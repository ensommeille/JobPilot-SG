"""Private, offline journey tests. All people and postings below are test fixtures."""

from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.db.models import (
    Application,
    ApplicationForm,
    ApplicationMethod,
    ApplicationStatus,
    JobPosting,
    JobSource,
    User,
    UserProfile,
)
from app.email_applications.models import EmailApplication, EmailApplicationPolicy


@pytest.fixture
def accounts(db: Session):
    users = [
        User(email=f"fictional-journey-{number}@example.com", password_hash="test-only")
        for number in (1, 2)
    ]
    db.add_all(users)
    db.commit()
    headers = [
        {"Authorization": f"Bearer {create_access_token(user_id=user.id, role=user.role.value)}"}
        for user in users
    ]
    return users, headers


@pytest.fixture(autouse=True)
def no_mail_dispatch(monkeypatch):
    monkeypatch.setenv("JOBPILOT_EMAIL_MODE", "disabled")

    def forbidden(*args, **kwargs):
        pytest.fail("Read-only journey must never dispatch email")

    monkeypatch.setattr("app.email_applications.router.deliver", forbidden)


@pytest.fixture
def job_factory(db: Session):
    source = JobSource(
        name="Journey synthetic test postings",
        source_type="mock",
        base_url="https://jobs.example.test",
    )
    db.add(source)
    db.commit()

    def make(*, apply_url="https://jobs.example.test/apply", assistant=False, **changes):
        key = uuid4().hex
        item = JobPosting(
            source_id=source.id,
            external_id=key,
            title="Synthetic backend internship",
            company="Fictional test company",
            description="Test fixture; not a real vacancy.",
            apply_url=apply_url,
            source_url="https://jobs.example.test/posting",
            dedup_hash=key * 2,
            raw_hash=key * 2,
            **changes,
        )
        db.add(item)
        db.flush()
        if assistant:
            db.add(
                ApplicationForm(job_id=item.id, template_version="journey-test", is_fixture=True)
            )
        db.commit()
        return item

    return make


def policy(db: Session, job: JobPosting, **changes):
    values = {
        "job_id": job.id,
        "email": "careers@fictional.example.com",
        "source_url": job.source_url,
        "evidence": "Synthetic fixture: send a CV to the verified test address.",
        "verified_at": datetime.now(UTC),
        "enabled": True,
    }
    values.update(changes)
    item = EmailApplicationPolicy(**values)
    db.add(item)
    db.commit()
    return item


def context(client, job, headers):
    return client.get(f"/jobs/{job.id}/application-context", headers=headers)


@pytest.mark.parametrize(
    "url,channel,path",
    [
        ("https://www.internsg.com/job-apply/123/", "internsg", "apply-external"),
        ("https://internsg.com/job-apply/123", "internsg", "apply-external"),
        ("https://job-boards.greenhouse.io/example/jobs/123?gh_jid=123", "ats", None),
        ("https://boards.greenhouse.io/example/jobs/123", "ats", None),
        ("https://job-boards.eu.greenhouse.io/example/jobs/123", "ats", None),
        ("https://job-boards.eu.greenhouse.io.attacker.test/example/jobs/123", "external", None),
        ("https://jobs.lever.co/example/abc-123/apply", "ats", None),
        ("https://jobs.eu.lever.co/example/abc-123/apply/", "ats", None),
        ("https://jobs.example.test/apply", "external", None),
        ("https://jobs.lever.co/example/abc-123", "external", None),
        ("https://jobs.lever.co.attacker.test/example/abc-123/apply", "external", None),
    ],
)
def test_channel_uses_exact_existing_supported_pages(
    client, accounts, job_factory, url, channel, path
):
    _users, headers = accounts
    job = job_factory(apply_url=url)
    response = context(client, job, headers[0])
    assert response.status_code == 200
    payload = response.json()
    assert payload["channel"] == channel
    assert payload["original_application_url"] == url
    assert payload["preparation_url"] == (f"/jobs/{job.id}/{path}" if path else None)
    assert isinstance(payload["instructions"], list)


def test_verified_email_takes_priority_and_reuses_existing_option(
    client, db, accounts, job_factory
):
    _users, headers = accounts
    job = job_factory(apply_url="https://www.internsg.com/job-apply/123/", assistant=True)
    policy(db, job)
    result = context(client, job, headers[0]).json()
    existing = client.get(f"/jobs/{job.id}/email-application-option", headers=headers[0]).json()
    assert result["channel"] == "email"
    assert result["email_option"] == existing
    assert "test mailbox" in " ".join(result["instructions"])
    assert result["preparation_url"] is None


