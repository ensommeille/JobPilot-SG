"""Authenticated application preparation and history, including private error responses."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.application_journey.schemas import ApplicationContext, HistoryChannel, JourneyHistoryPage
from app.application_journey.service import application_context, application_history
from app.auth.dependencies import CurrentUser
from app.db.session import get_db
from app.email_applications.router import PrivateRoute

router = APIRouter(tags=["application journey"], route_class=PrivateRoute)
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.get("/jobs/{job_id}/application-context", response_model=ApplicationContext)
def read_application_context(
    job_id: UUID, db: DatabaseSession, user: CurrentUser
) -> ApplicationContext:
    return application_context(db, user=user, job_id=job_id)


@router.get("/application-history", response_model=JourneyHistoryPage)
def read_application_history(
    db: DatabaseSession,
    user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    channel: HistoryChannel | None = None,
) -> JourneyHistoryPage:
    return application_history(db, user=user, page=page, page_size=page_size, channel=channel)
