"""Public ATS responses are fixtures; no employer API is contacted by this suite."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import httpx
import pytest

from app.ingestion.models import RunStatus, SourceConfig, SourceType
from app.ingestion.public_ats_adapter import PublicATSAdapter, public_ats_identity
from app.ingestion.schemas import SourceCreate
from app.ingestion.service import SourceRunError, build_source_adapter


def adapter_for(provider: str, handler) -> PublicATSAdapter:
    base = {
        "greenhouse": "https://boards-api.greenhouse.io/v1/boards/acme",
        "lever": "https://api.lever.co/v0/postings/acme",
        "ashby": "https://api.ashbyhq.com/posting-api/job-board/acme",
    }[provider]
    config = SourceConfig(
        source_id="source-1",
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
    assert public_ats_identity("https://api.ashbyhq.com/posting-api/job-board/flagright.com") == (
        "ashby",
        "flagright.com",
    )
    for bad in [
        "http://boards-api.greenhouse.io/v1/boards/acme",
        "https://evil.example/v1/boards/acme",
        "https://boards-api.greenhouse.io/v1/boards/acme/../../other",
        "https://api.lever.co/v0/postings/acme?key=secret",
        "https://api.ashbyhq.com/jobPosting.list",
        "https://api.ashbyhq.com/posting-api/job-board/../private",
        "https://api.ashbyhq.com/posting-api/job-board/%2e%2e",
        "https://api.ashbyhq.com/posting-api/job-board/..",
        "https://api.ashbyhq.com:443/posting-api/job-board/acme",
        "https://user:secret@api.ashbyhq.com/posting-api/job-board/acme",
        "https://api.ashbyhq.com/posting-api/job-board/acme?token=secret",
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
    with pytest.raises(ValueError, match="exact Greenhouse, Lever or Ashby"):
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
            "categories": {"location": "Singapore", "commitment": "Intern"},
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


@pytest.mark.parametrize("provider", ["greenhouse", "lever", "ashby"])
def test_non_json_or_redirect_fails_closed(provider):
    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, "<html>blocked</html>", content_type="text/html")

    batch = adapter_for(provider, handler).collect(max_links=10, max_details=5)
    assert batch.status is RunStatus.FAILED
    assert not batch.items


def ashby_job(external_id="id-123", *, title="Software Engineer | Internship", **overrides):
    return {
        "id": external_id,
        "title": title,
        "isListed": True,
        "location": "Singapore",
        "employmentType": "FullTime",
        "descriptionPlain": "Build Python services and review code.",
        "jobUrl": f"https://jobs.ashbyhq.com/acme/{external_id}",
        "applyUrl": f"https://jobs.ashbyhq.com/acme/{external_id}/application",
        "publishedAt": "2026-08-28T23:25:13.441+08:00",
        **overrides,
    }


def collect_ashby(jobs):
    return adapter_for("ashby", lambda request: reply(request, {"jobs": jobs})).collect(
        max_links=20,
        max_details=20,
    )


def test_ashby_keeps_fulltime_internship_and_posted_date_without_loading_apply_page():
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return reply(request, {"jobs": [ashby_job()]})

    batch = adapter_for("ashby", handler).collect(max_links=5, max_details=5)
    assert batch.status is RunStatus.SUCCEEDED
    record = batch.items[0].known_fields
    assert record.job_type == ["internship", "full-time"]
    assert record.job_type_raw == "FullTime"
    assert record.posted_at.isoformat() == "2026-08-28"
    assert record.source_url == "https://jobs.ashbyhq.com/acme/id-123"
    assert record.apply_url.endswith("/id-123/application")
    assert requests == ["https://api.ashbyhq.com/posting-api/job-board/acme"]


def test_ashby_requires_listed_and_explicit_singapore_not_a_jd_mention():
    batch = collect_ashby(
        [
            ashby_job("private", isListed=False),
            ashby_job("missing-list-flag", isListed=None),
            ashby_job(
                "us", location="San Francisco", descriptionPlain="Collaborate with Singapore."
            ),
            ashby_job("remote", location="Remote / Worldwide", isRemote=True),
            ashby_job("unknown", location=""),
            ashby_job("exclude", location="Outside Singapore"),
            ashby_job("sg"),
        ]
    )
    assert batch.discovered_count == batch.attempted_count == 1
    assert [item.external_id for item in batch.items] == ["sg"]
    assert not batch.failures


def test_multiple_locations_and_structured_country_include_singapore():
    batch = collect_ashby(
        [
            ashby_job(
                "secondary",
                location="Amsterdam",
                secondaryLocations=[
                    {
                        "location": "Singapore",
                        "address": {"addressCountry": "SGP"},
                    }
                ],
            ),
            ashby_job(
                "country",
                location="One North",
                address={
                    "postalAddress": {"addressCountry": "SG"},
                },
            ),
        ]
    )
    assert len(batch.items) == 2
    assert all(item.known_fields.city == "Singapore" for item in batch.items)
    assert batch.items[0].known_fields.location == "Amsterdam; Singapore"


@pytest.mark.parametrize(
    "title,employment_type,expected",
    [
        ("Graduate Software Engineer", "FullTime", ["graduate", "full-time"]),
        ("Junior Software Engineer", "FullTime", ["entry-level", "full-time"]),
        ("Software Engineer - New Grad", "FullTime", ["graduate", "full-time"]),
        ("Software Engineer - Entry Level", "FullTime", ["entry-level", "full-time"]),
        ("Software Engineer", "Intern", ["internship"]),
        ("Senior Software Engineer", "Intern", None),
        ("Staff Software Engineer - Graduate Mentorship", "FullTime", None),
        ("Principal Software Engineer", "FullTime", None),
        ("Graduate Recruitment Manager", "FullTime", None),
        ("Software Engineer", "FullTime", None),
    ],
)
def test_explicit_early_career_scope_does_not_admit_senior_roles(title, employment_type, expected):
    batch = collect_ashby([ashby_job(title=title, employmentType=employment_type)])
    assert batch.status is RunStatus.SUCCEEDED
    if expected is None:
        assert not batch.items
    else:
        assert batch.items[0].known_fields.job_type == expected


def test_distinct_ids_survive_same_title_and_title_changes_keep_identity():
    original = collect_ashby([ashby_job("one"), ashby_job("two")]).items
    renamed = collect_ashby([ashby_job("one", title="Software Engineering Intern")]).items[0]
    assert original[0].known_fields.dedup_hash != original[1].known_fields.dedup_hash
    assert original[0].known_fields.dedup_hash == renamed.known_fields.dedup_hash
    assert original[0].known_fields.raw_hash != renamed.known_fields.raw_hash


@pytest.mark.parametrize(
    "apply_url",
    [
        "https://attacker.example/acme/id-123/application",
        "https://jobs.ashbyhq.com/another/id-123/application",
        "https://jobs.ashbyhq.com/acme/different/application",
        "http://jobs.ashbyhq.com/acme/id-123/application",
    ],
)
def test_ashby_does_not_keep_unsafe_or_mismatched_application_links(apply_url):
    batch = collect_ashby([ashby_job(applyUrl=apply_url)])
    assert batch.status is RunStatus.FAILED
    assert not batch.items


@pytest.mark.parametrize("status", [301, 401, 403])
def test_ashby_published_api_contract_never_follows_redirects_or_bypasses_api_auth(status):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return reply(request, {}, status=status)

    batch = adapter_for("ashby", handler).collect(max_links=5, max_details=5)
    assert batch.status is RunStatus.FAILED
    assert len(calls) == 1


def test_ashby_contract_is_limited_to_the_configured_public_feed():
    calls = []
    adapter = adapter_for("ashby", lambda request: calls.append(request))
    with pytest.raises(ValueError, match="configured public ATS listing"):
        adapter._get("https://api.ashbyhq.com/jobPosting.list")
    assert calls == []


def test_lever_singapore_secondary_location_and_missing_location_filter():
    valid = {
        "id": "abc-123",
        "text": "Software Engineer Intern",
        "categories": {
            "location": "London",
            "allLocations": ["London", "Singapore"],
            "commitment": "Intern",
        },
        "descriptionPlain": "Build APIs.",
        "hostedUrl": "https://jobs.lever.co/acme/abc-123",
        "applyUrl": "https://jobs.lever.co/acme/abc-123/apply",
    }
    jobs = [
        valid,
        {**valid, "id": "elsewhere", "categories": {"location": "London"}},
        {**valid, "id": "unknown", "categories": {}},
    ]

    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, jobs)

    batch = adapter_for("lever", handler).collect(max_links=5, max_details=5)
    assert [item.external_id for item in batch.items] == ["abc-123"]


def test_greenhouse_multilocation_graduate_is_retained_without_calling_it_internship():
    jobs = {
        "jobs": [
            {
                "id": 223,
                "title": "Graduate Software Engineer",
                "content": "Build APIs.",
                "location": {"name": "Singapore; Taipei, Taiwan"},
                "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/223",
            }
        ]
    }

    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, jobs)

    batch = adapter_for("greenhouse", handler).collect(max_links=5, max_details=5)
    assert batch.items[0].known_fields.job_type == ["graduate"]


def test_ashby_source_create_and_factory_accept_public_board_only():
    from types import SimpleNamespace

    payload = SourceCreate(
        name="Acme",
        source_type=SourceType.JSON,
        base_url="https://api.ashbyhq.com/posting-api/job-board/acme",
    )
    adapter = build_source_adapter(
        SimpleNamespace(
            id="source-ashby",
            name=payload.name,
            source_type="json",
            base_url=payload.base_url,
            enabled=True,
        )
    )
    assert isinstance(adapter, PublicATSAdapter)
    assert adapter.provider == "ashby"
    adapter.close()


@pytest.mark.parametrize("key", ["blocktech", "cantina", "straitsx", "globalcampus"])
def test_reviewed_public_snapshots_are_parsed_offline(key):
    snapshot = json.loads(
        (Path(__file__).parent / "fixtures" / f"public_ats_{key}.json").read_text("utf-8")
    )
    config = SourceConfig(
        source_id=f"snapshot-{key}",
        name=snapshot["employer"],
        source_type=SourceType.JSON,
        base_url=snapshot["api_url"],
        allowed_hosts=frozenset({httpx.URL(snapshot["api_url"]).host}),
        user_agent="JobPilot-Tests/1.0",
    )

    def handler(request):
        if request.url.path == "/robots.txt":
            return reply(request, "User-agent: *\nAllow: /", content_type="text/plain")
        return reply(request, snapshot["payload"])

    adapter = PublicATSAdapter(
        config,
        provider=snapshot["provider"],
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _: None,
    )
    batch = adapter.collect(max_links=20, max_details=20)
    assert batch.status is RunStatus.SUCCEEDED
    assert len(batch.items) == len(snapshot["payload"]["jobs"]) > 0
    assert all(item.known_fields.city == "Singapore" for item in batch.items)


def test_api_body_is_bounded_before_a_large_payload_can_be_accepted():
    adapter = adapter_for(
        "ashby",
        lambda request: httpx.Response(
            200,
            content=b"x" * 10_000_001,
            headers={"content-type": "application/json"},
        ),
    )
    batch = adapter.collect(max_links=5, max_details=5)
    assert batch.status is RunStatus.FAILED
    assert "byte limit" in batch.failures[0].message


def test_compressed_public_feed_is_decoded_only_once():
    payload = gzip.compress(json.dumps({"jobs": [ashby_job()]}).encode())
    adapter = adapter_for(
        "ashby",
        lambda request: httpx.Response(
            200,
            content=payload,
            headers={"content-type": "application/json", "content-encoding": "gzip"},
        ),
    )
    batch = adapter.collect(max_links=5, max_details=5)
    assert batch.status is RunStatus.SUCCEEDED
    assert len(batch.items) == 1
