"""HTTP routes for the authenticated user's profile and resume metadata."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.session import get_db
from app.profiles.schemas import ProfileRead, ProfileUpdate, ResumeCreate, ResumeRead
from app.profiles.service import (
    add_resume_metadata,
    get_profile,
    list_resume_metadata,
    update_profile,
)

router = APIRouter(prefix="/profile", tags=["profile"])
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=ProfileRead)
def read_profile(db: DatabaseSession, current_user: CurrentUser) -> ProfileRead:
    return ProfileRead.model_validate(get_profile(db, user=current_user))


@router.put("", response_model=ProfileRead)
def replace_profile(
    payload: ProfileUpdate, db: DatabaseSession, current_user: CurrentUser
) -> ProfileRead:
    return ProfileRead.model_validate(update_profile(db, user=current_user, payload=payload))


@router.post("/resumes", response_model=ResumeRead, status_code=status.HTTP_201_CREATED)
def create_resume_metadata(
    payload: ResumeCreate, db: DatabaseSession, current_user: CurrentUser
) -> ResumeRead:
    return ResumeRead.model_validate(
        add_resume_metadata(db, user=current_user, payload=payload)
    )


@router.get("/resumes", response_model=list[ResumeRead])
def read_resume_metadata(
    db: DatabaseSession, current_user: CurrentUser
) -> list[ResumeRead]:
    return [
        ResumeRead.model_validate(item)
        for item in list_resume_metadata(db, user=current_user)
    ]
