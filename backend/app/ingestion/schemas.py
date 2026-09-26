"""Admin API schemas for job sources and persisted crawl runs."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models import CrawlRunStatus
from app.ingestion.models import SourceType


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_type: SourceType
    base_url: str = Field(min_length=1, max_length=1000)
    schedule: str | None = Field(default=None, max_length=120)
    enabled: bool = True

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
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("base_url must be an absolute HTTPS URL without credentials")
        return normalized


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    source_type: str
    base_url: str
    schedule: str | None
    enabled: bool
    status: str
    created_at: datetime
    updated_at: datetime


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
    error_summary: list[dict[str, Any]]
    created_at: datetime


class CrawlRunPage(BaseModel):
    items: list[CrawlRunRead]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)
