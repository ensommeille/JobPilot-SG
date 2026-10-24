"""Strict public and model-output contracts for one bounded recommendation batch."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from app.ingestion.schedule import utc_timestamp
from app.llm import TokenUsage


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RecommendationRequest(StrictModel):
    confirmed: StrictBool
    job_ids: list[UUID] | None = Field(default=None, min_length=1, max_length=5)
    keyword: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=120)
    job_type: str = Field(default="", max_length=80)

    @field_validator("confirmed")
    @classmethod
    def require_confirmation(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Explicit confirmation is required before model processing")
        return value

    @field_validator("job_ids")
    @classmethod
    def unique_ids(cls, value: list[UUID] | None) -> list[UUID] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Choose distinct jobs")
        return value


class Candidate(BaseModel):
    id: UUID
    title: str
    company: str
    city: str | None
    job_type: str | None


class CandidatePreview(BaseModel):
    candidates: list[Candidate]
    profile_ready: bool
    scanned: int
    truncated: bool


class RequirementAssessment(StrictModel):
    requirement: str = Field(min_length=1, max_length=2000)
    category: Literal[
        "skill", "responsibility", "education", "experience", "work_constraint", "other"
    ]
    outcome: Literal["supported", "gap", "unknown"]
    jd_quote: str = Field(min_length=1, max_length=4000)
    profile_field: Literal["education", "experience", "skills", "availability"] | None
    profile_quote: str | None = Field(max_length=4000)
    reason: str = Field(min_length=1, max_length=2000)


class JobAssessment(StrictModel):
    job_id: UUID
    rank: int = Field(ge=1, le=5, strict=True)
    summary: str = Field(min_length=1, max_length=3000)
    requirements: list[RequirementAssessment] = Field(min_length=1, max_length=25)
    warnings: list[str] = Field(max_length=20)


class BatchAssessment(StrictModel):
    requires_review: Literal[True]
    items: list[JobAssessment] = Field(min_length=1, max_length=5)

    @field_validator("requires_review", mode="before")
    @classmethod
    def explicit_review(cls, value):
        if value is not True:
            raise ValueError("requires_review must be JSON true")
        return value


class AdviceEvidence(RequirementAssessment):
    requirement_index: int = Field(ge=0)


class EvidenceCounts(BaseModel):
    supported: int
    gap: int
    unknown: int


class ActionAdvice(BaseModel):
    version: Literal["action-advice-v3"] = "action-advice-v3"
    status: Literal["priority_apply", "consider", "check_first", "not_priority"]
    headline: str
    reasons: list[str]
    blockers: list[AdviceEvidence]
    strengths: list[AdviceEvidence]
    counts: EvidenceCounts


class JobAssessmentReport(BaseModel):
    job_id: UUID
    status: Literal["available", "not_analyzed", "outdated", "running", "failed", "unavailable"]
    source_run_id: UUID | None = None
    assessment: JobAssessment | None = None
    advice: ActionAdvice | None = None
    execution_mode: Literal["live", "mock"] | None = None
    model: str | None = None
    finished_at: datetime | None = None
    reason: str | None = None

    @field_validator("finished_at")
    @classmethod
    def utc_time(cls, value: datetime | None) -> datetime | None:
        return utc_timestamp(value) if value is not None else None


class RecommendationReport(BaseModel):
    id: UUID
    status: Literal["running", "succeeded", "failed"]
    reused: bool
    is_current: bool
    input_hash: str
    provider: str
    model: str
    prompt_version: str
    execution_mode: Literal["mock", "live"]
    profile_skill_count: int
    candidates: list[Candidate]
    result: BatchAssessment | None
    advice: dict[str, ActionAdvice] = Field(default_factory=dict)
    display_order: list[UUID] = Field(default_factory=list)
    error_code: str | None
    usage: TokenUsage
    started_at: datetime
    expires_at: datetime
    finished_at: datetime | None

    @field_validator("started_at", "expires_at", "finished_at")
    @classmethod
    def utc_time(cls, value: datetime | None) -> datetime | None:
        return utc_timestamp(value) if value is not None else None
