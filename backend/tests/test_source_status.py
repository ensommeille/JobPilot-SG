"""Source freshness is public; private source configuration and diagnostics are not."""

from datetime import UTC, datetime, timedelta

from app.db.models import JobPosting, JobSource


def test_source_status_preserves_last_success_when_latest_check_failed(client, db):
    earlier = datetime.now(UTC) - timedelta(days=1)
    source = JobSource(
        name="Public employer board",
        source_type="json",
        base_url="https://api.ashbyhq.com/posting-api/job-board/example",
        schedule="every:6h",
        status="failed",
        last_success_at=earlier,
        last_attempt_at=earlier + timedelta(hours=6),
        next_run_at=earlier + timedelta(hours=12),
    )
    hidden = JobSource(
        name="Disabled", source_type="html", base_url="https://example.test", enabled=False
    )
    sandbox = JobSource(
        name="Internal fixture", source_type="sandbox", base_url="https://sandbox.test"
    )
    db.add_all([source, hidden, sandbox])
    db.flush()
    for status in ("active", "closed"):
        db.add(
            JobPosting(
                source_id=source.id,
                external_id=status,
                title="Example",
                company="Example",
                description="Example",
                apply_url="https://example.test",
                status=status,
                raw_hash=status * 6,
                dedup_hash=status * 6,
            )
        )
    db.commit()
    response = client.get("/job-sources/status")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert len(data["sources"]) == 1
    row = data["sources"][0]
    assert row["status"] == "failed" and row["active_jobs"] == 1
    assert row["provider"] == "ashby"
    assert row["last_success_at"].startswith(earlier.strftime("%Y-%m-%dT%H:%M:%S"))
    assert "base_url" not in row and "error_summary" not in row
    assert "observed_at" in data


def test_unchecked_source_does_not_claim_success(client, db):
    db.add(
        JobSource(
            name="Unverified programme",
            source_type="curated",
            base_url="https://example.test",
            status="healthy",
        )
    )
    db.commit()
    row = client.get("/job-sources/status").json()["sources"][0]
    assert row["last_success_at"] is None
    assert row["last_attempt_at"] is None and row["active_jobs"] == 0
