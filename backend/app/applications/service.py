"""Application persistence and lifecycle rules."""

from datetime import UTC, datetime
from math import ceil
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.applications.schemas import ManualApplicationCreate, SavedApplicationAnswer
from app.db.models import (
    Application,
    ApplicationMethod,
    ApplicationStatus,
    FormMappingRecord,
    JobPosting,
    User,
)

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
        selectinload(Application.job).selectinload(JobPosting.forms),
    )


def get_application(db: Session, *, user: User, application_id: UUID) -> Application | None:
    statement = (
        select(Application)
        .options(*_load_options())
        .where(Application.id == application_id, Application.user_id == user.id)
    )
    return db.scalar(statement)


def get_saved_application_answers(
    db: Session, *, application: Application
) -> list[SavedApplicationAnswer] | None:
    """Resolve the user's final confirmed answers, not unconfirmed AI suggestions."""
    if application.method != ApplicationMethod.ASSISTANT:
        return None
    statement = (
        select(FormMappingRecord)
        .options(selectinload(FormMappingRecord.form))
        .where(
            FormMappingRecord.application_id == application.id,
            FormMappingRecord.user_id == application.user_id,
        )
        .order_by(FormMappingRecord.created_at.desc(), FormMappingRecord.id.desc())
    )
    mapping = db.scalar(statement)
    if mapping is None:
        return None

    confirmation = application.confirmation_json
    confirmed = set(confirmation.get("confirmed_field_ids", []))
    edited = confirmation.get("edited_values", {})
    selected = confirmed | set(edited)
    suggestions = {
        item["field_id"]: item.get("value")
        for item in mapping.result_json.get("mapping", [])
        if isinstance(item, dict) and isinstance(item.get("field_id"), str)
    }
    answers: list[SavedApplicationAnswer] = []
    for field in mapping.form.fields_json:
        if not isinstance(field, dict):
            continue
        field_id = field.get("field_id")
        if not isinstance(field_id, str) or field_id not in selected:
            continue
        value = edited[field_id] if field_id in edited else suggestions.get(field_id)
        answers.append(
            SavedApplicationAnswer(
                field_id=field_id,
                label=str(field.get("label") or field_id),
                value="" if value is None else str(value),
            )
        )
    return answers


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
