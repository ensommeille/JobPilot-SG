"""Validated contracts shared by adapters and the ingestion orchestrator."""

from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SourceType(StrEnum):
    HTML = "html"
    RSS = "rss"
    MOCK = "mock"


class JobStatus(StrEnum):
    ACTIVE = "active"
    INCOMPLETE = "incomplete"


class RunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    FAILED = "failed"


class ContractModel(BaseModel):
    """Strict base model: contract drift fails loudly during integration."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SourceConfig(ContractModel):
    """Runtime policy for one source, normally loaded from JobSource storage."""

    source_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    source_type: SourceType
    base_url: str
    allowed_hosts: frozenset[str] = Field(min_length=1)
    user_agent: str = Field(min_length=8)
    timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    retry_count: int = Field(default=2, ge=0, le=5)
    polite_delay_seconds: float = Field(default=1.5, ge=1.0, le=60)
    enforce_robots: bool = True
    robots_fail_closed: bool = True
    enabled: bool = True

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("base_url must be an absolute HTTPS URL")
        return value.rstrip("/")

    @field_validator("allowed_hosts")
    @classmethod
    def normalize_hosts(cls, value: frozenset[str]) -> frozenset[str]:
        return frozenset(host.lower().rstrip(".") for host in value)


class JobRecord(ContractModel):
    """Deterministically parsed and normalized job data ready for ingestion."""

    source: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_type: SourceType
    external_id: str = Field(min_length=1)
    source_url: str
    title: str = Field(min_length=1)
    company: str = Field(min_length=1)
    location: str | None = None
    city: str | None = None
    job_type: list[str] = Field(default_factory=list)
    job_type_raw: str | None = None
    job_period: str | None = None
    allowance: str | None = None
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    salary_currency: str | None = None
    salary_period: str | None = None
    date_listed: str | None = None
    posted_at: date | None = None
    deadline: date | None = None
    education: str | None = None
    experience: str | None = None
    tags: list[str] = Field(default_factory=list)
    description: str = Field(min_length=1)
    apply_url: str | None = None
    raw_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    dedup_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    parser_version: str = Field(min_length=1)
    status: JobStatus = JobStatus.ACTIVE

    @field_validator("source_url", "apply_url")
    @classmethod
    def validate_http_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("URL must be absolute HTTP(S)")
        return value

    def to_dict(self) -> dict[str, Any]:
        """Compatibility helper retained for existing PoC consumers."""
        return self.model_dump(mode="json")


class RawJobItem(ContractModel):
    """Adapter output consumed by deterministic/LLM extraction services."""

    source_id: str
    source_type: SourceType
    external_id: str
    source_url: str
    raw_text: str = Field(min_length=1)
    raw_html: str | None = None
    raw_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    known_fields: JobRecord
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ItemFailure(ContractModel):
    url: str
    stage: Literal["robots", "listing", "fetch", "parse", "validation"]
    error_type: str
    message: str
    retryable: bool = False


class AdapterBatch(ContractModel):
    source_id: str
    status: RunStatus
    listing_accessible: bool
    discovered_count: int = Field(ge=0)
    attempted_count: int = Field(ge=0)
    items: list[RawJobItem] = Field(default_factory=list)
    failures: list[ItemFailure] = Field(default_factory=list)
    started_at: datetime
    finished_at: datetime


class UpsertStats(ContractModel):
    items_new: int = Field(ge=0)
    items_updated: int = Field(ge=0)
    items_unchanged: int = Field(ge=0)
    total_stored: int = Field(ge=0)


class CrawlRunReport(ContractModel):
    run_id: str
    source_id: str
    trigger: Literal["manual", "scheduled", "test"] = "manual"
    status: RunStatus
    started_at: datetime
    finished_at: datetime
    items_found: int = Field(ge=0)
    items_attempted: int = Field(ge=0)
    items_new: int = Field(ge=0)
    items_updated: int = Field(ge=0)
    items_unchanged: int = Field(ge=0)
    items_failed: int = Field(ge=0)
    error_summary: list[ItemFailure] = Field(default_factory=list)
