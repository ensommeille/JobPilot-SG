"""Authorized automatic preparation, separate from filling or employer submission."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.ai_recommendations.runtime import AIRuntime
from app.auth.dependencies import BrowserUser
from app.autofill_assistant import get_form_plan_runtime
from app.db.models import JobPosting
from app.db.session import get_db
from app.jobs.application_channels import supported_application_type

from .schemas import PrepareRequest, WarmRequest
from .service import WARM_FIELDS, prepare_answers

router = APIRouter(prefix="/browser-assistant", tags=["browser-assistant"])
DatabaseSession = Annotated[Session, Depends(get_db)]
Runtime = Annotated[AIRuntime | None, Depends(get_form_plan_runtime)]


@router.post("/prepare-answers")
async def prepare(payload: PrepareRequest, response: Response, db: DatabaseSession,
                  user: BrowserUser, runtime: Runtime):
    response.headers["Cache-Control"] = "no-store"
    return await prepare_answers(db, user, payload.page_url, payload.fields, runtime,
                                 fingerprint=payload.profile_fingerprint, cache_only=payload.cache_only)


@router.post("/prepare-answers/warm")
async def warm(payload: WarmRequest, response: Response, db: DatabaseSession,
               user: BrowserUser, runtime: Runtime):
    response.headers["Cache-Control"] = "no-store"
    job = db.get(JobPosting, payload.job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.status != "active" or supported_application_type(job.apply_url) not in {"internsg", "ats"}:
        raise HTTPException(422, "Use an active supported application")
    return await prepare_answers(db, user, job.apply_url, WARM_FIELDS, runtime,
                                 fingerprint=payload.profile_fingerprint, resume_id=payload.resume_id,
                                 cache_only=payload.cache_only, warm=True)
