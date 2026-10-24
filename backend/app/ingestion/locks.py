"""Database leases shared by manual requests and the standalone source runner."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from threading import Event, Thread
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import SourceCrawlLease
from app.ingestion.schedule import utc_timestamp

LOGGER = logging.getLogger(__name__)
LEASE_SECONDS = 300
HEARTBEAT_SECONDS = 30


class SourceBusyError(ValueError):
    """Another manual request or runner currently owns this source."""


class SourceLeaseLostError(RuntimeError):
    """A stale worker must not publish records after losing its lease."""


def database_now(db: Session) -> datetime:
    dialect = db.get_bind().dialect.name
    expression = (
        func.strftime("%Y-%m-%d %H:%M:%f", "now")
        if dialect == "sqlite"
        else func.clock_timestamp()
        if dialect == "postgresql"
        else func.current_timestamp()
    )
    value = db.scalar(select(expression))
    return utc_timestamp(datetime.fromisoformat(value) if isinstance(value, str) else value)


class SourceLease:
    def __init__(self, source_id: UUID, owner_token: UUID, previous_run_id: UUID | None):
        self.source_id = source_id
        self.owner_token = owner_token
        self.previous_run_id = previous_run_id
        self._stop = Event()
        self._thread: Thread | None = None

    @classmethod
    def claim(cls, db: Session, source_id: UUID) -> SourceLease:
        now = database_now(db)
        previous = db.get(SourceCrawlLease, source_id, populate_existing=True)
        previous_run_id = previous.run_id if previous else None
        token = uuid4()
        if previous is None:
            try:
                with db.begin_nested():
                    db.add(SourceCrawlLease(source_id=source_id))
                    db.flush()
            except IntegrityError:
                db.rollback()
                raise SourceBusyError("Source is already being collected") from None
        changed = db.execute(
            update(SourceCrawlLease)
            .where(
                SourceCrawlLease.source_id == source_id,
                or_(
                    SourceCrawlLease.owner_token.is_(None),
                    SourceCrawlLease.expires_at.is_(None),
                    SourceCrawlLease.expires_at <= now,
                ),
            )
            .values(
                owner_token=token,
                heartbeat_at=now,
                expires_at=now + timedelta(seconds=LEASE_SECONDS),
            )
            .execution_options(synchronize_session=False)
        )
        if changed.rowcount != 1:
            db.rollback()
            raise SourceBusyError("Source is already being collected")
        db.commit()
        return cls(source_id, token, previous_run_id)

    def fence(self, db: Session, *, run_id: UUID | None = None) -> None:
        """Hold the lease row lock until the caller commits all publication writes."""
        now = database_now(db)
        values = {"heartbeat_at": now, "expires_at": now + timedelta(seconds=LEASE_SECONDS)}
        if run_id is not None:
            values["run_id"] = run_id
        changed = db.execute(
            update(SourceCrawlLease)
            .where(
                SourceCrawlLease.source_id == self.source_id,
                SourceCrawlLease.owner_token == self.owner_token,
                SourceCrawlLease.expires_at > now,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        if changed.rowcount != 1:
            raise SourceLeaseLostError("Source collection lease expired or changed owner")

    def start_heartbeat(self, db: Session) -> None:
        bind = db.get_bind()
        engine = getattr(bind, "engine", bind)
        # In-memory SQLite shares one connection; unit tests finish within the lease.
        if engine.dialect.name == "sqlite" and engine.url.database in {None, "", ":memory:"}:
            return

        def renew() -> None:
            while not self._stop.wait(HEARTBEAT_SECONDS):
                try:
                    with Session(engine) as heartbeat_db:
                        self.fence(heartbeat_db)
                        heartbeat_db.commit()
                except SourceLeaseLostError:
                    return
                except Exception:
                    LOGGER.warning(
                        "Source lease heartbeat failed; publication remains fenced", exc_info=True
                    )

        self._thread = Thread(target=renew, name=f"source-lease-{self.source_id}", daemon=True)
        self._thread.start()

    def release(self, db: Session) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        db.execute(
            update(SourceCrawlLease)
            .where(
                SourceCrawlLease.source_id == self.source_id,
                SourceCrawlLease.owner_token == self.owner_token,
            )
            .values(owner_token=None, expires_at=None)
            .execution_options(synchronize_session=False)
        )
        db.commit()
