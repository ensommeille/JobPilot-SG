"""Database queries for job discovery and user-owned favorites."""

from datetime import date
from math import ceil
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db.models import Favorite, JobPosting, JobTag, User, job_posting_tags


def _normalized_values(values: list[str] | None) -> list[str]:
    if not values:
        return []
    normalized: list[str] = []
    for value in values:
        normalized.extend(item.strip().casefold() for item in value.split(",") if item.strip())
    return list(dict.fromkeys(normalized))


def _job_load_options() -> tuple[object, ...]:
    return (joinedload(JobPosting.source), selectinload(JobPosting.tags))


def _favorite_load_options() -> tuple[object, ...]:
    return (
        joinedload(Favorite.job).joinedload(JobPosting.source),
        joinedload(Favorite.job).selectinload(JobPosting.tags),
    )


def get_job(db: Session, job_id: UUID) -> JobPosting | None:
    statement = (
        select(JobPosting)
        .options(*_job_load_options())
        .where(
            JobPosting.id == job_id,
            JobPosting.status.in_(("active", "incomplete")),
        )
    )
    return db.scalar(statement)


def list_jobs(
    db: Session,
    *,
    query: str | None,
    tags: list[str] | None,
    city: str | None,
    salary_min: int | None,
    salary_max: int | None,
    job_type: str | None,
    deadline_from: date | None,
    deadline_to: date | None,
    page: int,
    page_size: int,
) -> tuple[list[JobPosting], int, int]:
    conditions = [JobPosting.status.in_(("active", "incomplete"))]
    if query and (term := query.strip().casefold()):
        pattern = f"%{term}%"
        conditions.append(
            or_(
                func.lower(JobPosting.title).like(pattern),
                func.lower(JobPosting.company).like(pattern),
                func.lower(JobPosting.description).like(pattern),
            )
        )
    if city and (normalized_city := city.strip().casefold()):
        conditions.append(func.lower(JobPosting.city) == normalized_city)
    if job_type and (normalized_type := job_type.strip().casefold()):
        conditions.append(func.lower(JobPosting.job_type) == normalized_type)
    if salary_min is not None:
        conditions.append(JobPosting.salary_max.is_not(None))
        conditions.append(JobPosting.salary_max >= salary_min)
    if salary_max is not None:
        conditions.append(JobPosting.salary_min.is_not(None))
        conditions.append(JobPosting.salary_min <= salary_max)
    if deadline_from is not None:
        conditions.append(JobPosting.deadline >= deadline_from)
    if deadline_to is not None:
        conditions.append(JobPosting.deadline <= deadline_to)

    for tag_name in _normalized_values(tags):
        matching_tag = (
            select(job_posting_tags.c.job_id)
            .join(JobTag, JobTag.id == job_posting_tags.c.tag_id)
            .where(
                job_posting_tags.c.job_id == JobPosting.id,
                func.lower(JobTag.name) == tag_name,
            )
            .exists()
        )
        conditions.append(matching_tag)

    total = db.scalar(select(func.count()).select_from(JobPosting).where(*conditions)) or 0
    statement = (
        select(JobPosting)
        .options(*_job_load_options())
        .where(*conditions)
        .order_by(
            JobPosting.posted_at.desc().nulls_last(),
            JobPosting.created_at.desc(),
            JobPosting.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(db.scalars(statement).all())
    return items, total, ceil(total / page_size) if total else 0


def list_tags(db: Session) -> list[JobTag]:
    statement = select(JobTag).order_by(func.lower(JobTag.category), func.lower(JobTag.name))
    return list(db.scalars(statement).all())


def add_favorite(db: Session, *, user: User, job: JobPosting) -> Favorite:
    existing = db.scalar(
        select(Favorite)
        .options(*_favorite_load_options())
        .where(Favorite.user_id == user.id, Favorite.job_id == job.id)
    )
    if existing is not None:
        return existing

    favorite = Favorite(user_id=user.id, job_id=job.id)
    db.add(favorite)
    db.commit()
    favorite_id = favorite.id
    statement = (
        select(Favorite)
        .options(*_favorite_load_options())
        .where(Favorite.id == favorite_id)
    )
    persisted = db.scalar(statement)
    if persisted is None:  # pragma: no cover - protects against unexpected transaction loss
        raise RuntimeError("Favorite was not persisted")
    return persisted


def remove_favorite(db: Session, *, user: User, job_id: UUID) -> None:
    favorite = db.scalar(
        select(Favorite).where(Favorite.user_id == user.id, Favorite.job_id == job_id)
    )
    if favorite is not None:
        db.delete(favorite)
        db.commit()


def list_favorites(
    db: Session, *, user: User, page: int, page_size: int
) -> tuple[list[Favorite], int, int]:
    conditions = (Favorite.user_id == user.id,)
    total = db.scalar(select(func.count()).select_from(Favorite).where(*conditions)) or 0
    statement = (
        select(Favorite)
        .options(*_favorite_load_options())
        .where(*conditions)
        .order_by(Favorite.created_at.desc(), Favorite.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(db.scalars(statement).unique().all())
    return items, total, ceil(total / page_size) if total else 0
