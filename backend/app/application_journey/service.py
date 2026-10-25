"""One channel decision and one globally paged history without inventing send events."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import ceil
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import String, cast, false, func, literal, select, union_all
from sqlalchemy.orm import Session, load_only, selectinload

from app.application_journey.schemas import (
    ApplicationContext,
    ContextJob,
    HistoryChannel,
    JourneyHistoryItem,
    JourneyHistoryPage,
    JourneyJob,
    JourneyProfile,
)
from app.db.models import Application, ApplicationMethod, JobPosting, User, UserProfile
from app.email_applications.models import EmailApplication
from app.email_applications.router import email_option
from app.jobs.application_channels import safe_https_url, supported_application_type


def _profile(db: Session, user: User) -> JourneyProfile:
    # A read does not create an empty profile, change saved fields or copy another account.
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    data = (
        {field: getattr(profile, field) for field in JourneyProfile.model_fields}
        if profile is not None
        else {}
    )
    data["contact_email"] = data.get("contact_email") or user.email
    data["skills"] = data.get("skills") or []
    return JourneyProfile.model_validate(data)


def application_context(db: Session, *, user: User, job_id: UUID) -> ApplicationContext:
    job = db.scalar(
        select(JobPosting).options(selectinload(JobPosting.forms)).where(JobPosting.id == job_id)
    )
    if job is None:
        raise HTTPException(404, "Job not found")
    apply_url, source_url = safe_https_url(job.apply_url), safe_https_url(job.source_url)
    try:
        option = email_option(job_id=job_id, db=db, user=user)
    except HTTPException as exc:
        # A broken optional transport configuration must not hide other usable channels.
        option = {"available": False, "mode": "unavailable", "notice": str(exc.detail)}
    if option.get("source_url") and safe_https_url(option["source_url"]) is None:
        option = {
            "available": False,
            "mode": option.get("mode", "unavailable"),
            "notice": "Email source URL is invalid",
        }
    today = datetime.now(timezone(timedelta(hours=8))).date()
    active = job.status == "active" and (job.deadline is None or job.deadline >= today)
    channel, label, preparation_url = "unavailable", "Application unavailable", None
    instructions = [
        "This posting is closed, expired or unavailable. Check the original posting before applying."
    ]
    if active:
        if option.get("available") is True:
            channel, label = "email", "Prepare email application"
            instructions = [
                "Review your saved details, choose a PDF and confirm the email draft before sending.",
                "The current pilot sends only to the displayed test mailbox; it does not deliver to the employer.",
            ]
        else:
            supported = supported_application_type(apply_url) if apply_url is not None else None
            if supported == "internsg":
                channel, label = "internsg", "Prepare InternSG application"
                preparation_url = f"/jobs/{job.id}/apply-external"
                instructions = [
                    "Review your saved details, then fill the original InternSG form.",
                    "Complete CAPTCHA, file upload and final submission yourself; preparation does not submit an application.",
                ]
            elif supported == "ats":
                channel, label = "ats", "Prepare original application"
                instructions = [
                    "Open the original hosted application and use the JobPilot extension to review supported saved fields.",
                    "Other questions, files, redirects and final submission require manual handling; opening a page is not a submission.",
                ]
            elif job.assistant_form_available:
                channel, label = "assistant", "Prepare JobPilot application record"
                preparation_url = f"/jobs/{job.id}/apply"
                instructions = [
                    "Review and save your confirmed answers in JobPilot.",
                    "This creates a local application record; it does not send an application to the employer.",
                ]
            elif apply_url is not None:
                channel, label = "external", "Prepare external application"
                instructions = [
                    "Review your saved details and resume, then follow the official application's instructions.",
                    "Submit on the original site yourself. A preparation draft or opened link does not confirm submission.",
                ]
            else:
                instructions = [
                    "No safe HTTPS application link or configured application channel is available. Check the original posting's instructions."
                ]
    return ApplicationContext(
        job=ContextJob(
            id=job.id,
            title=job.title,
            company=job.company,
            status=job.status,
            apply_url=apply_url,
            source_url=source_url,
        ),
        channel=channel,
        channel_label=label,
        preparation_url=preparation_url,
        original_application_url=apply_url,
        instructions=instructions,
        profile=_profile(db, user),
        email_option=option,
    )


def _documented(item: Application, job: JourneyJob) -> JourneyHistoryItem:
    method, status = item.method.value, item.status.value
    if method == "manual":
        display = (
            "Preparation draft"
            if status == "draft"
            else f"{status.replace('_', ' ').capitalize()} (self-reported)"
        )
        next_action = (
            "Continue preparing, then record submission only after you personally submit on the original site."
            if status == "draft"
            else "This status was recorded by you; employer receipt is not verified."
        )
    else:
        display = (
            "Application record saved"
            if status == "submitted"
            else f"{status.replace('_', ' ').capitalize()} (recorded)"
        )
        next_action = "Review the saved record. It does not establish submission to or receipt by an employer."
    return JourneyHistoryItem(
        id=f"documented:{item.id}",
        record_id=item.id,
        kind="application",
        job=job,
        channel=method,
        method=method,
        status=status,
        display_status=display,
        created_at=item.created_at,
        updated_at=item.updated_at,
        submitted_at=item.submitted_at if item.method == ApplicationMethod.MANUAL else None,
        next_action=next_action,
    )


def _email(item: EmailApplication, job: JourneyJob) -> JourneyHistoryItem:
    labels = {
        "draft": "Email draft",
        "sending": "Test email sending",
        "sent": "Test email sent",
        "failed": "Test email failed",
        "unknown": "Test email outcome unknown",
    }
    next_actions = {
        "draft": "Review the draft and PDF before sending to the displayed test mailbox.",
        "sending": "Await a definitive receipt; sending is not evidence of employer delivery.",
        "sent": "The test SMTP server accepted this message; employer delivery and ATS submission are not confirmed.",
        "failed": "Inspect the failure before taking further action. No employer delivery is confirmed.",
        "unknown": "Check the test mailbox before taking further action; acceptance could not be confirmed.",
    }
    channel = (item.reviewed_snapshot or {}).get("channel") or {}
    receipt = item.receipt or {}
    return JourneyHistoryItem(
        id=f"email:{item.id}",
        record_id=item.id,
        kind="email",
        job=job,
        channel="email",
        status=item.status,
        display_status=labels.get(item.status, "Email status unknown"),
        created_at=item.created_at,
        updated_at=item.updated_at,
        submitted_at=item.sent_at if item.status == "sent" else None,
        sent_at=item.sent_at,
        resume_filename=item.attachment_filename,
        next_action=next_actions.get(
            item.status, "Review this record; no employer submission has been verified."
        ),
        actual_recipient=receipt.get("actual_recipient") or channel.get("actual_recipient"),
        original_recipient=channel.get("original_recipient"),
        receipt=item.receipt,
        failure_code=item.failure_code,
    )


def application_history(
    db: Session,
    *,
    user: User,
    page: int,
    page_size: int,
    channel: HistoryChannel | None = None,
) -> JourneyHistoryPage:
    documented = select(
        literal("application").label("kind"),
        Application.id.label("record_id"),
        Application.updated_at.label("updated_at"),
    ).where(Application.user_id == user.id)
    email = select(
        literal("email").label("kind"),
        EmailApplication.id.label("record_id"),
        EmailApplication.updated_at.label("updated_at"),
    ).where(EmailApplication.user_id == user.id)
    if channel is not None:
        documented = (
            documented.where(cast(Application.method, String) == channel)
            if channel != "email"
            else documented.where(false())
        )
        email = email if channel == "email" else email.where(false())
    combined = union_all(documented, email).subquery("application_journey_history")
    total = db.scalar(select(func.count()).select_from(combined)) or 0
    selected = db.execute(
        select(combined)
        .order_by(
            combined.c.updated_at.desc(),
            combined.c.kind,
            combined.c.record_id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    if not selected:
        return JourneyHistoryPage(
            items=[],
            total=total,
            page=page,
            page_size=page_size,
            pages=ceil(total / page_size) if total else 0,
        )
    application_ids = [row.record_id for row in selected if row.kind == "application"]
    email_ids = [row.record_id for row in selected if row.kind == "email"]
    applications = (
        {
            item.id: item
            for item in db.scalars(
                select(Application).where(
                    Application.id.in_(application_ids), Application.user_id == user.id
                )
            )
        }
        if application_ids
        else {}
    )
    emails = (
        {
            item.id: item
            for item in db.scalars(
                select(EmailApplication)
                .options(
                    load_only(
                        EmailApplication.id,
                        EmailApplication.job_id,
                        EmailApplication.user_id,
                        EmailApplication.status,
                        EmailApplication.created_at,
                        EmailApplication.updated_at,
                        EmailApplication.sent_at,
                        EmailApplication.attachment_filename,
                        EmailApplication.reviewed_snapshot,
                        EmailApplication.receipt,
                        EmailApplication.failure_code,
                    )
                )
                .where(EmailApplication.id.in_(email_ids), EmailApplication.user_id == user.id)
            )
        }
        if email_ids
        else {}
    )
    job_ids = {item.job_id for item in [*applications.values(), *emails.values()]}
    jobs = {
        job.id: JourneyJob(id=job.id, title=job.title, company=job.company)
        for job in db.scalars(
            select(JobPosting)
            .options(load_only(JobPosting.id, JobPosting.title, JobPosting.company))
            .where(JobPosting.id.in_(job_ids))
        )
    }
    items = []
    for row in selected:
        item = applications[row.record_id] if row.kind == "application" else emails[row.record_id]
        job = jobs.get(item.job_id) or JourneyJob(
            id=item.job_id, title="Unavailable posting", company=""
        )
        items.append(_documented(item, job) if row.kind == "application" else _email(item, job))
    return JourneyHistoryPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=ceil(total / page_size) if total else 0,
    )
