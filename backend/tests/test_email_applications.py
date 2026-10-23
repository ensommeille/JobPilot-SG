"""Source-bound email pilot: real loopback SMTP, private history and safe failure states."""

import base64
import hashlib
import importlib.util
import json
import os
import smtplib
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from email import policy as message_policy
from email.parser import BytesParser
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

import app.email_applications.router as routes
from app.db.base import Base
from app.db.models import JobPosting, JobSource
from app.db.session import SessionLocal, get_db
from app.email_applications.models import EmailApplication, EmailApplicationPolicy
from app.email_applications.schemas import MAX_PDF_BYTES
from app.email_applications.transport import (
    DeliveryError,
    MailConfig,
    TransportConfigurationError,
    deliver,
)
from app.main import app


def pdf_bytes(label: str = "Local test candidate") -> bytes:
    """Build a small complete PDF; candidate data here is fictitious."""
    stream = f"BT /F1 12 Tf 20 40 Td ({label}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
    ]
    raw, offsets = bytearray(b"%PDF-1.4\n"), [0]
    for index, value in enumerate(objects, start=1):
        offsets.append(len(raw))
        raw.extend(f"{index} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(raw)
    raw.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        raw.extend(f"{offset:010d} 00000 n \n".encode())
    raw.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(raw)


def attachment(label: str = "Local test candidate") -> dict:
    return {
        "filename": "candidate.pdf",
        "content_base64": base64.b64encode(pdf_bytes(label)).decode(),
    }


@pytest.fixture(autouse=True)
def isolated_mail_config(monkeypatch):
    monkeypatch.setenv("JOBPILOT_EMAIL_MODE", "disabled")
    for name in ("HOST", "PORT", "RECIPIENT"):
        monkeypatch.delenv(f"JOBPILOT_TEST_SMTP_{name}", raising=False)


@pytest.fixture
def email_job(db: Session) -> JobPosting:
    source = JobSource(
        name="Official internship programme",
        source_type="curated",
        base_url="https://www.spgroup.com.sg/about-us/careers",
    )
    job = JobPosting(
        source=source,
        external_id="sp-programme-test",
        title="SP Group Internship Programme",
        company="SP Group",
        description="Official programme accepting CV by email; not a specific software vacancy.",
        source_url=source.base_url,
        apply_url=source.base_url,
        dedup_hash="6" * 64,
        raw_hash="7" * 64,
    )
    db.add(job)
    db.commit()
    db.add(
        EmailApplicationPolicy(
            job_id=job.id,
            email="internship@spgroup.com.sg",
            source_url=job.source_url,
            evidence="Send your CV to internship@spgroup.com.sg to apply today!",
            verified_at=datetime.now(UTC),
            enabled=True,
        )
    )
    db.commit()
    return job


@pytest.fixture
def headers(client: TestClient) -> dict:
    return account(client)


def account(client: TestClient, email="mail-pilot@example.com") -> dict:
    assert (
        client.post(
            "/auth/register", json={"email": email, "password": "Fictitious-test-password-321!"}
        ).status_code
        == 201
    )
    response = client.post(
        "/auth/login", json={"email": email, "password": "Fictitious-test-password-321!"}
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create(client, headers, email_job, **changes):
    payload = {
        "subject": "Internship programme application",
        "body": "Please find my CV attached.\nFictitious student",
        "attachment": attachment(),
        **changes,
    }
    response = client.post(
        f"/jobs/{email_job.id}/email-applications", headers=headers, json=payload
    )
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def review(client, headers, draft):
    response = client.post(f"/email-applications/{draft['id']}/preview", headers=headers, json={})
    assert response.status_code == 200, response.text
    return response.json()


def send(client, headers, draft, reviewed):
    return client.post(
        f"/email-applications/{draft['id']}/send",
        headers=headers,
        json={"confirmed": True, "review_token": reviewed["review_token"]},
    )


def enable(monkeypatch, **changes):
    monkeypatch.setenv("JOBPILOT_EMAIL_MODE", "test_smtp")
    for name, value in changes.items():
        monkeypatch.setenv(f"JOBPILOT_TEST_SMTP_{name.upper()}", str(value))


@pytest.fixture
def mailbox(tmp_path):
    script = Path(__file__).resolve().parents[2] / "scripts" / "local_test_mailbox.py"
    spec = importlib.util.spec_from_file_location("jobpilot_local_test_mailbox", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    server = module.LocalMailbox("127.0.0.1", 0, tmp_path)
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
    )
    thread.start()
    yield server, tmp_path
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def test_option_auth_policy_and_profile_prefill(client, headers, email_job):
    assert client.get(f"/jobs/{email_job.id}/email-application-option").status_code == 401
    client.put(
        "/profile",
        headers=headers,
        json={"full_name": "Fictitious Applicant", "contact_email": "reply@example.com"},
    )
    option = client.get(f"/jobs/{email_job.id}/email-application-option", headers=headers)
    assert option.headers["cache-control"] == "no-store"
    assert option.json()["original_recipient"] == "internship@spgroup.com.sg"
    assert option.json()["actual_recipient"] is None
    draft = client.post(f"/jobs/{email_job.id}/email-applications", headers=headers, json={}).json()
    assert "Fictitious Applicant" in draft["body"]
    assert draft["reply_to"] == "reply@example.com"
    assert draft["attachment"] is None
    assert draft["job_title"] == email_job.title
    assert (
        client.get(f"/jobs/{email_job.id}/email-application-option", headers=headers).json()[
            "existing_application_id"
        ]
        == draft["id"]
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("recipient", "attacker@example.com"),
        ("policy", {"enabled": True}),
        ("cc", "attacker@example.com"),
        ("sender", "x@example.com"),
        ("headers", {"Bcc": "x@example.com"}),
        ("reply_to", "x@example.com"),
    ],
)
def test_candidate_cannot_override_delivery_controls(client, headers, email_job, field, value):
    response = client.post(
        f"/jobs/{email_job.id}/email-applications", headers=headers, json={field: value}
    )
    assert response.status_code == 422
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "changes",
    [
        {"subject": "Hello\r\nBcc: x@example.com"},
        {"subject": "   "},
        {"attachment": {"filename": "../cv.pdf", "content_base64": attachment()["content_base64"]}},
        {"attachment": {"filename": "cv.exe", "content_base64": attachment()["content_base64"]}},
        {"attachment": {"filename": "cv.pdf", "content_base64": "not base64"}},
        {
            "attachment": {
                "filename": "cv.pdf",
                "content_base64": base64.b64encode(b"metadata only").decode(),
            }
        },
        {
            "attachment": {
                "filename": "cv.pdf",
                "content_base64": base64.b64encode(
                    b"%PDF-1.4\n" + b"x" * MAX_PDF_BYTES + b"%%EOF"
                ).decode(),
            }
        },
    ],
)
def test_attachment_and_header_validation(client, headers, email_job, changes):
    response = client.post(
        f"/jobs/{email_job.id}/email-applications",
        headers=headers,
        json={"subject": "Application", "body": "CV attached", **changes},
    )
    assert response.status_code == 422


