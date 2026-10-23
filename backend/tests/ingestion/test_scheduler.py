"""The optional scheduler never runs unscheduled or not-yet-due sources."""

from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, CrawlRun, CrawlRunStatus, JobSource
from app.ingestion import scheduler_cli
from app.ingestion.models import SourceType
from app.ingestion.scheduler import due_sources, run_due_sources, schedule_interval
from app.ingestion.schemas import SourceCreate
from app.ingestion.service import SourceRunError
from tests.test_ingestion_admin import FakeAdapter


def make_source(db: Session, *, name: str, schedule: str | None, enabled: bool = True) -> JobSource:
    source = JobSource(
        name=name, source_type="mock", base_url="https://jobs.example.test",
        schedule=schedule, enabled=enabled, status="healthy",
    )
    db.add(source)
    db.commit()
    return source


def test_schedule_accepts_bounded_intervals_and_leaves_manual_off() -> None:
    assert schedule_interval(None) is None
    assert schedule_interval("manual") is None
    assert schedule_interval("daily") == timedelta(days=1)
    assert schedule_interval("every 1h") == timedelta(hours=1)
    assert schedule_interval("every 7d") == timedelta(days=7)
    for value in ("every 5m", "every 0h", "every 8d", "every 99999999h", "* * * * *", "hourly"):
        with pytest.raises(ValueError):
            schedule_interval(value)

    with pytest.raises(ValueError):
        SourceCreate(
            name="Bad cadence", source_type=SourceType.JSON,
            base_url="https://boards-api.greenhouse.io/v1/boards/example",
            schedule="every 5m",
        )
    with pytest.raises(ValueError):
        SourceCreate(
            name="No mock worker", source_type=SourceType.MOCK,
            base_url="https://jobs.example.test", schedule="daily",
        )


def test_due_sources_skip_disabled_manual_running_and_recent(db: Session) -> None:
    now = datetime(2026, 10, 23, 12, tzinfo=UTC)
    due = make_source(db, name="Due", schedule="every 1h")
    recent = make_source(db, name="Recent", schedule="every 1h")
    running = make_source(db, name="Running", schedule="daily")
    make_source(db, name="Manual", schedule="manual")
    make_source(db, name="Disabled", schedule="daily", enabled=False)
    db.add_all([
        CrawlRun(
            source_id=recent.id, status=CrawlRunStatus.SUCCEEDED,
            finished_at=now - timedelta(minutes=30), trigger="scheduled",
        ),
        CrawlRun(
            source_id=running.id, status=CrawlRunStatus.SUCCEEDED,
            started_at=now - timedelta(days=3), finished_at=now - timedelta(days=3),
            trigger="scheduled",
        ),
        CrawlRun(
            source_id=running.id, status=CrawlRunStatus.RUNNING,
            started_at=now - timedelta(minutes=1), trigger="scheduled",
        ),
    ])
    db.commit()

    assert [source.name for source in due_sources(db, now=now, max_sources=5)] == [due.name]


def test_scheduled_run_has_system_audit_and_is_not_repeated_before_due(db: Session) -> None:
    make_source(db, name="Scheduled fixture", schedule="every 1h")

    def factory(current: JobSource) -> FakeAdapter:
        return FakeAdapter(str(current.id))

    runs = run_due_sources(db, adapter_factory=factory, max_sources=1, max_jobs=1)
    repeated = run_due_sources(db, adapter_factory=factory, max_sources=1, max_jobs=1)

    assert len(runs) == 1
    assert repeated == []
    assert runs[0].status is CrawlRunStatus.SUCCEEDED
    assert runs[0].trigger == "scheduled"
    persisted = db.scalar(select(CrawlRun).where(CrawlRun.id == runs[0].id))
    assert persisted is not None and persisted.trigger == "scheduled"
    audit = db.scalar(select(AuditLog).where(AuditLog.entity_id == str(runs[0].id)))
    assert audit is not None and audit.actor_id is None


def test_unrunnable_source_does_not_starve_other_due_sources(db: Session) -> None:
    make_source(db, name="A invalid", schedule="daily")
    valid = make_source(db, name="B valid", schedule="daily")

    def factory(source: JobSource) -> FakeAdapter:
        if source.name == "A invalid":
            raise SourceRunError("No live adapter")
        return FakeAdapter(str(source.id))

    runs = run_due_sources(db, adapter_factory=factory, max_sources=2, max_jobs=1)

    assert len(runs) == 1
    assert runs[0].source_id == valid.id


def test_scheduler_cli_previews_without_fetching(
    db: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    make_source(db, name="Preview only", schedule="daily")
    monkeypatch.setattr(scheduler_cli, "SessionLocal", lambda: nullcontext(db))
    monkeypatch.setattr(scheduler_cli, "run_due_sources", lambda **_kwargs: pytest.fail("fetch"))

    assert scheduler_cli.main([]) == 0
    assert "Preview only" in capsys.readouterr().out
