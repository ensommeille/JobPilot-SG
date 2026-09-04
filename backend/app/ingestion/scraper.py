"""Run a bounded InternSG crawl with safe upsert and CrawlRun audit output."""

from __future__ import annotations

import argparse
import logging
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

try:
    from .internsg_adapter import InternSGAdapter, default_internsg_config
    from .models import CrawlRunReport, ItemFailure, JobRecord, RunStatus, UpsertStats
    from .repository import JsonJobRepository, SnapshotValidationError, atomic_write_json
    from .source_adapter import SourceAdapter
except ImportError:  # pragma: no cover - permits `python scraper.py`
    from internsg_adapter import InternSGAdapter, default_internsg_config
    from models import CrawlRunReport, ItemFailure, JobRecord, RunStatus, UpsertStats
    from repository import JsonJobRepository, SnapshotValidationError, atomic_write_json
    from source_adapter import SourceAdapter


LOGGER = logging.getLogger(__name__)
DEFAULT_OUTPUT = Path("data") / "jobs.json"
DEFAULT_RUN_DIR = Path("data") / "crawl_runs"
REPORTED_FIELDS = (
    "title",
    "company",
    "city",
    "location",
    "job_type",
    "job_period",
    "salary_min",
    "salary_max",
    "posted_at",
    "description",
    "apply_url",
)


def run(
    output_path: Path,
    delay: float = 1.5,
    *,
    max_links: int = 20,
    max_details: int = 5,
    run_dir: Path | None = None,
    adapter: SourceAdapter | None = None,
    trigger: Literal["manual", "scheduled", "test"] = "manual",
) -> int:
    """Collect, safely merge successes, and always emit one audit report."""
    if delay < 1.0:
        raise ValueError("delay must be at least 1.0 second")
    owns_adapter = adapter is None
    if adapter is None:
        config_data = default_internsg_config().model_dump()
        config_data["polite_delay_seconds"] = delay
        config = type(default_internsg_config()).model_validate(config_data)
        adapter = InternSGAdapter(config)

    run_id = str(uuid4())
    run_dir = run_dir or DEFAULT_RUN_DIR
    batch = adapter.collect(max_links=max_links, max_details=max_details)
    records: list[JobRecord] = [item.known_fields for item in batch.items]
    failures = list(batch.failures)
    status = batch.status
    stats = UpsertStats(items_new=0, items_updated=0, items_unchanged=0, total_stored=0)

    try:
        # Empty/failed batches never replace the snapshot; successful records merge.
        stats = JsonJobRepository(output_path).upsert(records)
    except SnapshotValidationError as exc:
        LOGGER.error("Output snapshot validation failed: %s", exc)
        failures.append(
            ItemFailure(
                url=str(output_path),
                stage="validation",
                error_type=type(exc).__name__,
                message=str(exc),
                retryable=False,
            )
        )
        status = RunStatus.FAILED
    finally:
        if owns_adapter and hasattr(adapter, "close"):
            adapter.close()  # type: ignore[attr-defined]

    report = CrawlRunReport(
        run_id=run_id,
        source_id=batch.source_id,
        trigger=trigger,
        status=status,
        started_at=batch.started_at,
        finished_at=datetime.now(UTC),
        items_found=batch.discovered_count,
        items_attempted=batch.attempted_count,
        items_new=stats.items_new,
        items_updated=stats.items_updated,
        items_unchanged=stats.items_unchanged,
        items_failed=len(failures),
        error_summary=failures,
    )
    report_path = run_dir / f"{run_id}.json"
    atomic_write_json(report_path, report.model_dump(mode="json"))

    _print_summary(
        batch.listing_accessible,
        batch.discovered_count,
        batch.attempted_count,
        records,
        report,
        output_path,
        report_path,
    )
    return 0 if report.status in {RunStatus.SUCCEEDED, RunStatus.PARTIAL} and records else 1


def _print_summary(
    listing_accessible: bool,
    discovered: int,
    attempted: int,
    records: list[JobRecord],
    report: CrawlRunReport,
    output_path: Path,
    report_path: Path,
) -> None:
    print(f"Listing page accessible: {'YES' if listing_accessible else 'NO'}")
    print(f"Job links discovered: {discovered}")
    print(f"Detail pages attempted: {attempted}")
    print(f"Successfully parsed: {len(records)}")
    print(f"Run status: {report.status.value}")
    print(
        "Upsert: "
        f"new={report.items_new}, updated={report.items_updated}, "
        f"unchanged={report.items_unchanged}, failed={report.items_failed}"
    )
    print("\nFields:")
    present = Counter(
        field_name
        for job in records
        for field_name in REPORTED_FIELDS
        if getattr(job, field_name) not in (None, [], "")
    )
    for field_name in REPORTED_FIELDS:
        print(f"{field_name}: {present[field_name]}/{len(records)}")
    print(f"\nJSON snapshot: {output_path}")
    print(f"CrawlRun report: {report_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--run-dir", type=Path, default=DEFAULT_RUN_DIR)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--max-links", type=int, default=20)
    parser.add_argument("--max-details", type=int, default=5)
    parser.add_argument("--trigger", choices=("manual", "scheduled", "test"), default="manual")
    args = parser.parse_args()
    if args.delay < 1.0:
        parser.error("--delay must be at least 1.0 second")
    if not 1 <= args.max_links <= 100:
        parser.error("--max-links must be between 1 and 100")
    if not 1 <= args.max_details <= args.max_links:
        parser.error("--max-details must be between 1 and --max-links")
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    return run(
        args.output,
        args.delay,
        max_links=args.max_links,
        max_details=args.max_details,
        run_dir=args.run_dir,
        trigger=args.trigger,
    )


if __name__ == "__main__":
    raise SystemExit(main())
