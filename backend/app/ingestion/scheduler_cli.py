"""Optional, bounded single-worker source scheduler (off unless explicitly started).

Preview: python -m app.ingestion.scheduler_cli
Once:    python -m app.ingestion.scheduler_cli --apply
Worker:  python -m app.ingestion.scheduler_cli --apply --watch
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Sequence
from datetime import UTC, datetime

from app.db.session import SessionLocal
from app.ingestion.scheduler import due_sources, run_due_sources
from app.ingestion.service import build_source_adapter


def _cycle(*, apply: bool, max_sources: int, max_jobs: int) -> int:
    with SessionLocal() as db:
        selected = due_sources(db, now=datetime.now(UTC), max_sources=max_sources)
        print(f"Due sources: {len(selected)}")
        for source in selected:
            print(f"  {source.name}: {source.schedule} ({source.base_url})")
        if not apply or not selected:
            return 0
        runs = run_due_sources(
            db, adapter_factory=build_source_adapter,
            max_sources=max_sources, max_jobs=max_jobs,
        )
        for run in runs:
            print(
                f"  {run.source_id}: {run.status.value}; found={run.items_found}, "
                f"new={run.items_new}, updated={run.items_updated}, failed={run.items_failed}"
            )
        return 1 if len(runs) != len(selected) or any(
            run.status.value != "succeeded" for run in runs
        ) else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually fetch due public sources")
    parser.add_argument("--watch", action="store_true", help="Repeat until stopped; requires --apply")
    parser.add_argument("--max-sources", type=int, default=3, choices=range(1, 11), metavar="1..10")
    parser.add_argument("--max-jobs", type=int, default=5, choices=range(1, 101), metavar="1..100")
    parser.add_argument("--poll-seconds", type=int, default=900, choices=range(300, 3601), metavar="300..3600")
    args = parser.parse_args(argv)
    if args.watch and not args.apply:
        parser.error("--watch requires --apply")
    if not args.watch:
        return _cycle(apply=args.apply, max_sources=args.max_sources, max_jobs=args.max_jobs)
    while True:
        _cycle(apply=True, max_sources=args.max_sources, max_jobs=args.max_jobs)
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
