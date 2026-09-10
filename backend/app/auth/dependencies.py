"""FastAPI authentication and RBAC dependencies."""

from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import TokenValidationError, decode_access_token
from app.db.models import User, UserRole
from app.db.session import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
DatabaseSession = Annotated[Session, Depends(get_db)]


def _credentials_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    db: DatabaseSession, token: Annotated[str, Depends(oauth2_scheme)]
) -> User:
    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
    except (TokenValidationError, KeyError, TypeError, ValueError) as exc:
        raise _credentials_error() from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _credentials_error()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*allowed_roles: UserRole) -> Callable[[CurrentUser], User]:
    allowed = set(allowed_roles)

    def role_dependency(current_user: CurrentUser) -> User:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return role_dependency


AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
