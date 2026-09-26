"""Tests for the repeatable local demonstration bootstrap."""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.service import register_user
from app.core.security import verify_password
from app.db.models import ApplicationForm, AuditLog, JobPosting, JobSource, JobTag, User, UserRole
from app.demo_seed import DEMO_SOURCE_NAME, main, seed_demo


def test_seed_demo_creates_complete_dataset_and_is_idempotent(db: Session) -> None:
    first = seed_demo(
        db,
        admin_email="Admin@JobPilot.sg ",
        admin_password="demo-password-123",
        today=date(2026, 9, 25),
    )
    second = seed_demo(
        db,
        admin_email="admin@jobpilot.sg",
        admin_password="different-unused-password",
        today=date(2026, 10, 1),
    )

    assert first.admin_email == "admin@jobpilot.sg"
    assert first.admin_created is True
    assert first.source_created is True
    assert first.jobs_created == 2
    assert first.tags_created == 6
    assert first.forms_created == 1
    assert second.admin_created is False
    assert second.admin_promoted is False
    assert second.source_created is False
    assert second.jobs_created == 0
    assert second.tags_created == 0
    assert second.forms_created == 0

    admin = db.scalar(select(User).where(User.email == "admin@jobpilot.sg"))
    assert admin is not None
    assert admin.role == UserRole.ADMIN
    assert admin.profile is not None
    assert verify_password("demo-password-123", admin.password_hash)
    assert db.scalar(select(func.count()).select_from(JobSource)) == 1
    assert db.scalar(select(func.count()).select_from(JobPosting)) == 2
    assert db.scalar(select(func.count()).select_from(JobTag)) == 6
    assert db.scalar(select(func.count()).select_from(ApplicationForm)) == 1
    assert db.scalar(select(func.count()).select_from(AuditLog)) == 2

    source = db.scalar(select(JobSource).where(JobSource.name == DEMO_SOURCE_NAME))
    assert source is not None
    forms = list(db.scalars(select(ApplicationForm)).all())
    assert forms[0].is_fixture is True
    assert len(forms[0].fields_json) == 5


def test_seed_demo_promotes_existing_user_without_resetting_password(db: Session) -> None:
    user = register_user(db, email="seeker@example.com", password="original-password")

    result = seed_demo(
        db,
        admin_email=user.email,
        admin_password="ignored-new-password",
        today=date(2026, 9, 25),
    )

    db.refresh(user)
    assert result.admin_created is False
    assert result.admin_promoted is True
    assert user.role == UserRole.ADMIN
    assert verify_password("original-password", user.password_hash)
    assert not verify_password("ignored-new-password", user.password_hash)


def test_seed_demo_can_explicitly_reset_existing_password(db: Session) -> None:
    user = register_user(db, email="reset@example.com", password="original-password")

    seed_demo(
        db,
        admin_email=user.email,
        admin_password="replacement-password",
        reset_existing_password=True,
        today=date(2026, 9, 25),
    )

    db.refresh(user)
    assert user.role == UserRole.ADMIN
    assert verify_password("replacement-password", user.password_hash)
    assert not verify_password("original-password", user.password_hash)


def test_main_reads_password_from_environment_without_printing_it(
    db: Session, monkeypatch, capsys
) -> None:
    secret = "environment-password"
    monkeypatch.setenv("JOBPILOT_DEMO_ADMIN_PASSWORD", secret)

    assert main(["--admin-email", "cli-admin@example.com"]) == 0

    output = capsys.readouterr().out
    assert '"admin_email": "cli-admin@example.com"' in output
    assert secret not in output
    admin = db.scalar(select(User).where(User.email == "cli-admin@example.com"))
    assert admin is not None
    assert admin.role == UserRole.ADMIN