@pytest.mark.parametrize(
    "changes",
    [
        {"enabled": False},
        {"source_url": "https://jobs.example.test/other"},
        {"evidence": " "},
        {"email": "invalid-email"},
    ],
)
def test_invalid_email_policy_cannot_take_priority(client, db, accounts, job_factory, changes):
    _users, headers = accounts
    job = job_factory(apply_url="https://jobs.eu.lever.co/example/abc/apply")
    policy(db, job, **changes)
    data = context(client, job, headers[0]).json()
    assert data["channel"] == "ats" and data["email_option"]["available"] is False


def test_assistant_is_selected_only_after_hosted_channels(client, accounts, job_factory):
    _users, headers = accounts
    generic = job_factory(assistant=True)
    hosted = job_factory(apply_url="https://boards.greenhouse.io/example/jobs/123", assistant=True)
    assert context(client, generic, headers[0]).json()["channel"] == "assistant"
    assert (
        context(client, generic, headers[0]).json()["preparation_url"]
        == f"/jobs/{generic.id}/apply"
    )
    assert context(client, hosted, headers[0]).json()["channel"] == "ats"


@pytest.mark.parametrize("status,days", [("closed", None), ("incomplete", None), ("active", -1)])
def test_closed_expired_or_incomplete_posting_cannot_be_applied_to(
    client, db, accounts, job_factory, status, days
):
    _users, headers = accounts
    today = datetime.now(timezone(timedelta(hours=8))).date()
    job = job_factory(
        status=status,
        deadline=today + timedelta(days=days) if days is not None else None,
        assistant=True,
    )
    policy(db, job)
    result = context(client, job, headers[0]).json()
    assert result["channel"] == "unavailable" and result["preparation_url"] is None


def test_deadline_today_is_still_available_in_singapore(client, accounts, job_factory):
    _users, headers = accounts
    today = datetime.now(timezone(timedelta(hours=8))).date()
    job = job_factory(deadline=today)
    assert context(client, job, headers[0]).json()["channel"] == "external"


@pytest.mark.parametrize(
    "unsafe",
    [
        "javascript:alert(1)",
        "data:text/html,hello",
        "http://jobs.example.test/apply",
        "//jobs.example.test/apply",
        "https://user:secret@jobs.example.test/apply",
        "https://jobs.example.test:444/apply",
        "https://jobs.example.test\\@attacker.test/apply",
        "https://jobs.example.test/\napply",
        " https://jobs.example.test/apply",
        "https://[invalid/apply",
        "https://jobs.%00example.test/apply",
        "https://jobs..example.test/apply",
    ],
)
def test_unsafe_urls_are_not_exposed_as_application_links(
    client, db, accounts, job_factory, unsafe
):
    _users, headers = accounts
    job = job_factory(apply_url=unsafe)
    job.source_url = unsafe
    db.commit()
    data = context(client, job, headers[0]).json()
    assert data["channel"] == "unavailable"
    assert data["original_application_url"] is None
    assert data["job"]["apply_url"] is None and data["job"]["source_url"] is None


def test_optional_transport_error_does_not_hide_external_channel(
    client, accounts, job_factory, monkeypatch
):
    _users, headers = accounts
    monkeypatch.setenv("JOBPILOT_EMAIL_MODE", "invalid-mode")
    data = context(client, job_factory(), headers[0]).json()
    assert data["channel"] == "external"
    assert data["email_option"]["available"] is False


def test_nested_email_source_must_be_safe_https(client, db, accounts, job_factory):
    _users, headers = accounts
    job = job_factory()
    job.source_url = "javascript:alert(1)"
    db.commit()
    policy(db, job)
    data = context(client, job, headers[0]).json()
    assert data["channel"] == "external"
    assert data["email_option"]["available"] is False
    assert data["job"]["source_url"] is None
    assert "javascript:" not in str(data)


def test_context_is_private_and_never_creates_or_copies_profiles(client, db, accounts, job_factory):
    users, headers = accounts
    job = job_factory()
    db.add(
        UserProfile(
            user_id=users[0].id,
            full_name="Fictional Alice",
            phone="private-phone",
            contact_email="alice@example.com",
            skills=["Python"],
        )
    )
    db.commit()
    alice = context(client, job, headers[0]).json()["profile"]
    bob = context(client, job, headers[1]).json()["profile"]
    assert alice["full_name"] == "Fictional Alice" and alice["skills"] == ["Python"]
    assert bob["full_name"] is None and bob["skills"] == []
    assert bob["contact_email"] == users[1].email and bob["phone"] is None
    assert db.scalar(select(func.count()).select_from(UserProfile)) == 1
    for path in (f"/jobs/{job.id}/application-context", "/application-history"):
        unauthorized = client.get(path)
        assert (
            unauthorized.status_code == 401 and unauthorized.headers["cache-control"] == "no-store"
        )
        assert (
            client.get(path, headers={"Authorization": "Bearer jpx_not-a-session"}).status_code
            == 401
        )
        assert client.get(path, headers=headers[0]).headers["cache-control"] == "no-store"
    for path in (
        f"/jobs/{uuid4()}/application-context",
        "/jobs/not-uuid/application-context",
        "/application-history?page=0",
        "/application-history?channel=opened",
    ):
        response = client.get(path, headers=headers[0])
        assert (
            response.status_code in {404, 422} and response.headers["cache-control"] == "no-store"
        )


