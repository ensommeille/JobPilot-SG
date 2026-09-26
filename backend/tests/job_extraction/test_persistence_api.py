"""Offline API acceptance for extraction persistence, provenance and leases."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.db.models import AuditLog, JobExtractionRun, JobPosting, JobSource, User, UserRole
from app.job_extraction.persistence import ExtractionRequestError, finish
from app.job_extraction.runtime import ExtractionRuntime, get_extraction_runtime, mock_provider
from app.llm import MockProvider, ProviderAuthenticationError
from app.main import app


@pytest.fixture
def setup_job(client, db):
    credentials = {"email": "extraction@example.com", "password": "OfflineExtractPassword123!"}
    assert client.post("/auth/register", json=credentials).status_code == 201
    user = db.scalar(select(User).where(User.email == credentials["email"]))
    user.role = UserRole.ADMIN
    source = JobSource(
        name="Extract test", source_type="mock", base_url="https://jobs.example.test"
    )
    db.add(source)
    db.flush()
    job = JobPosting(
        source_id=source.id,
        external_id="example",
        title="Intern",
        company="Example",
        description="Build tested Python APIs.",
        apply_url="https://jobs.example.test/apply",
        source_url="https://jobs.example.test/job/example",
        raw_hash="a" * 64,
        dedup_hash="b" * 64,
    )
    db.add(job)
    db.commit()
    token = client.post("/auth/login", json=credentials).json()["access_token"]
    return job.id, user.id, {"Authorization": f"Bearer {token}"}


def trigger(client, setup_job, **payload):
    job_id, _, headers = setup_job
    return client.post(f"/jobs/{job_id}/extractions", headers=headers, json=payload)


def test_create_reuse_force_and_history(client, db, setup_job):
    job_id, _, headers = setup_job
    first = trigger(client, setup_job)
    assert first.status_code == 201
    data = first.json()
    assert data["status"] == "needs_review"
    assert data["started_at"].endswith("Z")
    assert data["result"]["execution_mode"] == "mock"
    assert data["result"]["quality"]["requires_review"] is True
    assert data["result"]["source_url"].endswith("/job/example")
    second = trigger(client, setup_job)
    assert second.status_code == 200
    assert second.json()["reused"] is True
    assert second.json()["id"] == data["id"]
    forced = trigger(client, setup_job, force=True)
    assert forced.status_code == 201
    assert forced.json()["id"] != data["id"]
    page = client.get(f"/jobs/{job_id}/extractions?page_size=1", headers=headers).json()
    assert page["total"] == 2
    assert len(page["items"]) == 1
    assert client.get(f"/extractions/{data['id']}", headers=headers).json()["is_stale"] is False
    assert (
        db.scalar(select(JobPosting).where(JobPosting.id == job_id)).description
        == "Build tested Python APIs."
    )
    actions = list(db.scalars(select(AuditLog.action)))
    assert actions.count("extraction.start") == 2
    assert actions.count("extraction.finish") == 2
    assert actions.count("extraction.reuse") == 1


def test_changed_input_and_profile_do_not_reuse(client, db, setup_job):
    job_id, _, headers = setup_job
    first = trigger(client, setup_job).json()
    job = db.get(JobPosting, job_id)
    job.description = "A new job description without a raw hash change."
    db.commit()
    assert client.get(f"/extractions/{first['id']}", headers=headers).json()["is_stale"] is True
    second = trigger(client, setup_job)
    assert second.status_code == 201
    assert second.json()["input_hash"] != first["input_hash"]
    app.dependency_overrides[get_extraction_runtime] = lambda: ExtractionRuntime(
        profile_revision="mock-empty-v2"
    )
    try:
        assert (
            client.get(f"/extractions/{first['id']}", headers=headers).json()["is_current_pipeline"]
            is False
        )
        third = trigger(client, setup_job)
        assert third.status_code == 201
        assert third.json()["pipeline_hash"] != first["pipeline_hash"]
    finally:
        app.dependency_overrides.pop(get_extraction_runtime, None)


def test_failure_does_not_replace_valid_result(client, db, setup_job):
    first = trigger(client, setup_job).json()

    @asynccontextmanager
    async def failing():
        yield MockProvider([ProviderAuthenticationError("NEVER_PERSIST_THIS_SECRET")])

    app.dependency_overrides[get_extraction_runtime] = lambda: ExtractionRuntime(
        provider_factory=failing
    )
    try:
        failed = trigger(client, setup_job, force=True)
        assert failed.status_code == 201
        assert failed.json()["status"] == "failed"
        assert "NEVER_PERSIST_THIS_SECRET" not in failed.text
        assert failed.json()["error_code"] == "provider_authentication_error"
        # The earlier valid record is still eligible, so no provider is constructed on reuse.
        reused = trigger(client, setup_job)
        assert reused.status_code == 200
        assert reused.json()["id"] == first["id"]
    finally:
        app.dependency_overrides.pop(get_extraction_runtime, None)


@pytest.mark.parametrize("mode", ["construction", "cleanup", "identity"])
def test_runtime_errors_are_persisted_without_leaking(client, setup_job, mode):
    @asynccontextmanager
    async def provider():
        if mode == "construction":
            raise RuntimeError("NEVER_PERSIST_THIS_SECRET")
        async with mock_provider() as inner:
            if mode == "identity":
                inner.name = "unexpected"
            yield inner
        if mode == "cleanup":
            raise RuntimeError("NEVER_PERSIST_THIS_SECRET")

    app.dependency_overrides[get_extraction_runtime] = lambda: ExtractionRuntime(
        provider_factory=provider
    )
    try:
        response = trigger(client, setup_job)
        assert response.status_code == 201
        assert response.json()["error_code"] == "extraction_runtime_error"
        assert "NEVER_PERSIST_THIS_SECRET" not in response.text
    finally:
        app.dependency_overrides.pop(get_extraction_runtime, None)
    assert trigger(client, setup_job).status_code == 201


def test_missing_provenance_requires_recrawl(client, db, setup_job):
    job = db.get(JobPosting, setup_job[0])
    job.source_url = None
    db.commit()
    response = trigger(client, setup_job)
    assert response.status_code == 422
    assert response.json()["detail"] == "missing_source_url_recrawl_required"
    assert list(db.scalars(select(JobExtractionRun))) == []


def test_history_remains_readable_when_current_provenance_is_missing(client, db, setup_job):
    first = trigger(client, setup_job).json()
    db.get(JobPosting, setup_job[0]).source_url = None
    db.commit()
    response = client.get(f"/extractions/{first['id']}", headers=setup_job[2])
    assert response.status_code == 200
    assert response.json()["is_stale"] is True
    assert response.json()["result"]["source_url"] == "https://jobs.example.test/job/example"


def test_invalid_stored_input(client, db, setup_job):
    job = db.get(JobPosting, setup_job[0])
    job.description = "x" * 40001
    db.commit()
    assert trigger(client, setup_job).json()["detail"] == "invalid_stored_extraction_input"


def test_lease_conflict_and_explicit_recovery(client, db, setup_job):
    job_id, actor_id, headers = setup_job
    first = trigger(client, setup_job).json()
    original = db.get(JobExtractionRun, UUID(first["id"]))
    running = JobExtractionRun(
        job_id=job_id,
        actor_id=actor_id,
        active_key=str(job_id),
        status="running",
        input_hash=original.input_hash,
        pipeline_hash=original.pipeline_hash,
        input_json=original.input_json,
        pipeline_json=original.pipeline_json,
        started_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db.add(running)
    db.commit()
    run_id = running.id
    assert trigger(client, setup_job, force=True).status_code == 409
    assert client.post(f"/extractions/{run_id}/recover", headers=headers).status_code == 409
    running.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    recovered = client.post(f"/extractions/{run_id}/recover", headers=headers)
    assert recovered.status_code == 200
    assert recovered.json()["error_code"] == "extraction_interrupted"
    with pytest.raises(ExtractionRequestError) as exc:
        finish(db, run_id, actor_id, error="late_worker")
    assert exc.value.code == "extraction_no_longer_running"
    assert trigger(client, setup_job, force=True).status_code == 201


def test_cancellation_releases_lease(db, client, setup_job):
    from app.job_extraction.persistence import execute

    @asynccontextmanager
    async def cancelled():
        raise asyncio.CancelledError
        yield  # pragma: no cover

    job_id, actor_id, _ = setup_job
    runtime = replace(ExtractionRuntime(), provider_factory=cancelled)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(execute(db, job_id=job_id, actor_id=actor_id, runtime=runtime))
    record = db.scalar(select(JobExtractionRun))
    assert record.status == "failed"
    assert record.error_code == "extraction_cancelled"
    assert record.active_key is None


def test_permissions_and_bad_requests(client, db, setup_job):
    job_id, user_id, headers = setup_job
    assert client.post(f"/jobs/{job_id}/extractions", json={}).status_code == 401
    for body in ({"force": "true"}, {"provider": "deepseek"}, {"api_key": "no"}):
        assert (
            client.post(f"/jobs/{job_id}/extractions", headers=headers, json=body).status_code
            == 422
        )
    assert (
        client.get(f"/jobs/{job_id}/extractions?page_size=101", headers=headers).status_code == 422
    )
    missing = uuid4()
    assert client.post(f"/jobs/{missing}/extractions", headers=headers, json={}).status_code == 404
    assert client.get(f"/jobs/{missing}/extractions", headers=headers).status_code == 404
    assert client.get(f"/extractions/{missing}", headers=headers).status_code == 404
    assert client.post(f"/extractions/{missing}/recover", headers=headers).status_code == 404
    db.get(User, user_id).role = UserRole.JOB_SEEKER
    db.commit()
    assert trigger(client, setup_job).status_code == 403
    assert client.get(f"/jobs/{job_id}/extractions", headers=headers).status_code == 403
    assert client.get(f"/extractions/{missing}", headers=headers).status_code == 403
    assert client.post(f"/extractions/{missing}/recover", headers=headers).status_code == 403
