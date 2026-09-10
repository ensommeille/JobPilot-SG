"""HTTP endpoints for registration, login, and the current user."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserRead
from app.auth.service import (
    EmailAlreadyRegisteredError,
    authenticate_user,
    register_user,
)
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db

auth_router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])
DatabaseSession = Annotated[Session, Depends(get_db)]


@auth_router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: DatabaseSession) -> UserRead:
    try:
        user = register_user(db, email=str(payload.email), password=payload.password)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return UserRead.model_validate(user)


@auth_router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DatabaseSession) -> TokenResponse:
    user = authenticate_user(db, email=str(payload.email), password=payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    settings = get_settings()
    token = create_access_token(user_id=user.id, role=user.role.value)
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_access_token_minutes * 60,
        user=UserRead.model_validate(user),
    )


@users_router.get("/me", response_model=UserRead)
def read_current_user(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
