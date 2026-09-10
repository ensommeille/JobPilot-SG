"""Job extraction business workflow with bounded repair and explicit review outcomes."""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from pydantic import Field, ValidationError

from app.llm import (
    CONTRACT_VERSION,
    InvalidStructuredOutputError,
    LLMProvider,
    LLMProviderError,
    StructuredGenerationRequest,
    StructuredGenerationResponse,
)

from .models import (
    SCHEMA_VERSION,
    AttemptRecord,
    ExtractionInput,
    ExtractionResult,
    JobExtractionSchema,
    StrictModel,
)
from .prompts import PROMPT_VERSION, build_messages
from .quality import assess_quality


class ExtractionConfig(StrictModel):
    max_validation_retries: int = Field(default=1, ge=0, le=2)
    provider_call_timeout_seconds: float = Field(default=60.0, gt=0, le=300)
    max_output_tokens: int = Field(default=2500, ge=1, le=16000)


class JobExtractionService:
    def __init__(self, provider: LLMProvider, config: ExtractionConfig | None = None) -> None:
        provider_name = provider.name
        provider_is_mock = provider.is_mock
        if not isinstance(provider_name, str) or not re.fullmatch(
            r"[a-zA-Z0-9_.-]{1,100}", provider_name
        ):
            raise ValueError("Provider name must be a safe identifier of at most 100 characters")
        if type(provider_is_mock) is not bool:
            raise ValueError("Provider is_mock must be a boolean")
        self.provider = provider
        self.provider_name = provider_name
        self.provider_is_mock = provider_is_mock
        selected_config = config or ExtractionConfig()
        self.config = ExtractionConfig.model_validate(selected_config.model_dump())

    async def extract(self, job: ExtractionInput) -> ExtractionResult:
        job = ExtractionInput.model_validate(job.model_dump())
        result_id = str(uuid4())
        started = datetime.now(UTC).isoformat()
        attempts: list[AttemptRecord] = []
        repair_codes: list[str] = []

        def finish(data: JobExtractionSchema | None, error: str | None) -> ExtractionResult:
            return ExtractionResult(
                result_id=result_id,
                source_id=job.source_id,
                external_id=job.external_id,
                source_url=job.source_url,
                input_hash=job.input_hash,
                raw_hash=job.raw_hash,
                schema_version=SCHEMA_VERSION,
                prompt_version=PROMPT_VERSION,
                contract_version=CONTRACT_VERSION,
                execution_mode="mock" if self.provider_is_mock else "live",
                status="needs_review" if data is not None else "failed",
                extraction=data,
                quality=assess_quality(data, job.description) if data is not None else None,
                error_code=error,
                attempts=attempts,
                started_at=started,
                finished_at=datetime.now(UTC).isoformat(),
            )

        for attempt in range(1, self.config.max_validation_retries + 2):
            request = StructuredGenerationRequest(
                request_id=f"{result_id}:{attempt}",
                messages=build_messages(job, repair_codes),
                schema_name="job_extraction_v1",
                output_schema=JobExtractionSchema.model_json_schema(),
                max_output_tokens=self.config.max_output_tokens,
            )
            clock = perf_counter()
            response: StructuredGenerationResponse | None = None
            data: JobExtractionSchema | None = None
            retry = False
            try:
                candidate = await asyncio.wait_for(
                    self.provider.generate_structured(request),
                    timeout=self.config.provider_call_timeout_seconds,
                )
                if not isinstance(candidate, StructuredGenerationResponse):
                    raise TypeError("Provider did not return the shared response DTO")
                # Revalidate a snapshot in case a mutable nested payload changed after DTO construction.
                response = StructuredGenerationResponse.model_validate(candidate.model_dump())
                if response.finish_reason != "stop":
                    outcome = f"provider_{response.finish_reason}"
                else:
                    data = JobExtractionSchema.model_validate(response.data)
                    outcome = "needs_review"
            except InvalidStructuredOutputError:
                outcome = "invalid_structured_output"
                repair_codes = [outcome]
                retry = True
            except ValidationError as exc:
                if response is None:
                    outcome = "provider_contract_error"
                else:
                    outcome = "schema_validation_failed"
                    repair_codes = [
                        error["type"]
                        for error in exc.errors(
                            include_input=False, include_url=False, include_context=False
                        )
                    ]
                    retry = True
            except TimeoutError:
                outcome = "provider_timeout"
            except LLMProviderError as exc:
                outcome = (
                    exc.code
                    if exc.code
                    in {
                        "provider_authentication_error",
                        "provider_rate_limit",
                        "provider_timeout",
                        "provider_capability_error",
                        "provider_error",
                    }
                    else "provider_error"
                )
            except Exception:
                # Isolate unexpected provider failures without leaking keys, prompts, or raw payloads.
                outcome = "unexpected_provider_error"
            attempts.append(
                AttemptRecord(
                    attempt=attempt,
                    request_id=request.request_id,
                    outcome=outcome,
                    duration_ms=round((perf_counter() - clock) * 1000, 3),
                    provider=response.provider
                    if isinstance(response, StructuredGenerationResponse)
                    else self.provider_name,
                    model=response.model
                    if isinstance(response, StructuredGenerationResponse)
                    else None,
                    provider_request_id=response.provider_request_id
                    if isinstance(response, StructuredGenerationResponse)
                    else None,
                    finish_reason=response.finish_reason
                    if isinstance(response, StructuredGenerationResponse)
                    else None,
                    usage=response.usage
                    if isinstance(response, StructuredGenerationResponse)
                    else None,
                )
            )
            if data is not None:
                return finish(data, None)
            if not retry or attempt > self.config.max_validation_retries:
                return finish(None, outcome)
        raise AssertionError("Bounded extraction loop must return")  # pragma: no cover
