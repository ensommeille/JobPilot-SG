"""Profile and resume metadata persistence use cases."""

from pathlib import PurePath
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import ResumeDocument, User, UserProfile
from app.profiles.schemas import ProfileUpdate, ResumeCreate


def get_profile(db: Session, *, user: User) -> UserProfile:
    statement = (
        select(UserProfile)
        .options(selectinload(UserProfile.resumes))
        .where(UserProfile.user_id == user.id)
    )
    profile = db.scalar(statement)
    if profile is not None:
        return profile

    profile = UserProfile(user_id=user.id, contact_email=user.email)
    db.add(profile)
    db.commit()
    return get_profile(db, user=user)


def update_profile(db: Session, *, user: User, payload: ProfileUpdate) -> UserProfile:
    profile = get_profile(db, user=user)
    for field, value in payload.model_dump(mode="python").items():
        setattr(profile, field, value)
    db.commit()
    return get_profile(db, user=user)


def add_resume_metadata(
    db: Session, *, user: User, payload: ResumeCreate
) -> ResumeDocument:
    profile = get_profile(db, user=user)
    suffix = PurePath(payload.filename).suffix.casefold()
    document = ResumeDocument(
        profile_id=profile.id,
        filename=payload.filename,
        storage_key=f"resumes/{user.id}/{uuid4()}{suffix}",
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def list_resume_metadata(db: Session, *, user: User) -> list[ResumeDocument]:
    profile = get_profile(db, user=user)
    statement = (
        select(ResumeDocument)
        .where(ResumeDocument.profile_id == profile.id)
        .order_by(ResumeDocument.uploaded_at.desc(), ResumeDocument.id)
    )
    return list(db.scalars(statement).all())
