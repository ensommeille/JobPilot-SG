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


class ConditionEvidence(StrictModel):
    condition: str = Field(min_length=1, max_length=1000)
    outcome: Literal["supported", "gap", "unknown"]
    profile_field: Literal["education", "experience", "skills", "availability"] | None
    profile_quote: str | None = Field(max_length=4000)
    reason: str = Field(min_length=1, max_length=1000)


class RelatedEvidence(StrictModel):
    requirement_index: int = Field(ge=0, strict=True)
    condition_index: int | None = Field(default=None, ge=0, strict=True)
    kind: Literal["partial_condition", "related_activity"]
    statement: str = Field(min_length=1, max_length=1000)
    jd_quote: str = Field(min_length=1, max_length=4000)
    profile_field: Literal["education", "experience", "skills", "availability"]
    profile_quote: str = Field(min_length=1, max_length=4000)
    reason: str = Field(min_length=1, max_length=1000)


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
    condition_checks: list[ConditionEvidence] = Field(default_factory=list, max_length=12)
    condition_operator: Literal["atomic", "all_of", "any_of", "unspecified"] | None = None


class CareerStrength(StrictModel):
    basis: Literal["requirement", "condition", "related_activity"]
    requirement_index: int = Field(ge=0, strict=True)
    condition_index: int | None = Field(ge=0, strict=True)
    text: str = Field(min_length=1, max_length=220)


class CareerConsideration(StrictModel):
    requirement_index: int = Field(ge=0, strict=True)
    condition_index: int | None = Field(ge=0, strict=True)
    text: str = Field(min_length=1, max_length=220)


ApplicationVerdict = Literal[
    "priority_apply", "consider", "not_priority", "insufficient_information"
]


class CareerFit(StrictModel):
    direction: Literal["direct", "adjacent", "low", "undetermined"]
    proposed_verdict: ApplicationVerdict
    summary: str = Field(min_length=1, max_length=420)
    jd_quote: str = Field(min_length=1, max_length=4000)
    profile_field: Literal["education", "experience", "skills"] | None
    profile_quote: str | None = Field(max_length=4000)
    job_focus: str | None = Field(default=None, max_length=100)
    profile_focus: str | None = Field(default=None, max_length=100)
    strengths: list[CareerStrength] = Field(max_length=3)
    considerations: list[CareerConsideration] = Field(max_length=3)
    server_adjusted: bool = False


class JobAssessment(StrictModel):
    job_id: UUID
    rank: int = Field(ge=1, le=5, strict=True)
    summary: str = Field(min_length=1, max_length=3000)
    requirements: list[RequirementAssessment] = Field(min_length=1, max_length=25)
    warnings: list[str] = Field(max_length=20)
    related_evidence: list[RelatedEvidence] = Field(default_factory=list, max_length=8)
    career_fit: CareerFit | None = None


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


class ApplicationRecommendation(StrictModel):
    verdict: ApplicationVerdict
    summary: str = Field(min_length=1, max_length=420)
    strengths: list[str] = Field(max_length=3)
    considerations: list[str] = Field(max_length=3)

    @field_validator("strengths", "considerations")
    @classmethod
    def short_points(cls, value: list[str]) -> list[str]:
        if any(not text.strip() or len(text) > 220 for text in value):
            raise ValueError("Application points must be nonempty and at most 220 characters")
        return value


class ActionAdvice(BaseModel):
    version: Literal["action-advice-v5"] = "action-advice-v5"
    status: Literal["priority_apply", "consider", "check_first", "not_priority"]
    headline: str
    reasons: list[str]
    blockers: list[AdviceEvidence]
    strengths: list[AdviceEvidence]
    counts: EvidenceCounts
    related_evidence: list[RelatedEvidence] = Field(default_factory=list)
    application_recommendation: ApplicationRecommendation | None = None


class JobAssessmentReport(BaseModel):
    job_id: UUID
    status: Literal["available", "not_analyzed", "outdated", "running", "failed", "unavailable"]
    context_hash: str | None = None
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
