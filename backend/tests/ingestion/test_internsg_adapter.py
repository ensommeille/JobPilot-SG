from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from app.ingestion.internsg_adapter import AdapterPolicyError, DetailParseError, InternSGAdapter
from app.ingestion.models import JobStatus, RunStatus


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
    assert record.parser_version == "internsg-2026-10-v3"


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


@pytest.mark.parametrize("base_url", ["https://www.internsg.com", "https://www.internsg.com/jobs/"])
def test_catalog_listing_url_is_normalized_to_origin(base_url, fixture_text):
    from app.ingestion.internsg_adapter import default_internsg_config

    requested = []

    def handler(request):
        requested.append(request.url.path)
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        return response(request, fixture_text("listing.html"))

    adapter = InternSGAdapter(
        default_internsg_config().model_copy(update={"base_url": base_url}),
        client=client_for(handler),
        sleep=lambda _: None,
    )
    adapter.fetch_listing_page()
    assert requested == ["/robots.txt", "/jobs/"]
    assert adapter.config.base_url == "https://www.internsg.com"


def test_collect_follows_real_next_page_and_deduplicates_links(fixture_text):
    requested = []
    sleeps = []

    def handler(request):
        requested.append(request.url.path)
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        if request.url.path == "/jobs/":
            return response(
                request,
                '<a class="job-listing-row" href="/job/one/">One</a>'
                '<a rel="next" href="/jobs/2#isg-top">Next</a>',
            )
        if request.url.path == "/jobs/2/":
            return response(
                request,
                '<a class="job-listing-row" href="/job/one/?f_pg=2#duplicate">One</a>'
                '<a class="job-listing-row" href="/job/two/?f_pg=2">Two</a>'
                '<a rel="next" href="/jobs/3#isg-top">Next</a>',
            )
        return response(request, fixture_text("detail_complete.html"))

    adapter = InternSGAdapter(client=client_for(handler), sleep=sleeps.append)
    batch = adapter.collect(max_links=2, max_details=2)
    assert batch.status is RunStatus.SUCCEEDED
    assert batch.discovered_count == batch.attempted_count == 2
    assert requested == ["/robots.txt", "/jobs/", "/jobs/2/", "/job/one/", "/job/two/"]
    assert len(sleeps) == len(requested) - 1
    assert all(delay >= 1.5 for delay in sleeps)


@pytest.mark.parametrize("next_url", ["https://evil.example/jobs/2", "/jobs/1", "/jobs/2?token=x"])
def test_bad_pagination_never_fetches_outside_scope_and_keeps_first_page(next_url, fixture_text):
    requested = []

    def handler(request):
        requested.append(str(request.url))
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        if request.url.path == "/jobs/":
            return response(
                request,
                '<a class="job-listing-row" href="/job/one/">One</a>'
                f'<a rel="next" href="{next_url}">Next</a>',
            )
        return response(request, fixture_text("detail_complete.html"))

    batch = InternSGAdapter(client=client_for(handler), sleep=lambda _: None).collect(
        max_links=2, max_details=2
    )
    assert batch.status is RunStatus.PARTIAL
    assert batch.attempted_count == len(batch.items) == 1
    assert batch.failures[0].stage == "listing"
    assert len(requested) == 3
    assert requested[-1] == "https://www.internsg.com/job/one/"


def test_later_listing_failure_keeps_successful_details(fixture_text):
    def handler(request):
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        if request.url.path == "/jobs/":
            return response(
                request,
                '<a class="job-listing-row" href="/job/one/">One</a>'
                '<a rel="next" href="/jobs/2">Next</a>',
            )
        if request.url.path == "/jobs/2/":
            return response(request, "temporarily unavailable", status=503)
        return response(request, fixture_text("detail_complete.html"))

    batch = InternSGAdapter(client=client_for(handler), sleep=lambda _: None).collect(
        max_links=2, max_details=2
    )
    assert batch.status is RunStatus.PARTIAL
    assert batch.listing_accessible and len(batch.items) == 1
    assert batch.failures[0].stage == "listing"


@pytest.mark.parametrize("stage", ["listing", "detail"])
def test_rate_limit_stops_batch_without_requesting_more_pages_or_details(stage, fixture_text):
    requested = []

    def handler(request):
        requested.append(request.url.path)
        if request.url.path == "/robots.txt":
            return response(request, fixture_text("robots_allow.txt"), content_type="text/plain")
        if request.url.path == "/jobs/":
            return response(
                request,
                '<a class="job-listing-row" href="/job/one/">One</a>'
                '<a class="job-listing-row" href="/job/two/">Two</a>'
                + ('<a rel="next" href="/jobs/2">Next</a>' if stage == "listing" else ""),
            )
        return response(request, "rate limited", status=429)

    batch = InternSGAdapter(client=client_for(handler), sleep=lambda _: None).collect(
        max_links=3, max_details=3
    )
    assert batch.status is RunStatus.FAILED
    assert len(batch.failures) == 1
    assert requested == ["/robots.txt", "/jobs/", "/jobs/2/" if stage == "listing" else "/job/one/"]


