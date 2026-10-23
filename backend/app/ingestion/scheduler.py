"""Explicitly invoked, single-worker due-source selection and dispatch."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import CrawlRun, CrawlRunStatus, JobSource
from app.ingestion.schedule_policy import schedule_interval
from app.ingestion.service import SourceAdapterFactory, SourceRunError, list_sources, run_source

LOGGER = logging.getLogger(__name__)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def due_sources(db: Session, *, now: datetime, max_sources: int) -> list[JobSource]:
    """Never treat unknown schedule text or a running crawl as permission to crawl."""
    if max_sources < 1:
        raise ValueError("max_sources must be positive")
    due: list[JobSource] = []
    for source in list_sources(db):
        if not source.enabled:
            continue
        try:
            interval = schedule_interval(source.schedule)
        except ValueError:
            continue  # Historical free-text schedules are fail-closed.
        if interval is None:
            continue
        last = db.scalar(
            select(CrawlRun)
            .where(CrawlRun.source_id == source.id)
            .order_by(
                func.coalesce(CrawlRun.started_at, CrawlRun.created_at).desc(),
                CrawlRun.id.desc(),
            )
            .limit(1)
        )
        if last is not None:
            if last.status in {CrawlRunStatus.PENDING, CrawlRunStatus.RUNNING}:
                continue
            reference = last.finished_at or last.started_at or last.created_at
            if _aware(reference) + interval > now:
                continue
        due.append(source)
        if len(due) >= max_sources:
            break
    return due


def run_due_sources(
    db: Session, *, adapter_factory: SourceAdapterFactory,
    max_sources: int, max_jobs: int, now: datetime | None = None,
) -> list[CrawlRun]:
    """Run one bounded cycle. A single process must own this scheduler instance."""
    if not 1 <= max_jobs <= 100:
        raise ValueError("max_jobs must be between 1 and 100")
    selected = due_sources(db, now=now or datetime.now(UTC), max_sources=max_sources)
    runs: list[CrawlRun] = []
    for source in selected:
        try:
            runs.append(run_source(
                db, source=source, actor=None, trigger="scheduled",
                adapter_factory=adapter_factory, max_links=max_jobs, max_details=max_jobs,
            ))
        except SourceRunError as exc:
            LOGGER.error("Scheduled source %s is not runnable: %s", source.name, exc)
    return runs
