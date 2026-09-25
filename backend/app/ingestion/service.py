"""Database-backed source management and ingestion orchestration."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from math import ceil
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import AuditLog, CrawlRun, CrawlRunStatus, JobSource, User
from app.ingestion.db_repository import SqlAlchemyJobRepository
from app.ingestion.internsg_adapter import InternSGAdapter, default_internsg_config
from app.ingestion.models import SourceConfig, SourceType
from app.ingestion.schemas import SourceCreate
from app.ingestion.source_adapter import SourceAdapter

LOGGER = logging.getLogger(__name__)


class SourceConflictError(ValueError):
    """A source with the requested identity already exists."""


class SourceRunError(ValueError):
    """A configured source cannot currently be executed."""


SourceAdapterFactory = Callable[[JobSource], SourceAdapter]


def create_source(db: Session, *, payload: SourceCreate, actor: User) -> JobSource:
    existing = db.scalar(
        select(JobSource).where(func.lower(JobSource.name) == payload.name.casefold())
    )
    if existing is not None:
        raise SourceConflictError("A source with this name already exists")

    source = JobSource(
        name=payload.name,
        source_type=payload.source_type.value,
        base_url=payload.base_url,
        schedule=payload.schedule,
        enabled=payload.enabled,
        status="healthy",
    )
    db.add(source)
    db.flush()
    db.add(
        AuditLog(
            actor_id=actor.id,
            action="source.create",
            entity_type="job_source",
            entity_id=str(source.id),
            metadata_json={"name": source.name, "source_type": source.source_type},
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise SourceConflictError("A source with this name already exists") from exc
    db.refresh(source)
    return source


def list_sources(db: Session) -> list[JobSource]:
    statement = select(JobSource).order_by(func.lower(JobSource.name), JobSource.id)
    return list(db.scalars(statement).all())


def get_source(db: Session, source_id: UUID) -> JobSource | None:
    return db.get(JobSource, source_id)


def get_crawl_run(db: Session, run_id: UUID) -> CrawlRun | None:
    return db.get(CrawlRun, run_id)


def list_crawl_runs(
    db: Session, *, page: int, page_size: int
) -> tuple[list[CrawlRun], int, int]:
    total = db.scalar(select(func.count()).select_from(CrawlRun)) or 0
    statement = (
        select(CrawlRun)
        .order_by(CrawlRun.created_at.desc(), CrawlRun.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return (
        list(db.scalars(statement).all()),
        total,
        ceil(total / page_size) if total else 0,
    )


def build_source_adapter(source: JobSource) -> SourceAdapter:
    """Build the currently supported live adapter from persisted source policy."""
    if not source.enabled:
        raise SourceRunError("Source is disabled")
    parsed = urlparse(source.base_url)
    host = (parsed.hostname or "").casefold().rstrip(".")
    if source.source_type != SourceType.HTML.value or host not in {
        "internsg.com",
        "www.internsg.com",
    }:
        raise SourceRunError("No live adapter is available for this source")

    defaults = default_internsg_config()
    config = SourceConfig(
        source_id=str(source.id),
        name=source.name,
        source_type=SourceType.HTML,
        base_url=source.base_url,
        allowed_hosts=frozenset({"internsg.com", "www.internsg.com"}),
        user_agent=defaults.user_agent,
        timeout_seconds=defaults.timeout_seconds,
        retry_count=defaults.retry_count,
        polite_delay_seconds=defaults.polite_delay_seconds,
        enforce_robots=defaults.enforce_robots,
        robots_fail_closed=defaults.robots_fail_closed,
        enabled=source.enabled,
    )
    return InternSGAdapter(config)


def get_source_adapter_factory() -> SourceAdapterFactory:
    return build_source_adapter


def run_source(
    db: Session,
    *,
    source: JobSource,
    actor: User,
    adapter_factory: SourceAdapterFactory,
    max_links: int,
    max_details: int,
) -> CrawlRun:
    adapter = adapter_factory(source)
    started_at = datetime.now(UTC)
    crawl_run = CrawlRun(
        source_id=source.id,
        status=CrawlRunStatus.RUNNING,
        trigger="manual",
        started_at=started_at,
    )
    db.add(crawl_run)
    db.commit()
    run_id = crawl_run.id

    try:
        batch = adapter.collect(max_links=max_links, max_details=max_details)
        records = [item.known_fields for item in batch.items]
        stats = SqlAlchemyJobRepository(db, source).upsert(records)
        crawl_run = _reload_run(db, run_id)
        crawl_run.status = CrawlRunStatus(batch.status.value)
        crawl_run.finished_at = datetime.now(UTC)
        crawl_run.items_found = batch.discovered_count
        crawl_run.items_new = stats.items_new
        crawl_run.items_updated = stats.items_updated
        crawl_run.items_failed = len(batch.failures)
        crawl_run.error_summary = [
            failure.model_dump(mode="json") for failure in batch.failures
        ]
        source.status = {
            CrawlRunStatus.SUCCEEDED: "healthy",
            CrawlRunStatus.PARTIAL: "degraded",
            CrawlRunStatus.FAILED: "failed",
        }[crawl_run.status]
        _add_run_audit(db, actor=actor, source=source, crawl_run=crawl_run)
        db.commit()
    except Exception as exc:
        db.rollback()
        crawl_run = _reload_run(db, run_id)
        persisted_source = db.get(JobSource, source.id)
        if persisted_source is None:  # pragma: no cover - protected by FK constraints
            raise RuntimeError("Source disappeared during ingestion") from exc
        crawl_run.status = CrawlRunStatus.FAILED
        crawl_run.finished_at = datetime.now(UTC)
        crawl_run.items_failed = 1
        crawl_run.error_summary = [
            {
                "url": persisted_source.base_url,
                "stage": "validation",
                "error_type": type(exc).__name__,
                "message": str(exc),
                "retryable": False,
            }
        ]
        persisted_source.status = "failed"
        _add_run_audit(
            db, actor=actor, source=persisted_source, crawl_run=crawl_run
        )
        db.commit()
    finally:
        close = getattr(adapter, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # pragma: no cover - cleanup failures must not hide run evidence
                LOGGER.warning("Source adapter cleanup failed", exc_info=True)

    crawl_run = _reload_run(db, run_id)
    db.refresh(crawl_run)
    return crawl_run


def _reload_run(db: Session, run_id: UUID) -> CrawlRun:
    crawl_run = db.get(CrawlRun, run_id)
    if crawl_run is None:  # pragma: no cover - protected by the committed run row
        raise RuntimeError("Crawl run was not persisted")
    return crawl_run


def _add_run_audit(
    db: Session, *, actor: User, source: JobSource, crawl_run: CrawlRun
) -> None:
    db.add(
        AuditLog(
            actor_id=actor.id,
            action="source.run",
            entity_type="crawl_run",
            entity_id=str(crawl_run.id),
            metadata_json={
                "source_id": str(source.id),
                "status": crawl_run.status.value,
                "items_new": crawl_run.items_new,
                "items_updated": crawl_run.items_updated,
                "items_failed": crawl_run.items_failed,
            },
        )
    )
