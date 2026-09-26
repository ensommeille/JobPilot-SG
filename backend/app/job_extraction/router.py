"""Administrator-only manual extraction and history. Defaults to offline mock mode."""

import asyncio
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.dependencies import AdminUser
from app.db.models import JobExtractionRun
from app.db.session import get_db

from .models import ExtractionResult
from .persistence import (
    ExtractionRequestError,
    execute,
    present,
    read_job,
    read_run,
    recover_expired,
)
from .runtime import ExtractionRuntime, get_extraction_runtime

router = APIRouter(tags=["admin-job-extraction"])
Database = Annotated[Session, Depends(get_db)]
Runtime = Annotated[ExtractionRuntime, Depends(get_extraction_runtime)]


class ExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    force: StrictBool = False


class ExtractionRunRead(BaseModel):
    id: UUID
    job_id: UUID
    status: str
    input_hash: str
    pipeline_hash: str
    pipeline: dict[str, Any]
    result: ExtractionResult | None
    error_code: str | None
    is_stale: bool
    is_current_pipeline: bool
    reused: bool
    started_at: datetime
    expires_at: datetime
    finished_at: datetime | None


class ExtractionPage(BaseModel):
    items: list[ExtractionRunRead]
    total: int
    page: int
    page_size: int


@router.post("/jobs/{job_id}/extractions", response_model=ExtractionRunRead, status_code=201)
def trigger_extraction(
    job_id: UUID,
    payload: ExtractionRequest,
    response: Response,
    db: Database,
    admin: AdminUser,
    runtime: Runtime,
) -> dict:
    try:
        run, reused = asyncio.run(
            execute(
                db,
                job_id=job_id,
                actor_id=admin.id,
                runtime=runtime,
                force=payload.force,
            )
        )
        response.status_code = 200 if reused else 201
        return present(db, run, runtime, reused=reused)
    except ExtractionRequestError as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc


@router.get("/jobs/{job_id}/extractions", response_model=ExtractionPage)
def extraction_history(
    job_id: UUID,
    db: Database,
    _admin: AdminUser,
    runtime: Runtime,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    try:
        read_job(db, job_id)
        condition = JobExtractionRun.job_id == job_id
        total = db.scalar(select(func.count()).select_from(JobExtractionRun).where(condition)) or 0
        runs = db.scalars(
            select(JobExtractionRun)
            .where(condition)
            .order_by(
                JobExtractionRun.started_at.desc(),
                JobExtractionRun.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return {
            "items": [present(db, run, runtime) for run in runs],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    except ExtractionRequestError as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc


@router.get("/extractions/{run_id}", response_model=ExtractionRunRead)
def extraction_detail(run_id: UUID, db: Database, _admin: AdminUser, runtime: Runtime) -> dict:
    try:
        return present(db, read_run(db, run_id), runtime)
    except ExtractionRequestError as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc


@router.post("/extractions/{run_id}/recover", response_model=ExtractionRunRead)
def recover_extraction(run_id: UUID, db: Database, admin: AdminUser, runtime: Runtime) -> dict:
    try:
        return present(db, recover_expired(db, run_id, admin.id), runtime)
    except ExtractionRequestError as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc
