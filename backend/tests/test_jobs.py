"""API tests for job discovery, filtering, tags, and favorite ownership."""

from datetime import date
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource, JobTag

PASSWORD = "CorrectHorseBatteryStaple!"


@pytest.fixture
def seeded_jobs(db: Session) -> list[JobPosting]:
    source = JobSource(
        name="Sandbox Jobs",
        source_type="mock",
        base_url="https://jobs.example.test",
    )
    engineering = JobTag(name="Engineering", category="function")
    internship = JobTag(name="Internship", category="employment")
    product = JobTag(name="Product", category="function")
    jobs = [
        JobPosting(
            source=source,
            external_id="alpha-1",
            title="Software Engineer Intern",
            company="Alpha Pte Ltd",
            city="Singapore",
            salary_min=1500,
            salary_max=2500,
            salary_currency="SGD",
            salary_period="month",
            job_type="Internship",
            description="Build backend APIs and data services.",
            apply_url="https://jobs.example.test/alpha-1",
            posted_at=date(2026, 9, 5),
            deadline=date(2026, 10, 1),
            dedup_hash="a" * 64,
            raw_hash="1" * 64,
            tags=[engineering, internship],
        ),
        JobPosting(
            source=source,
            external_id="beta-2",
            title="Product Analyst",
            company="Beta Pte Ltd",
            city="Remote",
            salary_min=3000,
            salary_max=4000,
            salary_currency="SGD",
            salary_period="month",
            job_type="Full-time",
            description="Analyse product usage and customer outcomes.",
            apply_url="https://jobs.example.test/beta-2",
            posted_at=date(2026, 9, 4),
            deadline=date(2026, 11, 1),
            dedup_hash="b" * 64,
            raw_hash="2" * 64,
            tags=[product],
        ),
        JobPosting(
            source=source,
            external_id="gamma-3",
            title="Data Engineer",
            company="Gamma Pte Ltd",
            city="Singapore",
            job_type="Full-time",
            description="Maintain data pipelines for analytics.",
            apply_url="https://jobs.example.test/gamma-3",
            posted_at=date(2026, 9, 3),
            deadline=date(2026, 12, 1),
            dedup_hash="c" * 64,
            raw_hash="3" * 64,
            status="incomplete",
            tags=[engineering],
        ),
        JobPosting(
            source=source,
            external_id="hidden-4",
            title="Archived Role",
            company="Archive Pte Ltd",
            city="Singapore",
            job_type="Full-time",
            description="This role should not appear in public discovery.",
            apply_url="https://jobs.example.test/hidden-4",
            posted_at=date(2026, 9, 6),
            deadline=date(2026, 9, 30),
            dedup_hash="d" * 64,
            raw_hash="4" * 64,
            status="archived",
        ),
    ]
    db.add_all(jobs)
    db.commit()
    for job in jobs:
        db.refresh(job)
    return jobs


def auth_headers(client: TestClient, email: str) -> dict[str, str]:
    registration = client.post(
        "/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert registration.status_code == 201
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_job_list_is_paginated_and_hides_archived_records(
    client: TestClient, seeded_jobs: list[JobPosting]
) -> None:
    response = client.get("/jobs", params={"page": 1, "page_size": 2})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert payload["pages"] == 2
    assert payload["page"] == 1
    assert [item["external_id"] for item in payload["items"]] == ["alpha-1", "beta-2"]


def test_combined_filters_and_intersecting_tags(
    client: TestClient, seeded_jobs: list[JobPosting]
) -> None:
    response = client.get(
        "/jobs",
        params=[
            ("q", "software"),
            ("city", "SINGAPORE"),
            ("type", "internship"),
            ("salary_min", "2000"),
            ("salary_max", "2200"),
            ("tags", "engineering"),
            ("tags", "internship"),
            ("deadline_from", "2026-09-30"),
            ("deadline_to", "2026-10-31"),
        ],
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["external_id"] == "alpha-1"
    assert {tag["name"] for tag in payload["items"][0]["tags"]} == {
        "Engineering",
        "Internship",
    }


def test_job_filter_validation(client: TestClient, seeded_jobs: list[JobPosting]) -> None:
    salary = client.get("/jobs", params={"salary_min": 3000, "salary_max": 1000})
    deadline = client.get(
        "/jobs", params={"deadline_from": "2026-12-01", "deadline_to": "2026-10-01"}
    )
    assert salary.status_code == 422
    assert deadline.status_code == 422


def test_job_detail_includes_source_and_tags(
    client: TestClient, seeded_jobs: list[JobPosting]
) -> None:
    visible = client.get(f"/jobs/{seeded_jobs[0].id}")
    hidden = client.get(f"/jobs/{seeded_jobs[3].id}")
    missing = client.get("/jobs/00000000-0000-0000-0000-000000000000")

    assert visible.status_code == 200
    assert visible.json()["source"]["name"] == "Sandbox Jobs"
    assert len(visible.json()["tags"]) == 2
    assert hidden.status_code == missing.status_code == 404


def test_tags_are_sorted_by_category_then_name(
    client: TestClient, seeded_jobs: list[JobPosting]
) -> None:
    response = client.get("/tags")
    assert response.status_code == 200
    assert [(item["category"], item["name"]) for item in response.json()] == [
        ("employment", "Internship"),
        ("function", "Engineering"),
        ("function", "Product"),
    ]


def test_favorites_require_auth_and_post_is_idempotent(
    client: TestClient, seeded_jobs: list[JobPosting]
) -> None:
    job_id = seeded_jobs[0].id
    assert client.post(f"/jobs/{job_id}/favorite").status_code == 401
    headers = auth_headers(client, "owner@example.com")

    first = client.post(f"/jobs/{job_id}/favorite", headers=headers)
    second = client.post(f"/jobs/{job_id}/favorite", headers=headers)
    favorites = client.get("/favorites", headers=headers)

    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert favorites.status_code == 200
    assert favorites.json()["total"] == 1
    assert UUID(favorites.json()["items"][0]["job"]["id"]) == job_id


def test_favorites_are_isolated_by_user(
    client: TestClient, seeded_jobs: list[JobPosting]
) -> None:
    job_id = seeded_jobs[0].id
    alice = auth_headers(client, "alice@example.com")
    bob = auth_headers(client, "bob@example.com")
    assert client.post(f"/jobs/{job_id}/favorite", headers=alice).status_code == 201

    assert client.get("/favorites", headers=bob).json()["total"] == 0
    assert client.delete(f"/jobs/{job_id}/favorite", headers=bob).status_code == 204
    assert client.get("/favorites", headers=alice).json()["total"] == 1

    assert client.delete(f"/jobs/{job_id}/favorite", headers=alice).status_code == 204
    assert client.get("/favorites", headers=alice).json()["total"] == 0
