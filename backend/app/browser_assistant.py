"""Read-only profile suggestions for user-reviewed original-site form filling."""

from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.auth.dependencies import BrowserUser
from app.db.session import get_db
from app.jobs.application_channels import supported_application_type
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
ATS_EVIDENCE_KEYS = {
    "education",
    "experience",
    "skills",
    "availability",
    "summary",
    "linkedin",
    "github",
}


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    page_url: str = Field(max_length=500)
    field_ids: list[str] = Field(min_length=1, max_length=5)

    @field_validator("page_url")
    @classmethod
    def allowed_page(cls, value: str) -> str:
        if supported_application_type(value) is None:
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


class NameParts(BaseModel):
    given_name: str | None = None
    family_name: str | None = None


class DraftResponse(BaseModel):
    values: dict[str, str]
    countries: dict[str, str | None] = Field(default_factory=dict)
    name_parts: NameParts = Field(default_factory=NameParts)
    profile_source: str = "jobpilot"
    summary_status: str
    requires_review: bool = True
    submission_supported: bool = False


class ATSEvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    page_url: str = Field(max_length=500)
    evidence_keys: list[str] = Field(min_length=1, max_length=7)

    @field_validator("page_url")
    @classmethod
    def allowed_ats_page(cls, value: str) -> str:
        DraftRequest.allowed_page(value)
        if urlsplit(value).netloc not in {
            "job-boards.greenhouse.io",
            "job-boards.eu.greenhouse.io",
            "boards.greenhouse.io",
            "jobs.lever.co",
            "jobs.eu.lever.co",
            "jobs.ashbyhq.com",
        }:
            raise ValueError("Only hosted Greenhouse and Lever forms are supported")
        return value

    @field_validator("evidence_keys")
    @classmethod
    def allowed_evidence(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or not set(value) <= ATS_EVIDENCE_KEYS:
            raise ValueError("Unsupported or duplicate evidence keys")
        return value


class ATSEvidenceResponse(BaseModel):
    values: dict[str, str]
    source_labels: dict[str, str]
    profile_source: str = "jobpilot"
    requires_review: bool = True
    submission_supported: bool = False


def _profile_link(links: dict[str, str], kind: str) -> str | None:
    matches: set[str] = set()
    for value in links.values():
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        known_host = host in (
            {"linkedin.com", "www.linkedin.com"}
            if kind == "linkedin"
            else {"github.com", "www.github.com"}
        )
        if parsed.scheme == "https" and known_host and not parsed.username and not parsed.password:
            matches.add(value)
    return next(iter(matches)) if len(matches) == 1 else None


@router.post("/ats-evidence", response_model=ATSEvidenceResponse)
async def ats_evidence(
    payload: ATSEvidenceRequest, response: Response, db: DatabaseSession, current_user: BrowserUser
) -> ATSEvidenceResponse:
    """Return only requested, previously saved profile facts; never generate claims."""
    response.headers["Cache-Control"] = "no-store"
    profile = get_profile(db, user=current_user)
    source = {
        "education": (profile.education, "JobPilot profile · Education"),
        "experience": (profile.experience, "JobPilot profile · Experience"),
        "skills": (", ".join(profile.skills or []), "JobPilot profile · Skills"),
        "availability": (profile.availability_period, "JobPilot profile · Availability period"),
        "summary": (profile.resume_summary, "JobPilot profile · Reusable summary"),
        "linkedin": (
            _profile_link(profile.links or {}, "linkedin"),
            "JobPilot profile · LinkedIn link",
        ),
        "github": (_profile_link(profile.links or {}, "github"), "JobPilot profile · GitHub link"),
    }
    values = {key: value for key in payload.evidence_keys if (value := source[key][0])}
    return ATSEvidenceResponse(
        values=values,
        source_labels={key: source[key][1] for key in values},
    )


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
        name_parts=NameParts(given_name=profile.given_name, family_name=profile.family_name)
        if "applicant_name" in payload.field_ids
        else NameParts(),
        summary_status="manual_only",
    )
