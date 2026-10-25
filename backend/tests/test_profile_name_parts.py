"""Explicit name order stays private, optional and independent of display names."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select, text

from alembic import command
from app.ai_recommendations.service import reviewed_profile
from app.core.config import get_settings
from app.db.models import User
from tests.test_extension_auth import CLIENT, connect
from tests.test_profiles_applications_assistant import auth_headers

NAME_PARTS = {"given_name": "Avery", "family_name": "Ng"}
DRAFT = {
    "page_url": "https://job-boards.greenhouse.io/offline-fixture/jobs/12345",
    "field_ids": ["applicant_name", "applicant_email", "applicant_contact"],
}


def test_full_name_never_guesses_parts_and_parts_never_rewrite_full_name(client):
    headers = auth_headers(client)
    first = client.put("/profile", headers=headers, json={"full_name": "Ng Avery"}).json()
    assert first["given_name"] is None and first["family_name"] is None
    result = client.patch("/profile", headers=headers, json=NAME_PARTS)
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert result.json()["full_name"] == "Ng Avery"
    assert all(result.json()[key] == value for key, value in NAME_PARTS.items())
    renamed = client.patch(
        "/profile", headers=headers, json={"full_name": "A different display name"}
    ).json()
    assert all(renamed[key] == value for key, value in NAME_PARTS.items())
    assert (
        client.put("/profile", headers=headers, json={"phone": "+65 1234 5678"}).json()[
            "given_name"
        ]
        == "Avery"
    )


def test_partial_updates_preserve_omitted_fields_and_explicit_null_clears(client):
    headers = auth_headers(client)
    initial = {
        **NAME_PARTS,
        "full_name": "Saved display name",
        "skills": ["Python"],
        "education": "BSc Computing",
    }
    client.put("/profile", headers=headers, json=initial)
    patched = client.patch("/profile", headers=headers, json={"phone": "12345"}).json()
    for key, value in initial.items():
        assert patched[key] == value
    assert client.patch("/profile", headers=headers, json={}).json() == patched
    cleared = client.patch("/profile", headers=headers, json={"given_name": None}).json()
    assert cleared["given_name"] is None and cleared["family_name"] == "Ng"
    cleared = client.put("/profile", headers=headers, json={"family_name": "   "}).json()
    assert cleared["family_name"] is None


@pytest.mark.parametrize("field", ["given_name", "family_name"])
@pytest.mark.parametrize("bad", [12, True, [], {}, "x" * 101, "Name\nOther", "Name\x00Other"])
def test_invalid_name_parts_are_rejected_without_changing_saved_names(client, field, bad):
    headers = auth_headers(client)
    client.put("/profile", headers=headers, json=NAME_PARTS)
    assert client.patch("/profile", headers=headers, json={field: bad}).status_code == 422
    saved = client.get("/profile", headers=headers).json()
    assert all(saved[key] == value for key, value in NAME_PARTS.items())


def test_names_allow_unicode_spaces_and_hyphens_without_inventing_order(client):
    headers = auth_headers(client)
    values = {"given_name": "  阿明 Jean-Luc  ", "family_name": " O’Neill 李 "}
    response = client.put("/profile", headers=headers, json=values).json()
    assert response["given_name"] == "阿明 Jean-Luc" and response["family_name"] == "O’Neill 李"
    assert response["full_name"] is None


def test_profile_owner_and_read_only_extension_reuse_keep_names_isolated(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])
    owner = auth_headers(client, "names-owner@example.com")
    other = auth_headers(client, "names-other@example.com")
    client.put("/profile", headers=owner, json={**NAME_PARTS, "full_name": "Ng Avery"})
    assert client.patch("/profile", json=NAME_PARTS).status_code == 401
    mine = client.post("/browser-assistant/draft", headers=owner, json=DRAFT).json()
    assert mine["name_parts"] == NAME_PARTS and mine["values"]["applicant_name"] == "Ng Avery"
    assert mine["submission_supported"] is False
    theirs = client.post("/browser-assistant/draft", headers=other, json=DRAFT).json()
    assert theirs["name_parts"] == {"given_name": None, "family_name": None}
    assert "applicant_name" not in theirs["values"]
    other_profile = client.get("/profile", headers=other).json()
    assert other_profile["given_name"] is None and other_profile["family_name"] is None
    restricted, _ = connect(client, owner)
    extension = client.post("/browser-assistant/draft", headers=restricted, json=DRAFT)
    assert extension.status_code == 200 and extension.headers["cache-control"] == "no-store"
    assert extension.json()["name_parts"] == NAME_PARTS
    assert (
        client.patch("/profile", headers=restricted, json={"given_name": "Override"}).status_code
        == 401
    )
    only_summary = client.post(
        "/browser-assistant/draft",
        headers=restricted,
        json={**DRAFT, "field_ids": ["applicant_summary"]},
    ).json()
    assert only_summary["name_parts"] == {"given_name": None, "family_name": None}


def test_confirming_name_parts_does_not_change_minimized_recommendation_input(client, db):
    headers = auth_headers(client)
    client.put(
        "/profile",
        headers=headers,
        json={"full_name": "Saved display name", "skills": ["Python"], "education": "BSc"},
    )
    user = db.scalar(select(User))
    before, _ = reviewed_profile(db, user)
    client.patch("/profile", headers=headers, json=NAME_PARTS)
    after, _ = reviewed_profile(db, user)
    assert before == after
    assert set(after) == {"education", "experience", "skills", "availability"}


def test_migration_preserves_old_columns_and_does_not_guess_existing_name_parts(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    url = f"sqlite+pysqlite:///{(tmp_path / 'name-parts-migration.sqlite').as_posix()}"
    # env.py reads settings; this temporary value applies only inside the test.
    settings = get_settings()
    previous = settings.database_url
    settings.database_url = url
    try:
        command.upgrade(config, "20261024_0009")
        engine = create_engine(url)
        user_id, profile_id = uuid4().hex, uuid4().hex
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users(id,email,password_hash,role,is_active) VALUES (:id,'migration-name@example.test','offline-only','user',1)"
                ),
                {"id": user_id},
            )
            connection.execute(
                text(
                    "INSERT INTO user_profiles(id,user_id,full_name,skills,links,resume_summary,education) VALUES (:id,:user,'Ng Avery',:skills,'{}','Saved summary','BSc Computing')"
                ),
                {"id": profile_id, "user": user_id, "skills": json.dumps(["Python"])},
            )
        command.upgrade(config, "20261024_0010")
        with engine.begin() as connection:
            before = connection.execute(
                text(
                    "SELECT full_name,skills,resume_summary,education,given_name,family_name FROM user_profiles"
                )
            ).one()
            assert tuple(before) == (
                "Ng Avery",
                '["Python"]',
                "Saved summary",
                "BSc Computing",
                None,
                None,
            )
            connection.execute(text("UPDATE user_profiles SET given_name='Avery',family_name='Ng'"))
        command.upgrade(config, "20261024_0010")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT given_name,family_name FROM user_profiles")
            ).one() == ("Avery", "Ng")
        command.downgrade(config, "20261024_0009")
        assert not {"given_name", "family_name"} & {
            column["name"] for column in inspect(engine).get_columns("user_profiles")
        }
        with engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT full_name,skills,resume_summary,education FROM user_profiles")
                ).one()
                == before[:4]
            )
        engine.dispose()
    finally:
        settings.database_url = previous
