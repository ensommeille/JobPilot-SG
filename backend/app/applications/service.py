"""Application persistence and lifecycle rules."""

from datetime import UTC, datetime
from math import ceil
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.applications.schemas import ManualApplicationCreate
from app.db.models import Application, ApplicationMethod, ApplicationStatus, JobPosting, User

ALLOWED_TRANSITIONS: dict[ApplicationStatus, set[ApplicationStatus]] = {
    ApplicationStatus.DRAFT: {ApplicationStatus.SUBMITTED, ApplicationStatus.WITHDRAWN},
    ApplicationStatus.SUBMITTED: {
        ApplicationStatus.INTERVIEWING,
        ApplicationStatus.REJECTED,
        ApplicationStatus.WITHDRAWN,
    },
    ApplicationStatus.INTERVIEWING: {
        ApplicationStatus.OFFERED,
        ApplicationStatus.REJECTED,
        ApplicationStatus.WITHDRAWN,
    },
    ApplicationStatus.OFFERED: {ApplicationStatus.WITHDRAWN},
    ApplicationStatus.REJECTED: set(),
    ApplicationStatus.WITHDRAWN: set(),
}


class ApplicationConflictError(ValueError):
    pass


class InvalidApplicationTransitionError(ValueError):
    pass


def _load_options() -> tuple[object, ...]:
    return (
        selectinload(Application.job).joinedload(JobPosting.source),
        selectinload(Application.job).selectinload(JobPosting.tags),
    )


def get_application(db: Session, *, user: User, application_id: UUID) -> Application | None:
    statement = (
        select(Application)
        .options(*_load_options())
        .where(Application.id == application_id, Application.user_id == user.id)
    )
    return db.scalar(statement)


def get_application_for_job(db: Session, *, user: User, job_id: UUID) -> Application | None:
    statement = select(Application).where(
        Application.user_id == user.id, Application.job_id == job_id
    )
    return db.scalar(statement)


def create_manual_application(
    db: Session,
    *,
    user: User,
    job: JobPosting,
    payload: ManualApplicationCreate,
) -> Application:
    if get_application_for_job(db, user=user, job_id=job.id) is not None:
        raise ApplicationConflictError("An application for this job already exists")
    submitted_at = payload.submitted_at
    if payload.status == ApplicationStatus.SUBMITTED and submitted_at is None:
        submitted_at = datetime.now(UTC)
    application = Application(
        user_id=user.id,
        job_id=job.id,
        method=ApplicationMethod.MANUAL,
        status=payload.status,
        applied_url=str(payload.applied_url) if payload.applied_url else job.apply_url,
        submitted_at=submitted_at,
    )
    db.add(application)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApplicationConflictError("An application for this job already exists") from exc
    persisted = get_application(db, user=user, application_id=application.id)
    if persisted is None:  # pragma: no cover
        raise RuntimeError("Application was not persisted")
    return persisted


def list_applications(
    db: Session, *, user: User, page: int, page_size: int
) -> tuple[list[Application], int, int]:
    condition = Application.user_id == user.id
    total = db.scalar(select(func.count()).select_from(Application).where(condition)) or 0
    statement = (
        select(Application)
        .options(*_load_options())
        .where(condition)
        .order_by(Application.updated_at.desc(), Application.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(db.scalars(statement).all())
    return items, total, ceil(total / page_size) if total else 0


def update_application_status(
    db: Session,
    *,
    user: User,
    application_id: UUID,
    target_status: ApplicationStatus,
) -> Application | None:
    application = get_application(db, user=user, application_id=application_id)
    if application is None:
        return None
    if target_status == application.status:
        return application
    if target_status not in ALLOWED_TRANSITIONS[application.status]:
        raise InvalidApplicationTransitionError(
            f"Cannot change application from {application.status.value} to {target_status.value}"
        )
    application.status = target_status
    if target_status == ApplicationStatus.SUBMITTED and application.submitted_at is None:
        application.submitted_at = datetime.now(UTC)
    db.commit()
    persisted = get_application(db, user=user, application_id=application.id)
    if persisted is None:  # pragma: no cover
        raise RuntimeError("Application disappeared after update")
    return persisted
