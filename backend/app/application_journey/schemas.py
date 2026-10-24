"""Private application journey responses; existing write APIs retain their contracts."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.ingestion.schedule import utc_timestamp

ApplicationChannel = Literal["email", "internsg", "ats", "assistant", "external", "unavailable"]
HistoryChannel = Literal["email", "manual", "assistant", "extension"]


class JourneyJob(BaseModel):
    id: UUID
    title: str
    company: str


class ContextJob(JourneyJob):
    status: str
    apply_url: str | None
    source_url: str | None


class JourneyProfile(BaseModel):
    full_name: str | None = None
    contact_email: str | None = None
    phone: str | None = None
    resume_summary: str | None = None
    availability_period: str | None = None
    education: str | None = None
    experience: str | None = None
    skills: list[str] = Field(default_factory=list)
    nationality: str | None = None
    study_country: str | None = None


class ApplicationContext(BaseModel):
    job: ContextJob
    channel: ApplicationChannel
    channel_label: str
    preparation_url: str | None = None
    original_application_url: str | None = None
    instructions: list[str]
    profile: JourneyProfile
    email_option: dict[str, Any] | None = None


class JourneyHistoryItem(BaseModel):
    id: str
    record_id: UUID
    kind: Literal["application", "email"]
    job: JourneyJob
    channel: HistoryChannel
    method: Literal["manual", "assistant", "extension"] | None = None
    status: str
    display_status: str
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None = None
    sent_at: datetime | None = None
    resume_filename: str | None = None
    next_action: str
    actual_recipient: str | None = None
    original_recipient: str | None = None
    receipt: dict[str, Any] | None = None
    failure_code: str | None = None

    @field_validator("created_at", "updated_at", "submitted_at", "sent_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime | None) -> datetime | None:
        return utc_timestamp(value) if value is not None else None


class JourneyHistoryPage(BaseModel):
    items: list[JourneyHistoryItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    pages: int = Field(ge=0)
