"""Public ATS responses are fixtures; no employer API is contacted by this suite."""

from __future__ import annotations

import httpx
import pytest

from app.ingestion.models import RunStatus, SourceConfig, SourceType
from app.ingestion.public_ats_adapter import PublicATSAdapter, public_ats_identity
from app.ingestion.schemas import SourceCreate
from app.ingestion.service import SourceRunError, build_source_adapter


def adapter_for(provider: str, handler, *, source_id: str = "source-1") -> PublicATSAdapter:
    base = (
        "https://boards-api.greenhouse.io/v1/boards/acme"
        if provider == "greenhouse"
        else "https://api.lever.co/v0/postings/acme"
    )
    config = SourceConfig(
        source_id=source_id,
        name="Acme",
        source_type=SourceType.JSON,
        base_url=base,
        allowed_hosts=frozenset({httpx.URL(base).host}),
        user_agent="JobPilot-Tests/1.0",
    )
    return PublicATSAdapter(
        config,
        provider=provider,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _: None,
    )


def reply(request: httpx.Request, data: object, *, status=200, content_type="application/json"):
    if isinstance(data, str):
        return httpx.Response(status, text=data, headers={"content-type": content_type})
    return httpx.Response(status, json=data, headers={"content-type": content_type})


def test_only_canonical_board_urls_are_accepted():
    assert public_ats_identity("https://boards-api.greenhouse.io/v1/boards/acme") == (
        "greenhouse",
        "acme",
    )
    assert public_ats_identity("https://api.eu.lever.co/v0/postings/acme") == ("lever", "acme")
    for bad in [
        "http://boards-api.greenhouse.io/v1/boards/acme",
        "https://evil.example/v1/boards/acme",
        "https://boards-api.greenhouse.io/v1/boards/acme/../../other",
        "https://api.lever.co/v0/postings/acme?key=secret",
    ]:
        assert public_ats_identity(bad) is None


def test_source_creation_and_factory_only_accept_supported_ats_boards():
    from types import SimpleNamespace

    good = SourceCreate(
        name="Acme", source_type=SourceType.JSON, base_url="https://api.lever.co/v0/postings/acme"
    )
    source = SimpleNamespace(
        id="source-1",
        name=good.name,
        source_type=good.source_type.value,
        base_url=good.base_url,
        enabled=True,
    )
    adapter = build_source_adapter(source)
    assert isinstance(adapter, PublicATSAdapter)
    adapter.close()
    with pytest.raises(ValueError, match="exact Greenhouse or Lever"):
        SourceCreate(
            name="Unknown", source_type=SourceType.JSON, base_url="https://unknown.example/jobs"
        )
    source.base_url = "https://unknown.example/jobs"
    with pytest.raises(SourceRunError):
        build_source_adapter(source)


def test_greenhouse_ingests_only_published_internships_and_keeps_hosted_url():
    requests = []
    jobs = {
        "jobs": [
            {
                "id": 123,
                "title": "Software Engineer Intern",
                "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/123",
                "location": {"name": "Singapore"},
                "content": "&lt;p&gt;Build Python services.&lt;/p&gt;",
            },
            {
                "id": 124,
                "title": "Sales Manager",
                "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/124",
                "content": "Sell.",
            },
        ]
    }

    def handler(request):
        requests.append(str(request.url))
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, jobs)

    batch = adapter_for("greenhouse", handler).collect(max_links=10, max_details=5)
    assert batch.status is RunStatus.SUCCEEDED
    assert batch.discovered_count == batch.attempted_count == len(batch.items) == 1
    record = batch.items[0].known_fields
    assert record.title == "Software Engineer Intern"
    assert record.company == "Acme"
    assert record.city == "Singapore"
    assert record.description == "Build Python services."
    assert record.apply_url == "https://job-boards.greenhouse.io/acme/jobs/123"
    assert not any("/jobs/123" in request for request in requests)


