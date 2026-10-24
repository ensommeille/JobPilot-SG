"""Offline scheduling, lease fencing, feed completeness and admin boundary tests."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import (
    CrawlRun,
    CrawlRunStatus,
    JobPosting,
    JobSource,
    SourceCrawlLease,
    User,
    UserRole,
)
from app.ingestion import locks
from app.ingestion.db_repository import SqlAlchemyJobRepository
from app.ingestion.locks import SourceBusyError, SourceLease, SourceLeaseLostError, database_now
from app.ingestion.models import AdapterBatch, RunStatus
from app.ingestion.schedule import utc_timestamp
from app.ingestion.scheduler import register_catalog_sources, require_runner_admin, run_due_sources
from app.ingestion.schemas import SourceCreate, SourceScheduleUpdate
from app.ingestion.service import (
    SourceNotDueError,
    SourceRunError,
    create_source,
    run_source,
    update_source_schedule,
)
from tests.test_ingestion_admin import FakeAdapter, auth_headers, make_record, source_payload


def admin_source(db: Session, *, schedule="every:6h", source_type="mock"):
    actor = User(
        email=f"runner-{uuid4()}@example.test", password_hash="unused", role=UserRole.ADMIN
    )
    db.add(actor)
    db.commit()
    source = create_source(
        db,
        actor=actor,
        payload=SourceCreate.model_validate(
            {
                **source_payload(),
                "source_type": source_type,
                "schedule": schedule,
            }
        ),
    )
    return actor, source


def test_runner_only_executes_enabled_due_interval_sources(db: Session) -> None:
    actor, source = admin_source(db)
    db.add_all(
        [
            JobSource(
                name="Manual",
                source_type="mock",
                base_url="https://jobs.example.test",
                schedule="manual",
            ),
            JobSource(
                name="Disabled",
                source_type="mock",
                base_url="https://jobs.example.test",
                schedule="every:6h",
                enabled=False,
            ),
            JobSource(
                name="Future",
                source_type="mock",
                base_url="https://jobs.example.test",
                schedule="every:24h",
                next_run_at=datetime.now(UTC) + timedelta(hours=1),
            ),
            JobSource(
                name="Legacy cron",
                source_type="mock",
                base_url="https://jobs.example.test",
                schedule="* * * * *",
            ),
        ]
    )
    db.commit()
    calls = []

    def factory(current):
        calls.append(current.id)
        return FakeAdapter(str(current.id))

    result = run_due_sources(db, actor=actor, adapter_factory=factory)
    assert calls == [source.id]
    assert result[0]["status"] == "succeeded"
    assert run_due_sources(db, actor=actor, adapter_factory=factory) == []
    db.refresh(source)
    assert source.status == "healthy"
    assert source.last_attempt_at is not None and source.last_success_at is not None
    assert utc_timestamp(source.next_run_at) == utc_timestamp(source.last_success_at) + timedelta(
        hours=6
    )
    run = db.scalar(select(CrawlRun))
    assert run.trigger == "scheduled"
    assert run.items_attempted == 1 and run.items_new == 1
    assert not run.is_complete  # A bounded HTML/mock scan cannot close missing jobs.
    assert db.scalar(select(JobPosting)).last_seen_at is not None


def test_scheduled_adapter_error_is_persisted_and_rescheduled(db: Session) -> None:
    actor, source = admin_source(db)

    def unavailable(_source):
        raise RuntimeError("offline fixture unavailable")

    result = run_due_sources(db, actor=actor, adapter_factory=unavailable)
    assert result[0]["status"] == "failed"
    db.refresh(source)
    assert source.status == "failed" and source.last_success_at is None
    assert source.last_attempt_at is not None and source.next_run_at is not None
    run = db.scalar(select(CrawlRun))
    assert run.error_summary[0]["message"] == "offline fixture unavailable"
    assert run_due_sources(db, actor=actor, adapter_factory=unavailable) == []


def test_legacy_cron_remains_manual_without_executing_its_expression(db: Session) -> None:
    actor, source = admin_source(db, schedule="manual")
    source.schedule = "* * * * *"
    db.commit()
    run = run_source(
        db,
        source=source,
        actor=actor,
        adapter_factory=lambda s: FakeAdapter(str(s.id)),
        max_links=20,
        max_details=5,
    )
    db.refresh(source)
    assert run.status == CrawlRunStatus.SUCCEEDED
    assert source.schedule == "* * * * *" and source.next_run_at is None
    assert (
        run_due_sources(
            db, actor=actor, adapter_factory=lambda _: pytest.fail("legacy cron must stay manual")
        )
        == []
    )


def test_failed_refresh_preserves_previous_success_time(db: Session) -> None:
    actor, source = admin_source(db)
    run_source(
        db,
        source=source,
        actor=actor,
        adapter_factory=lambda s: FakeAdapter(str(s.id)),
        max_links=20,
        max_details=5,
    )
    db.refresh(source)
    succeeded = source.last_success_at
    failed = run_source(
        db,
        source=source,
        actor=actor,
        adapter_factory=lambda s: FakeAdapter(str(s.id), fail=True),
        max_links=20,
        max_details=5,
    )
    db.refresh(source)
    assert failed.status == CrawlRunStatus.FAILED
    assert source.last_success_at == succeeded
    assert db.scalar(select(JobPosting)).status == "active"


def test_shared_lease_blocks_network_for_manual_and_scheduled(db: Session) -> None:
    actor, source = admin_source(db)
    lease = SourceLease.claim(db, source.id)
    calls = []

    def forbidden(_source):
        calls.append(True)
        raise AssertionError("busy source must not construct an adapter")

    try:
        with pytest.raises(SourceBusyError):
            run_source(
                db,
                source=source,
                actor=actor,
                adapter_factory=forbidden,
                max_links=20,
                max_details=5,
            )
        assert run_due_sources(db, actor=actor, adapter_factory=forbidden)[0]["status"] == "skipped"
        assert not calls
        assert db.scalar(select(CrawlRun)) is None
    finally:
        lease.release(db)


def test_schedule_recheck_prevents_stale_due_selection(db: Session) -> None:
    actor, source = admin_source(db)
    source.next_run_at = datetime.now(UTC) + timedelta(hours=6)
    db.commit()
    with pytest.raises(SourceNotDueError):
        run_source(
            db,
            source=source,
            actor=actor,
            adapter_factory=lambda _: pytest.fail("not due"),
            max_links=20,
            max_details=5,
            trigger="scheduled",
        )
    assert db.scalar(select(CrawlRun)) is None


def test_expired_worker_is_fenced_and_cannot_release_new_owner(db: Session) -> None:
    actor, source = admin_source(db)
    old = SourceLease.claim(db, source.id)
    row = db.get(SourceCrawlLease, source.id)
    row.expires_at = database_now(db) - timedelta(seconds=1)
    db.commit()
    newer = SourceLease.claim(db, source.id)
    with pytest.raises(SourceLeaseLostError):
        old.fence(db)
    db.rollback()
    old.release(db)
    db.expire_all()
    assert db.get(SourceCrawlLease, source.id).owner_token == newer.owner_token
    newer.release(db)


def test_expired_crashed_run_is_recovered_without_duplicate_jobs(db: Session) -> None:
    actor, source = admin_source(db)
    lease = SourceLease.claim(db, source.id)
    abandoned = CrawlRun(
        source_id=source.id,
        status=CrawlRunStatus.RUNNING,
        trigger="scheduled",
        started_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(abandoned)
    db.flush()
    lease.fence(db, run_id=abandoned.id)
    source.status = "running"
    source.next_run_at = datetime.now(UTC) + timedelta(hours=6)
    db.commit()
    row = db.get(SourceCrawlLease, source.id)
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    reports = run_due_sources(db, actor=actor, adapter_factory=lambda s: FakeAdapter(str(s.id)))
    assert reports[0]["status"] == "succeeded"
    db.refresh(abandoned)
    assert abandoned.status == CrawlRunStatus.FAILED
    assert abandoned.error_summary[0]["error_type"] == "InterruptedRun"
    assert len(db.scalars(select(JobPosting)).all()) == 1


@pytest.mark.parametrize(
    "variant,expected_closed",
    [("complete", 1), ("empty", 0), ("truncated", 0), ("partial", 0), ("inaccessible", 0)],
)
def test_only_nonempty_complete_successful_json_feed_closes_missing(
    db: Session, variant, expected_closed
) -> None:
    actor, source = admin_source(db)
    source.source_type = "json"
    repository = SqlAlchemyJobRepository(db, source)
    repository.upsert([make_record(str(source.id), external_id="gone", dedup_hash="b" * 64)])
    db.commit()

    class BatchAdapter(FakeAdapter):
        def collect(self, **kwargs) -> AdapterBatch:
            batch = super().collect(**kwargs)
            if variant == "empty":
                return batch.model_copy(
                    update={"items": [], "discovered_count": 0, "attempted_count": 0}
                )
            if variant == "truncated":
                return batch.model_copy(update={"discovered_count": 3})
            if variant == "partial":
                return batch.model_copy(update={"status": RunStatus.PARTIAL})
            if variant == "inaccessible":
                return batch.model_copy(update={"listing_accessible": False})
            return batch

    run = run_source(
        db,
        source=source,
        actor=actor,
        adapter_factory=lambda s: BatchAdapter(str(s.id)),
        max_links=20,
        max_details=20,
    )
    gone = db.scalar(select(JobPosting).where(JobPosting.external_id == "gone"))
    assert run.items_closed == expected_closed
    assert run.is_complete == bool(expected_closed)
    assert gone.status == ("closed" if expected_closed else "active")


def test_catalog_registration_is_explicit_and_does_not_fetch(db: Session) -> None:
    actor, original = admin_source(db, schedule="manual")
    registered = register_catalog_sources(db, actor=actor, keys=["greenhouse-stripe", "internsg"])
    assert [s.schedule for s in registered] == ["every:6h", "every:24h"]
    assert [(s.max_links, s.max_details) for s in registered] == [(20, 20), (10, 5)]
    assert all(s.next_run_at is not None for s in registered)
    assert original.schedule == "manual"
    assert db.scalar(select(CrawlRun)) is None
    assert (
        register_catalog_sources(db, actor=actor, keys=["greenhouse-stripe"])[0].id
        == registered[0].id
    )
    actor.role = UserRole.JOB_SEEKER
    db.commit()
    with pytest.raises(ValueError, match="active administrator"):
        run_due_sources(db, actor=actor)


def test_source_configuration_is_admin_only_and_validates_schedules(
    client: TestClient, db: Session
) -> None:
    admin = auth_headers(client, db, "schedule-admin@example.com", admin=True)
    seeker = auth_headers(client, db, "schedule-seeker@example.com", admin=False)
    source = client.post("/sources", headers=admin, json=source_payload()).json()
    path = f"/sources/{source['id']}"
    assert client.patch(path, headers=seeker, json={"schedule": "every:6h"}).status_code == 403
    assert client.patch(path, json={"schedule": "every:6h"}).status_code == 401
    for body in [
        {},
        {"schedule": "* * * * *"},
        {"max_links": 1},
        {"enabled": None},
        {"base_url": "https://evil.test"},
    ]:
        assert client.patch(path, headers=admin, json=body).status_code == 422
    enabled = client.patch(
        path, headers=admin, json={"schedule": "every:6h", "max_links": 10, "max_details": 10}
    ).json()
    assert enabled["next_run_at"].endswith("Z")
    assert enabled["last_success_at"] is None
    disabled = client.patch(path, headers=admin, json={"enabled": False}).json()
    assert disabled["next_run_at"] is None
    manual = client.patch(path, headers=admin, json={"schedule": "manual", "enabled": True}).json()
    assert manual["next_run_at"] is None


def test_lease_excludes_independent_database_sessions(tmp_path) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'lease.sqlite3'}")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as first, Session(engine) as second:
            source = JobSource(
                name="Concurrent", source_type="mock", base_url="https://jobs.example.test"
            )
            first.add(source)
            first.commit()
            source_id = source.id
            claimed = SourceLease.claim(first, source_id)
            with pytest.raises(SourceBusyError):
                SourceLease.claim(second, source_id)
            claimed.release(first)
            successor = SourceLease.claim(second, source_id)
            successor.release(second)
    finally:
        engine.dispose()


def test_inactive_or_missing_admin_cannot_run(db: Session) -> None:
    actor, _source = admin_source(db)
    actor.is_active = False
    db.commit()
    with pytest.raises(ValueError):
        require_runner_admin(db, actor.id)
    with pytest.raises(ValueError):
        require_runner_admin(db, uuid4())


def test_simultaneous_fresh_claims_have_one_owner(tmp_path) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'race.sqlite3'}")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            source = JobSource(
                name="Race", source_type="mock", base_url="https://jobs.example.test"
            )
            db.add(source)
            db.commit()
            source_id = source.id
        barrier = Barrier(2)

        def claim():
            with Session(engine) as db:
                barrier.wait(timeout=3)
                try:
                    return SourceLease.claim(db, source_id)
                except SourceBusyError:
                    return None

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: claim(), range(2)))
        winners = [lease for lease in results if lease is not None]
        assert len(winners) == 1
        with Session(engine) as db:
            winners[0].release(db)
    finally:
        engine.dispose()


def test_file_database_heartbeat_renews_without_network(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'heartbeat.sqlite3'}")
    Base.metadata.create_all(engine)
    renewed = Event()
    monkeypatch.setattr(locks, "HEARTBEAT_SECONDS", 0.01)
    original_fence = SourceLease.fence

    def observed_fence(self, db, **kwargs):
        original_fence(self, db, **kwargs)
        renewed.set()

    monkeypatch.setattr(SourceLease, "fence", observed_fence)
    try:
        with Session(engine) as db:
            source = JobSource(
                name="Heartbeat", source_type="mock", base_url="https://jobs.example.test"
            )
            db.add(source)
            db.commit()
            lease = SourceLease.claim(db, source.id)
            lease.start_heartbeat(db)
            assert renewed.wait(timeout=3)
            lease.release(db)
            db.expire_all()
            row = db.get(SourceCrawlLease, source.id)
            assert row.owner_token is None and row.expires_at is None
            assert lease._thread is not None and not lease._thread.is_alive()
    finally:
        engine.dispose()


def test_stale_collector_cannot_publish_jobs_or_overwrite_source(db: Session) -> None:
    actor, source = admin_source(db)
    new_owner = uuid4()

    class StaleAdapter(FakeAdapter):
        def collect(self, **kwargs):
            batch = super().collect(**kwargs)
            row = db.get(SourceCrawlLease, source.id)
            row.owner_token = new_owner
            row.expires_at = database_now(db) + timedelta(minutes=5)
            source.status = "degraded"
            db.commit()
            return batch

    with pytest.raises(SourceLeaseLostError):
        run_source(
            db,
            source=source,
            actor=actor,
            adapter_factory=lambda s: StaleAdapter(str(s.id)),
            max_links=20,
            max_details=5,
        )
    db.expire_all()
    assert db.scalar(select(JobPosting)) is None
    assert db.get(JobSource, source.id).status == "degraded"
    assert db.get(SourceCrawlLease, source.id).owner_token == new_owner


def test_disable_during_fetch_keeps_started_batch_and_prevents_future_runs(tmp_path) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'pause-during-fetch.sqlite3'}")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as worker_db:
            actor, source = admin_source(worker_db)
            actor_id, source_id = actor.id, source.id

            class PausedDuringFetch(FakeAdapter):
                def collect(self, **kwargs):
                    batch = super().collect(**kwargs)
                    # A genuinely independent administrator transaction commits while
                    # the worker is outside its publication transaction fetching data.
                    with Session(engine) as admin_db:
                        update_source_schedule(
                            admin_db,
                            source=admin_db.get(JobSource, source_id),
                            actor=admin_db.get(User, actor_id),
                            payload=SourceScheduleUpdate(enabled=False),
                        )
                    return batch

            run = run_source(
                worker_db,
                source=source,
                actor=actor,
                adapter_factory=lambda s: PausedDuringFetch(str(s.id)),
                max_links=20,
                max_details=5,
                trigger="scheduled",
            )
            worker_db.refresh(source)
            assert run.status == CrawlRunStatus.SUCCEEDED
            assert worker_db.scalar(select(JobPosting)).last_seen_at is not None
            assert source.last_success_at is not None
            assert source.enabled is False and source.next_run_at is None
            assert (
                run_due_sources(
                    worker_db,
                    actor=actor,
                    adapter_factory=lambda _: pytest.fail("paused source must stay idle"),
                )
                == []
            )
            with pytest.raises(SourceRunError, match="Source is disabled"):
                run_source(
                    worker_db,
                    source=source,
                    actor=actor,
                    adapter_factory=lambda _: pytest.fail("paused source must not be fetched"),
                    max_links=20,
                    max_details=5,
                )
    finally:
        engine.dispose()
