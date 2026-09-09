"""Authentication use cases, kept separate from HTTP routing."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db.models import User, UserProfile, UserRole


class EmailAlreadyRegisteredError(ValueError):
    pass


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == normalize_email(email)))


def register_user(db: Session, *, email: str, password: str) -> User:
    user = User(
        email=normalize_email(email),
        password_hash=hash_password(password),
        role=UserRole.JOB_SEEKER,
    )
    user.profile = UserProfile(contact_email=user.email)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise EmailAlreadyRegisteredError("Email is already registered") from exc
    db.refresh(user)
    return user


def authenticate_user(db: Session, *, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
