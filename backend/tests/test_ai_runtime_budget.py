"""A larger bounded response budget never admits truncated model output."""

import asyncio
from contextlib import asynccontextmanager
from uuid import UUID

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import select

from app.ai_recommendations import runtime as module
from app.ai_recommendations.models import AIRecommendationRun
from app.ai_recommendations.runtime import AIRuntime, get_ai_runtime
from app.llm import LLMSettings, Message, StructuredGenerationRequest
from app.main import app
from tests import test_ai_recommendations as shared

context = shared.context
provider = shared.provider


def test_default_batch_budget_matches_the_provider_timeout(monkeypatch):
    configured = LLMSettings(api_key=SecretStr("offline-placeholder"), provider="deepseek")
    monkeypatch.setenv("AI_RECOMMENDATIONS_LIVE_ENABLED", "true")
    monkeypatch.setattr(module, "LLMSettings", lambda: configured)
    seen = []

    class OfflineProvider:
        async def aclose(self):
            pass

    def factory(settings):
        seen.append(settings)
        return OfflineProvider()

    monkeypatch.setattr(module, "build_live_provider", factory)
    runtime = get_ai_runtime()
    assert runtime.snapshot()["max_output_tokens"] == 20000
    assert runtime.snapshot()["timeout_seconds"] == 75
    assert runtime.snapshot()["prompt_version"] == "ai-recommendation-v9-evidence-scope"

    async def enter():
        async with runtime.provider_factory():
            pass

    asyncio.run(enter())
    assert len(seen) == 1
    assert seen[0].timeout_seconds == 75 and seen[0].max_retries == 0
    assert seen[0].thinking == "disabled"


@pytest.mark.parametrize("partial", [False, True])
def test_length_response_never_exposes_partial_and_same_budget_does_not_retry(
    client, db, context, provider, monkeypatch, partial
):
    original = provider.generate_structured

    async def truncated(request):
        generated = await original(request)
        return generated.model_copy(
            update={
                "finish_reason": "length",
                "data": generated.data if partial else None,
            }
        )

    monkeypatch.setattr(provider, "generate_structured", truncated)
    first = shared.post(client, context).json()
    assert first["status"] == "failed" and first["error_code"] == "incomplete_output"
    assert first["result"] is None and first["advice"] == {} and first["display_order"] == []
    assert provider.calls[0].max_output_tokens == 20000
    saved = db.scalar(select(AIRecommendationRun))
    assert saved.result_json is None
    assert shared.post(client, context).json()["id"] == first["id"]
    read = client.get(f"/ai-recommendations/{first['id']}", headers=context.headers).json()
    assert read["result"] is None and read["advice"] == {}
    detail = client.get(f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers).json()
    assert (
        detail["status"] == "failed" and detail["assessment"] is None and detail["advice"] is None
    )
    assert len(provider.calls) == 1


def test_new_explicit_budget_has_new_identity_without_rewriting_failed_attempt(
    client, db, context, provider, monkeypatch
):
    original = provider.generate_structured

    async def once_truncated(request):
        generated = await original(request)
        if len(provider.calls) == 1:
            return generated.model_copy(update={"finish_reason": "length", "data": None})
        return generated

    monkeypatch.setattr(provider, "generate_structured", once_truncated)

    @asynccontextmanager
    async def factory():
        yield provider

    app.dependency_overrides[get_ai_runtime] = lambda: AIRuntime(
        provider_factory=factory,
        max_output_tokens=12000,
        timeout_seconds=60,
    )
    first = shared.post(client, context).json()
    assert first["status"] == "failed"
    repeated = shared.post(client, context).json()
    assert repeated["id"] == first["id"] and len(provider.calls) == 1
    app.dependency_overrides[get_ai_runtime] = lambda: AIRuntime(provider_factory=factory)
    second = shared.post(client, context).json()
    assert second["status"] == "succeeded" and second["reused"] is False
    assert second["id"] != first["id"] and second["input_hash"] != first["input_hash"]
    assert len(provider.calls) == 2
    previous = db.get(AIRecommendationRun, UUID(first["id"]))
    assert previous.status == "failed" and previous.result_json is None
    assert previous.pipeline_json["max_output_tokens"] == 12000
    assert previous.pipeline_json["timeout_seconds"] == 60


def test_shared_budget_contract_allows_the_selected_budget_and_stays_bounded():
    assert LLMSettings(timeout_seconds=75).timeout_seconds == 75
    kwargs = dict(
        request_id="offline",
        schema_name="offline_budget",
        messages=[Message(role="user", content="Offline")],
        output_schema={"type": "object"},
    )
    with pytest.raises(ValidationError):
        LLMSettings(timeout_seconds=76)
    assert StructuredGenerationRequest(**kwargs, max_output_tokens=20000).max_output_tokens == 20000
    with pytest.raises(ValidationError):
        StructuredGenerationRequest(**kwargs, max_output_tokens=20001)
