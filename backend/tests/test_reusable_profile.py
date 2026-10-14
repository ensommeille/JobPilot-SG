"""Reusable application details preserve old clients and account boundaries."""

import pytest

from tests.test_profiles_applications_assistant import auth_headers

DETAILS = {
    "resume_summary": "My own introduction. 我学习计算机。",
    "availability_period": "January to March 2027",
    "nationality": "cn",
    "study_country": "sg",
}


def test_save_reuse_legacy_preservation_clear_and_isolation(client):
    headers = auth_headers(client)
    other = auth_headers(client, "other@example.com")
    response = client.put("/profile", headers=headers, json={**DETAILS, "full_name": "Applicant"})
    assert response.status_code == 200
    for key, value in DETAILS.items():
        assert response.json()[key] == value
        assert client.get("/profile", headers=other).json()[key] is None
    # An old client replaces the old fields, but has no knowledge of the new ones.
    client.put("/profile", headers=headers, json={"full_name": "Changed name"})
    assert (
        client.get("/profile", headers=headers).json()["resume_summary"]
        == DETAILS["resume_summary"]
    )
    for job in (123, 456):
        draft = client.post(
            "/browser-assistant/draft",
            headers=headers,
            json={
                "page_url": f"https://www.internsg.com/job-apply/{job}/",
                "field_ids": ["applicant_summary", "applicant_period"],
            },
        ).json()
        assert draft["profile_source"] == "jobpilot"
        assert draft["values"]["applicant_summary"] == DETAILS["resume_summary"]
        assert draft["values"]["applicant_period"] == DETAILS["availability_period"]
        assert draft["countries"] == {"nationality": "cn", "campus": "sg"}
    cleared = client.put("/profile", headers=headers, json={key: None for key in DETAILS})
    assert all(cleared.json()[key] is None for key in DETAILS)


@pytest.mark.parametrize(
    "change",
    [
        {"resume_summary": "x" * 3001},
        {"availability_period": "x" * 501},
        {"nationality": "zz"},
        {"study_country": "China"},
        {"study_country": 42},
    ],
)
def test_invalid_application_details(client, change):
    assert client.put("/profile", headers=auth_headers(client), json=change).status_code == 422


def test_normalization(client):
    result = client.put(
        "/profile",
        headers=auth_headers(client),
        json={
            "resume_summary": "  Written by me  ",
            "availability_period": "  ",
            "nationality": "CN",
        },
    ).json()
    assert result["resume_summary"] == "Written by me"
    assert result["availability_period"] is None
    assert result["nationality"] == "cn"


def test_import_requires_consent_and_never_overwrites(client):
    assert client.post("/profile/import-local", json={"confirmed": True}).status_code == 401
    headers = auth_headers(client)
    client.put(
        "/profile", headers=headers, json={"resume_summary": "Keep platform text", "phone": "123"}
    )
    for body in (
        {},
        {"confirmed": False},
        {"confirmed": 1},
        {"confirmed": "true"},
        {"confirmed": True, "user_id": "other"},
    ):
        assert client.post("/profile/import-local", headers=headers, json=body).status_code == 422
    body = {**DETAILS, "phone": "456", "confirmed": True}
    result = client.post("/profile/import-local", headers=headers, json=body)
    assert result.status_code == 200
    assert set(result.json()["skipped"]) == {"resume_summary", "phone"}
    assert set(result.json()["imported"]) == {"nationality", "study_country", "availability_period"}
    assert client.get("/profile", headers=headers).json()["resume_summary"] == "Keep platform text"
    assert client.get("/profile", headers=headers).json()["phone"] == "123"
    assert client.post("/profile/import-local", headers=headers, json=body).json()["imported"] == []
    other = auth_headers(client, "isolation@example.com")
    assert client.get("/profile", headers=other).json()["nationality"] is None
