"""Explicit, bounded local import from selected public ATS boards.

Example:
    python -m app.ingestion.public_ats_cli --apply \
      --source 'Stripe=https://boards-api.greenhouse.io/v1/boards/stripe'
"""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from sqlalchemy import func, select

from app.db.models import JobSource, User, UserRole
from app.db.session import SessionLocal
from app.ingestion.models import SourceType
from app.ingestion.public_ats_adapter import public_ats_identity
from app.ingestion.schemas import SourceCreate
from app.ingestion.service import build_source_adapter, create_source, run_source
from app.ingestion.source_catalog import DEFAULT_SOURCE_CATALOG, catalog_source


def _source_argument(value: str) -> tuple[str, str]:
    name, separator, url = value.partition("=")
    name = name.strip()
    url = url.strip().rstrip("/")
    if not separator or not name:
        raise argparse.ArgumentTypeError("Use --source 'Employer=https://...'")
    try:
        SourceCreate(name=name, source_type=SourceType.JSON, base_url=url)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc
    if public_ats_identity(url) is None:
        raise argparse.ArgumentTypeError("Unsupported public ATS API URL")
    return name, url


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", type=_source_argument, default=[])
    parser.add_argument(
        "--catalog-source",
        action="append",
        default=[],
        choices=[entry.key for entry in DEFAULT_SOURCE_CATALOG],
        help="Select one reviewed board explicitly; repeat for multiple boards",
    )
    parser.add_argument(
        "--list-catalog", action="store_true", help="List reviewed sources without fetching"
    )
    parser.add_argument("--max-jobs", type=int, default=20, choices=range(1, 101), metavar="1..100")
    parser.add_argument("--apply", action="store_true", help="Actually fetch and import jobs")
    args = parser.parse_args(argv)

    if args.list_catalog:
        for entry in DEFAULT_SOURCE_CATALOG:
            print(
                f"{entry.key}: {entry.name}; default interval={entry.interval_hours}h; {entry.base_url}"
            )
        return 0
    if not args.source and not args.catalog_source:
        parser.error("Select --source or --catalog-source; no sources are enabled automatically")
    selected = [
        (name, SourceType.JSON, url, args.max_jobs, args.max_jobs) for name, url in args.source
    ]
    for key in args.catalog_source:
        entry = catalog_source(key)
        selected.append(
            (
                entry.name,
                entry.source_type,
                entry.base_url,
                min(args.max_jobs, entry.max_links),
                min(args.max_jobs, entry.max_details),
            )
        )
    # One explicit board request per invocation even if selected by name and catalog.
    selected = list(
        {
            (source_type, url): (name, source_type, url, links, details)
            for name, source_type, url, links, details in selected
        }.values()
    )

    if not args.apply:
        print("Preview only. Add --apply to import:")
        for name, source_type, url, _, details in selected:
            scope = (
                "Singapore early-career jobs" if source_type is SourceType.JSON else "source jobs"
            )
            print(f"  {name}: {url} (up to {details} {scope})")
        print("This importer does not enable scheduling or call a model provider.")
        return 0

    with SessionLocal() as db:
        actor = db.scalar(
            select(User)
            .where(User.role == UserRole.ADMIN, User.is_active.is_(True))
            .order_by(User.id)
        )
        if actor is None:
            parser.error("An existing local admin account is required for audited imports")
        failures = 0
        for name, source_type, url, links, details in selected:
            source = db.scalar(
                select(JobSource).where(func.lower(JobSource.name) == name.casefold())
            )
            if source is None:
                source = create_source(
                    db,
                    payload=SourceCreate(name=name, source_type=source_type, base_url=url),
                    actor=actor,
                )
            elif source.source_type != source_type.value or source.base_url.rstrip(
                "/"
            ) != url.rstrip("/"):
                parser.error(f"Existing source {name!r} has a different type or URL")
            run = run_source(
                db,
                source=source,
                actor=actor,
                adapter_factory=build_source_adapter,
                max_links=links,
                max_details=details,
            )
            print(
                f"{name}: {run.status.value}; found={run.items_found}, "
                f"new={run.items_new}, updated={run.items_updated}, failed={run.items_failed}"
            )
            if run.status.value != "succeeded":
                failures += 1
        return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