def test_distinct_ats_posting_ids_keep_distinct_identities_with_the_same_title():
    jobs = {
        "jobs": [
            {
                "id": posting_id,
                "title": "Data Analyst, Intern",
                "absolute_url": f"https://job-boards.greenhouse.io/acme/jobs/{posting_id}",
                "location": {"name": "Singapore"},
                "content": f"<p>Work with team {posting_id}.</p>",
            }
            for posting_id in (8194291, 8194287)
        ]
    }

    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, jobs)

    batch = adapter_for("greenhouse", handler).collect(max_links=2, max_details=2)

    assert batch.status is RunStatus.SUCCEEDED
    assert [item.external_id for item in batch.items] == ["8194291", "8194287"]
    assert batch.items[0].known_fields.dedup_hash != batch.items[1].known_fields.dedup_hash


def test_ats_posting_identity_survives_a_title_change():
    title = "Data Analyst, Intern"

    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(
            request,
            {
                "jobs": [
                    {
                        "id": 8194291,
                        "title": title,
                        "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/8194291",
                        "location": {"name": "Singapore"},
                        "content": "<p>Build services.</p>",
                    }
                ]
            },
        )

    adapter = adapter_for("greenhouse", handler)
    first = adapter.collect(max_links=1, max_details=1).items[0].known_fields
    title = "Senior Data Analyst, Intern"
    second = adapter.collect(max_links=1, max_details=1).items[0].known_fields

    assert first.raw_hash != second.raw_hash
    assert first.dedup_hash == second.dedup_hash


def test_same_public_board_posting_keeps_identity_across_source_configurations():
    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(
            request,
            {
                "jobs": [
                    {
                        "id": 8194291,
                        "title": "Data Analyst Intern",
                        "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/8194291",
                        "content": "<p>Build services.</p>",
                    }
                ]
            },
        )

    first = adapter_for("greenhouse", handler, source_id="first").collect(
        max_links=1, max_details=1
    )
    second = adapter_for("greenhouse", handler, source_id="second").collect(
        max_links=1, max_details=1
    )

    assert first.items[0].known_fields.dedup_hash == second.items[0].known_fields.dedup_hash


def test_lever_ingests_hosted_application_and_rejects_unsafe_links():
    jobs = [
        {
            "id": "abc-123",
            "text": "Machine Learning Intern",
            "categories": {"location": "Singapore", "commitment": "Intern"},
            "descriptionPlain": "Build ML tools.",
            "hostedUrl": "https://jobs.lever.co/acme/abc-123",
            "applyUrl": "https://jobs.lever.co/acme/abc-123/apply",
        },
        {
            "id": "bad",
            "text": "Data Intern",
            "descriptionPlain": "Bad link.",
            "hostedUrl": "https://jobs.lever.co/acme/bad",
            "applyUrl": "https://attacker.example/steal",
        },
    ]

    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, jobs)

    batch = adapter_for("lever", handler).collect(max_links=10, max_details=5)
    assert batch.status is RunStatus.PARTIAL
    assert batch.discovered_count == 2
    assert len(batch.items) == len(batch.failures) == 1
    assert batch.items[0].known_fields.apply_url == "https://jobs.lever.co/acme/abc-123/apply"


def test_robots_denial_prevents_api_request():
    paths = []

    def handler(request):
        paths.append(request.url.path)
        return reply(request, "User-agent: *\nDisallow: /", content_type="text/plain")

    batch = adapter_for("greenhouse", handler).collect(max_links=10, max_details=5)
    assert batch.status is RunStatus.FAILED
    assert paths == ["/robots.txt"]


@pytest.mark.parametrize("provider", ["greenhouse", "lever"])
def test_non_json_or_redirect_fails_closed(provider):
    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, "<html>blocked</html>", content_type="text/html")

    batch = adapter_for(provider, handler).collect(max_links=10, max_details=5)
    assert batch.status is RunStatus.FAILED
    assert not batch.items
