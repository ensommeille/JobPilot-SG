"""Offline regression for live-profile cache separation and immutable history."""

import hashlib
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import replace
from uuid import UUID

from app.db.models import JobExtractionRun
from app.job_extraction.runtime import get_extraction_runtime, live_runtime
from app.llm import MockProvider, StructuredGenerationResponse
from app.llm.config import LLMSettings
from app.main import app
from tests.job_extraction.test_persistence_api import setup_job as setup_job
from tests.job_extraction.test_persistence_api import trigger


def test_live_prompt_revision_does_not_reuse_or_rewrite_v5_history(
    client, db, setup_job, monkeypatch
):
    def forbid_live_provider(*_args, **_kwargs):
        raise AssertionError("This cache regression must never construct a live provider")

    monkeypatch.setattr("app.llm.config.build_live_provider", forbid_live_provider)
    endpoint = "https://llm.example.test/v1"
    settings = LLMSettings(
        _env_file=None,
        provider="deepseek",
        api_key="offline-test-placeholder",
        base_url=endpoint,
        model="offline-test-model",
    )
    configured = live_runtime(settings)
    endpoint_hash = hashlib.sha256(endpoint.encode()).hexdigest()[:16]
    assert configured.profile_revision == f"live-extraction-v6-applicant-context-{endpoint_hash}"

    providers = []
    payload = {
        "summary": {
            "value": "Build tested Python APIs.",
            "evidence": "Build tested Python APIs.",
        },
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
    }

    @asynccontextmanager
    async def offline_provider():
        provider = MockProvider(
            [
                StructuredGenerationResponse(
                    data=payload,
                    provider="mock",
                    model="scripted-fixture-v1",
                    finish_reason="stop",
                )
            ]
        )
        providers.append(provider)
        yield provider

    # Exercise the real live profile revision while truthfully marking all results
    # as scripted/offline; changing the profile never authorizes a paid model call.
    current = replace(
        configured,
        provider_factory=offline_provider,
        provider="mock",
        model="scripted-fixture-v1",
        is_mock=True,
    )
    legacy = replace(current, profile_revision=f"live-extraction-v5-evidence-scope-{endpoint_hash}")
    previous_override = app.dependency_overrides.get(get_extraction_runtime)
    app.dependency_overrides[get_extraction_runtime] = lambda: legacy
    try:
        first_response = trigger(client, setup_job)
        assert first_response.status_code == 201
        first = first_response.json()
        assert first["status"] == "needs_review"
        original = db.get(JobExtractionRun, UUID(first["id"]))
        before = deepcopy(
            {
                "input_json": original.input_json,
                "input_hash": original.input_hash,
                "pipeline_json": original.pipeline_json,
                "pipeline_hash": original.pipeline_hash,
                "result_json": original.result_json,
                "status": original.status,
            }
        )

        app.dependency_overrides[get_extraction_runtime] = lambda: current
        second_response = trigger(client, setup_job)
        assert second_response.status_code == 201
        second = second_response.json()
        assert second["reused"] is False
        assert second["id"] != first["id"]
        assert second["input_hash"] == first["input_hash"]
        assert second["pipeline_hash"] != first["pipeline_hash"]
        assert second["status"] == "needs_review"
        assert second["result"]["status"] == "needs_review"
        assert second["result"]["execution_mode"] == "mock"
        assert second["result"]["quality"]["requires_review"] is True
        assert second["result"]["schema_version"] == "job-extraction-v2"
        assert second["result"]["prompt_version"] == "job-extraction-prompt-v2"
        assert second["result"]["schema_version"] == first["result"]["schema_version"]
        assert second["result"]["prompt_version"] == first["result"]["prompt_version"]

        repeated = trigger(client, setup_job)
        assert repeated.status_code == 200
        assert repeated.json()["reused"] is True
        assert repeated.json()["id"] == second["id"]
        assert len(providers) == 2
        assert all(len(provider.requests) == 1 for provider in providers)

        job_id, _, headers = setup_job
        history = client.get(f"/jobs/{job_id}/extractions", headers=headers)
        assert history.status_code == 200
        assert history.json()["total"] == 2
        old = client.get(f"/extractions/{first['id']}", headers=headers)
        assert old.status_code == 200
        assert old.json()["is_stale"] is False
        assert old.json()["is_current_pipeline"] is False
        assert old.json()["result"] == first["result"]
        assert old.json()["pipeline"] == first["pipeline"]
        db.expire_all()
        original = db.get(JobExtractionRun, UUID(first["id"]))
        assert {
            "input_json": original.input_json,
            "input_hash": original.input_hash,
            "pipeline_json": original.pipeline_json,
            "pipeline_hash": original.pipeline_hash,
            "result_json": original.result_json,
            "status": original.status,
        } == before
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_extraction_runtime, None)
        else:
            app.dependency_overrides[get_extraction_runtime] = previous_override
