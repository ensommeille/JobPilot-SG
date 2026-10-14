"""PKCE-bound single-use authorization, restricted sessions and platform logout."""

import base64
import hashlib
import secrets
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, oauth2_scheme
from app.auth.extension_tokens import digest, extension_grant
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.models import ExtensionGrant, RevokedAccessToken, User
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["extension-auth"])
Database = Annotated[Session, Depends(get_db)]
Bearer = Annotated[str, Depends(oauth2_scheme)]


class AuthorizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    client_id: str = Field(pattern=r"^[a-p]{32}$")
    challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    confirmed: Literal[True]

    @field_validator("confirmed", mode="before")
    @classmethod
    def confirmation(cls, value: object) -> object:
        if value is not True:
            raise ValueError("Explicit confirmation required")
        return value


class ExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    client_id: str = Field(pattern=r"^[a-p]{32}$")
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    verifier: str = Field(pattern=r"^[A-Za-z0-9_-]{43,128}$")


class CodeResponse(BaseModel):
    code: str
    expires_in: int


class SessionResponse(BaseModel):
    user_id: str
    email: str
    expires_at: int


class ExchangeResponse(SessionResponse):
    access_token: str
    token_type: str = "bearer"
    scopes: list[str] = ["browser:draft", "profile:import-empty"]


def private(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post("/extension/authorize", response_model=CodeResponse)
def authorize(
    payload: AuthorizeRequest,
    request: Request,
    response: Response,
    db: Database,
    user: CurrentUser,
    token: Bearer,
) -> CodeResponse:
    settings = get_settings()
    if payload.client_id not in settings.extension_client_ids:
        raise HTTPException(403, "Extension is not registered on this server")
    if request.headers.get("origin") not in settings.extension_web_origins:
        raise HTTPException(403, "Unapproved platform origin")
    now = int(time.time())
    parent = digest(token)
    count = db.scalar(
        select(func.count())
        .select_from(ExtensionGrant)
        .where(ExtensionGrant.parent_digest == parent, ExtensionGrant.expires_at > now)
    )
    if count >= 20:
        raise HTTPException(429, "Connection limit reached for this login session")
    code = secrets.token_urlsafe(32)
    expiry = min(int(decode_access_token(token)["exp"]), now + 8 * 3600)
    db.add(
        ExtensionGrant(
            user_id=user.id,
            parent_digest=parent,
            client_id=payload.client_id,
            challenge=payload.challenge,
            code_digest=digest(code),
            code_expires_at=min(now + 90, expiry),
            expires_at=expiry,
        )
    )
    db.commit()
    private(response)
    return CodeResponse(code=code, expires_in=min(90, expiry - now))


@router.post("/extension/exchange", response_model=ExchangeResponse)
def exchange(payload: ExchangeRequest, response: Response, db: Database) -> ExchangeResponse:
    now = int(time.time())
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(payload.verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    grant = db.scalar(
        select(ExtensionGrant).where(ExtensionGrant.code_digest == digest(payload.code))
    )
    if (
        grant is None
        or payload.client_id not in get_settings().extension_client_ids
        or grant.client_id != payload.client_id
        or not secrets.compare_digest(grant.challenge, challenge)
        or grant.revoked
        or grant.consumed
        or grant.code_expires_at <= now
        or grant.expires_at <= now
        or db.get(RevokedAccessToken, grant.parent_digest)
    ):
        raise HTTPException(401, "Invalid or expired authorization")
    user = db.get(User, grant.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Account unavailable")
    access_token = "jpx_" + secrets.token_urlsafe(32)
    result = db.execute(
        update(ExtensionGrant)
        .where(
            ExtensionGrant.id == grant.id,
            ExtensionGrant.consumed.is_(False),
            ExtensionGrant.revoked.is_(False),
            ExtensionGrant.code_expires_at > int(time.time()),
        )
        .values(consumed=True, token_digest=digest(access_token))
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(401, "Authorization already consumed")
    db.commit()
    private(response)
    return ExchangeResponse(
        access_token=access_token,
        user_id=str(user.id),
        email=user.email,
        expires_at=grant.expires_at,
    )


@router.get("/extension/session", response_model=SessionResponse)
def session(response: Response, db: Database, token: Bearer) -> SessionResponse:
    grant = extension_grant(db, token)
    user = db.get(User, grant.user_id)
    private(response)
    return SessionResponse(user_id=str(user.id), email=user.email, expires_at=grant.expires_at)


@router.post("/extension/disconnect", status_code=204)
def disconnect(db: Database, token: Bearer) -> Response:
    grant = extension_grant(db, token)
    grant.revoked = True
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/logout", status_code=204)
def logout(db: Database, user: CurrentUser, token: Bearer) -> Response:
    parent = digest(token)
    try:
        with db.begin_nested():
            db.add(
                RevokedAccessToken(digest=parent, expires_at=int(decode_access_token(token)["exp"]))
            )
            db.flush()
    except IntegrityError:
        if db.get(RevokedAccessToken, parent) is None:
            raise
    db.execute(
        update(ExtensionGrant).where(ExtensionGrant.parent_digest == parent).values(revoked=True)
    )
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
