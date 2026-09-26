"""Server-owned extraction profiles. No live provider is enabled by this module."""

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field

from app.llm import CONTRACT_VERSION, LLMProvider, MockProvider, StructuredGenerationResponse

from .models import QUALITY_VERSION, SCHEMA_VERSION
from .prompts import PROMPT_VERSION
from .service import ExtractionConfig


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
                    "required_skills": [],
                    "preferred_skills": [],
                    "required_qualifications": [],
                    "preferred_qualifications": [],
                    "education": {"degree": None, "fields_of_study": [], "enrollment": None},
                    "experience": {"requirement": None, "minimum_years": None},
                    "languages": [],
                },
            )
        ]
    )


@dataclass(frozen=True)
class ExtractionRuntime:
    """Factory owns cleanup; revision identifies model/routing/fixture configuration changes."""

    provider_factory: Callable[[], AbstractAsyncContextManager[LLMProvider]] = mock_provider
    profile_revision: str = "mock-empty-v1"
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
            "schema_version": SCHEMA_VERSION,
            "prompt_version": PROMPT_VERSION,
            "quality_version": QUALITY_VERSION,
            "contract_version": CONTRACT_VERSION,
        }


def get_extraction_runtime() -> ExtractionRuntime:
    # Never infer authorization for a paid call from environment variables.
    return ExtractionRuntime()
