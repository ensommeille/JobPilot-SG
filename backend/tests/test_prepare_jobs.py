"""Isolated transport tests for the real-provider pipeline; never paid calls in CI."""

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import replace

import httpx
import pytest
from sqlalchemy import func, select

from app.db.models import JobExtractionRun, JobPosting, JobSource, User
from app.job_extraction.runtime import ExtractionRuntime, live_runtime
from app.llm.config import LLMSettings
from app.llm.deepseek import DeepSeekProvider
from app.prepare_jobs import prepare
from tests.test_ingestion_admin import FakeAdapter, auth_headers


@pytest.fixture
def pipeline(client, db):
    auth_headers(client, db, "prepare@example.com", admin=True)
    actor = db.scalar(select(User))
    source = JobSource(
        name="Pipeline test", source_type="html", base_url="https://www.internsg.com"
    )
    db.add(source)
    db.commit()
    return actor, source


def runtime(calls, status=200):
    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(
            status,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": None,
                                    "responsibilities": [],
                                    "required_skills": [
                                        {"value": "Python", "evidence": "Python required."}
                                    ],
                                    "preferred_skills": [],
                                    "required_qualifications": [],
                                    "preferred_qualifications": [],
                                    "education": {
                                        "degree": None,
                                        "enrollment": None,
                                        "fields_of_study": [],
                                    },
                                    "experience": {"requirement": None, "minimum_years": None},
                                    "languages": [],
                                }
                            )
                        },
                    }
                ]
            },
        )

    @asynccontextmanager
    async def factory():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            yield DeepSeekProvider(api_key="test-only", client=client, max_retries=0)

    return replace(
        ExtractionRuntime(), provider_factory=factory, provider="deepseek", is_mock=False
    )


def test_jd_persisted_live_result_reused_and_updated(client, db, pipeline):
    actor, source = pipeline
    calls = []
    rt = runtime(calls)
    text = ["Python required."]

    def adapter(src):
        return FakeAdapter(
            str(src.id),
            record_overrides={
                "description": text[0],
                "raw_hash": ("1" if len(text[0]) == 16 else "2") * 64,
            },
        )

    def run():
        return asyncio.run(
            prepare(db, source=source, actor=actor, runtime=rt, limit=1, adapter_factory=adapter)
        )

    first = run()
    assert first["jobs"][0]["status"] == "needs_review"
    job = db.scalar(select(JobPosting))
    assert job.description == text[0]
    assert job.source_url
    result = db.scalar(select(JobExtractionRun)).result_json
    assert result["execution_mode"] == "live"
    assert result["extraction"]["required_skills"][0]["evidence"] == text[0]
    assert run()["jobs"][0]["reused"] is True
    assert len(calls) == 1
    text[0] += " Build APIs."
    assert run()["jobs"][0]["reused"] is False
    assert len(calls) == 2
    db.refresh(job)
    assert job.description == text[0]


@pytest.mark.parametrize("mode", ["crawl", "provider"])
def test_failure_is_recorded_without_mock_fallback(client, db, pipeline, mode):
    actor, source = pipeline
    calls = []
    result = asyncio.run(
        prepare(
            db,
            source=source,
            actor=actor,
            runtime=runtime(calls, 401),
            limit=1,
            adapter_factory=lambda src: FakeAdapter(str(src.id), fail=mode == "crawl"),
        )
    )
    if mode == "crawl":
        assert result["crawl_status"] == "failed"
        assert calls == []
        assert db.scalar(select(func.count()).select_from(JobPosting)) == 0
    else:
        assert result["jobs"][0]["error_code"] == "provider_authentication_error"
        assert len(calls) == 1
        run = db.scalar(select(JobExtractionRun))
        assert run.result_json["execution_mode"] == "live"
        assert run.status == "failed"


@pytest.mark.parametrize(
    ("status", "error_code"),
    [(401, "provider_authentication_error"), (429, "provider_rate_limit")],
)
def test_provider_auth_or_rate_limit_stops_remaining_jobs(db, pipeline, status, error_code):
    actor, source = pipeline
    calls = []

    class MultiJobAdapter(FakeAdapter):
        def collect(self, *, max_links, max_details):
            assert max_links == max_details == 3
            batches = [
                FakeAdapter(
                    self.config.source_id,
                    record_overrides={
                        "external_id": f"stop-{index}",
                        "source_url": f"https://jobs.example.test/job/stop-{index}",
                        "dedup_hash": str(index) * 64,
                    },
                ).collect(max_links=1, max_details=1)
                for index in range(1, 4)
            ]
            return batches[0].model_copy(
                update={
                    "discovered_count": 3,
                    "attempted_count": 3,
                    "items": [batch.items[0] for batch in batches],
                }
            )

    result = asyncio.run(
        prepare(
            db,
            source=source,
            actor=actor,
            runtime=runtime(calls, status),
            limit=3,
            adapter_factory=lambda src: MultiJobAdapter(str(src.id)),
        )
    )

    assert result["crawl_status"] == "succeeded"
    assert db.scalar(select(func.count()).select_from(JobPosting)) == 3
    assert len(calls) == 1
    assert len(result["jobs"]) == 1
    assert result["jobs"][0]["status"] == "failed"
    assert result["jobs"][0]["error_code"] == error_code
    runs = list(db.scalars(select(JobExtractionRun)))
    assert len(runs) == 1
    assert runs[0].error_code == error_code
    assert runs[0].status == "failed"
    assert runs[0].active_key is None


def test_preflight_rejects_mock_nonadmin_and_bad_limits(client, db, pipeline):
    actor, source = pipeline
    for rt, limit in [(ExtractionRuntime(), 1), (runtime([]), 11)]:
        with pytest.raises(ValueError):
            asyncio.run(prepare(db, source=source, actor=actor, runtime=rt, limit=limit))
    actor.is_active = False
    with pytest.raises(ValueError):
        asyncio.run(prepare(db, source=source, actor=actor, runtime=runtime([])))


def test_live_runtime_snapshot_does_not_store_key():
    config = LLMSettings(api_key="private-test-value", model="selected-model", max_retries=0)
    rt = live_runtime(config)
    assert rt.is_mock is False
    assert rt.snapshot()["execution_mode"] == "live"
    assert rt.model == "selected-model"
    assert "private-test-value" not in json.dumps(rt.snapshot())
    assert rt.config.max_validation_retries == 0


def test_server_live_flag_requires_key_and_never_falls_back(monkeypatch):
    from fastapi import HTTPException

    from app.job_extraction.runtime import get_extraction_runtime

    monkeypatch.setenv("JOB_EXTRACTION_LIVE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "")
    with pytest.raises(HTTPException) as error:
        get_extraction_runtime()
    assert error.value.status_code == 503
    monkeypatch.setenv("LLM_API_KEY", "only-a-test-key")
    assert get_extraction_runtime().is_mock is False
    monkeypatch.delenv("JOB_EXTRACTION_LIVE_ENABLED")
    assert get_extraction_runtime().is_mock is True


def test_extraction_runtime_disables_thinking_without_changing_provider_default():
    from tests.llm.test_live_providers import request

    async def check():
        settings = LLMSettings(api_key="test-only", thinking="enabled", max_retries=2)
        rt = live_runtime(settings)
        async with rt.provider_factory() as provider:
            assert provider._build_payload(request())["thinking"] == {"type": "disabled"}
            assert provider.max_retries == 0
        assert settings.thinking == "enabled"
        provider = DeepSeekProvider(api_key="test-only")
        try:
            assert "thinking" not in provider._build_payload(request())
        finally:
            await provider.aclose()

    asyncio.run(check())
