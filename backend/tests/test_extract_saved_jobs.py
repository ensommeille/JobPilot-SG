"""Saved public JDs are prepared only by an authorized, bounded live workflow."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.db.models import JobPosting, JobSource, User
from app.extract_saved_jobs import pending_jobs, prepare_saved
from app.job_extraction.runtime import ExtractionRuntime
from tests.test_ingestion_admin import auth_headers
from tests.test_prepare_jobs import runtime


@pytest.fixture
def stored(client, db):
    auth_headers(client, db, "saved-extraction-admin@example.com", admin=True)
    actor = db.scalar(select(User))
    source = JobSource(name="Public ATS", source_type="api", base_url="https://jobs.example.test")
    sandbox = JobSource(name="Sandbox", source_type="sandbox", base_url="https://example.test")
    db.add_all([source, sandbox])
    db.flush()

    def add(source_id, title):
        job = JobPosting(
            source_id=source_id,
            external_id=str(uuid4()),
            title=title,
            company="Example",
            description="Python required.",
            source_url="https://jobs.example.test/job/" + str(uuid4()),
            apply_url="https://jobs.example.test/apply",
            raw_hash="a" * 64,
            dedup_hash=uuid4().hex * 2,
        )
        db.add(job)
        db.flush()
        return job

    first = add(source.id, "Public one")
    second = add(source.id, "Public two")
    add(sandbox.id, "Demo only")
    db.commit()
    return actor, first, second


def test_preview_selects_real_jobs_and_skips_current_live_results(db, stored):
    actor, first, second = stored
    jobs = pending_jobs(db, limit=10)
    assert {job.id for job in jobs} == {first.id, second.id}
    calls = []
    report = asyncio.run(prepare_saved(db, actor=actor, jobs=[first], runtime=runtime(calls)))
    assert report["jobs"][0]["status"] == "needs_review"
    assert len(calls) == 1
    assert [job.id for job in pending_jobs(db, limit=10)] == [second.id]
    first.description += " Another stated fact."
    db.commit()
    assert {job.id for job in pending_jobs(db, limit=10)} == {first.id, second.id}


def test_live_preparation_stops_after_authentication_failure(db, stored):
    actor, first, second = stored
    calls = []
    report = asyncio.run(
        prepare_saved(db, actor=actor, jobs=[first, second], runtime=runtime(calls, 401))
    )
    assert len(calls) == 1
    assert len(report["jobs"]) == 1
    assert report["jobs"][0]["error_code"] == "provider_authentication_error"


def test_mock_and_unbounded_batches_fail_closed(db, stored):
    actor, first, _ = stored
    with pytest.raises(ValueError, match="mock"):
        asyncio.run(prepare_saved(db, actor=actor, jobs=[first], runtime=ExtractionRuntime()))
    with pytest.raises(ValueError, match="ten"):
        asyncio.run(prepare_saved(db, actor=actor, jobs=[first] * 11, runtime=runtime([])))
    with pytest.raises(ValueError, match="Limit"):
        pending_jobs(db, limit=11)
