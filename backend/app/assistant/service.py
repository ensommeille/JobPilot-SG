"""Application-form lookup and confirmed mapping persistence."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.applications.service import ApplicationConflictError, get_application
from app.assistant.schemas import AssistantApplicationCreate
from app.db.models import (
    Application,
    ApplicationForm,
    ApplicationMethod,
    ApplicationStatus,
    FormMappingRecord,
    JobPosting,
    User,
)
from app.profiles.service import get_profile


class AssistantConfirmationError(ValueError):
    pass


def list_fixture_forms(db: Session) -> list[ApplicationForm]:
    statement = (
        select(ApplicationForm)
        .join(ApplicationForm.job)
        .where(
            ApplicationForm.is_fixture.is_(True),
            JobPosting.status.in_(("active", "incomplete")),
        )
        .order_by(ApplicationForm.created_at, ApplicationForm.id)
    )
    return list(db.scalars(statement).all())


def get_form(db: Session, form_id: UUID) -> ApplicationForm | None:
    statement = (
        select(ApplicationForm)
        .join(ApplicationForm.job)
        .where(
            ApplicationForm.id == form_id,
            JobPosting.status.in_(("active", "incomplete")),
        )
    )
    return db.scalar(statement)


def profile_snapshot(db: Session, *, user: User) -> dict[str, Any]:
    profile = get_profile(db, user=user)
    return {
        "full_name": profile.full_name,
        "phone": profile.phone,
        "contact_email": profile.contact_email,
        "education": profile.education,
        "experience": profile.experience,
        "skills": list(profile.skills),
        "links": dict(profile.links),
    }


def _defined_field_ids(form: ApplicationForm) -> set[str]:
    return {
        str(item["field_id"])
        for item in form.fields_json
        if isinstance(item, dict) and item.get("field_id")
    }


def _required_field_ids(form: ApplicationForm) -> set[str]:
    return {
        str(item["field_id"])
        for item in form.fields_json
        if isinstance(item, dict) and item.get("field_id") and item.get("required") is True
    }


def validate_snapshot(form: ApplicationForm, snapshot_ids: set[str]) -> None:
    undefined = snapshot_ids - _defined_field_ids(form)
    if undefined:
        raise AssistantConfirmationError("form snapshot contains fields not defined by the form")


def create_assistant_application(
    db: Session,
    *,
    user: User,
    form: ApplicationForm,
    payload: AssistantApplicationCreate,
) -> tuple[Application, FormMappingRecord]:
    if form.job_id != payload.job_id:
        raise AssistantConfirmationError("form does not belong to the selected job")

    defined = _defined_field_ids(form)
    referenced = (
        {item.field_id for item in payload.mapping_draft.mapping}
        | set(payload.confirmed_field_ids)
        | set(payload.edited_values)
    )
    if referenced - defined:
        raise AssistantConfirmationError("mapping contains fields not defined by the form")

    confirmed = set(payload.confirmed_field_ids) | set(payload.edited_values)
    missing_required = _required_field_ids(form) - confirmed
    if missing_required:
        raise AssistantConfirmationError(
            "all required fields must be confirmed or supplied as edited values"
        )

    application = Application(
        user_id=user.id,
        job_id=payload.job_id,
        method=ApplicationMethod.ASSISTANT,
        status=ApplicationStatus.SUBMITTED,
        applied_url=form.job.apply_url,
        submitted_at=datetime.now(UTC),
        mapping_version=payload.mapping_version,
        confirmation_json={
            "confirmed_field_ids": sorted(payload.confirmed_field_ids),
            "edited_values": payload.edited_values,
        },
    )
    mapping = FormMappingRecord(
        user_id=user.id,
        form_id=form.id,
        application=application,
        mapping_version=payload.mapping_version,
        provider=payload.provider,
        prompt_version=payload.prompt_version,
        result_json=payload.mapping_draft.model_dump(mode="json"),
        confirmation_json=application.confirmation_json,
    )
    db.add_all([application, mapping])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApplicationConflictError("An application for this job already exists") from exc

    persisted_application = get_application(
        db, user=user, application_id=application.id
    )
    persisted_mapping = get_mapping(db, user=user, mapping_id=mapping.id)
    if persisted_application is None or persisted_mapping is None:  # pragma: no cover
        raise RuntimeError("Assistant application was not persisted")
    return persisted_application, persisted_mapping


def get_mapping(
    db: Session, *, user: User, mapping_id: UUID
) -> FormMappingRecord | None:
    statement = select(FormMappingRecord).where(
        FormMappingRecord.id == mapping_id, FormMappingRecord.user_id == user.id
    )
    return db.scalar(statement)