def test_listing_page_cap_and_invalid_config_fail_without_network():
    from app.ingestion.internsg_adapter import default_internsg_config

    adapter = InternSGAdapter(client=client_for(lambda _: pytest.fail("unexpected request")))
    with pytest.raises(ValueError, match="page must be between"):
        adapter.fetch_listing_page(page=adapter.MAX_LISTING_PAGES + 1)
    with pytest.raises(AdapterPolicyError, match="origin or /jobs"):
        InternSGAdapter(
            default_internsg_config().model_copy(
                update={"base_url": "https://www.internsg.com/jobs/?private=1"}
            )
        )


def test_live_scope_requires_source_singapore_and_early_career_and_excludes_senior(fixture_text):
    adapter = InternSGAdapter(client=client_for(lambda _: pytest.fail("no network")))
    record = adapter.parse_job_detail(
        fixture_text("detail_complete.html"), "https://www.internsg.com/job/example/"
    )
    assert adapter._in_scope(record)
    assert not adapter._in_scope(record.model_copy(update={"city": None}))
    assert not adapter._in_scope(
        record.model_copy(update={"title": "Senior Software Engineer Intern"})
    )
    assert not adapter._in_scope(
        record.model_copy(
            update={"title": "Software Engineer", "job_type": ["full-time"], "experience": None}
        )
    )
    assert adapter._in_scope(
        record.model_copy(
            update={
                "title": "Software Engineer",
                "job_type": ["full-time"],
                "experience": "Entry Level / Junior Executive",
            }
        )
    )
    assert adapter._in_scope(record.model_copy(update={"city": None, "status": JobStatus.CLOSED}))


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


def closed_header(html: str, text: str = "This position is <strong>already closed</strong>") -> str:
    return html.replace(
        '<div class="isg-job-header">',
        '<div class="isg-job-header"><div class="isg-job-action"><span class="isg-job-closed">'
        + text
        + "</span></div>",
        1,
    )


@pytest.mark.parametrize("position", ["header", "application_notice"])
def test_explicit_source_status_marks_job_closed_and_changes_hash(fixture_text, position):
    original_html = fixture_text("detail_complete.html")
    html = (
        closed_header(original_html)
        if position == "header"
        else original_html.replace(
            '<div class="isg-apply-card">',
            '<div class="isg-detail-apply">This position is <strong>already closed</strong> and no longer available.</div><div class="isg-apply-card">',
        )
    )
    adapter = InternSGAdapter(
        client=client_for(lambda request: response(request, "")), sleep=lambda _: None
    )
    original = adapter.parse_job_detail(original_html, "https://www.internsg.com/job/example/")
    record = adapter.parse_job_detail(html, "https://www.internsg.com/job/example/")
    assert original.status is JobStatus.ACTIVE
    assert record.status is JobStatus.CLOSED
    assert record.raw_hash != original.raw_hash
    assert record.dedup_hash == original.dedup_hash
    assert record.description == original.description
    raw = adapter.to_raw_item(html, "https://www.internsg.com/job/example/")
    assert raw.known_fields.status is JobStatus.CLOSED
    assert "already closed" in raw.raw_text


@pytest.mark.parametrize("change", ["jd_prose", "jd_fake_class", "outside_container", "not_closed"])
def test_job_prose_and_unrelated_closed_text_do_not_close_job(fixture_text, change):
    html = fixture_text("detail_complete.html")
    if change == "jd_prose":
        html = html.replace("Build and test", "This position is already closed. Build and test")
    elif change == "jd_fake_class":
        html = html.replace(
            "Build and test",
            '<span class="isg-job-closed">This position is already closed</span> Build and test',
        )
    elif change == "outside_container":
        html = html.replace(
            "</body>", '<div class="isg-detail-apply">This position is already closed</div></body>'
        )
    else:
        html = closed_header(html, "This position is not closed")
    adapter = InternSGAdapter(
        client=client_for(lambda request: response(request, "")), sleep=lambda _: None
    )
    assert (
        adapter.parse_job_detail(html, "https://www.internsg.com/job/example/").status
        is JobStatus.ACTIVE
    )


def test_source_closed_record_is_persisted_and_excluded_from_discovery(client, db, fixture_text):
    from sqlalchemy import select

    from app.db.models import JobPosting, JobSource
    from app.ingestion.db_repository import SqlAlchemyJobRepository
    from tests.test_ingestion_admin import auth_headers

    source = JobSource(
        name="InternSG source status", source_type="html", base_url="https://www.internsg.com"
    )
    db.add(source)
    db.commit()
    adapter = InternSGAdapter(
        client=client_for(lambda request: response(request, "")), sleep=lambda _: None
    )
    record = adapter.parse_job_detail(
        closed_header(fixture_text("detail_complete.html")), "https://www.internsg.com/job/example/"
    )
    stats = SqlAlchemyJobRepository(db, source).upsert([record])
    db.commit()
    row = db.scalar(select(JobPosting))
    assert stats.items_new == 1
    assert row.status == "closed"
    assert client.get("/jobs").json()["total"] == 0
    assert client.get(f"/jobs/{row.id}").status_code == 404
    headers = auth_headers(client, db, "closed-source-test@example.com", admin=False)
    assert client.put("/profile", headers=headers, json={"skills": ["Python"]}).status_code == 200
    recommendation = client.post("/jobs/recommendations", headers=headers, json={})
    assert recommendation.status_code == 200
    assert recommendation.json()["status"] == "no_candidates"
    assert recommendation.json()["scanned"] == 0
    assert recommendation.json()["items"] == []
