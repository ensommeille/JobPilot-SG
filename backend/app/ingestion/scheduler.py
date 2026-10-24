"""Explicit standalone ingestion runner: never started by FastAPI workers.

Example: python -m app.ingestion.scheduler --once --actor-id ADMIN_UUID
Catalog registration is opt-in: append --catalog greenhouse-stripe (repeatable).
This runner only collects public postings; it never extracts or ranks with an LLM.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from threading import Event
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import JobSource, SourceCrawlLease, User, UserRole
from app.ingestion.locks import SourceBusyError, SourceLeaseLostError, database_now
from app.ingestion.schedule import INTERVAL_HOURS
from app.ingestion.schemas import SourceCreate, SourceScheduleUpdate
from app.ingestion.service import (
    SourceAdapterFactory,
    SourceNotDueError,
    build_source_adapter,
    create_source,
    run_source,
    update_source_schedule,
)
from app.ingestion.source_catalog import catalog_source


def require_runner_admin(db: Session, actor_id: UUID) -> User:
    actor = db.get(User, actor_id, populate_existing=True)
    if actor is None or not actor.is_active or actor.role != UserRole.ADMIN:
        raise ValueError("Runner requires the ID of an active administrator")
    return actor


def register_catalog_sources(db: Session, *, actor: User, keys: Sequence[str]) -> list[JobSource]:
    require_runner_admin(db, actor.id)
    entries = [catalog_source(key) for key in dict.fromkeys(keys)]
    sources = []
    for entry in entries:
        source = db.scalar(select(JobSource).where(JobSource.base_url == entry.base_url))
        if source is None:
            source = create_source(
                db,
                actor=actor,
                payload=SourceCreate(
                    name=entry.name,
                    source_type=entry.source_type,
                    base_url=entry.base_url,
                    schedule=f"every:{entry.interval_hours}h",
                    enabled=True,
                    max_links=entry.max_links,
                    max_details=entry.max_details,
                ),
            )
        else:
            if source.source_type != entry.source_type.value:
                raise ValueError(f"Existing source type conflicts with catalog: {entry.key}")
            source = update_source_schedule(
                db,
                actor=actor,
                source=source,
                payload=SourceScheduleUpdate(
                    schedule=f"every:{entry.interval_hours}h",
                    enabled=True,
                    max_links=entry.max_links,
                    max_details=entry.max_details,
                ),
            )
        sources.append(source)
    return sources


def run_due_sources(
    db: Session,
    *,
    actor: User,
    adapter_factory: SourceAdapterFactory = build_source_adapter,
    limit: int = 20,
) -> list[dict[str, str]]:
    require_runner_admin(db, actor.id)
    if not 1 <= limit <= 100:
        raise ValueError("Runner source limit must be between 1 and 100")
    now = database_now(db)
    source_ids = list(
        db.scalars(
            select(JobSource.id)
            .outerjoin(SourceCrawlLease, SourceCrawlLease.source_id == JobSource.id)
            .where(
                JobSource.enabled.is_(True),
                JobSource.schedule.in_(INTERVAL_HOURS),
                or_(
                    JobSource.next_run_at.is_(None),
                    JobSource.next_run_at <= now,
                    (JobSource.status == "running")
                    & SourceCrawlLease.owner_token.is_not(None)
                    & (SourceCrawlLease.expires_at <= now),
                ),
            )
            .order_by(JobSource.next_run_at, JobSource.id)
            .limit(limit)
        )
    )
    reports = []
    for source_id in source_ids:
        source = db.get(JobSource, source_id)
        if source is None:
            continue
        try:
            run = run_source(
                db,
                source=source,
                actor=actor,
                adapter_factory=adapter_factory,
                max_links=source.max_links,
                max_details=source.max_details,
                trigger="scheduled",
            )
            reports.append(
                {"source_id": str(source_id), "run_id": str(run.id), "status": run.status.value}
            )
        except (SourceBusyError, SourceNotDueError):
            reports.append({"source_id": str(source_id), "status": "skipped"})
        except SourceLeaseLostError:
            reports.append({"source_id": str(source_id), "status": "lease_lost"})
        except Exception as exc:
            db.rollback()
            reports.append({"source_id": str(source_id), "status": "error", "error": str(exc)})
    return reports


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--loop", action="store_true")
    parser.add_argument("--actor-id", required=True, type=UUID)
    parser.add_argument("--catalog", action="append", default=[], metavar="KEY")
    parser.add_argument("--poll-seconds", type=int, default=60)
    args = parser.parse_args(argv)
    if not 5 <= args.poll_seconds <= 3600:
        parser.error("--poll-seconds must be between 5 and 3600")
    # Importing the runner itself does not initialize a database engine or start work.
    from app.db.session import SessionLocal

    try:
        with SessionLocal() as db:
            actor = require_runner_admin(db, args.actor_id)
            register_catalog_sources(db, actor=actor, keys=args.catalog)
        stop = Event()
        while True:
            with SessionLocal() as db:
                actor = require_runner_admin(db, args.actor_id)
                print(json.dumps(run_due_sources(db, actor=actor), ensure_ascii=False), flush=True)
            if args.once:
                return 0
            stop.wait(args.poll_seconds)
    except KeyboardInterrupt:
        return 0
    except ValueError as exc:
        parser.error(str(exc))
    return 2  # pragma: no cover


if __name__ == "__main__":
    raise SystemExit(main())
