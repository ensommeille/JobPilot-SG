"""Profile and resume metadata API schemas."""

from datetime import datetime
from pathlib import PurePath
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

ALLOWED_RESUME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_RESUME_SUFFIXES = {".pdf", ".doc", ".docx"}


class ResumeCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)
    size_bytes: int = Field(gt=0, le=5 * 1024 * 1024)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        cleaned = value.strip()
        if PurePath(cleaned).name != cleaned or "\\" in cleaned:
            raise ValueError("filename must not contain a path")
        if PurePath(cleaned).suffix.casefold() not in ALLOWED_RESUME_SUFFIXES:
            raise ValueError("resume must use a PDF, DOC, or DOCX filename")
        return cleaned

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if normalized not in ALLOWED_RESUME_TYPES:
            raise ValueError("unsupported resume content type")
        return normalized


class ResumeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime
    has_file: bool = False
    sha256: str | None = None
    extraction_status: Literal["metadata_only", "parsed", "needs_text"] = "metadata_only"
    page_count: int | None = None


COUNTRY_CODES = frozenset(
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ "
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR "
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP "
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ "
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ "
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".lower().split()
)
APPLICATION_FIELDS = {"resume_summary", "availability_period", "nationality", "study_country"}
NAME_PART_FIELDS = {"given_name", "family_name"}


class ApplicationDetails(BaseModel):
    resume_summary: str | None = Field(default=None, max_length=3000)
    availability_period: str | None = Field(default=None, max_length=500)
    nationality: str | None = Field(default=None, max_length=2)
    study_country: str | None = Field(default=None, max_length=2)

    @field_validator("resume_summary", "availability_period")
    @classmethod
    def clean_application_text(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("nationality", "study_country")
    @classmethod
    def country_code(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        code = value.lower()
        if code not in COUNTRY_CODES:
            raise ValueError("Use a supported two-letter country code")
        return code


class LocalProfileImport(ApplicationDetails):
    model_config = ConfigDict(extra="forbid", strict=True)
    confirmed: Literal[True]
    phone: str | None = Field(default=None, max_length=40)

    @field_validator("confirmed", mode="before")
    @classmethod
    def explicit_confirmation(cls, value: object) -> object:
        if value is not True:
            raise ValueError("Explicit confirmation is required")
        return value


class ProfileUpdate(ApplicationDetails):
    full_name: str | None = Field(default=None, max_length=200)
    given_name: str | None = Field(default=None, max_length=100)
    family_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=40)
    contact_email: EmailStr | None = None
    education: str | None = Field(default=None, max_length=5000)
    experience: str | None = Field(default=None, max_length=10000)
    skills: list[str] = Field(default_factory=list, max_length=100)
    links: dict[str, str] = Field(default_factory=dict, max_length=30)

    @field_validator("given_name", "family_name")
    @classmethod
    def normalize_name_part(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        cleaned = value.strip()
        if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in cleaned):
            raise ValueError("Name parts must be single-line text without control characters")
        return cleaned

    @field_validator("full_name", "phone", "education", "experience")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("skills")
    @classmethod
    def normalize_skills(cls, value: list[str]) -> list[str]:
        normalized = [item.strip() for item in value if item.strip()]
        if any(len(item) > 100 for item in normalized):
            raise ValueError("each skill must contain at most 100 characters")
        return list(dict.fromkeys(normalized))

    @field_validator("links")
    @classmethod
    def normalize_links(cls, value: dict[str, str]) -> dict[str, str]:
        normalized: dict[str, str] = {}
        for label, url in value.items():
            clean_label = label.strip()
            clean_url = url.strip()
            if not clean_label or len(clean_label) > 50:
                raise ValueError("link labels must contain 1 to 50 characters")
            if not clean_url.startswith(("https://", "http://")) or len(clean_url) > 2000:
                raise ValueError("profile links must be absolute HTTP or HTTPS URLs")
            normalized[clean_label] = clean_url
        return normalized


class ProfileRead(ApplicationDetails):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str | None
    given_name: str | None = None
    family_name: str | None = None
    phone: str | None
    contact_email: EmailStr | None
    education: str | None
    experience: str | None
    skills: list[str]
    links: dict[str, str]
    resumes: list[ResumeRead]
    created_at: datetime
    updated_at: datetime
