"""Business retries, traceability, and safe provider failure isolation."""

import asyncio
import json

import pytest
from pydantic import ValidationError

from app.job_extraction.models import ExtractionResult
from app.job_extraction.service import ExtractionConfig, JobExtractionService
from app.llm import (
    InvalidStructuredOutputError,
    MockProvider,
    ProviderAuthenticationError,
    ProviderCapabilityError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    StructuredGenerationResponse,
    TokenUsage,
)


def extract(provider, job, config=None):
    return asyncio.run(JobExtractionService(provider, config).extract(job))


def test_success_records_versions_usage_and_review(job, response):
    response.usage = TokenUsage(input_tokens=100, output_tokens=80)
    response.provider_request_id = "vendor-request-42"
    provider = MockProvider([response])
    result = extract(provider, job)
    assert result.status == "needs_review"
    assert result.execution_mode == "mock"
    assert result.input_hash == job.input_hash
    assert result.quality.score == 1.0
    assert result.schema_version == "job-extraction-v1"
    assert result.prompt_version == "job-extraction-prompt-v1"
    assert result.contract_version == "0.1.0"
    assert result.attempts[0].usage.input_tokens == 100
    assert result.attempts[0].provider_request_id == "vendor-request-42"
    assert provider.requests[0].schema_name == "job_extraction_v1"


def test_actual_response_provider_is_audited(job, response):
    response = response.model_copy(update={"provider": "fallback-provider"})
    result = extract(MockProvider([response]), job)
    # MockProvider deliberately replaces metadata with its actual implementation identity.
    assert result.attempts[0].provider == "mock"


def test_schema_repair_once(job, response):
    broken = response.model_copy(deep=True)
    broken.data.pop("languages")
    provider = MockProvider([broken, response])
    result = extract(provider, job)
    assert result.status == "needs_review"
    assert [a.outcome for a in result.attempts] == ["schema_validation_failed", "needs_review"]
    assert provider.requests[0].request_id != provider.requests[1].request_id
    repair = json.loads(provider.requests[1].messages[1].content)
    assert "missing" in repair["previous_validation_codes"]


def test_repair_does_not_echo_untrusted_extra_key(job, response):
    bad = response.model_copy(deep=True)
    bad.data["SECRET-DO-NOT-ECHO"] = "payload"
    provider = MockProvider([bad, response])
    assert extract(provider, job).status == "needs_review"
    assert "SECRET-DO-NOT-ECHO" not in provider.requests[1].messages[1].content


@pytest.mark.parametrize("retries", [0, 1, 2])
def test_repair_has_hard_bound(job, retries):
    provider = MockProvider([InvalidStructuredOutputError("raw secret")] * 4)
    result = extract(provider, job, ExtractionConfig(max_validation_retries=retries))
    assert result.status == "failed"
    assert result.error_code == "invalid_structured_output"
    assert len(provider.requests) == retries + 1
    assert "raw secret" not in result.model_dump_json()


def test_invalid_json_can_recover(job, response):
    provider = MockProvider([InvalidStructuredOutputError(), response])
    assert extract(provider, job).status == "needs_review"


@pytest.mark.parametrize(
    "error,code",
    [
        (ProviderAuthenticationError, "provider_authentication_error"),
        (ProviderRateLimitError, "provider_rate_limit"),
        (ProviderCapabilityError, "provider_capability_error"),
        (ProviderTimeoutError, "provider_timeout"),
        (RuntimeError, "unexpected_provider_error"),
    ],
)
def test_provider_failures_are_not_schema_retried(job, error, code):
    provider = MockProvider([error("secret-key-and-sensitive-payload")])
    result = extract(provider, job)
    assert result.error_code == code
    assert len(provider.requests) == 1
    assert "secret-key" not in result.model_dump_json()


@pytest.mark.parametrize("reason", ["length", "refusal", "unknown"])
def test_non_success_finish_reasons_do_not_accept_partial_output(job, reason):
    provider = MockProvider(
        [
            StructuredGenerationResponse(
                data=None,
                provider="mock",
                model="fixture",
                finish_reason=reason,
            )
        ]
    )
    result = extract(provider, job)
    assert result.error_code == f"provider_{reason}"
    assert result.extraction is None
    assert len(result.attempts) == 1