def test_metadata_only_resume_cannot_be_reviewed(client, headers, email_job):
    client.post(
        "/profile/resumes",
        headers=headers,
        json={"filename": "saved.pdf", "content_type": "application/pdf", "size_bytes": 123},
    )
    draft = create(client, headers, email_job, attachment=None)
    response = client.post(f"/email-applications/{draft['id']}/preview", headers=headers, json={})
    assert response.status_code == 422
    assert "metadata" in response.text


def test_draft_private_history_and_unique_attempt(client, headers, email_job):
    draft = create(client, headers, email_job)
    other = account(client, "other-pilot@example.com")
    assert client.get("/email-applications", headers=other).json() == {"items": []}
    for suffix in ("", "/preview", "/send"):
        path = f"/email-applications/{draft['id']}{suffix}"
        response = (
            client.get(path, headers=other)
            if not suffix
            else client.post(
                path,
                headers=other,
                json={"confirmed": True, "review_token": "x" * 43} if suffix == "/send" else {},
            )
        )
        assert response.status_code == 404
        assert response.headers["cache-control"] == "no-store"
    assert (
        client.put(
            f"/email-applications/{draft['id']}", headers=other, json={"subject": "X", "body": "X"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/jobs/{email_job.id}/email-applications", headers=headers, json={}
        ).status_code
        == 409
    )
    history = client.get("/email-applications", headers=headers)
    assert history.headers["cache-control"] == "no-store"
    assert (
        history.json()["items"][0]["attachment"]["sha256"]
        == hashlib.sha256(pdf_bytes()).hexdigest()
    )
    assert "content_base64" not in history.text


def test_disabled_is_default_and_never_calls_smtp(client, headers, email_job, monkeypatch):
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    monkeypatch.setattr(smtplib, "SMTP", lambda *a, **k: pytest.fail("Disabled mode tried SMTP"))
    assert send(client, headers, draft, reviewed).status_code == 409
    assert (
        client.get(f"/email-applications/{draft['id']}", headers=headers).json()["status"]
        == "draft"
    )


@pytest.mark.parametrize(
    "settings",
    [
        {"host": "smtp.example.com"},
        {"host": "8.8.8.8"},
        {"host": "0.0.0.0"},
        {"host": "::ffff:8.8.8.8"},
        {"recipient": "internship@spgroup.com.sg"},
        {"recipient": "applications@jobpilot.test\r\nBcc: x@example.com"},
        {"port": 0},
        {"port": "bad"},
    ],
)
def test_transport_fails_closed_before_any_socket(monkeypatch, settings):
    enable(monkeypatch, **settings)
    monkeypatch.setattr(
        smtplib, "SMTP", lambda *a, **k: pytest.fail("Invalid configuration opened SMTP")
    )
    with pytest.raises(TransportConfigurationError):
        MailConfig.from_env()


def test_loopback_real_smtp_preserves_pdf_and_only_test_envelope(
    client, headers, email_job, monkeypatch, mailbox
):
    server, directory = mailbox
    enable(monkeypatch, port=server.server_address[1])
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    assert reviewed["application"]["actual_recipient"] == "applications@jobpilot.test"
    assert reviewed["application"]["original_recipient"] == "internship@spgroup.com.sg"
    response = send(client, headers, draft, reviewed)
    assert response.status_code == 200, response.text
    sent = response.json()
    assert sent["status"] == "sent" and sent["sent_at"]
    assert sent["receipt"]["smtp_accepted"] is True
    assert sent["receipt"]["employer_delivery_confirmed"] is False
    messages = list(directory.glob("*.eml"))
    assert len(messages) == 1
    receipt = json.loads(next(directory.glob("*.json")).read_text())
    assert receipt["envelope_from"] == "jobpilot@jobpilot.test"
    assert receipt["envelope_to"] == ["applications@jobpilot.test"]
    message = BytesParser(policy=message_policy.default).parsebytes(messages[0].read_bytes())
    assert message["To"] == "applications@jobpilot.test"
    assert message["Reply-To"] == "mail-pilot@example.com"
    assert message["Cc"] is None and message["Bcc"] is None
    assert message["Message-ID"] == sent["receipt"]["message_id"]
    assert next(message.iter_attachments()).get_payload(decode=True) == pdf_bytes()
    assert (
        message.get_body(preferencelist=("plain",)).get_content().replace("\r\n", "\n").strip()
        == draft["body"]
    )
    assert send(client, headers, draft, reviewed).status_code == 409
    assert (
        client.put(
            f"/email-applications/{draft['id']}",
            headers=headers,
            json={"subject": "Changed", "body": "Changed"},
        ).status_code
        == 409
    )
    assert len(list(directory.glob("*.eml"))) == 1
    persisted = client.get("/email-applications", headers=headers).json()["items"][0]
    assert persisted["receipt"] == sent["receipt"]


def test_mailbox_refuses_real_employer_envelope(mailbox):
    server, directory = mailbox
    with smtplib.SMTP("127.0.0.1", server.server_address[1], timeout=2) as smtp:
        smtp.ehlo()
        assert smtp.mail("jobpilot@jobpilot.test")[0] == 250
        assert smtp.rcpt("internship@spgroup.com.sg")[0] == 550
    assert list(directory.iterdir()) == []


@pytest.mark.parametrize(
    "mutation",
    [
        "body",
        "attachment",
        "filename",
        "reply_to",
        "policy_email",
        "policy_evidence",
        "policy_verified",
        "policy_disabled",
        "source_url",
        "job_closed",
        "job_expired",
        "job_changed",
        "transport_recipient",
        "transport_port",
        "token_expired",
        "token_wrong",
    ],
)
def test_review_binds_exact_content_policy_job_and_transport(
    client, headers, email_job, monkeypatch, db, mutation
):
    enable(monkeypatch)
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    if mutation in ("body", "attachment", "filename"):
        replacement = {"subject": draft["subject"], "body": draft["body"]}
        if mutation == "body":
            replacement["body"] += " edited"
        else:
            replacement["attachment"] = attachment(
                "Different bytes" if mutation == "attachment" else "Local test candidate"
            )
            if mutation == "filename":
                replacement["attachment"]["filename"] = "renamed.pdf"
        assert (
            client.put(
                f"/email-applications/{draft['id']}", headers=headers, json=replacement
            ).status_code
            == 200
        )
    elif mutation == "reply_to":
        assert (
            client.put(
                "/profile", headers=headers, json={"contact_email": "changed@example.com"}
            ).status_code
            == 200
        )
    elif mutation.startswith("policy_"):
        item = db.get(EmailApplicationPolicy, email_job.id)
        if mutation == "policy_email":
            item.email = "different@spgroup.com.sg"
        if mutation == "policy_evidence":
            item.evidence += " Changed"
        if mutation == "policy_verified":
            item.verified_at = datetime.now(UTC) + timedelta(seconds=3)
        if mutation == "policy_disabled":
            item.enabled = False
        db.commit()
    elif mutation in ("source_url", "job_closed", "job_expired", "job_changed"):
        job = db.get(JobPosting, email_job.id)
        if mutation == "source_url":
            job.source_url = "https://example.com/changed"
        if mutation == "job_closed":
            job.status = "closed"
        if mutation == "job_expired":
            job.deadline = date.today() - timedelta(days=1)
        if mutation == "job_changed":
            job.raw_hash = "9" * 64
        db.commit()
    elif mutation == "transport_recipient":
        enable(monkeypatch, recipient="changed@jobpilot.test")
    elif mutation == "transport_port":
        enable(monkeypatch, port=1026)
    elif mutation == "token_expired":
        item = db.get(EmailApplication, UUID(draft["id"]))
        item.review_expires_at = int(time.time()) - 1
        db.commit()
    else:
        reviewed["review_token"] = "x" * 43
    monkeypatch.setattr(
        routes, "deliver", lambda *a, **k: pytest.fail("Stale review reached transport")
    )
    assert send(client, headers, draft, reviewed).status_code == 409


def test_replace_can_preserve_or_remove_pdf_and_invalidates_token(client, headers, email_job):
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    payload = {"subject": "New subject", "body": "New body"}
    response = client.put(f"/email-applications/{draft['id']}", headers=headers, json=payload)
    assert response.json()["attachment"] == draft["attachment"]
    response = client.put(
        f"/email-applications/{draft['id']}", headers=headers, json={**payload, "attachment": None}
    )
    assert response.json()["attachment"] is None
    assert (
        client.post(f"/email-applications/{draft['id']}/preview", headers=headers).status_code
        == 422
    )
    assert reviewed["review_token"]


@pytest.mark.parametrize(
    "error,expected",
    [
        (DeliveryError("smtp_rejected"), "failed"),
        (DeliveryError("smtp_acceptance_unknown", ambiguous=True), "unknown"),
    ],
)
def test_failure_and_ambiguous_timeout_are_durable_and_not_retried(
    client, headers, email_job, monkeypatch, error, expected
):
    enable(monkeypatch)
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    calls = []

    def fail(*args, **kwargs):
        calls.append(True)
        raise error

    monkeypatch.setattr(routes, "deliver", fail)
    result = send(client, headers, draft, reviewed).json()
    assert result["status"] == expected and result["receipt"] is None
    assert result["failure_code"] == error.code
    assert send(client, headers, draft, reviewed).status_code == 409
    assert len(calls) == 1
    assert (
        client.get("/email-applications", headers=headers).json()["items"][0]["status"] == expected
    )


def test_sending_claim_is_committed_before_transport_and_blocks_inflight_retry(
    client, headers, email_job, monkeypatch
):
    enable(monkeypatch)
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    calls = []

    def accepted(*args, **kwargs):
        with SessionLocal() as session:
            item = session.scalar(
                select(EmailApplication).where(EmailApplication.job_id == email_job.id)
            )
            assert item.status == "sending" and item.review_digest is None
        calls.append(True)
        assert send(client, headers, draft, reviewed).status_code == 409
        return {"smtp_accepted": True, "employer_delivery_confirmed": False}

    monkeypatch.setattr(routes, "deliver", accepted)
    assert send(client, headers, draft, reviewed).json()["status"] == "sent"
    assert len(calls) == 1


def test_process_crash_leaves_sending_and_never_auto_retries(
    client, headers, email_job, monkeypatch
):
    enable(monkeypatch)
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)

    def crash(*args, **kwargs):
        raise RuntimeError("simulated process failure after durable claim")

    monkeypatch.setattr(routes, "deliver", crash)
    with pytest.raises(RuntimeError):
        send(client, headers, draft, reviewed)
    assert (
        client.get(f"/email-applications/{draft['id']}", headers=headers).json()["status"]
        == "sending"
    )
    assert send(client, headers, draft, reviewed).status_code == 409


