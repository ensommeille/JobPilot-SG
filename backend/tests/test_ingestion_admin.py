"""Admin API tests for source configuration and database-backed crawl runs."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, CrawlRun, JobPosting, User, UserRole
from app.ingestion.models import (
    AdapterBatch,
    ItemFailure,
    JobRecord,
    RawJobItem,
    RunStatus,
    SourceConfig,
    SourceType,
)
from app.ingestion.service import get_source_adapter_factory
from app.main import app

PASSWORD = "CorrectHorseBatteryStaple!"


def auth_headers(
    client: TestClient, db: Session, email: str, *, admin: bool
) -> dict[str, str]:
    response = client.post(
        "/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 201
    user = db.scalar(select(User).where(User.email == email))
    assert user is not None
    if admin:
        user.role = UserRole.ADMIN
        db.commit()
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def source_payload() -> dict[str, object]:
    return {
        "name": "Sandbox Jobs",
        "source_type": "mock",
        "base_url": "https://jobs.example.test",
        "schedule": "manual",
        "enabled": True,
    }


def make_record(source_id: str, **overrides: object) -> JobRecord:
    payload: dict[str, object] = {
        "source": "sandbox",
        "source_id": source_id,
        "source_type": SourceType.MOCK,
        "external_id": "sandbox-1",
        "source_url": "https://jobs.example.test/job/sandbox-1",
        "title": "Data Intern",
        "company": "Sandbox Pte Ltd",
        "city": "Singapore",
        "job_type": ["internship"],
        "description": "Build a reliable data pipeline.",
        "apply_url": None,
        "raw_hash": "1" * 64,
        "dedup_hash": "a" * 64,
        "parser_version": "sandbox-v1",
        "tags": ["internship", "data"],
    }
    payload.update(overrides)
    return JobRecord.model_validate(payload)


class FakeAdapter:
    def __init__(
        self,
        source_id: str,
        *,
        record_overrides: dict[str, object] | None = None,
        fail: bool = False,
    ) -> None:
        self._config = SourceConfig(
            source_id=source_id,
            name="Sandbox Jobs",
            source_type=SourceType.MOCK,
            base_url="https://jobs.example.test",
            allowed_hosts=frozenset({"jobs.example.test"}),
            user_agent="JobPilot-Test/1.0",
            enforce_robots=False,
        )
        self.record_overrides = record_overrides or {}
        self.fail = fail

    @property
    def config(self) -> SourceConfig:
        return self._config

    def collect(self, *, max_links: int, max_details: int) -> AdapterBatch:
        now = datetime.now(UTC)
        if self.fail:
            failure = ItemFailure(
                url=self.config.base_url,
                stage="listing",
                error_type="FixtureUnavailable",
                message="fixture unavailable",
                retryable=False,
            )
            return AdapterBatch(
                source_id=self.config.source_id,
                status=RunStatus.FAILED,
                listing_accessible=False,
                discovered_count=0,
                attempted_count=0,
                failures=[failure],
                started_at=now,
                finished_at=now,
            )
        record = make_record(self.config.source_id, **self.record_overrides)
        item = RawJobItem(
            source_id=self.config.source_id,
            source_type=SourceType.MOCK,
            external_id=record.external_id,
            source_url=record.source_url,
            raw_text="fixture job",
            raw_hash=record.raw_hash,
            known_fields=record,
            fetched_at=now,
        )
        return AdapterBatch(
            source_id=self.config.source_id,
            status=RunStatus.SUCCEEDED,
            listing_accessible=True,
            discovered_count=1,
            attempted_count=1,
            items=[item],
            started_at=now,
            finished_at=now,
        )


def test_source_routes_require_admin_and_reject_duplicates(
    client: TestClient, db: Session
) -> None:
    seeker = auth_headers(client, db, "seeker-source@example.com", admin=False)
    admin = auth_headers(client, db, "admin-source@example.com", admin=True)

    assert client.get("/sources").status_code == 401
    assert client.get("/sources", headers=seeker).status_code == 403
    created = client.post("/sources", headers=admin, json=source_payload())
    duplicate = client.post("/sources", headers=admin, json=source_payload())

    assert created.status_code == 201
    assert created.json()["name"] == "Sandbox Jobs"
    assert duplicate.status_code == 409
    assert client.get("/sources", headers=admin).json()[0]["id"] == created.json()["id"]


def test_crawl_run_persists_jobs_updates_and_audit(
    client: TestClient, db: Session
) -> None:
    admin = auth_headers(client, db, "admin-run@example.com", admin=True)
    created = client.post("/sources", headers=admin, json=source_payload())
    source_id = created.json()["id"]
    adapter_state: dict[str, object] = {}

    def factory(_source: object) -> FakeAdapter:
        return FakeAdapter(source_id, record_overrides=adapter_state)

    app.dependency_overrides[get_source_adapter_factory] = lambda: factory
    try:
        first = client.post(
            f"/sources/{source_id}/run",
            headers=admin,
            json={"max_links": 3, "max_details": 1},
        )
        second = client.post(
            f"/sources/{source_id}/run",
            headers=admin,
            json={"max_links": 3, "max_details": 1},
        )
        adapter_state.update(
            {
                "title": "Updated Data Intern",
                "raw_hash": "2" * 64,
                "dedup_hash": "b" * 64,
            }
        )
        third = client.post(
            f"/sources/{source_id}/run",
            headers=admin,
            json={"max_links": 3, "max_details": 1},
        )
    finally:
        app.dependency_overrides.pop(get_source_adapter_factory, None)

    assert first.status_code == second.status_code == third.status_code == 201
    assert first.json()["items_new"] == 1
    assert second.json()["items_new"] == second.json()["items_updated"] == 0
    assert third.json()["items_updated"] == 1
    assert db.scalar(select(func.count()).select_from(JobPosting)) == 1
    job = db.scalar(select(JobPosting))
    assert job is not None
    assert job.title == "Updated Data Intern"
    assert job.apply_url == "https://jobs.example.test/job/sandbox-1"
    assert client.get("/jobs").json()["total"] == 1

    runs = client.get("/runs", headers=admin)
    assert runs.status_code == 200
    assert runs.json()["total"] == 3
    run_id = first.json()["id"]
    assert client.get(f"/runs/{run_id}", headers=admin).status_code == 200
    assert db.scalar(select(func.count()).select_from(CrawlRun)) == 3
    assert db.scalar(select(func.count()).select_from(AuditLog)) == 4


def test_failed_batch_is_visible_and_does_not_delete_existing_jobs(
    client: TestClient, db: Session
) -> None:
    admin = auth_headers(client, db, "admin-failure@example.com", admin=True)
    source_id = client.post(
        "/sources", headers=admin, json=source_payload()
    ).json()["id"]
    should_fail = False

    def factory(_source: object) -> FakeAdapter:
        return FakeAdapter(source_id, fail=should_fail)

    app.dependency_overrides[get_source_adapter_factory] = lambda: factory
    try:
        succeeded = client.post(
            f"/sources/{source_id}/run", headers=admin, json={}
        )
        should_fail = True
        failed = client.post(f"/sources/{source_id}/run", headers=admin, json={})
    finally:
        app.dependency_overrides.pop(get_source_adapter_factory, None)

    assert succeeded.json()["status"] == "succeeded"
    assert failed.json()["status"] == "failed"
    assert failed.json()["items_failed"] == 1
    assert failed.json()["error_summary"][0]["error_type"] == "FixtureUnavailable"
    assert db.scalar(select(func.count()).select_from(JobPosting)) == 1


def test_source_without_live_adapter_cannot_be_run(
    client: TestClient, db: Session
) -> None:
    admin = auth_headers(client, db, "admin-unsupported@example.com", admin=True)
    source_id = client.post(
        "/sources", headers=admin, json=source_payload()
    ).json()["id"]

    response = client.post(f"/sources/{source_id}/run", headers=admin, json={})

    assert response.status_code == 422
    assert response.json() == {"detail": "No live adapter is available for this source"}
    assert db.scalar(select(func.count()).select_from(CrawlRun)) == 0


@pytest.mark.parametrize(
    "payload",
    [
        {**source_payload(), "base_url": "http://jobs.example.test"},
        {**source_payload(), "base_url": "https://user:secret@jobs.example.test"},
    ],
)
def test_source_rejects_unsafe_base_urls(
    client: TestClient, db: Session, payload: dict[str, object]
) -> None:
    admin = auth_headers(client, db, f"admin-{abs(hash(str(payload)))}@example.com", admin=True)
    assert client.post("/sources", headers=admin, json=payload).status_code == 422