def test_confirmed_profile_reaches_context_and_original_site_draft(client, accounts, job_factory):
    _users, headers = accounts
    # Explicitly confirmed synthetic profile facts, like suggestions accepted after a PDF review.
    saved = {
        "full_name": "Fictional Jamie",
        "contact_email": "jamie@example.com",
        "phone": "+65 6000 0000",
        "resume_summary": "Built a synthetic Python test project.",
        "education": "Test university programme",
        "experience": "Test project",
        "skills": ["Python", "SQL"],
        "availability_period": "January to June",
        "nationality": "sg",
        "study_country": "sg",
    }
    assert client.put("/profile", json=saved, headers=headers[0]).status_code == 200
    job = job_factory(apply_url="https://www.internsg.com/job-apply/123/")
    data = context(client, job, headers[0]).json()
    assert data["profile"] == saved
    draft = client.post(
        "/browser-assistant/draft",
        headers=headers[0],
        json={
            "page_url": job.apply_url,
            "field_ids": ["applicant_name", "applicant_email", "applicant_summary"],
        },
    ).json()
    assert draft["values"] == {
        "applicant_name": saved["full_name"],
        "applicant_email": saved["contact_email"],
        "applicant_summary": saved["resume_summary"],
    }
    assert draft["requires_review"] is True and draft["submission_supported"] is False


def documented(db, user, job, *, status="submitted", method="manual", when=None, record_id=None):
    when = when or datetime.now(UTC)
    item = Application(
        id=record_id or uuid4(),
        user_id=user.id,
        job_id=job.id,
        method=ApplicationMethod(method),
        status=ApplicationStatus(status),
        created_at=when,
        updated_at=when,
        submitted_at=when if status == "submitted" else None,
    )
    db.add(item)
    db.commit()
    return item


def email_record(db, user, job, *, status="draft", when=None, record_id=None):
    when = when or datetime.now(UTC)
    item = EmailApplication(
        id=record_id or uuid4(),
        user_id=user.id,
        job_id=job.id,
        status=status,
        subject="Synthetic application",
        body="Private fictional body must not appear in history",
        attachment_filename="fictional-resume.pdf",
        attachment_content=b"private fake blob",
        reviewed_snapshot={
            "body": "private reviewed text",
            "smtp_host": "do-not-expose",
            "channel": {
                "actual_recipient": "applications@jobpilot.test",
                "original_recipient": "careers@fictional.example.com",
            },
        },
        receipt={
            "transport": "test_smtp",
            "actual_recipient": "applications@jobpilot.test",
            "smtp_accepted": True,
            "employer_delivery_confirmed": False,
        }
        if status == "sent"
        else None,
        sent_at=when if status == "sent" else None,
        created_at=when,
        updated_at=when,
    )
    db.add(item)
    db.commit()
    return item


def test_history_globally_paginates_both_tables_and_isolates_accounts(
    client, db, accounts, job_factory
):
    users, headers = accounts
    start = datetime(2026, 10, 1, tzinfo=UTC)
    oldest = documented(db, users[0], job_factory(), when=start)
    middle = email_record(db, users[0], job_factory(), when=start + timedelta(days=1))
    newest = documented(db, users[0], job_factory(), when=start + timedelta(days=2), status="draft")
    email_record(db, users[1], job_factory(), when=start + timedelta(days=3))
    page1 = client.get("/application-history?page_size=2", headers=headers[0]).json()
    page2 = client.get("/application-history?page=2&page_size=2", headers=headers[0]).json()
    assert page1["total"] == page2["total"] == 3 and page1["pages"] == 2
    assert [item["id"] for item in page1["items"]] == [
        f"documented:{newest.id}",
        f"email:{middle.id}",
    ]
    assert page2["items"][0]["id"] == f"documented:{oldest.id}"
    assert client.get("/application-history", headers=headers[1]).json()["total"] == 1
    empty = client.get("/application-history?page=99&page_size=2", headers=headers[0]).json()
    assert empty["items"] == [] and empty["total"] == 3