def test_token_is_single_current_review_and_confirmation_is_explicit(
    client, headers, email_job, monkeypatch
):
    enable(monkeypatch)
    draft = create(client, headers, email_job)
    older = review(client, headers, draft)
    newer = review(client, headers, draft)
    assert older["content_hash"] == newer["content_hash"]
    assert older["review_token"] != newer["review_token"]
    assert send(client, headers, draft, older).status_code == 409
    path = f"/email-applications/{draft['id']}/send"
    for payload in (
        {"review_token": newer["review_token"]},
        {"confirmed": False, "review_token": newer["review_token"]},
        {"confirmed": 1, "review_token": newer["review_token"]},
        {"confirmed": True, "review_token": newer["review_token"], "recipient": "x@example.com"},
    ):
        response = client.post(path, headers=headers, json=payload)
        assert response.status_code == 422
        assert response.headers["cache-control"] == "no-store"


def test_unverified_policy_missing_job_and_disabled_channel(client, headers, db, email_job):
    assert (
        client.get(f"/jobs/{uuid4()}/email-application-option", headers=headers).status_code == 404
    )
    policy = db.get(EmailApplicationPolicy, email_job.id)
    policy.enabled = False
    db.commit()
    option = client.get(f"/jobs/{email_job.id}/email-application-option", headers=headers)
    assert option.json()["available"] is False
    assert (
        client.post(
            f"/jobs/{email_job.id}/email-applications", headers=headers, json={}
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "failure,phase,ambiguous,code",
    [
        (ConnectionRefusedError(), "connect", False, "smtp_connection_failed"),
        (TimeoutError(), "send", True, "smtp_acceptance_unknown"),
        (smtplib.SMTPServerDisconnected(), "send", True, "smtp_acceptance_unknown"),
        (smtplib.SMTPDataError(550, b"rejected"), "send", False, "smtp_rejected"),
        (
            smtplib.SMTPRecipientsRefused({"applications@jobpilot.test": (550, b"rejected")}),
            "send",
            False,
            "smtp_rejected",
        ),
    ],
)
def test_real_transport_error_classification(monkeypatch, failure, phase, ambiguous, code):
    enable(monkeypatch)
    calls = []

    class SMTPDouble:
        def send_message(self, message, *, from_addr, to_addrs):
            assert from_addr == "jobpilot@jobpilot.test"
            assert to_addrs == ["applications@jobpilot.test"]
            raise failure

        def close(self):
            pass

    def connect(host, port, timeout):
        assert host == "127.0.0.1"
        calls.append((host, port))
        if phase == "connect":
            raise failure
        return SMTPDouble()

    monkeypatch.setattr(smtplib, "SMTP", connect)
    with pytest.raises(DeliveryError) as error:
        deliver(
            MailConfig.from_env(),
            subject="Test",
            body="Test",
            reply_to="candidate@example.com",
            filename="cv.pdf",
            content=pdf_bytes(),
        )
    assert error.value.ambiguous is ambiguous
    assert error.value.code == code
    assert len(calls) == 1


def test_close_failure_after_smtp_acceptance_preserves_receipt(monkeypatch):
    enable(monkeypatch)

    class SMTPDouble:
        def send_message(self, message, *, from_addr, to_addrs):
            return {}

        def close(self):
            raise OSError("connection already closed")

    monkeypatch.setattr(smtplib, "SMTP", lambda *args, **kwargs: SMTPDouble())
    receipt = deliver(
        MailConfig.from_env(),
        subject="Test",
        body="Test",
        reply_to="candidate@example.com",
        filename="cv.pdf",
        content=pdf_bytes(),
    )
    assert receipt["smtp_accepted"] is True


@pytest.mark.parametrize("operation", ["preview", "send"])
def test_policy_change_between_snapshot_and_atomic_write_is_rejected(
    client, headers, email_job, monkeypatch, operation
):
    enable(monkeypatch)
    draft = create(client, headers, email_job)
    reviewed = review(client, headers, draft)
    original_snapshot = routes._snapshot

    def racing_snapshot(*args, **kwargs):
        snapshot = original_snapshot(*args, **kwargs)
        with SessionLocal() as session:
            item = session.get(EmailApplicationPolicy, email_job.id)
            item.enabled = False
            session.commit()
        return snapshot

    monkeypatch.setattr(routes, "_snapshot", racing_snapshot)
    monkeypatch.setattr(
        routes, "deliver", lambda *a, **k: pytest.fail("Changed policy reached SMTP")
    )
    if operation == "preview":
        response = client.post(f"/email-applications/{draft['id']}/preview", headers=headers)
    else:
        response = send(client, headers, draft, reviewed)
    assert response.status_code == 409


def test_concurrent_retry_on_file_database_dispatches_once(client, monkeypatch, tmp_path):
    """Use independent connections; the shared in-memory fixture cannot prove this race."""
    enable(monkeypatch)
    file_engine = create_engine(
        f"sqlite+pysqlite:///{(tmp_path / 'concurrent.sqlite').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(file_engine)
    factory = sessionmaker(bind=file_engine, expire_on_commit=False)

    def isolated_database():
        with factory() as session:
            yield session

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = isolated_database
    entered, release = threading.Event(), threading.Event()
    calls = []

    def accept_once(*args, **kwargs):
        calls.append(True)
        entered.set()
        assert release.wait(5), "Concurrent test did not release transport"
        return {"smtp_accepted": True, "employer_delivery_confirmed": False}

    monkeypatch.setattr(routes, "deliver", accept_once)
    try:
        with factory() as session:
            job = email_job.__wrapped__(session)
        user_headers = account(client, "concurrent-pilot@example.com")
        draft = create(client, user_headers, job)
        reviewed = review(client, user_headers, draft)
        with ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(send, client, user_headers, draft, reviewed)
            try:
                assert entered.wait(5)
                retry = send(client, user_headers, draft, reviewed)
                assert retry.status_code == 409
            finally:
                release.set()
            assert first.result(timeout=5).json()["status"] == "sent"
        assert len(calls) == 1
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        file_engine.dispose()


def test_email_migration_preserves_prior_rows_and_round_trips(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'email-migration.sqlite').as_posix()}"
    environment = {**os.environ, "DATABASE_URL": url}

    def migrate(direction, revision):
        response = subprocess.run(
            [sys.executable, "-m", "alembic", direction, revision],
            cwd=backend,
            env=environment,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        assert response.returncode == 0, response.stderr

    migrate("upgrade", "20261023_0005")
    file_engine = create_engine(url)
    user_id = uuid4().hex
    with file_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id,email,password_hash,role,is_active) VALUES (:id,'migration-fixture@example.test','not-a-password','job_seeker',1)"
            ),
            {"id": user_id},
        )
    file_engine.dispose()
    migrate("upgrade", "20261023_0006")
    file_engine = create_engine(url)
    inspector = inspect(file_engine)
    assert {"email_applications", "email_application_policies"} <= set(inspector.get_table_names())
    assert {column["name"] for column in inspector.get_columns("email_applications")} == set(
        EmailApplication.__table__.columns.keys()
    )
    with file_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT email FROM users WHERE id=:id"), {"id": user_id}
            ).scalar_one()
            == "migration-fixture@example.test"
        )
    file_engine.dispose()
    migrate("downgrade", "20261023_0005")
    file_engine = create_engine(url)
    assert "email_applications" not in inspect(file_engine).get_table_names()
    with file_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT email FROM users WHERE id=:id"), {"id": user_id}
            ).scalar_one()
            == "migration-fixture@example.test"
        )
    file_engine.dispose()
