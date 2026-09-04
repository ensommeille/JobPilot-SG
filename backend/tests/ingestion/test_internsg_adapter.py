from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from app.ingestion.internsg_adapter import AdapterPolicyError, DetailParseError, InternSGAdapter
from app.ingestion.models import RunStatus


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def response(
    request: httpx.Request, body: str, status: int = 200, content_type: str = "text/html"
) -> httpx.Response:
    return httpx.Response(
        status, text=body, headers={"content-type": content_type}, request=request
    )


def test_collect_satisfies_contract_and_normalizes_fields(fixture_text) -> None:
    routes = {
        "/robots.txt": (fixture_text("robots_allow.txt"), "text/plain"),
        "/jobs/": (fixture_text("listing.html"), "text/html"),
        "/job/example-one/": (fixture_text("detail_complete.html"), "text/html"),
        "/job/example-two/": (fixture_text("detail_missing_optional.html"), "text/html"),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        body, content_type = routes[request.url.path]
        return response(request, body, content_type=content_type)

    adapter = InternSGAdapter(client=client_for(handler), sleep=lambda _: None)
    batch = adapter.collect(max_links=20, max_details=2)

    assert batch.status is RunStatus.SUCCEEDED
    assert batch.discovered_count == 2
    assert batch.attempted_count == 2
    assert not batch.failures
    record = batch.items[0].known_fields
    assert record.external_id == "123"
    assert record.title == "Software Engineer Intern"
    assert record.city == "Singapore"
    assert record.salary_min == 1000
    assert record.salary_max == 1500
    assert record.posted_at.isoformat() == "2026-08-24"
    assert record.job_type == ["internship", "temporary"]
    assert len(record.raw_hash) == len(record.dedup_hash) == 64
    assert record.parser_version == "internsg-2026-08-v2"


def test_robots_denial_fails_closed_before_listing(fixture_text) -> None:
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        return response(request, fixture_text("robots_deny.txt"), content_type="text/plain")

    adapter = InternSGAdapter(client=client_for(handler), sleep=lambda _: None)
    batch = adapter.collect(max_links=20, max_details=1)

    assert batch.status is RunStatus.FAILED
    assert batch.items == []
    assert batch.failures[0].stage == "robots"
    assert requested == ["/robots.txt"]


def test_server_errors_retry_twice_then_succeed(fixture_text) -> None:
    listing_attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal listing_attempts
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        if request.url.path == "/jobs/":
            listing_attempts += 1
            if listing_attempts < 3:
                return response(request, "temporary", status=503)
            return response(request, fixture_text("listing.html"))
        return response(request, fixture_text("detail_complete.html"))

    adapter = InternSGAdapter(client=client_for(handler), sleep=lambda _: None)
    batch = adapter.collect(max_links=1, max_details=1)

    assert listing_attempts == 3
    assert batch.status is RunStatus.SUCCEEDED


def test_invalid_detail_is_not_counted_as_success(fixture_text) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        if request.url.path == "/jobs/":
            return response(request, '<a class="job-listing-row" href="/job/example-one/">Job</a>')
        return response(request, fixture_text("detail_invalid.html"))

    adapter = InternSGAdapter(client=client_for(handler), sleep=lambda _: None)
    batch = adapter.collect(max_links=1, max_details=1)

    assert batch.status is RunStatus.FAILED
    assert not batch.items
    assert batch.failures[0].stage == "parse"


def test_parser_rejects_non_job_page_and_outside_host(fixture_text) -> None:
    adapter = InternSGAdapter(
        client=client_for(lambda request: response(request, "")), sleep=lambda _: None
    )
    with pytest.raises(DetailParseError):
        adapter.parse_job_detail(
            fixture_text("detail_invalid.html"), "https://www.internsg.com/job/example/"
        )
    with pytest.raises(AdapterPolicyError):
        adapter.fetch_job_detail("https://malicious.example/job/example/")


def test_empty_listing_is_a_structured_failure(fixture_text) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        return response(request, "<html><body>No current jobs</body></html>")

    adapter = InternSGAdapter(client=client_for(handler), sleep=lambda _: None)
    batch = adapter.collect(max_links=1, max_details=1)

    assert batch.status is RunStatus.FAILED
    assert batch.listing_accessible is True
    assert batch.failures[0].message == "no job links discovered"


def test_non_html_detail_is_rejected(fixture_text) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        return response(request, "{}", content_type="application/json")

    adapter = InternSGAdapter(client=client_for(handler), sleep=lambda _: None)
    with pytest.raises(DetailParseError, match="expected HTML"):
        adapter.fetch_job_detail("https://www.internsg.com/job/example/")


def test_invalid_collection_limits_fail_before_network() -> None:
    adapter = InternSGAdapter(
        client=client_for(lambda request: response(request, "")), sleep=lambda _: None
    )
    with pytest.raises(ValueError, match="max_links"):
        adapter.collect(max_links=0, max_details=1)
    with pytest.raises(ValueError, match="max_details"):
        adapter.collect(max_links=1, max_details=2)


def test_title_change_changes_raw_hash(fixture_text) -> None:
    adapter = InternSGAdapter(
        client=client_for(lambda request: response(request, "")), sleep=lambda _: None
    )
    original_html = fixture_text("detail_complete.html")
    changed_html = original_html.replace("Software Engineer Intern", "Platform Engineer Intern")

    original = adapter.parse_job_detail(original_html, "https://www.internsg.com/job/example/")
    changed = adapter.parse_job_detail(changed_html, "https://www.internsg.com/job/example/")

    assert original.raw_hash != changed.raw_hash
    assert original.dedup_hash != changed.dedup_hash
