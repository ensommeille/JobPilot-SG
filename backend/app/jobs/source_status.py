"""Public source freshness without administrator diagnostics or credentials."""

from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource
from app.db.session import get_db
from app.ingestion.public_ats_adapter import public_ats_identity

router = APIRouter(tags=["jobs"])


class PublicSourceStatus(BaseModel):
    id: UUID
    name: str
    provider: str
    schedule: str | None
    status: str
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    next_run_at: datetime | None
    active_jobs: int

    @field_validator("last_attempt_at", "last_success_at", "next_run_at")
    @classmethod
    def utc_time(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class SourceStatusReport(BaseModel):
    observed_at: datetime
    sources: list[PublicSourceStatus]


def public_source_report(db: Session) -> SourceStatusReport:
    counts = dict(
        db.execute(
            select(JobPosting.source_id, func.count())
            .where(JobPosting.status == "active")
            .group_by(JobPosting.source_id)
        ).all()
    )
    items = []
    for source in db.scalars(
        select(JobSource).where(JobSource.enabled.is_(True)).order_by(JobSource.name)
    ):
        if source.source_type in {"mock", "sandbox"}:
            continue
        identity = public_ats_identity(source.base_url)
        provider = (
            identity[0]
            if identity
            else "InternSG"
            if (urlparse(source.base_url).hostname or "").lower()
            in {"internsg.com", "www.internsg.com"}
            else "Curated"
        )
        items.append(
            PublicSourceStatus(
                id=source.id,
                name=source.name,
                provider=provider,
                schedule=source.schedule,
                status=source.status,
                last_attempt_at=source.last_attempt_at,
                last_success_at=source.last_success_at,
                next_run_at=source.next_run_at,
                active_jobs=counts.get(source.id, 0),
            )
        )
    return SourceStatusReport(observed_at=datetime.now(UTC), sources=items)


@router.get("/job-sources/status", response_model=SourceStatusReport)
def read_source_status(
    response: Response, db: Annotated[Session, Depends(get_db)]
) -> SourceStatusReport:
    response.headers["Cache-Control"] = "no-store"
    return public_source_report(db)
