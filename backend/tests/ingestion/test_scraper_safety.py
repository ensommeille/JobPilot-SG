from __future__ import annotations

import json

import httpx

from app.ingestion.internsg_adapter import InternSGAdapter
from app.ingestion.repository import JsonJobRepository
from app.ingestion.scraper import run
from tests.ingestion.test_repository import make_record


def test_failed_crawl_preserves_snapshot_and_writes_crawl_run(tmp_path, fixture_text) -> None:
    output_path = tmp_path / "jobs.json"
    run_dir = tmp_path / "crawl_runs"
    JsonJobRepository(output_path).upsert([make_record()])
    before = output_path.read_bytes()

    def deny(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=fixture_text("robots_deny.txt"),
            headers={"content-type": "text/plain"},
            request=request,
        )

    client = httpx.Client(transport=httpx.MockTransport(deny))
    adapter = InternSGAdapter(client=client, sleep=lambda _: None)
    exit_code = run(
        output_path,
        adapter=adapter,
        max_links=20,
        max_details=1,
        run_dir=run_dir,
        trigger="test",
    )

    assert exit_code == 1
    assert output_path.read_bytes() == before
    reports = list(run_dir.glob("*.json"))
    assert len(reports) == 1
    report = json.loads(reports[0].read_text(encoding="utf-8"))
    assert report["status"] == "failed"
    assert report["items_failed"] == 1


def test_successful_crawl_merges_snapshot_and_reports_upsert(tmp_path, fixture_text) -> None:
    output_path = tmp_path / "jobs.json"
    run_dir = tmp_path / "crawl_runs"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            body, content_type = fixture_text("robots_allow.txt"), "text/plain"
        elif request.url.path == "/jobs/":
            body, content_type = (
                '<a class="job-listing-row" href="/job/example-one/">Job</a>',
                "text/html",
            )
        else:
            body, content_type = fixture_text("detail_complete.html"), "text/html"
        return httpx.Response(
            200, text=body, headers={"content-type": content_type}, request=request
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = InternSGAdapter(client=client, sleep=lambda _: None)
    exit_code = run(
        output_path,
        adapter=adapter,
        max_links=1,
        max_details=1,
        run_dir=run_dir,
        trigger="test",
    )

    assert exit_code == 0
    jobs = json.loads(output_path.read_text(encoding="utf-8"))
    assert jobs[0]["external_id"] == "123"
    report = json.loads(next(run_dir.glob("*.json")).read_text(encoding="utf-8"))
    assert report["status"] == "succeeded"
    assert report["items_new"] == 1
