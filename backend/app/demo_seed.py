"""Create a repeatable local dataset for demos and integration testing."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.schemas import RegisterRequest
from app.auth.service import normalize_email
from app.core.security import hash_password
from app.db.models import (
    ApplicationForm,
    AuditLog,
    JobPosting,
    JobSource,
    JobTag,
    User,
    UserProfile,
    UserRole,
)
from app.db.session import SessionLocal

DEMO_SOURCE_NAME = "JobPilot Sandbox"
DEMO_SOURCE_URL = "https://sandbox.jobpilot.local"
DEMO_FORM_VERSION = "sandbox-v1"
PASSWORD_ENV_VAR = "JOBPILOT_DEMO_ADMIN_PASSWORD"


@dataclass(frozen=True)
class DemoSeedResult:
    """Non-sensitive summary returned after a demo seed run."""

    admin_email: str
    admin_created: bool
    admin_promoted: bool
    source_created: bool
    jobs_created: int
    tags_created: int
    forms_created: int


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _job_fixtures(today: date) -> list[dict[str, Any]]:
    return [
        {
            "external_id": "sandbox-software-engineer-intern",
            "title": "Software Engineer Intern",
            "company": "JobPilot Sandbox Labs",
            "city": "Singapore",
            "salary_min": 1200,
            "salary_max": 1800,
            "salary_currency": "SGD",
            "salary_period": "month",
            "education": "Diploma or undergraduate",
            "experience": "Entry level",
            "job_type": "internship",
            "description": (
                "Build and test backend APIs for a Singapore job discovery platform. "
                "This local fixture is safe to use in demonstrations."
            ),
            "apply_url": f"{DEMO_SOURCE_URL}/apply/software-engineer-intern",
            "posted_at": today,
            "deadline": today + timedelta(days=30),
            "tags": (("Python", "skill"), ("FastAPI", "skill"), ("Internship", "employment")),
        },
        {
            "external_id": "sandbox-data-analyst",
            "title": "Junior Data Analyst",
            "company": "Lion City Analytics",
            "city": "Singapore",
            "salary_min": 3200,
            "salary_max": 4200,
            "salary_currency": "SGD",
            "salary_period": "month",
            "education": "Bachelor's degree",
            "experience": "0-2 years",
            "job_type": "full-time",
            "description": (
                "Prepare dashboards and analyse product data for a growing Singapore team. "
                "This local fixture does not submit data to an external employer."
            ),
            "apply_url": f"{DEMO_SOURCE_URL}/apply/junior-data-analyst",
            "posted_at": today,
            "deadline": today + timedelta(days=45),
            "tags": (("SQL", "skill"), ("Analytics", "skill"), ("Full-time", "employment")),
        },
    ]


def _form_fields() -> list[dict[str, Any]]:
    return [
        {
            "field_id": "full_name",
            "label": "Full name",
            "name": "full_name",
            "type": "text",
            "required": True,
            "options": [],
            "context": "Applicant identity",
        },
        {
            "field_id": "contact_email",
            "label": "Contact email",
            "name": "contact_email",
            "type": "email",
            "required": True,
            "options": [],
            "context": "Applicant contact details",
        },
        {
            "field_id": "education",
            "label": "Education",
            "name": "education",
            "type": "textarea",
            "required": True,
            "options": [],
            "context": "Highest qualification and field of study",
        },
        {
            "field_id": "experience",
            "label": "Relevant experience",
            "name": "experience",
            "type": "textarea",
            "required": False,
            "options": [],
            "context": "Relevant work, internship, or project experience",
        },
        {
            "field_id": "motivation",
            "label": "Why are you interested in this role?",
            "name": "motivation",
            "type": "textarea",
            "required": True,
            "options": [],
            "context": "Short application motivation",
        },
    ]


def _get_or_create_tag(db: Session, *, name: str, category: str) -> tuple[JobTag, bool]:
    tag = db.scalar(select(JobTag).where(JobTag.name == name, JobTag.category == category))
    if tag is not None:
        return tag, False

    tag = JobTag(name=name, category=category)
    db.add(tag)
    db.flush()
    return tag, True


def seed_demo(
    db: Session,
    *,
    admin_email: str,
    admin_password: str,
    reset_existing_password: bool = False,
    today: date | None = None,
) -> DemoSeedResult:
    """Seed the local demo dataset in one transaction.

    Existing accounts keep their password unless ``reset_existing_password`` is true.
    """

    credentials = RegisterRequest(email=admin_email, password=admin_password)
    normalized_email = normalize_email(str(credentials.email))
    current_date = today or date.today()

    admin_created = False
    admin_promoted = False
    source_created = False
    jobs_created = 0
    tags_created = 0
    forms_created = 0

    try:
        admin = db.scalar(select(User).where(User.email == normalized_email))
        if admin is None:
            admin = User(
                email=normalized_email,
                password_hash=hash_password(credentials.password),
                role=UserRole.ADMIN,
            )
            admin.profile = UserProfile(
                full_name="Demo Administrator",
                contact_email=normalized_email,
                skills=[],
                links={},
            )
            db.add(admin)
            db.flush()
            admin_created = True
        else:
            if admin.role != UserRole.ADMIN:
                admin.role = UserRole.ADMIN
                admin_promoted = True
            if not admin.is_active:
                admin.is_active = True
            if reset_existing_password:
                admin.password_hash = hash_password(credentials.password)
            if admin.profile is None:
                admin.profile = UserProfile(contact_email=normalized_email)

        source = db.scalar(select(JobSource).where(JobSource.name == DEMO_SOURCE_NAME))
        if source is None:
            source = JobSource(
                name=DEMO_SOURCE_NAME,
                source_type="sandbox",
                base_url=DEMO_SOURCE_URL,
                schedule=None,
                enabled=True,
                status="healthy",
            )
            db.add(source)
            db.flush()
            source_created = True

        first_job: JobPosting | None = None
        for fixture in _job_fixtures(current_date):
            external_id = str(fixture["external_id"])
            job = db.scalar(
                select(JobPosting).where(
                    JobPosting.source_id == source.id,
                    JobPosting.external_id == external_id,
                )
            )
            if job is None:
                content_fingerprint = json.dumps(fixture, default=str, sort_keys=True)
                job = JobPosting(
                    source_id=source.id,
                    external_id=external_id,
                    title=str(fixture["title"]),
                    company=str(fixture["company"]),
                    city=str(fixture["city"]),
                    salary_min=int(fixture["salary_min"]),
                    salary_max=int(fixture["salary_max"]),
                    salary_currency=str(fixture["salary_currency"]),
                    salary_period=str(fixture["salary_period"]),
                    education=str(fixture["education"]),
                    experience=str(fixture["experience"]),
                    job_type=str(fixture["job_type"]),
                    description=str(fixture["description"]),
                    apply_url=str(fixture["apply_url"]),
                    posted_at=fixture["posted_at"],
                    deadline=fixture["deadline"],
                    dedup_hash=_sha256(
                        f"{fixture['title']}|{fixture['company']}|{fixture['city']}|{external_id}"
                    ),
                    raw_hash=_sha256(content_fingerprint),
                    status="active",
                )
                db.add(job)
                for tag_name, category in fixture["tags"]:
                    tag, created = _get_or_create_tag(
                        db, name=str(tag_name), category=str(category)
                    )
                    tags_created += int(created)
                    job.tags.append(tag)
                db.flush()
                jobs_created += 1
            if first_job is None:
                first_job = job

        if first_job is None:  # pragma: no cover - fixtures are intentionally non-empty
            raise RuntimeError("Demo job fixtures are empty")

        form = db.scalar(
            select(ApplicationForm).where(
                ApplicationForm.job_id == first_job.id,
                ApplicationForm.template_version == DEMO_FORM_VERSION,
            )
        )
        if form is None:
            db.add(
                ApplicationForm(
                    job_id=first_job.id,
                    template_version=DEMO_FORM_VERSION,
                    fields_json=_form_fields(),
                    is_fixture=True,
                )
            )
            forms_created = 1

        db.add(
            AuditLog(
                actor_id=admin.id,
                action="demo.seed",
                entity_type="demo_dataset",
                entity_id=DEMO_SOURCE_NAME,
                metadata_json={
                    "admin_created": admin_created,
                    "admin_promoted": admin_promoted,
                    "source_created": source_created,
                    "jobs_created": jobs_created,
                    "tags_created": tags_created,
                    "forms_created": forms_created,
                },
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return DemoSeedResult(
        admin_email=normalized_email,
        admin_created=admin_created,
        admin_promoted=admin_promoted,
        source_created=source_created,
        jobs_created=jobs_created,
        tags_created=tags_created,
        forms_created=forms_created,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create an administrator and repeatable sandbox data for local demos."
    )
    parser.add_argument(
        "--admin-email",
        default="admin@jobpilot.sg",
        help="Administrator email (default: admin@jobpilot.sg)",
    )
    parser.add_argument(
        "--reset-existing-password",
        action="store_true",
        help="Replace the password when the administrator account already exists.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the local demo bootstrap without exposing the password in process arguments."""

    args = _parser().parse_args(argv)
    password = os.environ.get(PASSWORD_ENV_VAR)
    if password is None:
        password = getpass.getpass("Demo administrator password: ")

    with SessionLocal() as db:
        result = seed_demo(
            db,
            admin_email=args.admin_email,
            admin_password=password,
            reset_existing_password=args.reset_existing_password,
        )
    print(json.dumps(asdict(result), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through ``main`` tests
    raise SystemExit(main())