def test_timeout_is_bounded(job):
    class SlowProvider:
        name = "slow"
        is_mock = False

        async def generate_structured(self, request):
            await asyncio.sleep(10)

    result = extract(SlowProvider(), job, ExtractionConfig(provider_call_timeout_seconds=0.01))
    assert result.error_code == "provider_timeout"
    assert result.execution_mode == "live"


def test_cancellation_propagates(job):
    class CancelledProvider:
        name = "cancelled"
        is_mock = False

        async def generate_structured(self, request):
            raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        extract(CancelledProvider(), job)


def test_wrong_provider_return_type(job):
    class WrongProvider:
        name = "wrong"
        is_mock = False

        async def generate_structured(self, request):
            return {"data": {}}

    assert extract(WrongProvider(), job).error_code == "unexpected_provider_error"


def test_provider_dto_validation_failure_is_not_business_retried(job):
    class BrokenProvider:
        name = "broken"
        is_mock = False

        async def generate_structured(self, request):
            return StructuredGenerationResponse(
                data=None, provider="broken", model="model", finish_reason="stop"
            )

    result = extract(BrokenProvider(), job)
    assert result.error_code == "provider_contract_error"
    assert len(result.attempts) == 1


def test_mutated_nested_provider_payload_is_revalidated(job, response):
    response.data["summary"]["value"] = float("nan")
    result = extract(MockProvider([response]), job)
    assert result.error_code == "provider_contract_error"
    assert len(result.attempts) == 1


def test_unknown_provider_error_code_is_not_persisted(job):
    class UnsafeError(ProviderAuthenticationError):
        code = "secret_api_key_value"

    result = extract(MockProvider([UnsafeError("more sensitive text")]), job)
    assert result.error_code == "provider_error"
    assert "secret" not in result.model_dump_json()


@pytest.mark.parametrize("name,is_mock", [("bad name", False), ("ok", 1), ("x" * 101, False)])
def test_invalid_provider_metadata_fails_before_calls(name, is_mock):
    class BadMetadataProvider:
        async def generate_structured(self, request):
            raise AssertionError("must not be called")

    provider = BadMetadataProvider()
    provider.name = name
    provider.is_mock = is_mock
    with pytest.raises(ValueError):
        JobExtractionService(provider)


def test_config_is_revalidated_and_copied(response):
    config = ExtractionConfig()
    config.provider_call_timeout_seconds = -1
    with pytest.raises(ValidationError):
        JobExtractionService(MockProvider([response]), config)


def test_evidence_failure_is_preserved_for_review(job, response):
    response.data["summary"]["evidence"] = "This quote is fabricated."
    result = extract(MockProvider([response]), job)
    assert result.status == "needs_review"
    assert result.quality.score < 1
    assert result.extraction.summary.evidence == "This quote is fabricated."
    assert len(result.attempts) == 1


def test_audit_result_rejects_inconsistent_status(job, response):
    result = extract(MockProvider([response]), job).model_dump()
    result["status"] = "failed"
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate(result)


@pytest.mark.parametrize(
    "field,value",
    [
        ("input_hash", "not-a-hash"),
        ("raw_hash", "not-a-hash"),
        ("schema_version", "future-version"),
        ("result_id", "not-a-uuid"),
        ("started_at", "2026-01-01T00:00:00"),
    ],
)
def test_audit_result_rejects_invalid_provenance(job, response, field, value):
    result = extract(MockProvider([response]), job).model_dump()
    result[field] = value
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate(result)


def test_audit_result_rejects_reverse_time_and_nonconsecutive_attempts(job, response):
    result = extract(MockProvider([response]), job).model_dump()
    result["finished_at"] = "2020-01-01T00:00:00+00:00"
    with pytest.raises(ValidationError, match="precede"):
        ExtractionResult.model_validate(result)
    result = extract(MockProvider([response]), job).model_dump()
    result["attempts"][0]["attempt"] = 2
    with pytest.raises(ValidationError, match="consecutive"):
        ExtractionResult.model_validate(result)
    result["status"] = "needs_review"
    result["quality"] = None
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate(result)
