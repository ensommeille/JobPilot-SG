"""Cross-module journeys use saved profiles without inventing matches or submissions."""

# Imported pytest fixtures are injected by their argument names.
# ruff: noqa: F811

from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.models import Application, JobExtractionRun
from tests.test_extension_auth import CLIENT, connect
from tests.test_job_matching import sample as matching_sample  # noqa: F401
from tests.test_job_recommendations import live as recommendation_live  # noqa: F401
from tests.test_natural_recommendations import fact, prepare_job
from tests.test_profiles_applications_assistant import auth_headers

PROFILE = {
    "full_name": "Fictional Journey Applicant",
    "contact_email": "journey@example.com",
    "phone": "+65 8000 0000",
    "education": "Fictional computing course",
    "experience": "Fictional student project",
    "skills": ["I used Microsoft Excel to prepare weekly sales reports."],
    "links": {},
    "resume_summary": "My own introduction, maintained on JobPilot.",
    "availability_period": "January to March 2027",
    "nationality": "cn",
    "study_country": "sg",
}
FORM_FIELDS = [
    "applicant_name",
    "applicant_email",
    "applicant_contact",
    "applicant_period",
    "applicant_summary",
]


@pytest.fixture
def journey(client, db, recommendation_live, monkeypatch):
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])
    description = "Comfortable using Excel or Google Sheets for weekly reports."
    fixture = prepare_job(
        db,
        recommendation_live,
        description,
        required=[fact("Comfortable using Excel or Google Sheets", description)],
    )
    fixture[1].apply_url = "https://www.internsg.com/job-apply/271036/"
    db.commit()
    # apply_url is part of the stored input identity; keep the isolated extraction current.
    prepare_job(
        db,
        fixture,
        description,
        required=[fact("Comfortable using Excel or Google Sheets", description)],
    )
    assert client.put("/profile", headers=fixture[0], json=PROFILE).status_code == 200
    return fixture


def recommendations(client, headers):
    response = client.post("/jobs/recommendations", headers=headers, json={})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def draft(client, headers, job_id=271036, **changes):
    return client.post(
        "/browser-assistant/draft",
        headers=headers,
        json={
            "page_url": f"https://www.internsg.com/job-apply/{job_id}/",
            "field_ids": FORM_FIELDS,
            **changes,
        },
    )


def assert_current_draft(response, profile):
    assert response.status_code == 200
    payload = response.json()
    assert payload["profile_source"] == "jobpilot"
    assert payload["summary_status"] == "manual_only"
    assert payload["requires_review"] is True
    assert payload["submission_supported"] is False
    expected = {
        "applicant_name": profile.get("full_name"),
        "applicant_email": profile.get("contact_email"),
        "applicant_contact": profile.get("phone"),
        "applicant_period": profile.get("availability_period"),
        "applicant_summary": profile.get("resume_summary"),
    }
    assert payload["values"] == {key: value for key, value in expected.items() if value}
    assert payload["countries"] == {
        "nationality": profile.get("nationality"),
        "campus": profile.get("study_country"),
    }


def test_saved_profile_to_natural_recommendation_to_two_application_drafts(client, db, journey):
    headers, job, _ = journey
    stored = client.get("/profile", headers=headers)
    assert stored.status_code == 200
    assert {field: stored.json()[field] for field in PROFILE} == PROFILE
    report = recommendations(client, headers)
    assert report["status"] == "ready"
    assert report["matched"] == 1
    item = report["items"][0]
    assert item["job_id"] == str(job.id)
    assert item["supported"] == []
    assert item["unknown"] == item["overlaps"]
    overlap = item["overlaps"][0]
    assert overlap["job_evidence"] == job.description
    assert overlap["profile_evidence"] == PROFILE["skills"][0]
    assert [skill["skill_id"] for skill in overlap["skill_overlaps"]] == ["excel"]

    details = client.get(f"/jobs/{job.id}", headers=headers)
    assert details.status_code == 200
    assert details.json()["apply_url"] == job.apply_url
    restricted, session = connect(client, headers)
    assert session["scopes"] == ["browser:draft", "profile:import-empty"]
    before_runs = db.scalar(select(func.count()).select_from(JobExtractionRun))
    for external_job_id in (271036, 271037):
        assert_current_draft(draft(client, restricted, external_job_id), PROFILE)
    assert db.scalar(select(func.count()).select_from(Application)) == 0
    assert db.scalar(select(func.count()).select_from(JobExtractionRun)) == before_runs
    assert {key: client.get("/profile", headers=headers).json()[key] for key in PROFILE} == PROFILE


