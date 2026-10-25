"""User-confirmed paid processing, free previews and private cache reads."""

import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.session import get_db
from app.email_applications.router import PrivateRoute

from .runtime import AIRuntime, get_ai_runtime
from .schemas import (
    CandidatePreview,
    JobAssessmentReport,
    RecommendationReport,
    RecommendationRequest,
)
from .service import candidate_preview, execute, job_assessment, present, read_run

router = APIRouter(tags=["AI recommendations"], route_class=PrivateRoute)
Database = Annotated[Session, Depends(get_db)]
Runtime = Annotated[AIRuntime, Depends(get_ai_runtime)]


@router.get("/jobs/ai-recommendations/candidates", response_model=CandidatePreview)
def preview(
    db: Database,
    user: CurrentUser,
    keyword: Annotated[str, Query(max_length=200)] = "",
    city: Annotated[str, Query(max_length=120)] = "",
    job_type: Annotated[str, Query(max_length=80)] = "",
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
):
    return candidate_preview(db, user, keyword=keyword, city=city, job_type=job_type, limit=limit)


@router.post("/jobs/ai-recommendations", response_model=RecommendationReport, status_code=201)
def recommend(
    payload: RecommendationRequest,
    db: Database,
    user: CurrentUser,
    runtime: Runtime,
    response: Response,
):
    run, reused = asyncio.run(execute(db, user=user, payload=payload, runtime=runtime))
    response.status_code = 202 if run.status == "running" else 200 if reused else 201
    return present(run, reused=reused, db=db, user=user)


@router.get("/ai-recommendations/{run_id}", response_model=RecommendationReport)
def detail(run_id: UUID, db: Database, user: CurrentUser):
    return present(read_run(db, user, run_id), reused=True, db=db, user=user)


@router.get("/jobs/{job_id}/ai-assessment", response_model=JobAssessmentReport)
def assessment(job_id: UUID, db: Database, user: CurrentUser):
    return job_assessment(db, user, job_id)
