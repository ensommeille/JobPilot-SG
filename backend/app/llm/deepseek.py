"""DeepSeek provider adapter for the shared JobPilot LLM contract."""

from __future__ import annotations

from typing import Literal

import httpx

from .contracts import StructuredGenerationRequest
from .openai_compatible import OpenAICompatibleChatProvider


class DeepSeekProvider(OpenAICompatibleChatProvider):
    """DeepSeek adapter using its OpenAI-compatible chat API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.deepseek.com",
        model: str = "deepseek-v4-flash",
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        retry_backoff_seconds: float = 0.25,
        client: httpx.AsyncClient | None = None,
        thinking: Literal["enabled", "disabled"] | None = None,
    ) -> None:
        super().__init__(
            name="deepseek",
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            retry_backoff_seconds=retry_backoff_seconds,
            client=client,
        )
        self.thinking = thinking

    def _build_payload(self, request: StructuredGenerationRequest) -> dict:
        payload = super()._build_payload(request)
        if self.thinking is not None:
            payload["thinking"] = {"type": self.thinking}
        return payload
