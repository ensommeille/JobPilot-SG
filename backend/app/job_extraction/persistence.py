"""Database orchestration around the source-neutral extraction service."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import AuditLog, JobExtractionRun, JobPosting

from .models import ExtractionInput
from .runtime import ExtractionRuntime
from .service import JobExtractionService


class ExtractionRequestError(Exception):
    def __init__(self, status_code: int, code: str):
        self.status_code = status_code
        self.code = code


def job_input(job: JobPosting) -> ExtractionInput:
    if not job.source_url:
        raise ExtractionRequestError(422, "missing_source_url_recrawl_required")
    try:
        return ExtractionInput(
            source_id=str(job.source_id),
            external_id=job.external_id,
            source_url=job.source_url,
            source_type=job.source.source_type,
            title=job.title,
            company=job.company,
            description=job.description,
            raw_hash=job.raw_hash,
        )
    except ValidationError as exc:
        raise ExtractionRequestError(422, "invalid_stored_extraction_input") from exc


def fingerprint(snapshot: dict) -> str:
    return hashlib.sha256(
        json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def audit(db: Session, actor_id: UUID, run_id: UUID, action: str) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type="job_extraction",
            entity_id=str(run_id),
            metadata_json={},
        )
    )


def read_run(db: Session, run_id: UUID) -> JobExtractionRun:
    run = db.get(JobExtractionRun, run_id)
    if run is None:
        raise ExtractionRequestError(404, "extraction_not_found")
    return run


def read_job(db: Session, job_id: UUID) -> JobPosting:
    job = db.get(JobPosting, job_id)
    if job is None:
        raise ExtractionRequestError(404, "job_not_found")
    return job


def present(
    db: Session, run: JobExtractionRun, runtime: ExtractionRuntime, *, reused=False
) -> dict:
    job = read_job(db, run.job_id)
    try:
        stale = job_input(job).input_hash != run.input_hash
    except ExtractionRequestError:
        stale = True
    return {
        "id": run.id,
        "job_id": run.job_id,
        "status": run.status,
        "input_hash": run.input_hash,
        "pipeline_hash": run.pipeline_hash,
        "pipeline": run.pipeline_json,
        "result": run.result_json,
        "error_code": run.error_code,
        "is_stale": stale,
        "is_current_pipeline": fingerprint(runtime.snapshot()) == run.pipeline_hash,
        "reused": reused,
        "started_at": utc_timestamp(run.started_at),
        "finished_at": utc_timestamp(run.finished_at),
        "expires_at": utc_timestamp(run.expires_at),
    }


def utc_timestamp(value: datetime | None) -> datetime | None:
    # SQLite drops timezone metadata; this module always persists UTC timestamps.
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def finish(db: Session, run_id: UUID, actor_id: UUID, *, result=None, error=None) -> None:
    status = result.status if result is not None else "failed"
    changed = db.execute(
        update(JobExtractionRun)
        .where(
            JobExtractionRun.id == run_id,
            JobExtractionRun.status == "running",
        )
        .values(
            status=status,
            active_key=None,
            finished_at=datetime.now(UTC),
            result_json=result.model_dump(mode="json") if result is not None else None,
            error_code=result.error_code if result is not None else error,
        )
    )
    if changed.rowcount != 1:
        db.rollback()
        raise ExtractionRequestError(409, "extraction_no_longer_running")
    audit(db, actor_id, run_id, "extraction.finish")
    db.commit()
    # Bulk updates may leave JSON attributes stale in an expire_on_commit=False session.
    db.expire_all()


async def execute(
    db: Session,
    *,
    job_id: UUID,
    actor_id: UUID,
    runtime: ExtractionRuntime,
    force: bool = False,
) -> tuple[JobExtractionRun, bool]:
    job = read_job(db, job_id)
    item = job_input(job)
    snapshot = runtime.snapshot()
    pipeline_hash = fingerprint(snapshot)
    run_id = uuid4()
    now = datetime.now(UTC)
    # The lease outlives all bounded extraction attempts, including provider cleanup margin.
    lease_seconds = (
        runtime.config.provider_call_timeout_seconds * (runtime.config.max_validation_retries + 1)
        + 60
    )
    run = JobExtractionRun(
        id=run_id,
        job_id=job_id,
        actor_id=actor_id,
        active_key=str(job_id),
        status="running",
        input_hash=item.input_hash,
        pipeline_hash=pipeline_hash,
        input_json=item.model_dump(mode="json"),
        pipeline_json=snapshot,
        started_at=now,
        expires_at=now + timedelta(seconds=lease_seconds),
    )
    db.add(run)
    try:
        # Acquire the unique job lease before checking cache or constructing a provider.
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ExtractionRequestError(409, "extraction_already_running") from exc
    # A different worker might have changed this job while this transaction waited.
    db.refresh(job)
    try:
        item = job_input(job)
    except ExtractionRequestError:
        db.rollback()
        raise
    run.input_hash = item.input_hash
    run.input_json = item.model_dump(mode="json")
    if not force:
        cached = db.scalar(
            select(JobExtractionRun)
            .where(
                JobExtractionRun.job_id == job_id,
                JobExtractionRun.input_hash == item.input_hash,
                JobExtractionRun.pipeline_hash == pipeline_hash,
                JobExtractionRun.status == "needs_review",
            )
            .order_by(JobExtractionRun.finished_at.desc(), JobExtractionRun.id.desc())
            .limit(1)
        )
        if cached is not None:
            cached_id = cached.id
            db.rollback()
            audit(db, actor_id, cached_id, "extraction.reuse")
            db.commit()
            return read_run(db, cached_id), True
    audit(db, actor_id, run_id, "extraction.start")
    db.commit()
    # Do not hold a DB transaction or row lock during inference.
    result = None
    error = None
    try:
        async with runtime.provider_factory() as provider:
            if provider.name != runtime.provider or provider.is_mock != runtime.is_mock:
                raise ValueError("Provider profile mismatch")
            result = await JobExtractionService(provider, runtime.config).extract(item)
    except asyncio.CancelledError:
        finish(db, run_id, actor_id, error="extraction_cancelled")
        raise
    except Exception:
        # No exception messages, raw provider responses or credentials enter persistent logs.
        result = None
        error = "extraction_runtime_error"
    finish(db, run_id, actor_id, result=result, error=error)
    return read_run(db, run_id), False


def recover_expired(db: Session, run_id: UUID, actor_id: UUID) -> JobExtractionRun:
    run = read_run(db, run_id)
    expires = run.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if run.status != "running" or datetime.now(UTC) < expires:
        raise ExtractionRequestError(409, "extraction_not_expired_running")
    # Conditional finalization ensures a late worker cannot overwrite the recovery record.
    finish(db, run_id, actor_id, error="extraction_interrupted")
    return read_run(db, run_id)