def test_history_filters_before_paging_and_preserves_same_uuid_across_tables(
    client, db, accounts, job_factory
):
    users, headers = accounts
    shared_id = uuid4()
    row = documented(db, users[0], job_factory(), method="assistant", record_id=shared_id)
    email_record(db, users[0], job_factory(), status="sent", record_id=shared_id)
    manual = documented(db, users[0], job_factory(), method="manual", status="draft")
    documented(db, users[0], job_factory(), method="extension")
    combined = client.get("/application-history?page_size=1", headers=headers[0]).json()
    assert combined["total"] == 4
    for channel, expected in [
        ("email", f"email:{shared_id}"),
        ("assistant", f"documented:{row.id}"),
        ("manual", f"documented:{manual.id}"),
    ]:
        data = client.get(
            f"/application-history?channel={channel}&page_size=1", headers=headers[0]
        ).json()
        assert data["total"] == 1 and data["pages"] == 1
        assert data["items"][0]["id"] == expected and data["items"][0]["channel"] == channel


def test_history_ties_are_stable_across_global_page_boundaries(client, db, accounts, job_factory):
    users, headers = accounts
    same_time = datetime(2026, 10, 1, tzinfo=UTC)
    documented(db, users[0], job_factory(), when=same_time, record_id=UUID(int=2))
    documented(db, users[0], job_factory(), when=same_time, record_id=UUID(int=1))
    email_record(db, users[0], job_factory(), when=same_time, record_id=UUID(int=1))
    expected = [f"documented:{UUID(int=1)}", f"documented:{UUID(int=2)}", f"email:{UUID(int=1)}"]
    for _ in range(2):
        actual = [
            client.get(f"/application-history?page={page}&page_size=1", headers=headers[0]).json()[
                "items"
            ][0]["id"]
            for page in (1, 2, 3)
        ]
        assert actual == expected


@pytest.mark.parametrize(
    "status,label",
    [
        ("draft", "Email draft"),
        ("sending", "Test email sending"),
        ("sent", "Test email sent"),
        ("failed", "Test email failed"),
        ("unknown", "Test email outcome unknown"),
        ("legacy_other", "Email status unknown"),
    ],
)
def test_email_history_is_a_historical_test_receipt_without_transport_or_pdf_reads(
    client, db, accounts, job_factory, monkeypatch, status, label
):
    users, headers = accounts
    item = email_record(db, users[0], job_factory(), status=status)
    monkeypatch.setenv("JOBPILOT_EMAIL_MODE", "invalid-live-mode")
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", capture)
    try:
        response = client.get("/application-history", headers=headers[0])
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", capture)
    assert response.status_code == 200
    data = response.json()["items"][0]
    assert data["display_status"] == label and data["record_id"] == str(item.id)
    assert data["resume_filename"] == "fictional-resume.pdf"
    assert data["actual_recipient"] == "applications@jobpilot.test"
    assert data["created_at"].endswith("Z") and data["updated_at"].endswith("Z")
    assert (data["sent_at"] is not None) == (status == "sent")
    assert data["method"] is None
    text = response.text
    assert (
        "private fake blob" not in text
        and "Private fictional body" not in text
        and "do-not-expose" not in text
    )
    assert not any("email_applications.attachment_content" in sql for sql in statements)
    if status == "sent":
        assert data["receipt"]["employer_delivery_confirmed"] is False


def test_assistant_and_extension_records_never_claim_employer_submission(
    client, db, accounts, job_factory
):
    users, headers = accounts
    for method in ("assistant", "extension", "manual"):
        documented(db, users[0], job_factory(), method=method)
    items = client.get("/application-history", headers=headers[0]).json()["items"]
    for item in items:
        assert (
            item["status"] == "submitted"
        )  # Preserve the legacy stored state, explain it honestly.
        if item["method"] == "manual":
            assert (
                item["display_status"] == "Submitted (self-reported)"
                and item["submitted_at"] is not None
            )
        else:
            assert (
                item["display_status"] == "Application record saved"
                and item["submitted_at"] is None
            )


def test_preparation_draft_uses_existing_write_and_manual_status_endpoint(
    client, db, accounts, job_factory
):
    _users, headers = accounts
    job = job_factory()
    created = client.post(
        f"/jobs/{job.id}/applications", headers=headers[0], json={"status": "draft"}
    )
    assert created.status_code == 201
    record_id = created.json()["id"]
    draft = client.get("/application-history", headers=headers[0]).json()["items"][0]
    assert draft["display_status"] == "Preparation draft" and draft["submitted_at"] is None
    assert "opened" not in draft["display_status"].lower()
    assert (
        client.patch(
            f"/applications/{record_id}", headers=headers[1], json={"status": "submitted"}
        ).status_code
        == 404
    )
    updated = client.patch(
        f"/applications/{record_id}", headers=headers[0], json={"status": "submitted"}
    )
    assert updated.status_code == 200
    history = client.get("/application-history", headers=headers[0]).json()["items"][0]
    assert history["display_status"] == "Submitted (self-reported)"
    assert history["submitted_at"] is not None
    assert UUID(history["record_id"]) == UUID(record_id)
