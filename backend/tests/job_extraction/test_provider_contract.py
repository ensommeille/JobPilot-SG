"""Generic provider expectations: reusable reference for Member 4 adapter tests."""

import asyncio
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.llm import (
    LLMProvider,
    Message,
    MockProvider,
    StructuredGenerationRequest,
    StructuredGenerationResponse,
)
from app.llm.mock import MockProviderExhausted


def request():
    # Deliberately unrelated to jobs: the shared provider must be domain-neutral.
    return StructuredGenerationRequest(
        request_id="contract-test-1",
        messages=[Message(role="user", content="Return an answer")],
        schema_name="generic_answer",
        output_schema={
            "type": "object",
            "properties": {"answer": {"type": "string"}},
            "required": ["answer"],
            "additionalProperties": False,
        },
    )


def test_generic_provider_contract():
    provider = MockProvider(
        [
            StructuredGenerationResponse(
                data={"answer": "ok"},
                provider="mock",
                model="fixture",
                finish_reason="stop",
            )
        ]
    )
    assert isinstance(provider, LLMProvider)
    result = asyncio.run(provider.generate_structured(request()))
    assert result.data == {"answer": "ok"}
    assert result.usage.input_tokens is None
    assert provider.is_mock is True


def test_mock_copies_request_and_response(response):
    provider = MockProvider([response])
    req = request()
    result = asyncio.run(provider.generate_structured(req))
    req.output_schema["new"] = "changed"
    result.data.clear()
    assert "new" not in provider.requests[0].output_schema
    assert response.data


def test_mock_exhaustion_is_explicit():
    with pytest.raises(MockProviderExhausted):
        asyncio.run(MockProvider([]).generate_structured(request()))


def test_response_allows_object_that_consumer_must_validate():
    response = StructuredGenerationResponse(
        data={}, provider="qwen", model="configured-model", finish_reason="stop"
    )
    assert response.data == {}


@pytest.mark.parametrize(
    "data,reason", [(None, "stop"), ([], "stop"), ("{}", "stop"), ({}, "invalid")]
)
def test_invalid_response_contract_rejected(data, reason):
    with pytest.raises(ValidationError):
        StructuredGenerationResponse(data=data, provider="test", model="test", finish_reason=reason)


def test_nonfinite_latency_rejected():
    with pytest.raises(ValidationError):
        StructuredGenerationResponse(
            data={}, provider="test", model="test", finish_reason="stop", latency_ms=float("inf")
        )


def test_contract_version_mismatch_rejected():
    payload = request().model_dump()
    payload["contract_version"] = "2.0.0"
    with pytest.raises(ValidationError):
        StructuredGenerationRequest.model_validate(payload)


@pytest.mark.parametrize(
    "schema",
    [
        {"type": "array"},
        {"type": "object", "example": float("nan")},
        {"type": "object", "example": datetime.now(UTC)},
    ],
)
def test_request_requires_json_compatible_object_schema(schema):
    payload = request().model_dump()
    payload["output_schema"] = schema
    with pytest.raises(ValidationError):
        StructuredGenerationRequest.model_validate(payload)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), datetime.now(UTC), b"bytes"])
def test_response_rejects_non_json_values(value):
    with pytest.raises(ValidationError):
        StructuredGenerationResponse(
            data={"answer": value}, provider="test", model="test", finish_reason="stop"
        )


@pytest.mark.parametrize("provider", ["", "bad provider", "line\nbreak", "x" * 101])
def test_response_rejects_unsafe_provider_identifier(provider):
    with pytest.raises(ValidationError):
        StructuredGenerationResponse(data={}, provider=provider, model="test", finish_reason="stop")
