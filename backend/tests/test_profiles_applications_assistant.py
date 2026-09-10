"""API tests for profile, resume, application, and assistant persistence boundaries."""

from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.assistant.gateway import get_form_mapping_gateway
from app.assistant.schemas import FormSnapshotField, MappingDraft, MappingFieldSuggestion
from app.db.models import ApplicationForm, JobPosting, JobSource
from app.main import app

PASSWORD = "CorrectHorseBatteryStaple!"


@pytest.fixture
def application_context(db: Session) -> tuple[JobPosting, ApplicationForm]:
    source = JobSource(
        name="Application Sandbox",
        source_type="mock",
        base_url="https://apply.example.test",
    )
    job = JobPosting(
        source=source,
        external_id="apply-1",
        title="Backend Engineer Intern",
        company="Example Pte Ltd",
        city="Singapore",
        salary_min=1800,
        salary_max=2400,
        salary_currency="SGD",
        salary_period="month",
        job_type="Internship",
        description="Build and test backend services.",
        apply_url="https://apply.example.test/jobs/apply-1",
        posted_at=date(2026, 9, 8),
        deadline=date(2026, 10, 8),
        dedup_hash="e" * 64,
        raw_hash="5" * 64,
    )
    form = ApplicationForm(
        job=job,
        template_version="fixture-v1",
        is_fixture=True,
        fields_json=[
            {"field_id": "name", "label": "Full Name", "type": "text", "required": True},
            {"field_id": "email", "label": "Email", "type": "email", "required": True},
            {"field_id": "note", "label": "Note", "type": "textarea", "required": False},
        ],
    )
    db.add(form)
    db.commit()
    db.refresh(job)
    db.refresh(form)
    return job, form


