"""PR 25 job personalization must preserve PR 28 session and scope boundaries."""

# Imported pytest fixtures are injected by their argument names.
# ruff: noqa: F811

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.models import ApplicationForm, JobPosting, User
from tests.test_extension_auth import CLIENT, authorize, connect, exchange
from tests.test_profiles_applications_assistant import (
    application_context,  # noqa: F401
    auth_headers,
)


def test_favorite_detail_refresh_never_crosses_account_boundaries(
    client: TestClient, application_context: tuple[JobPosting, ApplicationForm]
) -> None:
    job, _ = application_context
    path = f"/jobs/{job.id}"
    owner = auth_headers(client, "favorite-owner@example.com")
    other = auth_headers(client, "favorite-other@example.com")

    assert client.get(path, headers=owner).json()["is_favorited"] is False
    created = client.post(f"{path}/favorite", headers=owner)
    assert created.status_code == 201
    assert created.json()["job"]["is_favorited"] is True

    for headers, expected in ((owner, True), (other, False), ({}, False), (owner, True)):
        response = client.get(path, headers=headers)
        assert response.status_code == 200
        assert response.json()["is_favorited"] is expected

    assert client.delete(f"{path}/favorite", headers=other).status_code == 204
    assert client.get(path, headers=owner).json()["is_favorited"] is True
    assert client.delete(f"{path}/favorite", headers=owner).status_code == 204
    for headers in (owner, other, {}):
        refreshed = client.get(path, headers=headers)
        assert refreshed.status_code == 200
        assert refreshed.json()["is_favorited"] is False


@pytest.mark.parametrize("credential_state", ["invalid", "expired", "disabled", "revoked"])
def test_optional_job_auth_rejects_unusable_credentials_instead_of_anonymous_fallback(
    client: TestClient,
    db: Session,
    application_context: tuple[JobPosting, ApplicationForm],
    credential_state: str,
) -> None:
    job, _ = application_context
    headers = auth_headers(client, "optional-auth@example.com")
    user = db.scalar(select(User).where(User.email == "optional-auth@example.com"))
    assert user is not None

    if credential_state == "invalid":
        headers = {"Authorization": "Bearer invalid-token"}
    elif credential_state == "expired":
        token = create_access_token(
            user_id=user.id,
            role=user.role.value,
            now=datetime.now(UTC) - timedelta(hours=2),
        )
        headers = {"Authorization": f"Bearer {token}"}
    elif credential_state == "disabled":
        user.is_active = False
        db.commit()
    else:
        assert client.post("/auth/logout", headers=headers).status_code == 204

    response = client.get(f"/jobs/{job.id}", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    anonymous = client.get(f"/jobs/{job.id}")
    assert anonymous.status_code == 200
    assert anonymous.json()["is_favorited"] is False


def test_optional_auth_does_not_promote_extension_tokens_and_logout_still_revokes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    application_context: tuple[JobPosting, ApplicationForm],
) -> None:
    job, _ = application_context
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])
    platform = auth_headers(client, "scope-owner@example.com")
    saved = client.put(
        "/profile", headers=platform, json={"resume_summary": "My manually written summary."}
    )
    assert saved.status_code == 200
    restricted, token_payload = connect(client, platform)
    assert token_payload["access_token"].startswith("jpx_")
    draft_payload = {
        "page_url": "https://www.internsg.com/job-apply/123/",
        "field_ids": ["applicant_summary"],
    }

    draft = client.post("/browser-assistant/draft", headers=restricted, json=draft_payload)
    assert draft.status_code == 200
    assert draft.json()["values"] == {"applicant_summary": "My manually written summary."}
    for method, path, body in (
        ("GET", f"/jobs/{job.id}", None),
        ("GET", "/favorites", None),
        ("POST", f"/jobs/{job.id}/favorite", None),
        ("DELETE", f"/jobs/{job.id}/favorite", None),
        ("GET", "/profile", None),
        ("PUT", "/profile", {"full_name": "Not authorized"}),
    ):
        response = client.request(method, path, headers=restricted, json=body)
        assert response.status_code == 401, (method, path, response.text)

    pending, verifier = authorize(client, platform)
    assert pending.status_code == 200
    assert client.post("/auth/logout", headers=platform).status_code == 204
    assert client.get(f"/jobs/{job.id}", headers=platform).status_code == 401
    assert client.get("/auth/extension/session", headers=restricted).status_code == 401
    assert (
        client.post("/browser-assistant/draft", headers=restricted, json=draft_payload).status_code
        == 401
    )
    assert exchange(client, pending.json()["code"], verifier).status_code == 401
    assert client.get(f"/jobs/{job.id}").status_code == 200


@pytest.mark.parametrize(
    ("form_state", "available"), [("fixture", True), ("missing", False), ("nonfixture", False)]
)
def test_form_availability_survives_all_nested_job_serializations(
    client: TestClient,
    db: Session,
    application_context: tuple[JobPosting, ApplicationForm],
    form_state: str,
    available: bool,
) -> None:
    job, form = application_context
    if form_state == "missing":
        db.delete(form)
    elif form_state == "nonfixture":
        form.is_fixture = False
    db.commit()
    headers = auth_headers(client, "availability@example.com")

    detail = client.get(f"/jobs/{job.id}", headers=headers)
    listing = client.get("/jobs")
    favorite = client.post(f"/jobs/{job.id}/favorite", headers=headers)
    favorites = client.get("/favorites", headers=headers)
    # A local draft exercises serialization without claiming external delivery.
    application = client.post(
        f"/jobs/{job.id}/applications", headers=headers, json={"status": "draft"}
    )
    assert detail.status_code == listing.status_code == favorites.status_code == 200
    assert favorite.status_code == application.status_code == 201
    history = client.get("/applications", headers=headers)
    application_detail = client.get(f"/applications/{application.json()['id']}", headers=headers)
    assert history.status_code == application_detail.status_code == 200
    assert application.json()["submitted_at"] is None

    nested_jobs = [
        detail.json(),
        listing.json()["items"][0],
        favorite.json()["job"],
        favorites.json()["items"][0]["job"],
        application.json()["job"],
        history.json()["items"][0]["job"],
        application_detail.json()["job"],
    ]
    for serialized in nested_jobs:
        assert serialized["id"] == str(job.id)
        assert serialized["assistant_form_available"] is available
        assert isinstance(serialized["is_favorited"], bool)
    assert favorite.json()["job"]["is_favorited"] is True
    assert favorites.json()["items"][0]["job"]["is_favorited"] is True