def test_profile_changes_refresh_recommendations_and_existing_extension_session(
    client, db, journey
):
    headers, _, _ = journey
    restricted, _ = connect(client, headers)
    assert recommendations(client, headers)["status"] == "ready"
    assert_current_draft(draft(client, restricted), PROFILE)

    updated = {
        **PROFILE,
        "skills": ["I use Python for class projects."],
        "phone": "+65 8111 1111",
        "resume_summary": "My revised introduction.",
        "availability_period": "April to June 2027",
        "nationality": "sg",
        "study_country": "cn",
    }
    assert client.put("/profile", headers=headers, json=updated).status_code == 200
    refreshed = recommendations(client, headers)
    assert refreshed["status"] == "no_matches"
    assert refreshed["items"] == []
    assert_current_draft(draft(client, restricted, 271037), updated)

    cleared = {
        **updated,
        "skills": [],
        "phone": None,
        "resume_summary": None,
        "availability_period": None,
        "nationality": None,
        "study_country": None,
    }
    assert client.put("/profile", headers=headers, json=cleared).status_code == 200
    assert recommendations(client, headers)["status"] == "profile_needed"
    assert_current_draft(draft(client, restricted, 271038), cleared)
    assert db.scalar(select(func.count()).select_from(Application)) == 0


def test_account_switch_revokes_old_extension_and_never_reuses_previous_profile(
    client, db, journey
):
    first = journey[0]
    old_extension, _ = connect(client, first)
    assert_current_draft(draft(client, old_extension), PROFILE)
    assert client.post("/auth/logout", headers=first).status_code == 204
    assert draft(client, old_extension).status_code == 401
    assert client.post("/jobs/recommendations", headers=first, json={}).status_code == 401

    second = auth_headers(client, "journey-second@example.com")
    other_profile = {
        **PROFILE,
        "full_name": "Second Fictional Applicant",
        "contact_email": "second-contact@example.com",
        "phone": None,
        "skills": ["I use AutoCAD for drafting."],
        "resume_summary": "The second account's own introduction.",
        "availability_period": None,
        "nationality": "my",
        "study_country": None,
    }
    assert client.put("/profile", headers=second, json=other_profile).status_code == 200
    current_extension, session = connect(client, second)
    assert session["email"] == "journey-second@example.com"
    assert recommendations(client, second)["status"] == "no_matches"
    assert_current_draft(draft(client, current_extension), other_profile)
    assert draft(client, old_extension).status_code == 401
    assert db.scalar(select(func.count()).select_from(Application)) == 0


def test_restricted_extension_cannot_select_another_profile_or_write_platform_state(
    client, db, journey
):
    headers, job, _ = journey
    restricted, _ = connect(client, headers)
    before = deepcopy(client.get("/profile", headers=headers).json())
    other = auth_headers(client, "journey-other@example.com")
    identity = client.get("/users/me", headers=other).json()
    for method, path, payload in [
        ("GET", "/profile", None),
        ("PUT", "/profile", {"full_name": "Unauthorized replacement"}),
        ("POST", "/jobs/recommendations", {}),
        ("POST", f"/jobs/{job.id}/match-analysis", {}),
        ("POST", f"/jobs/{job.id}/applications", {}),
    ]:
        response = client.request(method, path, headers=restricted, json=payload)
        assert response.status_code == 401
    assert draft(client, restricted, user_id=identity["id"]).status_code == 422
    assert (
        client.post(
            "/profile/import-local",
            headers=restricted,
            json={"confirmed": True, "user_id": identity["id"], "phone": "111"},
        ).status_code
        == 422
    )
    assert client.get("/profile", headers=headers).json() == before
    assert_current_draft(draft(client, restricted), PROFILE)
    assert db.scalar(select(func.count()).select_from(Application)) == 0


def test_stale_requirements_block_recommendation_but_do_not_corrupt_reusable_profile(
    client, db, journey
):
    headers, job, _ = journey
    restricted, _ = connect(client, headers)
    assert recommendations(client, headers)["status"] == "ready"
    job.description = "This posting was changed. AutoCAD is required."
    db.commit()
    report = recommendations(client, headers)
    assert report["status"] == "no_evidence"
    assert report["excluded"] == {"stale_extraction": 1}
    assert report["items"] == []
    assert_current_draft(draft(client, restricted), PROFILE)
    assert db.scalar(select(func.count()).select_from(Application)) == 0
