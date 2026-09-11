"""HTTP routes for manual applications, history, and status changes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.applications.schemas import (
    ApplicationPage,
    ApplicationRead,
    ApplicationStatusUpdate,
    ManualApplicationCreate,
)
from app.applications.service import (
    ApplicationConflictError,
    InvalidApplicationTransitionError,
    create_manual_application,
    get_application,
    list_applications,
    update_application_status,
)
from app.auth.dependencies import CurrentUser
from app.db.session import get_db
from app.jobs.service import get_job

router = APIRouter(tags=["applications"])
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.post(
    "/jobs/{job_id}/applications",
    response_model=ApplicationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_application(
    job_id: UUID,
    payload: ManualApplicationCreate,
    db: DatabaseSession,
    current_user: CurrentUser,
) -> ApplicationRead:
    job = get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        application = create_manual_application(
            db, user=current_user, job=job, payload=payload
        )
    except ApplicationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ApplicationRead.model_validate(application)


@router.get("/applications", response_model=ApplicationPage)
def read_applications(
    db: DatabaseSession,
    current_user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ApplicationPage:
    items, total, pages = list_applications(
        db, user=current_user, page=page, page_size=page_size
    )
    return ApplicationPage(
        items=[ApplicationRead.model_validate(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
        pages=pages,
    )


@router.get("/applications/{application_id}", response_model=ApplicationRead)
def read_application(
    application_id: UUID, db: DatabaseSession, current_user: CurrentUser
) -> ApplicationRead:
    application = get_application(db, user=current_user, application_id=application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return ApplicationRead.model_validate(application)


@router.patch("/applications/{application_id}", response_model=ApplicationRead)
def change_application_status(
    application_id: UUID,
    payload: ApplicationStatusUpdate,
    db: DatabaseSession,
    current_user: CurrentUser,
) -> ApplicationRead:
    try:
        application = update_application_status(
            db,
            user=current_user,
            application_id=application_id,
            target_status=payload.status,
        )
    except InvalidApplicationTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return ApplicationRead.model_validate(application)
