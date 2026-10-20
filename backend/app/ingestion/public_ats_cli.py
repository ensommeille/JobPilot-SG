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
    parser.add_argument("--source", action="append", type=_source_argument, required=True)
    parser.add_argument("--max-jobs", type=int, default=100, choices=range(1, 101), metavar="1..100")
    parser.add_argument("--apply", action="store_true", help="Actually fetch and import jobs")
    args = parser.parse_args(argv)

    if not args.apply:
        print("Preview only. Add --apply to import:")
        for name, url in args.source:
            print(f"  {name}: {url} (up to {args.max_jobs} Singapore jobs)")
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
        for name, url in args.source:
            source = db.scalar(select(JobSource).where(func.lower(JobSource.name) == name.casefold()))
            if source is None:
                source = create_source(
                    db,
                    payload=SourceCreate(name=name, source_type=SourceType.JSON, base_url=url),
                    actor=actor,
                )
            elif source.source_type != SourceType.JSON.value or source.base_url != url:
                parser.error(f"Existing source {name!r} has a different type or URL")
            run = run_source(
                db,
                source=source,
                actor=actor,
                adapter_factory=build_source_adapter,
                max_links=args.max_jobs,
                max_details=args.max_jobs,
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
