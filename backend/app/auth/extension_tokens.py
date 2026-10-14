"""Opaque tokens are accepted only by explicitly opted-in extension endpoints."""

import hashlib
import time

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import ExtensionGrant, RevokedAccessToken, User


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def extension_grant(db: Session, token: str) -> ExtensionGrant:
    if not token.startswith("jpx_") or len(token) > 100:
        raise HTTPException(401, "Invalid extension session")
    grant = db.scalar(select(ExtensionGrant).where(ExtensionGrant.token_digest == digest(token)))
    if (
        grant is None
        or grant.client_id not in get_settings().extension_client_ids
        or grant.revoked
        or not grant.consumed
        or grant.expires_at <= int(time.time())
        or db.get(RevokedAccessToken, grant.parent_digest) is not None
    ):
        raise HTTPException(401, "Extension session expired or revoked")
    user = db.get(User, grant.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Account unavailable")
    return grant
