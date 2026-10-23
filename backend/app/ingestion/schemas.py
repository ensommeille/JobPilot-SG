"""Admin API schemas for job sources and persisted crawl runs."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models import CrawlRunStatus
from app.ingestion.models import SourceType
from app.ingestion.public_ats_adapter import public_ats_identity
from app.ingestion.schedule import normalize_schedule, utc_timestamp


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_type: SourceType
    base_url: str = Field(min_length=1, max_length=1000)
    schedule: str | None = Field(default=None, max_length=120)
    enabled: bool = Field(
        default=True,
        description="Allow new runs. Disabling does not cancel an in-progress collection or remove saved jobs.",
    )
    max_links: int = Field(default=20, ge=1, le=100)
    max_details: int = Field(default=5, ge=1, le=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must not be blank")
        return normalized

    @field_validator("schedule")
    @classmethod
    def normalize_schedule(cls, value: str | None) -> str | None:
        return normalize_schedule(value)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("base_url must be an absolute HTTPS URL without credentials")
        return normalized

    @model_validator(mode="after")
    def validate_public_ats(self) -> SourceCreate:
        if self.max_details > self.max_links:
            raise ValueError("max_details must not exceed max_links")
        if self.source_type is SourceType.JSON and public_ats_identity(self.base_url) is None:
            raise ValueError(
                "JSON sources require an exact Greenhouse, Lever or Ashby public board API URL"
            )
        return self


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    source_type: str
    base_url: str
    schedule: str | None
    enabled: bool
    status: str
    max_links: int
    max_details: int
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    next_run_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_validator("last_attempt_at", "last_success_at", "next_run_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime | None) -> datetime | None:
        return utc_timestamp(value) if value is not None else None


class SourceScheduleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule: str | None = Field(default=None, max_length=120)
    enabled: bool | None = Field(
        default=None,
        description="Disable to prevent new runs; an in-progress collection may finish and save its batch.",
    )
    max_links: int | None = Field(default=None, ge=1, le=100)
    max_details: int | None = Field(default=None, ge=1, le=100)

    @field_validator("schedule")
    @classmethod
    def validate_schedule(cls, value: str | None) -> str | None:
        return normalize_schedule(value)

    @model_validator(mode="after")
    def validate_update(self) -> SourceScheduleUpdate:
        if not self.model_fields_set:
            raise ValueError("provide at least one source setting")
        if any(getattr(self, field) is None for field in self.model_fields_set - {"schedule"}):
            raise ValueError("only schedule can be null")
        return self


class SourceRunRequest(BaseModel):
    max_links: int = Field(default=20, ge=1, le=100)
    max_details: int = Field(default=5, ge=1, le=100)

    @model_validator(mode="after")
    def validate_limits(self) -> SourceRunRequest:
        if self.max_details > self.max_links:
            raise ValueError("max_details must not exceed max_links")
        return self


class CrawlRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: UUID
    status: CrawlRunStatus
    trigger: str
    started_at: datetime | None
    finished_at: datetime | None
    items_found: int
    items_new: int
    items_updated: int
    items_failed: int
    items_attempted: int
    items_unchanged: int
    items_closed: int
    is_complete: bool
    error_summary: list[dict[str, Any]]
    created_at: datetime


class CrawlRunPage(BaseModel):
    items: list[CrawlRunRead]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)
