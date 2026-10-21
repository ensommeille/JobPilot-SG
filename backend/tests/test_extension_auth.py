"""Restricted extension sessions cannot become platform/admin credentials."""

import base64
import hashlib
import secrets
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import Base
from app.db.models import ExtensionGrant, User
from app.db.session import get_db
from app.main import app
from tests.test_profiles_applications_assistant import auth_headers

CLIENT = "a" * 32
ORIGIN = "http://127.0.0.1:5173"


@pytest.fixture(autouse=True)
def registered(monkeypatch):
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])


def authorize(client, headers, **changes):
    verifier = secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    response = client.post(
        "/auth/extension/authorize",
        headers={**headers, "Origin": ORIGIN},
        json={"client_id": CLIENT, "challenge": challenge, "confirmed": True, **changes},
    )
    return response, verifier


def exchange(client, code, verifier, **changes):
    return client.post(
        "/auth/extension/exchange",
        json={"client_id": CLIENT, "code": code, "verifier": verifier, **changes},
    )


def connect(client, headers):
    code, verifier = authorize(client, headers)
    assert code.status_code == 200
    assert code.headers["cache-control"] == "no-store"
    result = exchange(client, code.json()["code"], verifier)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    return {"Authorization": "Bearer " + result.json()["access_token"]}, result.json()


def test_concurrent_exchange_has_exactly_one_winner(client, tmp_path):
    engine = create_engine(
        "sqlite+pysqlite:///" + (tmp_path / "auth.sqlite").as_posix(),
        connect_args={"check_same_thread": False, "timeout": 20},
    )
    Base.metadata.create_all(engine)

    def database():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = database
    try:
        headers = auth_headers(client)
        code, verifier = authorize(client, headers)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda _: exchange(client, code.json()["code"], verifier), range(2))
            )
        assert sorted(result.status_code for result in results) == [200, 401]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda _: client.post("/auth/logout", headers=headers), range(2))
            )
        assert all(result.status_code in (204, 401) for result in results)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_removing_allowed_extension_revokes_access(client, monkeypatch):
    headers = auth_headers(client)
    restricted, _ = connect(client, headers)
    monkeypatch.setattr(get_settings(), "extension_client_ids", [])
    assert client.get("/auth/extension/session", headers=restricted).status_code == 401


def test_scopes_identity_compatibility_and_hash_storage(client, db):
    headers = auth_headers(client)
    client.put("/profile", headers=headers, json={"resume_summary": "My text"})
    restricted, session = connect(client, headers)
    assert session["scopes"] == ["browser:draft", "profile:import-empty"]
    assert (
        client.get("/auth/extension/session", headers=restricted).json()["email"]
        == "profile@example.com"
    )
    assert client.post(
        "/browser-assistant/draft",
        headers=restricted,
        json={
            "page_url": "https://www.internsg.com/job-apply/123/",
            "field_ids": ["applicant_summary"],
        },
    ).json()["values"] == {"applicant_summary": "My text"}
    assert client.post(
        "/browser-assistant/ats-evidence",
        headers=restricted,
        json={
            "page_url": "https://jobs.lever.co/acme/abc-123/apply",
            "evidence_keys": ["summary"],
        },
    ).json()["values"] == {"summary": "My text"}
    assert (
        client.post(
            "/profile/import-local",
            headers=restricted,
            json={"confirmed": True, "nationality": "cn"},
        ).status_code
        == 200
    )
    for method, path, body in [
        ("GET", "/users/me", None),
        ("GET", "/profile", None),
        ("PUT", "/profile", {"full_name": "No"}),
        ("POST", "/auth/logout", {}),
        (
            "POST",
            "/auth/extension/authorize",
            {"client_id": CLIENT, "confirmed": True, "challenge": "a" * 43},
        ),
    ]:
        assert client.request(method, path, headers=restricted, json=body).status_code == 401
    assert client.get("/profile", headers=headers).status_code == 200
    grant = db.scalar(select(ExtensionGrant))
    assert len(grant.token_digest) == 64
    assert session["access_token"] not in str(grant.__dict__)
    other = auth_headers(client, "other@example.com")
    other_restricted, _ = connect(client, other)
    assert (
        client.post(
            "/browser-assistant/draft",
            headers=other_restricted,
            json={
                "page_url": "https://www.internsg.com/job-apply/123/",
                "field_ids": ["applicant_summary"],
            },
        ).json()["values"]
        == {}
    )


