"""Database-backed source management and ingestion orchestration."""

from __future__ import annotations

import logging
from collections.abc import Callable
from math import ceil
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import AuditLog, CrawlRun, CrawlRunStatus, JobSource, User
from app.ingestion.db_repository import SqlAlchemyJobRepository
from app.ingestion.internsg_adapter import InternSGAdapter, default_internsg_config
from app.ingestion.locks import SourceLease, SourceLeaseLostError, database_now
from app.ingestion.models import SourceConfig, SourceType
from app.ingestion.public_ats_adapter import PublicATSAdapter, public_ats_identity
from app.ingestion.schedule import INTERVAL_HOURS, next_attempt, utc_timestamp
from app.ingestion.schemas import SourceCreate, SourceScheduleUpdate
from app.ingestion.source_adapter import SourceAdapter

LOGGER = logging.getLogger(__name__)


class SourceConflictError(ValueError):
    """A source with the requested identity already exists."""


class SourceRunError(ValueError):
    """A configured source cannot currently be executed."""


class SourceNotDueError(SourceRunError):
    """A different worker has already completed the selected scheduled run."""


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
        max_links=payload.max_links,
        max_details=payload.max_details,
        enabled=payload.enabled,
        status="healthy",
        next_run_at=(
            database_now(db) if payload.enabled and payload.schedule in INTERVAL_HOURS else None
        ),
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


def update_source_schedule(
    db: Session, *, source: JobSource, payload: SourceScheduleUpdate, actor: User
) -> JobSource:
    """Pause future runs; a collection already in progress may finish and save its batch."""
    # Serialize the read/modify/write with a worker finishing a collection.
    db.refresh(source, with_for_update=True)
    changes = payload.model_dump(exclude_unset=True)
    max_links = changes.get("max_links", source.max_links)
    max_details = changes.get("max_details", source.max_details)
    if max_details > max_links:
        raise SourceRunError("max_details must not exceed max_links")
    changed_schedule = "schedule" in changes and changes["schedule"] != source.schedule
    enabled_now = changes.get("enabled") is True and not source.enabled
    for field, value in changes.items():
        setattr(source, field, value)
    if not source.enabled or source.schedule not in INTERVAL_HOURS:
        source.next_run_at = None
    elif changed_schedule or enabled_now or source.next_run_at is None:
        source.next_run_at = database_now(db)
    db.add(
        AuditLog(
            actor_id=actor.id,
            action="source.configure",
            entity_type="job_source",
            entity_id=str(source.id),
            metadata_json=changes,
        )
    )
    db.commit()
    db.refresh(source)
    return source


def list_sources(db: Session) -> list[JobSource]:
    statement = select(JobSource).order_by(func.lower(JobSource.name), JobSource.id)
    return list(db.scalars(statement).all())


def get_source(db: Session, source_id: UUID) -> JobSource | None:
    return db.get(JobSource, source_id)


def get_crawl_run(db: Session, run_id: UUID) -> CrawlRun | None:
    return db.get(CrawlRun, run_id)


