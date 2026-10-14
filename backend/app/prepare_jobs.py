"""Explicit, bounded real-source -> stored JD -> live extraction operator command."""

import argparse
import asyncio
import getpass
import json
from uuid import UUID

from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CrawlRunStatus, JobPosting, JobSource, User, UserRole
from app.ingestion.service import build_source_adapter, run_source
from app.job_extraction.persistence import ExtractionRequestError, execute
from app.job_extraction.runtime import ExtractionRuntime, live_runtime
from app.llm.config import LLMSettings


async def prepare(
    db: Session,
    *,
    source: JobSource,
    actor: User,
    runtime: ExtractionRuntime,
    limit: int = 3,
    adapter_factory=build_source_adapter,
) -> dict:
    if not actor.is_active or actor.role != UserRole.ADMIN:
        raise ValueError("An active administrator is required")
    if runtime.is_mock:
        raise ValueError("Live preparation refuses mock extraction")
    if not 1 <= limit <= 10:
        raise ValueError("Limit must be between 1 and 10")
    ids: list[str] = []
    crawl = run_source(
        db,
        source=source,
        actor=actor,
        adapter_factory=adapter_factory,
        max_links=limit,
        max_details=limit,
        collected_external_ids=ids,
    )
    report = {"crawl_run_id": str(crawl.id), "crawl_status": crawl.status.value, "jobs": []}
    if crawl.status == CrawlRunStatus.FAILED:
        return report
    jobs = list(
        db.scalars(
            select(JobPosting)
            .where(
                JobPosting.source_id == source.id,
                JobPosting.external_id.in_(list(dict.fromkeys(ids))),
                JobPosting.status == "active",
            )
            .order_by(JobPosting.id)
            .limit(limit)
        )
    )
    for job in jobs:
        try:
            run, reused = await execute(
                db,
                job_id=job.id,
                actor_id=actor.id,
                runtime=runtime,
            )
            report["jobs"].append(
                {
                    "job_id": str(job.id),
                    "title": job.title,
                    "jd_characters": len(job.description),
                    "extraction_id": str(run.id),
                    "status": run.status,
                    "reused": reused,
                    "error_code": run.error_code,
                }
            )
            if run.error_code in {"provider_authentication_error", "provider_rate_limit"}:
                break
        except ExtractionRequestError as exc:
            db.rollback()
            report["jobs"].append({"job_id": str(job.id), "error_code": exc.code})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-id", type=UUID, required=True)
    parser.add_argument("--actor-id", type=UUID, required=True)
    parser.add_argument("--limit", type=int, choices=range(1, 11), default=3)
    parser.add_argument("--allow-paid", action="store_true")
    parser.add_argument("--prompt-key", action="store_true")
    args = parser.parse_args()
    if not args.allow_paid:
        parser.error("--allow-paid is required; no network or DB work started")
    settings = LLMSettings()
    if args.prompt_key:
        settings.api_key = SecretStr(getpass.getpass("Provider API key (hidden): "))
    if not settings.api_key or not settings.api_key.get_secret_value().strip():
        parser.error("Configure LLM_API_KEY or use --prompt-key")
    # Network retries are disabled to bound paid attempts to at most one per job.
    settings.max_retries = 0
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        source = db.get(JobSource, args.source_id)
        actor = db.get(User, args.actor_id)
        if source is None or actor is None:
            parser.error("Source or administrator does not exist")
        result = asyncio.run(
            prepare(
                db,
                source=source,
                actor=actor,
                runtime=live_runtime(settings),
                limit=args.limit,
            )
        )
        print(json.dumps(result, ensure_ascii=True))
        if (
            result["crawl_status"] == "failed"
            or any(item.get("status") != "needs_review" for item in result["jobs"])
            or not result["jobs"]
        ):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
