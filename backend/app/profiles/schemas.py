"""Profile and resume metadata API schemas."""

from datetime import datetime
from pathlib import PurePath
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


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    contact_email: EmailStr | None = None
    education: str | None = Field(default=None, max_length=5000)
    experience: str | None = Field(default=None, max_length=10000)
    skills: list[str] = Field(default_factory=list, max_length=100)
    links: dict[str, str] = Field(default_factory=dict, max_length=30)

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


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str | None
    phone: str | None
    contact_email: EmailStr | None
    education: str | None
    experience: str | None
    skills: list[str]
    links: dict[str, str]
    resumes: list[ResumeRead]
    created_at: datetime
    updated_at: datetime