def list_crawl_runs(db: Session, *, page: int, page_size: int) -> tuple[list[CrawlRun], int, int]:
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
    if source.source_type == SourceType.JSON.value:
        identity = public_ats_identity(source.base_url)
        if identity is None:
            raise SourceRunError(
                "Only canonical Greenhouse, Lever and Ashby public API boards are supported"
            )
        config = SourceConfig(
            source_id=str(source.id),
            name=source.name,
            source_type=SourceType.JSON,
            base_url=source.base_url,
            allowed_hosts=frozenset({host}),
            user_agent="JobPilot-SWE5006/0.3 (low-frequency academic project)",
        )
        return PublicATSAdapter(config, provider=identity[0])
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
    collected_external_ids: list[str] | None = None,
    trigger: str = "manual",
) -> CrawlRun:
    """Collect under a source lease; disabling pauses future runs, not an existing batch."""
    if trigger not in {"manual", "scheduled"}:
        raise SourceRunError("Unsupported collection trigger")
    if not source.enabled:
        raise SourceRunError("Source is disabled")
    lease = SourceLease.claim(db, source.id)
    adapter = None
    run_id = None
    try:
        db.refresh(source, with_for_update=True)
        if not source.enabled:
            raise SourceRunError("Source is disabled")
        started_at = database_now(db)
        previous = (
            db.get(CrawlRun, lease.previous_run_id, populate_existing=True)
            if lease.previous_run_id
            else None
        )
        interrupted = previous is not None and previous.status == CrawlRunStatus.RUNNING
        if trigger == "scheduled" and (
            source.schedule not in INTERVAL_HOURS
            or (
                not interrupted
                and source.next_run_at is not None
                and utc_timestamp(source.next_run_at) > started_at
            )
        ):
            raise SourceNotDueError("Source is no longer due")
        # Adapter construction validates configuration; collection happens only after leasing.
        if trigger == "manual":
            adapter = adapter_factory(source)
        lease.fence(db)
        if interrupted:
            previous.status = CrawlRunStatus.FAILED
            previous.finished_at = started_at
            previous.items_failed = 1
            previous.error_summary = [
                {
                    "error_type": "InterruptedRun",
                    "stage": "fetch",
                    "message": "Previous worker lease expired before completion",
                    "url": source.base_url,
                    "retryable": True,
                }
            ]
        crawl_run = CrawlRun(
            source_id=source.id,
            status=CrawlRunStatus.RUNNING,
            trigger=trigger,
            started_at=started_at,
        )
        db.add(crawl_run)
        db.flush()
        lease.fence(db, run_id=crawl_run.id)
        source.last_attempt_at = started_at
        source.status = "running"
        source.next_run_at = next_attempt(source.schedule, enabled=source.enabled, after=started_at)
        db.commit()
        run_id = crawl_run.id
        lease.start_heartbeat(db)
        if adapter is None:
            adapter = adapter_factory(source)
        batch = adapter.collect(max_links=max_links, max_details=max_details)
        lease.fence(db)
        # Keep an already collected batch, but respect the latest pause/interval setting.
        # Lock through commit so a concurrent pause cannot have next_run_at overwritten.
        db.refresh(source, with_for_update=True)
        finished_at = database_now(db)
        records = [item.known_fields for item in batch.items]
        repository = SqlAlchemyJobRepository(db, source)
        stats = repository.upsert(records, seen_at=finished_at)
        closed = 0
        is_complete = (
            source.source_type == SourceType.JSON.value
            and batch.listing_accessible
            and batch.status.value == "succeeded"
            and not batch.failures
            and 0 < batch.discovered_count == batch.attempted_count == len(records)
            and len({record.external_id for record in records}) == len(records)
        )
        if is_complete:
            closed = repository.close_missing({record.external_id for record in records})
        crawl_run = _reload_run(db, run_id)
        crawl_run.status = CrawlRunStatus(batch.status.value)
        crawl_run.finished_at = finished_at
        crawl_run.items_found = batch.discovered_count
        crawl_run.items_attempted = batch.attempted_count
        crawl_run.items_new = stats.items_new
        crawl_run.items_updated = stats.items_updated + closed
        crawl_run.items_unchanged = stats.items_unchanged
        crawl_run.items_closed = closed
        crawl_run.is_complete = is_complete
        crawl_run.items_failed = len(batch.failures)
        crawl_run.error_summary = [failure.model_dump(mode="json") for failure in batch.failures]
        source.status = {
            CrawlRunStatus.SUCCEEDED: "healthy",
            CrawlRunStatus.PARTIAL: "degraded",
            CrawlRunStatus.FAILED: "failed",
        }[crawl_run.status]
        if crawl_run.status == CrawlRunStatus.SUCCEEDED:
            source.last_success_at = finished_at
        source.next_run_at = next_attempt(
            source.schedule, enabled=source.enabled, after=finished_at
        )
        _add_run_audit(db, actor=actor, source=source, crawl_run=crawl_run)
        db.commit()
        if collected_external_ids is not None:
            collected_external_ids.extend(record.external_id for record in records)
    except Exception as exc:
        db.rollback()
        if run_id is None:
            raise
        crawl_run = _reload_run(db, run_id)
        persisted_source = db.get(JobSource, source.id)
        if persisted_source is None:  # pragma: no cover - protected by FK constraints
            raise RuntimeError("Source disappeared during ingestion") from exc
        try:
            lease.fence(db)
        except SourceLeaseLostError:
            db.rollback()
            # The new owner recovers the abandoned run. Never overwrite its source status.
            raise SourceLeaseLostError(
                "Collection lost ownership; no records were published"
            ) from exc
        db.refresh(persisted_source, with_for_update=True)
        finished_at = database_now(db)
        crawl_run.status = CrawlRunStatus.FAILED
        crawl_run.finished_at = finished_at
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
        persisted_source.next_run_at = next_attempt(
            persisted_source.schedule, enabled=persisted_source.enabled, after=finished_at
        )
        _add_run_audit(db, actor=actor, source=persisted_source, crawl_run=crawl_run)
        db.commit()
    finally:
        close = getattr(adapter, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # pragma: no cover - cleanup failures must not hide run evidence
                LOGGER.warning("Source adapter cleanup failed", exc_info=True)
        db.rollback()
        lease.release(db)

    crawl_run = _reload_run(db, run_id)
    db.refresh(crawl_run)
    return crawl_run


def _reload_run(db: Session, run_id: UUID) -> CrawlRun:
    crawl_run = db.get(CrawlRun, run_id)
    if crawl_run is None:  # pragma: no cover - protected by the committed run row
        raise RuntimeError("Crawl run was not persisted")
    return crawl_run


def _add_run_audit(db: Session, *, actor: User, source: JobSource, crawl_run: CrawlRun) -> None:
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
                "items_attempted": crawl_run.items_attempted,
                "items_unchanged": crawl_run.items_unchanged,
                "items_closed": crawl_run.items_closed,
                "is_complete": crawl_run.is_complete,
            },
        )
    )
