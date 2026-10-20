"""Public ATS parsing and database integration without live network dependencies."""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import func, select

from app.db.models import JobPosting, User, UserRole
from app.ingestion.models import SourceConfig, SourceType
from app.ingestion.public_ats_adapter import PublicATSAdapter, ats_provider
from app.ingestion.service import get_source_adapter_factory
from app.main import app


def config(provider: str, source_id: str = "source-1") -> SourceConfig:
    greenhouse = provider == "greenhouse"
    return SourceConfig(
        source_id=source_id,
        name="Example Employer",
        source_type=SourceType.API,
        base_url=(
            "https://boards-api.greenhouse.io/v1/boards/example"
            if greenhouse
            else "https://api.lever.co/v0/postings/example"
        ),
        allowed_hosts=frozenset({
            "boards-api.greenhouse.io" if greenhouse else "api.lever.co"
        }),
        user_agent="JobPilot-Test/1.0",
        retry_count=0,
        enforce_robots=False,
    )


def greenhouse_job(job_id: int, *, location: str = "Singapore", title: str = "Data Intern") -> dict:
    return {
        "id": job_id,
        "title": title,
        "location": {"name": location},
        "absolute_url": f"https://example.com/jobs/{job_id}",
        "content": "&lt;p&gt;Build &amp; maintain Python services.&lt;/p&gt;",
        "updated_at": "2026-10-20T00:00:00Z",
    }


def lever_job(job_id: str, *, location: str = "Singapore, Singapore") -> dict:
    return {
        "id": job_id,
        "text": "Software Engineer Intern",
        "categories": {"location": location, "commitment": "Intern"},
        "hostedUrl": f"https://jobs.lever.co/example/{job_id}",
        "applyUrl": f"https://jobs.lever.co/example/{job_id}/apply",
        "descriptionPlain": "Build Python services.",
        "lists": [{"text": "Requirements", "content": "<li>Know SQL &amp; Python</li>"}],
        "createdAt": 1792454400000,
    }


@pytest.mark.parametrize("url", [
    "https://evil.example/v1/boards/example",
    "http://boards-api.greenhouse.io/v1/boards/example",
    "https://boards-api.greenhouse.io/v1/boards/example/jobs",
    "https://api.lever.co/v0/postings/example?mode=json",
    "https://user:pass@api.lever.co/v0/postings/example",
    "https://api.lever.co:444/v0/postings/example",
])
def test_only_canonical_public_api_roots_are_allowed(url: str) -> None:
    with pytest.raises(ValueError):
        ats_provider(url)


def test_greenhouse_collects_only_singapore_and_decodes_description() -> None:
    requests: list[str] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(200, json={"jobs": [
            greenhouse_job(1),
            greenhouse_job(2, location="New York"),
            greenhouse_job(3, title="Backend Engineer"),
        ]})

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        adapter = PublicATSAdapter(config("greenhouse"), client=client)
        batch = adapter.collect(max_links=10, max_details=10)
    assert requests == ["https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true"]
    assert batch.status.value == "succeeded"
    assert batch.discovered_count == batch.attempted_count == len(batch.items) == 2
    assert all(item.known_fields.city == "Singapore" for item in batch.items)
    assert "Build & maintain" in batch.items[0].known_fields.description
    assert batch.items[0].known_fields.apply_url == "https://example.com/jobs/1"


def test_lever_keeps_distinct_same_title_jobs_and_source_apply_urls() -> None:
    def transport(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[
            lever_job("one"), lever_job("two"), lever_job("three", location="London"),
        ])

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        batch = PublicATSAdapter(config("lever"), client=client).collect(
            max_links=10, max_details=10
        )
    assert batch.status.value == "succeeded"
    assert batch.discovered_count == len(batch.items) == 2
    assert {item.external_id for item in batch.items} == {"one", "two"}
    assert len({item.known_fields.dedup_hash for item in batch.items}) == 2
    assert all(item.known_fields.job_type == ["internship"] for item in batch.items)
    assert all("Know SQL & Python" in item.known_fields.description for item in batch.items)
    assert all(item.known_fields.apply_url.endswith("/apply") for item in batch.items)


def test_rate_limit_fails_without_retry() -> None:
    calls = 0

    def transport(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        batch = PublicATSAdapter(
            config("lever").model_copy(update={"retry_count": 2}), client=client,
            sleep=lambda _: None,
        ).collect(max_links=10, max_details=5)
    assert calls == 1
    assert batch.status.value == "failed"
    assert batch.items == []


def test_public_ats_round_trip_is_idempotent_and_has_no_fixture_form(client, db) -> None:
    credentials = {"email": "ats-admin@example.com", "password": "OfflinePipelinePassword123!"}
    assert client.post("/auth/register", json=credentials).status_code == 201
    user = db.scalar(select(User).where(User.email == credentials["email"]))
    assert user is not None
    user.role = UserRole.ADMIN
    db.commit()
    token = client.post("/auth/login", json=credentials).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post("/sources", headers=headers, json={
        "name": "Example Employer",
        "source_type": "api",
        "base_url": "https://api.lever.co/v0/postings/example",
    })
    assert created.status_code == 201
    source_id = created.json()["id"]
    jobs = [lever_job("one"), lever_job("two")]

    def transport(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=jobs)

    with httpx.Client(transport=httpx.MockTransport(transport)) as http_client:
        app.dependency_overrides[get_source_adapter_factory] = lambda: (
            lambda source: PublicATSAdapter(
                config("lever", str(source.id)),
                client=http_client,
                now=lambda: datetime.now(UTC),
            )
        )
        try:
            first = client.post(
                f"/sources/{source_id}/run", headers=headers,
                json={"max_links": 10, "max_details": 10},
            )
            second = client.post(
                f"/sources/{source_id}/run", headers=headers,
                json={"max_links": 10, "max_details": 10},
            )
            capped = client.post(
                f"/sources/{source_id}/run", headers=headers,
                json={"max_links": 1, "max_details": 1},
            )
            jobs.pop()
            removed = client.post(
                f"/sources/{source_id}/run", headers=headers,
                json={"max_links": 10, "max_details": 10},
            )
        finally:
            app.dependency_overrides.pop(get_source_adapter_factory, None)

    assert first.status_code == second.status_code == 201
    assert first.json()["items_new"] == 2
    assert second.json()["items_new"] == second.json()["items_updated"] == 0
    assert capped.json()["items_updated"] == 0
    assert removed.json()["items_updated"] == 1
    assert db.scalar(select(func.count()).select_from(JobPosting)) == 2
    assert db.scalar(select(func.count()).select_from(JobPosting).where(JobPosting.status == "closed")) == 1
    jobs_page = client.get("/jobs").json()
    assert jobs_page["total"] == 1
    assert all(job["assistant_form_available"] is False for job in jobs_page["items"])
