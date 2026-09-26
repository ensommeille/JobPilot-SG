"""OpenAI-compatible HTTP transport used by concrete JobPilot LLM providers."""

from __future__ import annotations

import asyncio
import json
from time import perf_counter
from typing import Any

import httpx

from .contracts import (
    InvalidStructuredOutputError,
    LLMProviderError,
    ProviderAuthenticationError,
    ProviderCapabilityError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    StructuredGenerationRequest,
    StructuredGenerationResponse,
    TokenUsage,
)


class OpenAICompatibleChatProvider:
    """Map the shared JobPilot contract to an OpenAI-compatible chat endpoint."""

    is_mock = False

    def __init__(
        self,
        *,
        name: str,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        retry_backoff_seconds: float = 0.25,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not name.strip():
            raise ValueError("provider name must not be empty")
        if not api_key.strip():
            raise ProviderAuthenticationError("LLM API key is not configured")
        if not base_url.strip():
            raise ProviderCapabilityError("LLM base URL is not configured")
        if not model.strip():
            raise ProviderCapabilityError("LLM model is not configured")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if max_retries < 0:
            raise ValueError("max_retries must be non-negative")
        if retry_backoff_seconds < 0:
            raise ValueError("retry_backoff_seconds must be non-negative")

        self._name = name
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_backoff_seconds = retry_backoff_seconds
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None

    @property
    def name(self) -> str:
        return self._name

    @property
    def chat_completions_url(self) -> str:
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return f"{self.base_url}/chat/completions"

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def generate_structured(
        self, request: StructuredGenerationRequest
    ) -> StructuredGenerationResponse:
        payload = self._build_payload(request)
        started = perf_counter()
        response = await self._post_with_retries(payload)
        latency_ms = (perf_counter() - started) * 1000
        return self._parse_response(response, latency_ms=latency_ms)

    def _build_payload(self, request: StructuredGenerationRequest) -> dict[str, Any]:
        schema_json = json.dumps(
            request.output_schema,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        schema_instruction = (
            "Return exactly one JSON object and no Markdown or explanatory text. "
            "The JSON object must conform to this JSON Schema: "
            f"{schema_json}"
        )
        messages = [{"role": "system", "content": schema_instruction}]
        messages.extend(message.model_dump() for message in request.messages)
        return {
            "model": self.model,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_output_tokens,
            "response_format": {"type": "json_object"},
        }

    async def _post_with_retries(self, payload: dict[str, Any]) -> httpx.Response:
        last_network_error: httpx.RequestError | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.post(
                    self.chat_completions_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=self.timeout_seconds,
                )
            except httpx.TimeoutException as exc:
                if attempt < self.max_retries:
                    await self._sleep_before_retry(attempt)
                    continue
                raise ProviderTimeoutError("LLM provider request timed out") from exc
            except httpx.RequestError as exc:
                last_network_error = exc
                if attempt < self.max_retries:
                    await self._sleep_before_retry(attempt)
                    continue
                raise LLMProviderError("LLM provider network request failed") from exc

            if response.status_code in {401, 403}:
                raise ProviderAuthenticationError("LLM provider authentication failed")
            if response.status_code == 429:
                if attempt < self.max_retries:
                    await self._sleep_before_retry(attempt)
                    continue
                raise ProviderRateLimitError("LLM provider rate limit exhausted")
            if response.status_code >= 500:
                if attempt < self.max_retries:
                    await self._sleep_before_retry(attempt)
                    continue
                raise LLMProviderError("LLM provider server error")
            if response.status_code >= 400:
                raise ProviderCapabilityError(
                    f"LLM provider rejected the structured request with HTTP {response.status_code}"
                )
            return response

        raise LLMProviderError("LLM provider request failed") from last_network_error

    async def _sleep_before_retry(self, attempt: int) -> None:
        delay = self.retry_backoff_seconds * (2**attempt)
        if delay > 0:
            await asyncio.sleep(delay)

    def _parse_response(
        self, response: httpx.Response, *, latency_ms: float
    ) -> StructuredGenerationResponse:
        try:
            payload = response.json()
        except ValueError as exc:
            raise LLMProviderError("LLM provider returned a non-JSON HTTP response") from exc
        if not isinstance(payload, dict):
            raise LLMProviderError("LLM provider returned an invalid response envelope")

        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise LLMProviderError("LLM provider response has no usable choice")

        choice = choices[0]
        finish_reason = self._map_finish_reason(choice.get("finish_reason"))
        data: dict[str, Any] | None = None
        if finish_reason == "stop":
            message = choice.get("message")
            if not isinstance(message, dict):
                raise InvalidStructuredOutputError("LLM response message is missing")
            content = message.get("content")
            if not isinstance(content, str) or not content.strip():
                raise InvalidStructuredOutputError("LLM returned empty structured output")
            data = self._parse_json_object(content)

        usage_payload = payload.get("usage")
        usage = self._parse_usage(usage_payload if isinstance(usage_payload, dict) else {})
        provider_request_id = payload.get("id")
        if not isinstance(provider_request_id, str):
            provider_request_id = None
        resolved_model = payload.get("model")
        if not isinstance(resolved_model, str) or not resolved_model.strip():
            resolved_model = self.model

        return StructuredGenerationResponse(
            data=data,
            provider=self.name,
            model=resolved_model,
            finish_reason=finish_reason,
            usage=usage,
            provider_request_id=provider_request_id,
            latency_ms=latency_ms,
        )

    @staticmethod
    def _parse_json_object(content: str) -> dict[str, Any]:
        def reject_constant(value: str) -> None:
            raise ValueError(f"non-standard JSON constant: {value}")

        try:
            parsed = json.loads(content, parse_constant=reject_constant)
        except (json.JSONDecodeError, ValueError) as exc:
            raise InvalidStructuredOutputError("LLM returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise InvalidStructuredOutputError("LLM structured output must be a JSON object")
        return parsed

    @staticmethod
    def _map_finish_reason(value: Any) -> str:
        if value == "stop":
            return "stop"
        if value == "length":
            return "length"
        if value in {"content_filter", "refusal"}:
            return "refusal"
        return "unknown"

    @staticmethod
    def _parse_usage(payload: dict[str, Any]) -> TokenUsage:
        input_tokens = OpenAICompatibleChatProvider._nonnegative_int(
            payload.get("prompt_tokens", payload.get("input_tokens"))
        )
        output_tokens = OpenAICompatibleChatProvider._nonnegative_int(
            payload.get("completion_tokens", payload.get("output_tokens"))
        )
        return TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens)

    @staticmethod
    def _nonnegative_int(value: Any) -> int | None:
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
        return None
