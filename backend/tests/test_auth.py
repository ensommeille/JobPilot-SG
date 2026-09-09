"""API and security tests for registration, login, JWT, and RBAC."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import require_roles
from app.core.security import TokenValidationError, create_access_token, decode_access_token
from app.db.models import User, UserRole

PASSWORD = "CorrectHorseBatteryStaple!"


def register(client: TestClient, email: str = "seeker@example.com") -> dict[str, object]:
    response = client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201
    return response.json()


def login(client: TestClient, email: str = "seeker@example.com") -> dict[str, object]:
    response = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return response.json()


def test_register_hashes_password_and_creates_profile(
    client: TestClient, db: Session
) -> None:
    payload = register(client, "New.User@Example.com")

    user = db.scalar(select(User).where(User.email == "new.user@example.com"))
    assert user is not None
    assert user.password_hash != PASSWORD
    assert user.password_hash.startswith("$argon2")
    assert user.profile is not None
    assert user.profile.contact_email == "new.user@example.com"
    assert payload["role"] == "job_seeker"
    assert "password_hash" not in payload


def test_duplicate_email_is_case_insensitive(client: TestClient) -> None:
    register(client, "duplicate@example.com")
    response = client.post(
        "/auth/register",
        json={"email": "DUPLICATE@example.com", "password": PASSWORD},
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "Email is already registered"}


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [
        ({"email": "not-an-email", "password": PASSWORD}, 422),
        ({"email": "short@example.com", "password": "short"}, 422),
    ],
)
def test_register_rejects_invalid_input(
    client: TestClient, payload: dict[str, str], expected_status: int
) -> None:
    assert client.post("/auth/register", json=payload).status_code == expected_status


def test_login_and_users_me_happy_path(client: TestClient) -> None:
    registered = register(client)
    token_payload = login(client)

    assert token_payload["token_type"] == "bearer"
    assert token_payload["expires_in"] == 3600
    response = client.get(
        "/users/me", headers={"Authorization": f"Bearer {token_payload['access_token']}"}
    )
    assert response.status_code == 200
    assert response.json()["id"] == registered["id"]
    assert response.json()["email"] == "seeker@example.com"


def test_login_does_not_reveal_which_credential_is_wrong(client: TestClient) -> None:
    register(client)
    wrong_password = client.post(
        "/auth/login", json={"email": "seeker@example.com", "password": "wrong"}
    )
    unknown_user = client.post(
        "/auth/login", json={"email": "missing@example.com", "password": "wrong"}
    )
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


def test_users_me_requires_a_valid_bearer_token(client: TestClient) -> None:
    assert client.get("/users/me").status_code == 401
    response = client.get("/users/me", headers={"Authorization": "Bearer invalid"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_expired_token_is_rejected(db: Session) -> None:
    user = User(email="expired@example.com", password_hash="unused", role=UserRole.JOB_SEEKER)
    db.add(user)
    db.commit()
    old_time = datetime.now(UTC) - timedelta(hours=2)
    token = create_access_token(user_id=user.id, role=user.role.value, now=old_time)

    with pytest.raises(TokenValidationError):
        decode_access_token(token)


def test_admin_dependency_enforces_role() -> None:
    dependency = require_roles(UserRole.ADMIN)
    seeker = User(email="seeker@example.com", password_hash="unused", role=UserRole.JOB_SEEKER)
    admin = User(email="admin@example.com", password_hash="unused", role=UserRole.ADMIN)

    with pytest.raises(HTTPException) as exc_info:
        dependency(seeker)
    assert exc_info.value.status_code == 403
    assert dependency(admin) is admin
