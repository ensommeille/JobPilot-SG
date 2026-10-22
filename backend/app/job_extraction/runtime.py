"""Server-owned extraction profiles; live calls require explicit operator opt-in."""

import hashlib
import os
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field

from app.llm import CONTRACT_VERSION, LLMProvider, MockProvider, StructuredGenerationResponse

from .models import prompt_version_for, quality_version_for
from .service import ExtractionConfig


def live_runtime(settings) -> "ExtractionRuntime":
    """Explicit paid-call opt-in. Secrets never enter the pipeline fingerprint."""
    from app.llm.config import build_live_provider

    settings = settings.model_copy(deep=True, update={"max_retries": 0, "thinking": "disabled"})
    endpoint_revision = hashlib.sha256((settings.base_url or "default").encode()).hexdigest()[:16]

    @asynccontextmanager
    async def factory():
        provider = build_live_provider(settings)
        try:
            yield provider
        finally:
            await provider.aclose()

    return ExtractionRuntime(
        provider_factory=factory,
        profile_revision="live-extraction-v6-applicant-context-" + endpoint_revision,
        provider=settings.provider,
        model=settings.model
        or ("deepseek-v4-flash" if settings.provider == "deepseek" else "qwen3.8-flash"),
        is_mock=False,
        config=ExtractionConfig(
            max_validation_retries=0,
            provider_call_timeout_seconds=settings.timeout_seconds + 5,
            max_output_tokens=8000,
        ),
    )


@asynccontextmanager
async def mock_provider() -> AsyncIterator[LLMProvider]:
    """An explicit empty demonstration result, not a model or quality benchmark."""
    yield MockProvider(
        [
            StructuredGenerationResponse(
                provider="mock",
                model="scripted-fixture-v1",
                finish_reason="stop",
                data={
                    "summary": None,
                    "responsibilities": [],
                    "requirement_groups": [],
                    "education": {"degree": None, "fields_of_study": [], "enrollment": None},
                    "experience": {"requirement": None, "minimum_years": None},
                    "work_constraints": {
                        "schedule": None,
                        "hours": None,
                        "minimum_duration": None,
                        "work_modes": [],
                        "locations": [],
                    },
                },
            )
        ]
    )


@dataclass(frozen=True)
class ExtractionRuntime:
    """Factory owns cleanup; revision identifies model/routing/fixture configuration changes."""

    provider_factory: Callable[[], AbstractAsyncContextManager[LLMProvider]] = mock_provider
    profile_revision: str = "mock-empty-v2"
    provider: str = "mock"
    model: str = "scripted-fixture-v1"
    is_mock: bool = True
    config: ExtractionConfig = field(default_factory=ExtractionConfig)

    def snapshot(self) -> dict:
        return {
            "profile_revision": self.profile_revision,
            "provider": self.provider,
            "model": self.model,
            "execution_mode": "mock" if self.is_mock else "live",
            "config": self.config.model_dump(),
            "schema_version": self.config.schema_version,
            "prompt_version": prompt_version_for(self.config.schema_version),
            "quality_version": quality_version_for(self.config.schema_version),
            "contract_version": CONTRACT_VERSION,
        }


def get_extraction_runtime() -> ExtractionRuntime:
    # A key alone is not paid-call authorization. Deployment must explicitly opt in.
    if os.environ.get("JOB_EXTRACTION_LIVE_ENABLED", "").lower() == "true":
        from fastapi import HTTPException

        from app.llm.config import LLMSettings

        settings = LLMSettings()
        if not settings.api_key or not settings.api_key.get_secret_value().strip():
            raise HTTPException(503, "live_extraction_key_not_configured")
        return live_runtime(settings)
    return ExtractionRuntime()
