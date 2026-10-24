"""Dependency-injectable paid provider; the default requires an independent opt-in."""

import hashlib
import os
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass

from fastapi import HTTPException

from app.llm import LLMProvider, LLMSettings, build_live_provider

PROMPT_VERSION = "ai-recommendation-v3-complete-rows"


@dataclass(frozen=True)
class AIRuntime:
    provider_factory: Callable[[], AbstractAsyncContextManager[LLMProvider]]
    provider: str = "mock"
    model: str = "scripted-fixture-v1"
    is_mock: bool = True
    timeout_seconds: float = 60
    max_output_tokens: int = 12000
    revision: str = PROMPT_VERSION

    def snapshot(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "execution_mode": "mock" if self.is_mock else "live",
            "prompt_version": PROMPT_VERSION,
            "revision": self.revision,
            "max_output_tokens": self.max_output_tokens,
            "timeout_seconds": self.timeout_seconds,
        }


def get_ai_runtime() -> AIRuntime:
    if os.environ.get("AI_RECOMMENDATIONS_LIVE_ENABLED", "").lower() != "true":
        raise HTTPException(503, "ai_recommendations_disabled")
    configured = LLMSettings()
    selected_model = configured.model or (
        "deepseek-flash" if configured.provider == "deepseek" else "qwen3.8-flash"
    )
    settings = configured.model_copy(
        update={
            "max_retries": 0,
            "timeout_seconds": 60,
            "thinking": "disabled",
            "model": selected_model,
        }
    )
    if not settings.api_key or not settings.api_key.get_secret_value().strip():
        raise HTTPException(503, "ai_recommendations_key_not_configured")

    @asynccontextmanager
    async def factory():
        provider = build_live_provider(settings)
        try:
            yield provider
        finally:
            await provider.aclose()

    return AIRuntime(
        provider_factory=factory,
        provider=settings.provider,
        model=selected_model,
        is_mock=False,
        revision=PROMPT_VERSION
        + "-"
        + hashlib.sha256((settings.base_url or "default").encode()).hexdigest()[:16],
    )
