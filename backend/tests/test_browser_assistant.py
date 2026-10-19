"""External form drafting is authenticated, bounded and never submits anything."""

import pytest

from tests.test_profiles_applications_assistant import auth_headers

URL = "https://www.internsg.com/job-apply/271036"


def body(**changes):
    return {
        "page_url": URL,
        "field_ids": ["applicant_name", "applicant_email", "applicant_summary"],
        **changes,
    }


def test_auth_profile_isolation_and_no_submission(client, db):
    from sqlalchemy import func, select

    from app.db.models import Application

    assert client.post("/browser-assistant/draft", json=body()).status_code == 401
    first = auth_headers(client, "first@example.com")
    second = auth_headers(client, "second@example.com")
    client.put(
        "/profile",
        headers=first,
        json={"full_name": "First Applicant", "contact_email": "first@example.com"},
    )
    response = client.post("/browser-assistant/draft", headers=first, json=body())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["values"]["applicant_name"] == "First Applicant"
    assert response.json()["submission_supported"] is False
    other = client.post("/browser-assistant/draft", headers=second, json=body()).json()
    assert "applicant_name" not in other["values"]
    assert db.scalar(select(func.count()).select_from(Application)) == 0


@pytest.mark.parametrize(
    "url",
    [
        "https://job-boards.greenhouse.io/acme/jobs/12345?gh_jid=12345",
        "https://boards.greenhouse.io/acme/jobs/12345",
        "https://jobs.lever.co/acme/abc-123/apply",
        "https://jobs.eu.lever.co/acme/abc-123/apply",
    ],
)
def test_public_ats_draft_is_read_only(client, db, url):
    from sqlalchemy import func, select

    from app.db.models import Application

    headers = auth_headers(client)
    response = client.post(
        "/browser-assistant/draft",
        headers=headers,
        json=body(
            page_url=url, field_ids=["applicant_name", "applicant_email", "applicant_contact"]
        ),
    )
    assert response.status_code == 200
    assert response.json()["submission_supported"] is False
    assert db.scalar(select(func.count()).select_from(Application)) == 0


@pytest.mark.parametrize(
    "url",
    [
        "http://www.internsg.com/job-apply/1",
        "https://www.internsg.com.evil.test/job-apply/1",
        "https://www.internsg.com@evil.test/job-apply/1",
        "https://www.internsg.com:443/job-apply/1",
        URL + "?next=evil",
        URL + "#x",
        "https://www.internsg.com/jobs/",
        "https://job-boards.greenhouse.io/acme/jobs/not-a-number",
        "https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=456",
        "https://job-boards.greenhouse.io.evil.test/acme/jobs/123",
        "https://jobs.lever.co/acme/abc-123/apply?redirect=evil",
        "https://jobs.lever.co/acme/abc-123/not-apply",
    ],
)
def test_rejects_bad_urls(client, url):
    headers = auth_headers(client)
    assert (
        client.post(
            "/browser-assistant/draft", headers=headers, json=body(page_url=url)
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "change",
    [
        {"field_ids": ["btnSubmit"]},
        {"field_ids": ["applicant_name", "applicant_name"]},
        {"field_ids": []},
        {"api_key": "not-accepted"},
        {"generate_summary": "true"},
        {"generate_summary": True},
        {"generate_summary": False},
    ],
)
def test_rejects_unknown_fields_and_client_configuration(client, change):
    assert (
        client.post(
            "/browser-assistant/draft", headers=auth_headers(client), json=body(**change)
        ).status_code
        == 422
    )


def test_summary_is_manual_only_even_when_legacy_flag_enabled(client, monkeypatch):
    monkeypatch.setenv("BROWSER_ASSISTANT_LIVE_ENABLED", "true")
    result = client.post("/browser-assistant/draft", headers=auth_headers(client), json=body())
    assert result.status_code == 200
    assert result.json()["summary_status"] == "manual_only"
    assert "applicant_summary" not in result.json()["values"]
