"""HTTP routes for job discovery, tags, and favorites."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.session import get_db
from app.jobs.schemas import FavoritePage, FavoriteRead, JobPage, JobRead, JobTagRead
from app.jobs.service import (
    add_favorite,
    get_job,
    list_favorites,
    list_jobs,
    list_tags,
    remove_favorite,
)

router = APIRouter(tags=["jobs"])
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.get("/jobs", response_model=JobPage)
def read_jobs(
    db: DatabaseSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    tags: Annotated[list[str] | None, Query()] = None,
    city: Annotated[str | None, Query(max_length=120)] = None,
    salary_min: Annotated[int | None, Query(ge=0)] = None,
    salary_max: Annotated[int | None, Query(ge=0)] = None,
    job_type: Annotated[str | None, Query(alias="type", max_length=80)] = None,
    deadline_from: date | None = None,
    deadline_to: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> JobPage:
    if salary_min is not None and salary_max is not None and salary_min > salary_max:
        raise HTTPException(status_code=422, detail="salary_min must be less than salary_max")
    if deadline_from is not None and deadline_to is not None and deadline_from > deadline_to:
        raise HTTPException(status_code=422, detail="deadline_from must not follow deadline_to")
    items, total, pages = list_jobs(
        db,
        query=q,
        tags=tags,
        city=city,
        salary_min=salary_min,
        salary_max=salary_max,
        job_type=job_type,
        deadline_from=deadline_from,
        deadline_to=deadline_to,
        page=page,
        page_size=page_size,
    )
    return JobPage(
        items=[JobRead.model_validate(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
        pages=pages,
    )


@router.get("/jobs/{job_id}", response_model=JobRead)
def read_job(job_id: UUID, db: DatabaseSession) -> JobRead:
    job = get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobRead.model_validate(job)


@router.get("/tags", response_model=list[JobTagRead])
def read_tags(db: DatabaseSession) -> list[JobTagRead]:
    return [JobTagRead.model_validate(tag) for tag in list_tags(db)]


@router.post("/jobs/{job_id}/favorite", response_model=FavoriteRead, status_code=201)
def create_favorite(job_id: UUID, db: DatabaseSession, current_user: CurrentUser) -> FavoriteRead:
    job = get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return FavoriteRead.model_validate(add_favorite(db, user=current_user, job=job))


@router.delete("/jobs/{job_id}/favorite", status_code=204)
def delete_favorite(job_id: UUID, db: DatabaseSession, current_user: CurrentUser) -> Response:
    if get_job(db, job_id) is None:
        raise HTTPException(status_code=404, detail="Job not found")
    remove_favorite(db, user=current_user, job_id=job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/favorites", response_model=FavoritePage)
def read_favorites(
    db: DatabaseSession,
    current_user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> FavoritePage:
    items, total, pages = list_favorites(
        db, user=current_user, page=page, page_size=page_size
    )
    return FavoritePage(
        items=[FavoriteRead.model_validate(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
        pages=pages,
    )
