"""M3/M4 boundary tests using real provider adapters and strictly offline HTTP."""

import asyncio
import copy
import json

import httpx
import pytest

from app.job_extraction.batch import extract_batch
from app.llm import (
    DeepSeekProvider,
    MockProvider,
    ProviderAuthenticationError,
    QwenProvider,
    StructuredGenerationResponse,
)


@pytest.mark.parametrize("provider_class", [DeepSeekProvider, QwenProvider])
@pytest.mark.parametrize(
    "scenario", ["success", "repair", "invalid", "authentication", "truncated"]
)
def test_provider_to_extraction(provider_class, scenario, jobs, payload):
    requests = []

    def handler(request):
        assert request.url.host == "provider.example.test"
        body = json.loads(request.content)
        requests.append(body)
        if scenario == "authentication":
            return httpx.Response(401, json={"error": "DO_NOT_LEAK_RESPONSE"})
        data = payload
        if scenario == "invalid" or (scenario == "repair" and len(requests) == 1):
            data = {"unexpected": "DO_NOT_LEAK_RESPONSE"}
        return httpx.Response(
            200,
            json={
                "id": "offline-request",
                "model": "offline-model",
                "choices": [
                    {
                        "message": {"content": json.dumps(data)},
                        "finish_reason": "length" if scenario == "truncated" else "stop",
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 4},
            },
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = provider_class(
                api_key="offline-placeholder",
                client=client,
                base_url="https://provider.example.test/v1",
                max_retries=0,
            )
            return await extract_batch(jobs[:1], provider)

    original = copy.deepcopy(jobs)
    report = asyncio.run(run())
    assert jobs == original
    result = report["results"][0]["result"]
    assert result["contract_version"] == "0.1.0"
    assert result["source_id"] == jobs[0]["source_id"]
    assert result["external_id"] == jobs[0]["external_id"]
    assert '"required_skills"' in requests[0]["messages"][0]["content"]
    assert '"$defs"' in requests[0]["messages"][0]["content"]
    assert requests[0]["response_format"] == {"type": "json_object"}
    assert len(requests) == (2 if scenario in {"repair", "invalid"} else 1)
    assert "DO_NOT_LEAK_RESPONSE" not in json.dumps(report)
    if scenario in {"success", "repair"}:
        assert report["status"] == "completed_with_review"
        assert result["extraction"] == payload
        assert result["quality"]["requires_review"] is True
        assert result["attempts"][-1]["usage"]["input_tokens"] == 12
    else:
        assert report["failed_count"] == 1
        assert result["extraction"] is None
        assert (
            result["error_code"]
            == {
                "invalid": "schema_validation_failed",
                "authentication": "provider_authentication_error",
                "truncated": "provider_length",
            }[scenario]
        )


def test_batch_isolates_invalid_and_duplicate_inputs(jobs, payload):
    provider = MockProvider(
        [
            StructuredGenerationResponse(
                data=payload, provider="mock", model="offline", finish_reason="stop"
            )
        ]
    )
    report = asyncio.run(extract_batch([None, jobs[0], jobs[0]], provider))
    assert report["status"] == "partial"
    assert report["extracted_count"] == 1
    assert report["failed_count"] == 2
    assert report["results"][0]["input_index"] == 1
    assert report["input_failures"] == [
        {"input_index": 0, "error_code": "invalid_input"},
        {"input_index": 2, "error_code": "duplicate_input"},
    ]


@pytest.mark.parametrize("limit", [0, 101, True, 1.5])
def test_batch_rejects_invalid_limits(limit):
    with pytest.raises(ValueError):
        asyncio.run(extract_batch([], MockProvider([]), max_items=limit))


def test_batch_rejects_oversize_before_provider_call(jobs):
    with pytest.raises(ValueError):
        asyncio.run(extract_batch(jobs, MockProvider([]), max_items=1))


def test_empty_batch_has_no_success():
    report = asyncio.run(extract_batch([], MockProvider([])))
    assert report["status"] == "failed"
    assert report["results"] == []


def test_batch_continues_after_provider_failure(jobs, payload):
    provider = MockProvider(
        [
            ProviderAuthenticationError("DO_NOT_LEAK_RESPONSE"),
            StructuredGenerationResponse(
                data=payload, provider="mock", model="offline", finish_reason="stop"
            ),
        ]
    )
    report = asyncio.run(extract_batch(jobs[:2], provider))
    assert report["status"] == "partial"
    assert report["results"][0]["result"]["status"] == "failed"
    assert report["results"][1]["result"]["status"] == "needs_review"
    assert "DO_NOT_LEAK_RESPONSE" not in json.dumps(report)


def test_batch_propagates_cancellation(jobs):
    class CancelledProvider:
        name = "cancelled"
        is_mock = True

        async def generate_structured(self, request):
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(extract_batch(jobs[:1], CancelledProvider()))
