"""Preview or prepare existing public jobs for evidence-backed matching.

The default invocation is read-only. Paid generation requires both --allow-paid
and an operator-provided API key; no profile or resume is sent to the provider.
"""

import argparse
import asyncio
import getpass
import json
from datetime import UTC, datetime
from uuid import UUID

from pydantic import SecretStr, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.db.models import JobExtractionRun, JobPosting, JobSource, User, UserRole
from app.job_extraction.models import ExtractionResult
from app.job_extraction.persistence import ExtractionRequestError, execute, job_input
from app.job_extraction.runtime import ExtractionRuntime, live_runtime
from app.llm.config import LLMSettings


def pending_jobs(
    db: Session,
    *,
    limit: int,
    source_id: UUID | None = None,
    job_type: str | None = None,
) -> list[JobPosting]:
    """Select bounded real jobs without a current successful live extraction."""
    if not 1 <= limit <= 10:
        raise ValueError("Limit must be between 1 and 10")
    conditions = [
        JobPosting.status == "active",
        or_(JobPosting.deadline.is_(None), JobPosting.deadline >= datetime.now(UTC).date()),
        JobSource.source_type.notin_(("mock", "sandbox")),
    ]
    if source_id is not None:
        conditions.append(JobPosting.source_id == source_id)
    if job_type is not None:
        conditions.append(func.lower(JobPosting.job_type) == job_type.casefold())
    jobs = list(
        db.scalars(
            select(JobPosting)
            .join(JobPosting.source)
            .options(joinedload(JobPosting.source))
            .where(*conditions)
            .order_by(
                JobPosting.posted_at.desc().nulls_last(),
                JobPosting.created_at.desc(),
                JobPosting.id,
            )
            .limit(500)
        )
    )
    if not jobs:
        return []
    ranked = (
        select(
            JobExtractionRun.id,
            func.row_number()
            .over(
                partition_by=JobExtractionRun.job_id,
                order_by=(JobExtractionRun.started_at.desc(), JobExtractionRun.id.desc()),
            )
            .label("position"),
        )
        .where(JobExtractionRun.job_id.in_([job.id for job in jobs]))
        .subquery()
    )
    latest = {
        run.job_id: run
        for run in db.scalars(
            select(JobExtractionRun)
            .join(ranked, ranked.c.id == JobExtractionRun.id)
            .where(ranked.c.position == 1)
        )
    }
    pending = []
    for job in jobs:
        try:
            item = job_input(job)
        except ExtractionRequestError:
            continue
        run = latest.get(job.id)
        if run is not None and run.status == "needs_review":
            try:
                result = ExtractionResult.model_validate(run.result_json)
            except ValidationError:
                pass
            else:
                if (
                    result.execution_mode == "live"
                    and result.status == "needs_review"
                    and run.input_hash == item.input_hash
                    and result.input_hash == item.input_hash
                ):
                    continue
        pending.append(job)
        if len(pending) == limit:
            break
    return pending


async def prepare_saved(
    db: Session,
    *,
    actor: User,
    jobs: list[JobPosting],
    runtime: ExtractionRuntime,
) -> dict:
    """Extract selected stored JDs; stop after authentication/rate-limit failure."""
    if not actor.is_active or actor.role != UserRole.ADMIN:
        raise ValueError("An active administrator is required")
    if runtime.is_mock:
        raise ValueError("Saved-job preparation refuses mock extraction")
    if len(jobs) > 10:
        raise ValueError("At most ten jobs per invocation")
    report = {"jobs": []}
    for job in jobs:
        try:
            run, reused = await execute(db, job_id=job.id, actor_id=actor.id, runtime=runtime)
            entry = {
                "job_id": str(job.id),
                "title": job.title,
                "extraction_id": str(run.id),
                "status": run.status,
                "reused": reused,
                "error_code": run.error_code,
            }
            report["jobs"].append(entry)
            if run.error_code in {"provider_authentication_error", "provider_rate_limit"}:
                break
        except ExtractionRequestError as exc:
            db.rollback()
            report["jobs"].append({"job_id": str(job.id), "error_code": exc.code})
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor-id", type=UUID, required=True)
    parser.add_argument("--source-id", type=UUID)
    parser.add_argument("--job-type", type=str, help="Exact job type, e.g. internship")
    parser.add_argument("--limit", type=int, choices=range(1, 11), default=3)
    parser.add_argument("--allow-paid", action="store_true")
    parser.add_argument("--prompt-key", action="store_true")
    args = parser.parse_args()
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        actor = db.get(User, args.actor_id)
        if actor is None or not actor.is_active or actor.role != UserRole.ADMIN:
            parser.error("An existing active administrator is required")
        jobs = pending_jobs(db, limit=args.limit, source_id=args.source_id, job_type=args.job_type)
        if not args.allow_paid:
            print(
                json.dumps(
                    {
                        "mode": "preview_only",
                        "jobs": [{"job_id": str(job.id), "title": job.title} for job in jobs],
                    }
                )
            )
            return
        settings = LLMSettings()
        if args.prompt_key:
            settings.api_key = SecretStr(getpass.getpass("Provider API key (hidden): "))
        if not settings.api_key or not settings.api_key.get_secret_value().strip():
            parser.error("Configure LLM_API_KEY or use --prompt-key")
        settings.max_retries = 0
        result = asyncio.run(
            prepare_saved(db, actor=actor, jobs=jobs, runtime=live_runtime(settings))
        )
        print(json.dumps(result, ensure_ascii=True))
        if any(item.get("status") != "needs_review" for item in result["jobs"]):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
