"""Authenticated, source-bound email drafts with single-use reviewed SMTP dispatch."""

import hashlib
import json
import secrets
import time
from datetime import UTC, datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.models import JobPosting, User, UserProfile
from app.db.session import get_db
from app.email_applications.models import EmailApplication, EmailApplicationPolicy
from app.email_applications.schemas import DraftInput, SendInput
from app.email_applications.transport import (
    DeliveryError,
    MailConfig,
    TransportConfigurationError,
    deliver,
    safe_email,
)
from app.profiles.resume_files import parse_pdf, stored_attachment

NOTICE = "TEST PILOT: mail goes only to the displayed local .test mailbox. Sent means SMTP acceptance, not employer receipt or ATS submission."


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                response = await handler(request)
            except RequestValidationError as exc:
                response = await request_validation_exception_handler(request, exc)
            except HTTPException as exc:
                exc.headers = {**(exc.headers or {}), "Cache-Control": "no-store"}
                raise
            response.headers["Cache-Control"] = "no-store"
            return response

        return private_handler


router = APIRouter(tags=["email applications"], route_class=PrivateRoute)
DatabaseSession = Annotated[Session, Depends(get_db)]


def _hash(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def _config() -> MailConfig:
    try:
        return MailConfig.from_env()
    except TransportConfigurationError as exc:
        raise HTTPException(503, "Email transport configuration unavailable") from exc


def _policy(db: Session, job_id: UUID) -> tuple[JobPosting, EmailApplicationPolicy]:
    job = db.get(JobPosting, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    policy = db.get(EmailApplicationPolicy, job_id)
    if policy is None or not policy.enabled:
        raise HTTPException(
            409, "No verified email application channel is enabled for this posting"
        )
    singapore_today = datetime.now(timezone(timedelta(hours=8))).date()
    if job.status != "active" or (job.deadline is not None and job.deadline < singapore_today):
        raise HTTPException(409, "Posting is closed or expired")
    if (
        not policy.source_url
        or policy.source_url != job.source_url
        or not policy.evidence.strip()
        or not safe_email(policy.email)
    ):
        raise HTTPException(409, "Official email policy no longer matches the source posting")
    if policy.verified_at is None:
        raise HTTPException(409, "Email channel has not been verified")
    return job, policy


def _owned(db: Session, application_id: UUID, user: User) -> EmailApplication:
    item = db.scalar(
        select(EmailApplication).where(
            EmailApplication.id == application_id, EmailApplication.user_id == user.id
        )
    )
    if item is None:
        raise HTTPException(404, "Email application not found")
    return item


def _reply_to(db: Session, user: User) -> str:
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    value = profile.contact_email if profile and profile.contact_email else user.email
    if not safe_email(value):
        raise HTTPException(409, "Save a valid contact email before reviewing the application")
    return value


def _channel(policy: EmailApplicationPolicy, config: MailConfig) -> dict:
    return {
        "mode": config.mode,
        "original_recipient": policy.email,
        "actual_recipient": config.recipient,
        "source_url": policy.source_url,
        "evidence": policy.evidence,
        "verified_at": policy.verified_at.isoformat(),
        "notice": NOTICE,
    }


def _read(item: EmailApplication, db: Session, user: User) -> dict:
    # Historical receipts retain the reviewed channel even if current policy changes.
    snapshot = item.reviewed_snapshot or {}
    policy = db.get(EmailApplicationPolicy, item.job_id)
    job = db.get(JobPosting, item.job_id)
    channel = snapshot.get("channel") or (_channel(policy, _config()) if policy else {})
    return {
        "id": str(item.id),
        "job_id": str(item.job_id),
        "job_title": job.title if job else None,
        "company": job.company if job else None,
        "status": item.status,
        "subject": item.subject,
        "body": item.body,
        "attachment": {
            "filename": item.attachment_filename,
            "content_type": "application/pdf",
            "size_bytes": item.attachment_size,
            "sha256": item.attachment_sha256,
        }
        if item.attachment_content
        else None,
        "reply_to": snapshot.get("reply_to") or _reply_to(db, user),
        **channel,
        "receipt": item.receipt,
        "failure_code": item.failure_code,
        "error_code": item.failure_code,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "sent_at": item.sent_at,
    }


def _snapshot(item: EmailApplication, db: Session, user: User, config: MailConfig) -> dict:
    job, policy = _policy(db, item.job_id)
    if item.attachment_content is None or item.attachment_sha256 is None:
        raise HTTPException(
            422,
            "Upload actual PDF resume bytes before reviewing; saved resume metadata is insufficient",
        )
    return {
        "job_id": str(job.id),
        "job_raw_hash": job.raw_hash,
        "channel": _channel(policy, config),
        "smtp_host": config.host,
        "smtp_port": config.port,
        "sender": config.sender,
        "reply_to": _reply_to(db, user),
        "subject": item.subject,
        "body": item.body,
        "attachment_filename": item.attachment_filename,
        "attachment_sha256": hashlib.sha256(item.attachment_content).hexdigest(),
        "attachment_size": len(item.attachment_content),
    }


def _source_guard(snapshot: dict):
    """Recheck operator policy and posting in the same SQL statement as the state claim."""
    channel = snapshot["channel"]
    singapore_today = datetime.now(timezone(timedelta(hours=8))).date()
    return (
        select(EmailApplicationPolicy.job_id)
        .join(JobPosting, JobPosting.id == EmailApplicationPolicy.job_id)
        .where(
            EmailApplicationPolicy.job_id == EmailApplication.job_id,
            EmailApplicationPolicy.enabled.is_(True),
            EmailApplicationPolicy.email == channel["original_recipient"],
            EmailApplicationPolicy.source_url == channel["source_url"],
            EmailApplicationPolicy.evidence == channel["evidence"],
            EmailApplicationPolicy.verified_at == datetime.fromisoformat(channel["verified_at"]),
            JobPosting.source_url == channel["source_url"],
            JobPosting.raw_hash == snapshot["job_raw_hash"],
            JobPosting.status == "active",
            (JobPosting.deadline.is_(None) | (JobPosting.deadline >= singapore_today)),
        )
        .exists()
    )


@router.get("/jobs/{job_id}/email-application-option")
def email_option(job_id: UUID, db: DatabaseSession, user: CurrentUser) -> dict:
    config = _config()
    job = db.get(JobPosting, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    existing = db.scalar(
        select(EmailApplication.id).where(
            EmailApplication.job_id == job_id, EmailApplication.user_id == user.id
        )
    )
    try:
        _, policy = _policy(db, job_id)
    except HTTPException as exc:
        return {
            "available": False,
            "mode": config.mode,
            "notice": str(exc.detail),
            "existing_application_id": str(existing) if existing else None,
        }
    return {
        "available": True,
        **_channel(policy, config),
        "existing_application_id": str(existing) if existing else None,
    }


@router.post("/jobs/{job_id}/email-applications", status_code=201)
def create_draft(job_id: UUID, payload: DraftInput, db: DatabaseSession, user: CurrentUser) -> dict:
    job, _ = _policy(db, job_id)
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    name = profile.full_name if profile and profile.full_name else user.email
    body = f"Dear Recruitment Team,\n\nI would like to apply for {job.title}. Please find my CV attached.\n\nKind regards,\n{name}"
    item = EmailApplication(
        user_id=user.id,
        job_id=job_id,
        subject=payload.subject or f"Application: {job.title}"[:300],
        body=payload.body or body,
    )
    _set_attachment(item, payload, db=db, user=user)
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409, "An email application already exists for this posting; open its history"
        ) from exc
    db.refresh(item)
    return _read(item, db, user)


def _set_attachment(
    item: EmailApplication,
    payload: DraftInput,
    *,
    db: Session | None = None,
    user: User | None = None,
) -> None:
    if payload.resume_id is not None:
        filename, content = stored_attachment(db, user, payload.resume_id)
    elif payload.attachment is not None:
        content = payload.attachment.content()
        parse_pdf(content)  # legacy direct uploads receive the same real parser validation
        filename = payload.attachment.filename
    else:
        item.attachment_filename = item.attachment_content = item.attachment_sha256 = (
            item.attachment_size
        ) = None
        return
    item.attachment_filename = filename
    item.attachment_content = content
    item.attachment_sha256 = hashlib.sha256(content).hexdigest()
    item.attachment_size = len(content)


@router.put("/email-applications/{application_id}")
def replace_draft(
    application_id: UUID, payload: DraftInput, db: DatabaseSession, user: CurrentUser
) -> dict:
    item = _owned(db, application_id, user)
    _policy(db, item.job_id)
    if payload.subject is None or payload.body is None:
        raise HTTPException(422, "Saving a draft requires both subject and body")
    # The state predicate prevents edits racing a committed send claim.
    values = {
        "subject": payload.subject,
        "body": payload.body,
        "review_digest": None,
        "review_content_hash": None,
        "review_expires_at": None,
        "reviewed_snapshot": None,
    }
    if {"attachment", "resume_id"} & payload.model_fields_set:
        temporary = EmailApplication()
        _set_attachment(temporary, payload, db=db, user=user)
        values.update(
            {
                field: getattr(temporary, field)
                for field in (
                    "attachment_filename",
                    "attachment_content",
                    "attachment_sha256",
                    "attachment_size",
                )
            }
        )
    changed = db.execute(
        update(EmailApplication)
        .where(
            EmailApplication.id == item.id,
            EmailApplication.user_id == user.id,
            EmailApplication.status == "draft",
        )
        .values(**values),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    if changed.rowcount != 1:
        raise HTTPException(409, "Only an unsent draft can be edited")
    db.refresh(item)
    return _read(item, db, user)


@router.get("/email-applications")
def history(db: DatabaseSession, user: CurrentUser) -> dict:
    items = db.scalars(
        select(EmailApplication)
        .where(EmailApplication.user_id == user.id)
        .order_by(EmailApplication.created_at.desc())
        .limit(100)
    ).all()
    return {"items": [_read(item, db, user) for item in items]}


@router.get("/email-applications/{application_id}")
def detail(application_id: UUID, db: DatabaseSession, user: CurrentUser) -> dict:
    return _read(_owned(db, application_id, user), db, user)


@router.post("/email-applications/{application_id}/preview")
def preview(application_id: UUID, db: DatabaseSession, user: CurrentUser) -> dict:
    item = _owned(db, application_id, user)
    config = _config()
    snapshot = _snapshot(item, db, user, config)
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + 300
    content_hash = _hash(snapshot)
    # Content predicates ensure a stale reader cannot issue a token for an edited draft.
    changed = db.execute(
        update(EmailApplication)
        .where(
            EmailApplication.id == item.id,
            EmailApplication.status == "draft",
            EmailApplication.subject == item.subject,
            EmailApplication.body == item.body,
            EmailApplication.attachment_sha256 == item.attachment_sha256,
            EmailApplication.attachment_filename == item.attachment_filename,
            _source_guard(snapshot),
        )
        .values(
            review_digest=hashlib.sha256(token.encode()).hexdigest(),
            review_content_hash=content_hash,
            review_expires_at=expires,
            reviewed_snapshot=snapshot,
        ),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    if changed.rowcount != 1:
        raise HTTPException(409, "Draft changed or was already dispatched; reload before reviewing")
    db.refresh(item)
    return {
        "application": _read(item, db, user),
        "content_hash": content_hash,
        "review_token": token,
        "expires_at": datetime.fromtimestamp(expires, UTC),
    }


@router.post("/email-applications/{application_id}/send")
def send(application_id: UUID, payload: SendInput, db: DatabaseSession, user: CurrentUser) -> dict:
    item = _owned(db, application_id, user)
    config = _config()
    if config.mode != "test_smtp":
        raise HTTPException(409, "Sending is disabled; only the local test mailbox is supported")
    snapshot = _snapshot(item, db, user, config)
    token_digest = hashlib.sha256(payload.review_token.encode()).hexdigest()
    content_hash = _hash(snapshot)
    now = int(time.time())
    changed = db.execute(
        update(EmailApplication)
        .where(
            EmailApplication.id == item.id,
            EmailApplication.user_id == user.id,
            EmailApplication.status == "draft",
            EmailApplication.review_digest == token_digest,
            EmailApplication.review_content_hash == content_hash,
            EmailApplication.review_expires_at >= now,
            EmailApplication.subject == item.subject,
            EmailApplication.body == item.body,
            EmailApplication.attachment_sha256 == item.attachment_sha256,
            EmailApplication.attachment_filename == item.attachment_filename,
            _source_guard(snapshot),
        )
        .values(status="sending", review_digest=None),
        execution_options={"synchronize_session": False},
    )
    db.commit()  # Durable claim BEFORE any SMTP traffic; a crash remains sending, never auto-retried.
    if changed.rowcount != 1:
        raise HTTPException(
            409, "Review is stale, expired, already used, or dispatch is already in progress"
        )
    try:
        receipt = deliver(
            config,
            subject=item.subject,
            body=item.body,
            reply_to=snapshot["reply_to"],
            filename=item.attachment_filename,
            content=item.attachment_content,
        )
        state, failure = "sent", None
    except DeliveryError as exc:
        receipt = None
        state, failure = ("unknown" if exc.ambiguous else "failed"), exc.code
    db.execute(
        update(EmailApplication)
        .where(EmailApplication.id == item.id, EmailApplication.status == "sending")
        .values(
            status=state,
            receipt=receipt,
            failure_code=failure,
            sent_at=datetime.now(UTC) if state == "sent" else None,
        ),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    db.refresh(item)
    return _read(item, db, user)