def test_pkce_client_binding_and_replay(client):
    headers = auth_headers(client)
    result, verifier = authorize(client, headers)
    code = result.json()["code"]
    assert exchange(client, code, "b" * 43).status_code == 401
    assert exchange(client, code, verifier, client_id="b" * 32).status_code == 401
    assert exchange(client, code, verifier).status_code == 200
    assert exchange(client, code, verifier).status_code == 401


def test_allowlist_origin_and_explicit_consent(client):
    headers = auth_headers(client)
    for value in (False, 1, "true"):
        assert authorize(client, headers, confirmed=value)[0].status_code == 422
    assert authorize(client, headers, client_id="b" * 32)[0].status_code == 403
    assert (
        client.post(
            "/auth/extension/authorize",
            headers=headers,
            json={"client_id": CLIENT, "confirmed": True, "challenge": "a" * 43},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/auth/extension/authorize",
            headers={**headers, "Origin": "https://evil.test"},
            json={"client_id": CLIENT, "confirmed": True, "challenge": "a" * 43},
        ).status_code
        == 403
    )


def test_logout_revokes_existing_and_pending_sessions(client):
    headers = auth_headers(client)
    restricted, _ = connect(client, headers)
    pending, verifier = authorize(client, headers)
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/users/me", headers=headers).status_code == 401
    assert client.get("/auth/extension/session", headers=restricted).status_code == 401
    assert exchange(client, pending.json()["code"], verifier).status_code == 401
    assert authorize(client, headers)[0].status_code == 401


def test_disconnect_does_not_log_out_platform(client):
    headers = auth_headers(client)
    restricted, _ = connect(client, headers)
    assert client.post("/auth/extension/disconnect", headers=restricted).status_code == 204
    assert client.get("/auth/extension/session", headers=restricted).status_code == 401
    assert client.get("/users/me", headers=headers).status_code == 200


def test_expired_code_session_and_disabled_user(client, db):
    headers = auth_headers(client)
    pending, verifier = authorize(client, headers)
    grant = db.scalar(select(ExtensionGrant))
    grant.code_expires_at = int(time.time()) - 1
    db.commit()
    assert exchange(client, pending.json()["code"], verifier).status_code == 401
    restricted, data = connect(client, headers)
    grant = db.scalar(select(ExtensionGrant).where(ExtensionGrant.consumed.is_(True)))
    grant.expires_at = int(time.time()) - 1
    db.commit()
    assert client.get("/auth/extension/session", headers=restricted).status_code == 401
    restricted, data = connect(client, headers)
    user = db.scalar(select(User))
    user.is_active = False
    db.commit()
    assert client.get("/auth/extension/session", headers=restricted).status_code == 401


def test_new_logins_have_distinct_tokens_and_old_session_revocation_is_scoped(client):
    headers = auth_headers(client)
    response = client.post(
        "/auth/login",
        json={"email": "profile@example.com", "password": "CorrectHorseBatteryStaple!"},
    )
    assert set(response.json()) == {"access_token", "token_type", "expires_in", "user"}
    second = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert second != headers
    old, _ = connect(client, headers)
    new, _ = connect(client, second)
    client.post("/auth/logout", headers=headers)
    assert client.get("/auth/extension/session", headers=old).status_code == 401
    assert client.get("/auth/extension/session", headers=new).status_code == 200