def auth_headers(client: TestClient, email: str = "profile@example.com") -> dict[str, str]:
    registration = client.post(
        "/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert registration.status_code == 201
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_profile_requires_auth_and_can_be_replaced(client: TestClient) -> None:
    assert client.get("/profile").status_code == 401
    headers = auth_headers(client)
    initial = client.get("/profile", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["contact_email"] == "profile@example.com"

    update = client.put(
        "/profile",
        headers=headers,
        json={
            "full_name": "  Example Student  ",
            "phone": "+65 8123 4567",
            "contact_email": "student@example.com",
            "education": "BComp candidate",
            "experience": "Backend course project",
            "skills": ["Python", "SQL", "Python"],
            "links": {"github": "https://github.com/example"},
        },
    )
    assert update.status_code == 200
    assert update.json()["full_name"] == "Example Student"
    assert update.json()["skills"] == ["Python", "SQL"]
    assert client.get("/profile", headers=headers).json() == update.json()


@pytest.mark.parametrize(
    "payload",
    [
        {"filename": "../resume.pdf", "content_type": "application/pdf", "size_bytes": 100},
        {"filename": "resume.exe", "content_type": "application/pdf", "size_bytes": 100},
        {"filename": "resume.pdf", "content_type": "text/plain", "size_bytes": 100},
        {"filename": "resume.pdf", "content_type": "application/pdf", "size_bytes": 6_000_000},
    ],
)
def test_resume_metadata_validation(client: TestClient, payload: dict[str, object]) -> None:
    headers = auth_headers(client)
    assert client.post("/profile/resumes", headers=headers, json=payload).status_code == 422


def test_resume_metadata_is_stored_without_exposing_storage_key(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = {
        "filename": "jobpilot-resume.pdf",
        "content_type": "application/pdf",
        "size_bytes": 2048,
    }
    created = client.post("/profile/resumes", headers=headers, json=payload)
    listed = client.get("/profile/resumes", headers=headers)
    assert created.status_code == 201
    assert listed.status_code == 200
    assert listed.json() == [created.json()]
    assert "storage_key" not in created.json()


def test_profiles_and_resumes_are_isolated_by_user(client: TestClient) -> None:
    alice = auth_headers(client, "profile-alice@example.com")
    bob = auth_headers(client, "profile-bob@example.com")
    client.put("/profile", headers=alice, json={"full_name": "Alice", "skills": ["Python"]})
    client.post(
        "/profile/resumes",
        headers=alice,
        json={"filename": "alice.pdf", "content_type": "application/pdf", "size_bytes": 10},
    )
    assert client.get("/profile", headers=bob).json()["full_name"] is None
    assert client.get("/profile/resumes", headers=bob).json() == []


def test_manual_application_history_and_duplicate_protection(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    job, _ = application_context
    headers = auth_headers(client, "manual@example.com")
    created = client.post(f"/jobs/{job.id}/applications", headers=headers, json={})
    duplicate = client.post(f"/jobs/{job.id}/applications", headers=headers, json={})
    history = client.get("/applications", headers=headers)

    assert created.status_code == 201
    assert created.json()["method"] == "manual"
    assert created.json()["status"] == "submitted"
    assert created.json()["submitted_at"] is not None
    assert duplicate.status_code == 409
    assert history.status_code == 200
    assert history.json()["total"] == 1
    assert history.json()["items"][0]["job"]["id"] == str(job.id)


def test_application_status_transitions_are_controlled(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    job, _ = application_context
    headers = auth_headers(client, "status@example.com")
    created = client.post(
        f"/jobs/{job.id}/applications",
        headers=headers,
        json={"status": "draft"},
    )
    application_id = created.json()["id"]
    for target in ("submitted", "interviewing", "offered"):
        changed = client.patch(
            f"/applications/{application_id}", headers=headers, json={"status": target}
        )
        assert changed.status_code == 200
        assert changed.json()["status"] == target
    invalid = client.patch(
        f"/applications/{application_id}", headers=headers, json={"status": "rejected"}
    )
    assert invalid.status_code == 409


def test_application_history_is_isolated_by_user(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    job, _ = application_context
    alice = auth_headers(client, "application-alice@example.com")
    bob = auth_headers(client, "application-bob@example.com")
    created = client.post(f"/jobs/{job.id}/applications", headers=alice, json={})
    application_id = created.json()["id"]
    assert client.get("/applications", headers=bob).json()["total"] == 0
    assert client.get(f"/applications/{application_id}", headers=bob).status_code == 404


def test_assistant_bootstrap_and_form_contract(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    _, form = application_context
    bootstrap = client.get("/assistant/bootstrap")
    form_response = client.get(f"/assistant/forms/{form.id}")
    assert bootstrap.status_code == 200
    assert bootstrap.json()["manual_fallback"] is True
    assert bootstrap.json()["forms"][0]["id"] == str(form.id)
    assert form_response.status_code == 200
    assert form_response.json()["fields_json"][0]["field_id"] == "name"


def test_mapping_route_fails_safely_until_gateway_is_injected(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    _, form = application_context
    headers = auth_headers(client, "gateway-unavailable@example.com")
    response = client.post(
        "/assistant/map-fields",
        headers=headers,
        json={
            "form_id": str(form.id),
            "form_snapshot": [
                {"field_id": "name", "label": "Full Name", "type": "text", "required": True}
            ],
        },
    )
    assert response.status_code == 503
    assert "manual entry" in response.json()["detail"]


def test_mapping_gateway_receives_minimized_profile(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    _, form = application_context
    headers = auth_headers(client, "gateway@example.com")
    client.put(
        "/profile",
        headers=headers,
        json={"full_name": "Gateway User", "contact_email": "gateway@example.com"},
    )

    class FakeGateway:
        profile_data: dict[str, Any] | None = None

        def map_fields(
            self,
            *,
            form_snapshot: list[FormSnapshotField],
            profile_data: dict[str, Any],
        ) -> MappingDraft:
            self.profile_data = profile_data
            return MappingDraft(
                mapping=[
                    MappingFieldSuggestion(
                        field_id="name",
                        label=form_snapshot[0].label,
                        value=profile_data["full_name"],
                        confidence=0.99,
                        needs_review=False,
                    )
                ]
            )

    fake = FakeGateway()
    app.dependency_overrides[get_form_mapping_gateway] = lambda: fake
    try:
        response = client.post(
            "/assistant/map-fields",
            headers=headers,
            json={
                "form_id": str(form.id),
                "form_snapshot": [
                    {"field_id": "name", "label": "Full Name", "type": "text", "required": True}
                ],
            },
        )
    finally:
        app.dependency_overrides.pop(get_form_mapping_gateway, None)

    assert response.status_code == 200
    assert response.json()["mapping"][0]["value"] == "Gateway User"
    assert fake.profile_data is not None
    assert set(fake.profile_data) == {
        "full_name",
        "phone",
        "contact_email",
        "education",
        "experience",
        "skills",
        "links",
    }


def test_assistant_application_requires_confirmation_and_owns_mapping(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    job, form = application_context
    alice = auth_headers(client, "assistant-alice@example.com")
    bob = auth_headers(client, "assistant-bob@example.com")
    base_payload = {
        "job_id": str(job.id),
        "form_id": str(form.id),
        "mapping_version": "mapping-v1",
        "provider": "mock",
        "prompt_version": "prompt-v1",
        "mapping_draft": {
            "mapping": [
                {
                    "field_id": "name",
                    "label": "Full Name",
                    "value": "Alice Example",
                    "confidence": 0.99,
                    "needs_review": False,
                },
                {
                    "field_id": "email",
                    "label": "Email",
                    "value": "assistant-alice@example.com",
                    "confidence": 0.98,
                    "needs_review": False,
                },
            ],
            "unmapped_fields": [],
            "missing_profile_fields": [],
        },
        "confirmed_field_ids": ["name"],
        "edited_values": {},
    }
    missing_confirmation = client.post(
        "/assistant/applications", headers=alice, json=base_payload
    )
    assert missing_confirmation.status_code == 422

    base_payload["edited_values"] = {"email": "verified@example.com"}
    created = client.post("/assistant/applications", headers=alice, json=base_payload)
    assert created.status_code == 201
    assert created.json()["application"]["method"] == "assistant"
    assert created.json()["application"]["mapping_version"] == "mapping-v1"
    mapping_id = created.json()["mapping"]["id"]
    assert client.get(f"/assistant/mappings/{mapping_id}", headers=alice).status_code == 200
    assert client.get(f"/assistant/mappings/{mapping_id}", headers=bob).status_code == 404
