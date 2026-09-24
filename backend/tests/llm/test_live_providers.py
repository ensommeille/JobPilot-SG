"""Offline tests for M4 concrete provider adapters; no paid API calls are made."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from pydantic import SecretStr

from app.llm import (
    DeepSeekProvider,
    InvalidStructuredOutputError,
    LLMProvider,
    LLMProviderError,
    LLMSettings,
    Message,
    ProviderAuthenticationError,
    ProviderCapabilityError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    QwenProvider,
    StructuredGenerationRequest,
    build_live_provider,
)


def request() -> StructuredGenerationRequest:
    return StructuredGenerationRequest(
        request_id="m4-test-1",
        messages=[Message(role="user", content="Return the requested structured value.")],
        schema_name="simple_result",
        output_schema={
            "type": "object",
            "properties": {"answer": {"type": "string"}},
            "required": ["answer"],
            "additionalProperties": False,
        },
        temperature=0.0,
        max_output_tokens=100,
    )


def success_response(
    *, content: str = '{"answer":"ok"}', finish_reason: str = "stop"
) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "provider-request-1",
            "model": "resolved-model",
            "choices": [
                {
                    "finish_reason": finish_reason,
                    "message": {"role": "assistant", "content": content},
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 4},
        },
    )


def test_deepseek_provider_satisfies_protocol_and_maps_success() -> None:
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["authorization"] = req.headers.get("Authorization")
        captured["body"] = json.loads(req.content)
        return success_response()

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DeepSeekProvider(
        api_key="secret",
        client=client,
        retry_backoff_seconds=0,
    )
    assert isinstance(provider, LLMProvider)
    result = asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())

    assert result.data == {"answer": "ok"}
    assert result.provider == "deepseek"
    assert result.model == "resolved-model"
    assert result.finish_reason == "stop"
    assert result.usage.input_tokens == 12
    assert result.usage.output_tokens == 4
    assert result.provider_request_id == "provider-request-1"
    assert captured["authorization"] == "Bearer secret"

    body = captured["body"]
    assert isinstance(body, dict)
    assert body["response_format"] == {"type": "json_object"}
    assert body["temperature"] == 0.0
    assert body["max_tokens"] == 100
    assert "JSON Schema" in body["messages"][0]["content"]
    assert '"answer"' in body["messages"][0]["content"]


def test_qwen_provider_uses_configured_workspace_url() -> None:
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(str(req.url))
        return success_response()

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = QwenProvider(
        api_key="secret",
        base_url="https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        client=client,
        retry_backoff_seconds=0,
    )
    result = asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())

    assert result.provider == "qwen"
    assert seen == [
        "https://workspace.ap-southeast-1.maas.aliyuncs.com/"
        "compatible-mode/v1/chat/completions"
    ]


@pytest.mark.parametrize("content", ["not-json", "[]", "NaN"])
def test_invalid_structured_output_is_rejected(content: str) -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: success_response(content=content))
    )
    provider = DeepSeekProvider(api_key="secret", client=client, max_retries=0)
    with pytest.raises(InvalidStructuredOutputError):
        asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())


@pytest.mark.parametrize(
    ("vendor_reason", "expected"),
    [
        ("length", "length"),
        ("content_filter", "refusal"),
        ("refusal", "refusal"),
        ("tool_calls", "unknown"),
    ],
)
def test_non_stop_finish_reason_returns_no_data(
    vendor_reason: str, expected: str
) -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: success_response(content="not parsed", finish_reason=vendor_reason)
        )
    )
    provider = DeepSeekProvider(api_key="secret", client=client, max_retries=0)
    result = asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())
    assert result.finish_reason == expected
    assert result.data is None


@pytest.mark.parametrize(
    ("status_code", "error_type"),
    [
        (401, ProviderAuthenticationError),
        (403, ProviderAuthenticationError),
        (400, ProviderCapabilityError),
    ],
)
def test_non_retryable_http_errors_are_mapped(
    status_code: int, error_type: type[Exception]
) -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status_code))
    )
    provider = DeepSeekProvider(api_key="secret", client=client, max_retries=0)
    with pytest.raises(error_type):
        asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())


def test_rate_limit_is_retried_then_mapped() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DeepSeekProvider(
        api_key="secret",
        client=client,
        max_retries=2,
        retry_backoff_seconds=0,
    )
    with pytest.raises(ProviderRateLimitError):
        asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())
    assert calls == 3


def test_transient_server_error_recovers_with_retry() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return success_response()

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DeepSeekProvider(
        api_key="secret",
        client=client,
        max_retries=1,
        retry_backoff_seconds=0,
    )
    result = asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())
    assert result.data == {"answer": "ok"}
    assert calls == 2


def test_timeout_is_retried_then_mapped() -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("timed out", request=req)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DeepSeekProvider(
        api_key="secret",
        client=client,
        max_retries=1,
        retry_backoff_seconds=0,
    )
    with pytest.raises(ProviderTimeoutError):
        asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())
    assert calls == 2


def test_network_error_is_mapped_without_vendor_details() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("contains-vendor-detail", request=req)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DeepSeekProvider(
        api_key="secret",
        client=client,
        max_retries=0,
    )
    with pytest.raises(LLMProviderError) as exc_info:
        asyncio.run(provider.generate_structured(request()))
    asyncio.run(client.aclose())
    assert "contains-vendor-detail" not in str(exc_info.value)


def test_factory_builds_deepseek_without_exposing_secret() -> None:
    settings = LLMSettings(
        provider="deepseek",
        api_key=SecretStr("very-secret"),
        base_url="https://api.deepseek.com",
        model="deepseek-v4-flash",
        max_retries=0,
    )
    provider = build_live_provider(settings)
    assert isinstance(provider, DeepSeekProvider)
    assert provider.name == "deepseek"
    assert provider.is_mock is False
    assert provider.api_key == "very-secret"
    asyncio.run(provider.aclose())


def test_factory_requires_qwen_workspace_url() -> None:
    settings = LLMSettings(
        provider="qwen",
        api_key=SecretStr("secret"),
        base_url=None,
        model="qwen3.8-flash",
    )
    with pytest.raises(ProviderCapabilityError):
        build_live_provider(settings)


def test_factory_requires_api_key() -> None:
    settings = LLMSettings(provider="deepseek", api_key=None)
    with pytest.raises(ProviderAuthenticationError):
        build_live_provider(settings)
