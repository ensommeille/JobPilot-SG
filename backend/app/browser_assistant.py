"""Read-only profile suggestions for user-reviewed original-site form filling."""

import re
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.auth.dependencies import BrowserUser
from app.db.session import get_db
from app.profiles.service import get_profile

router = APIRouter(prefix="/browser-assistant", tags=["browser-assistant"])
DatabaseSession = Annotated[Session, Depends(get_db)]
SUPPORTED = {
    "applicant_name",
    "applicant_email",
    "applicant_contact",
    "applicant_period",
    "applicant_summary",
}


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    page_url: str = Field(max_length=500)
    field_ids: list[str] = Field(min_length=1, max_length=5)

    @field_validator("page_url")
    @classmethod
    def allowed_page(cls, value: str) -> str:
        parsed = urlsplit(value)
        internsg = (
            parsed.netloc in {"www.internsg.com", "internsg.com"}
            and bool(re.fullmatch(r"/job-apply/[0-9]+/?", parsed.path))
            and not parsed.query
        )
        greenhouse_path = re.fullmatch(r"/[A-Za-z0-9_-]+/jobs/([0-9]+)/?", parsed.path)
        greenhouse = (
            parsed.netloc in {"job-boards.greenhouse.io", "boards.greenhouse.io"}
            and bool(greenhouse_path)
            and (not parsed.query or parsed.query == f"gh_jid={greenhouse_path.group(1)}")
        )
        lever = (
            parsed.netloc in {"jobs.lever.co", "jobs.eu.lever.co"}
            and bool(re.fullmatch(r"/[A-Za-z0-9_-]+/[A-Za-z0-9-]+/apply/?", parsed.path))
            and not parsed.query
        )
        if parsed.scheme != "https" or parsed.fragment or not (internsg or greenhouse or lever):
            raise ValueError(
                "Only canonical InternSG, Greenhouse or Lever application pages are supported"
            )
        return value

    @field_validator("field_ids")
    @classmethod
    def allowed_fields(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or not set(value) <= SUPPORTED:
            raise ValueError("Unsupported or duplicate fields")
        return value


class DraftResponse(BaseModel):
    values: dict[str, str]
    countries: dict[str, str | None] = Field(default_factory=dict)
    profile_source: str = "jobpilot"
    summary_status: str
    requires_review: bool = True
    submission_supported: bool = False


@router.post("/draft", response_model=DraftResponse)
async def draft(
    payload: DraftRequest, response: Response, db: DatabaseSession, current_user: BrowserUser
) -> DraftResponse:
    response.headers["Cache-Control"] = "no-store"
    profile = get_profile(db, user=current_user)
    direct = {
        "applicant_name": profile.full_name,
        "applicant_email": profile.contact_email,
        "applicant_contact": profile.phone,
        "applicant_period": profile.availability_period,
        "applicant_summary": profile.resume_summary,
    }
    values = {key: value for key, value in direct.items() if key in payload.field_ids and value}
    return DraftResponse(
        values=values,
        countries={"nationality": profile.nationality, "campus": profile.study_country},
        summary_status="manual_only",
    )
