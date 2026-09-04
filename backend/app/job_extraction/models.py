"""Source-neutral extraction input, model output schema, and audit records."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.llm import TokenUsage

SCHEMA_VERSION = "job-extraction-v1"
QUALITY_VERSION = "evidence-coverage-v1"


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, str_strip_whitespace=True, allow_inf_nan=False
    )


class ExtractionInput(StrictModel):
    source_id: str = Field(min_length=1, max_length=100)
    external_id: str = Field(min_length=1, max_length=300)
    source_url: str = Field(min_length=1, max_length=2048)
    source_type: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=1000)
    company: str = Field(min_length=1, max_length=1000)
    description: str = Field(min_length=1, max_length=40000)
    raw_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @property
    def input_hash(self) -> str:
        # The legacy raw_hash need not cover all extraction inputs; compute our own hash.
        payload = self.model_dump(exclude={"raw_hash"})
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class TextFact(StrictModel):
    value: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(
        min_length=1, max_length=2500, description="Verbatim supporting quote from description"
    )


class NumberFact(StrictModel):
    value: float = Field(ge=0, le=80)
    evidence: str = Field(min_length=1, max_length=2500)


class EducationRequirements(StrictModel):
    degree: TextFact | None
    fields_of_study: list[TextFact] = Field(max_length=30)
    enrollment: TextFact | None


class ExperienceRequirements(StrictModel):
    requirement: TextFact | None
    minimum_years: NumberFact | None


class JobExtractionSchema(StrictModel):
    """All keys are required; unknown information is represented by null or an empty list."""

    summary: TextFact | None
    responsibilities: list[TextFact] = Field(max_length=40)
    required_skills: list[TextFact] = Field(max_length=40)
    preferred_skills: list[TextFact] = Field(max_length=40)
    required_qualifications: list[TextFact] = Field(max_length=40)
    preferred_qualifications: list[TextFact] = Field(max_length=40)
    education: EducationRequirements
    experience: ExperienceRequirements
    languages: list[TextFact] = Field(max_length=20)

    @model_validator(mode="after")
    def reject_duplicate_facts(self) -> JobExtractionSchema:
        lists = [
            self.responsibilities,
            self.required_skills,
            self.preferred_skills,
            self.required_qualifications,
            self.preferred_qualifications,
            self.languages,
            self.education.fields_of_study,
        ]
        for facts in lists:
            values = [" ".join(f.value.casefold().split()) for f in facts]
            if len(values) != len(set(values)):
                raise ValueError("Duplicate facts within a category")
        required = {" ".join(f.value.casefold().split()) for f in self.required_skills}
        preferred = {" ".join(f.value.casefold().split()) for f in self.preferred_skills}
        if required & preferred:
            raise ValueError("A skill cannot be both required and preferred")
        required = {" ".join(f.value.casefold().split()) for f in self.required_qualifications}
        preferred = {" ".join(f.value.casefold().split()) for f in self.preferred_qualifications}
        if required & preferred:
            raise ValueError("A qualification cannot be both required and preferred")
        return self


class FixtureCase(StrictModel):
    """A source-bound annotation used for deterministic demos or reviewed evaluation sets."""

    case_id: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_.-]+$")
    source_id: str = Field(min_length=1, max_length=100)
    external_id: str = Field(min_length=1, max_length=300)
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    annotation_status: Literal["draft_requires_human_review", "human_reviewed"]
    extraction: JobExtractionSchema


class FixtureBundle(StrictModel):
    notice: str = Field(min_length=1, max_length=1000)
    cases: list[FixtureCase] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def reject_duplicate_identities(self) -> FixtureBundle:
        identities = [(item.source_id, item.external_id, item.input_hash) for item in self.cases]
        case_ids = [item.case_id for item in self.cases]
        if len(identities) != len(set(identities)) or len(case_ids) != len(set(case_ids)):
            raise ValueError("Fixture identities and case IDs must be unique")
        return self


class QualityIssue(StrictModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    field: str = Field(min_length=1, max_length=200, pattern=r"^[a-z0-9_.]+$")


class QualityReport(StrictModel):
    """A diagnostic score, never a calibrated probability or proof of semantic correctness."""

    quality_version: str = QUALITY_VERSION
    score: float | None = Field(ge=0, le=1)
    total_claims: int = Field(ge=0)
    evidence_matched: int = Field(ge=0)
    issues: list[QualityIssue]
    requires_review: Literal[True] = True
    interpretation: str = (
        "Evidence coverage only; semantic correctness and completeness require human review."
    )


class AttemptRecord(StrictModel):
    attempt: int = Field(ge=1, le=3)
    request_id: str = Field(min_length=1, max_length=200)
    outcome: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    duration_ms: float = Field(ge=0)
    provider: str = Field(min_length=1, max_length=200)
    model: str | None = Field(default=None, max_length=300)
    provider_request_id: str | None = Field(default=None, max_length=500)
    finish_reason: Literal["stop", "length", "refusal", "unknown"] | None = None
    usage: TokenUsage | None = None


class ExtractionResult(StrictModel):
    result_id: str = Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )
    source_id: str = Field(min_length=1, max_length=100)
    external_id: str = Field(min_length=1, max_length=300)
    source_url: str = Field(min_length=1, max_length=2048)
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    raw_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    schema_version: Literal["job-extraction-v1"]
    prompt_version: Literal["job-extraction-prompt-v1"]
    contract_version: Literal["0.1.0"]
    execution_mode: Literal["mock", "live"]
    status: Literal["needs_review", "failed"]
    extraction: JobExtractionSchema | None
    quality: QualityReport | None
    error_code: str | None = Field(default=None, max_length=64, pattern=r"^[a-z0-9_]+$")
    attempts: list[AttemptRecord] = Field(min_length=1, max_length=3)
    started_at: str = Field(min_length=1, max_length=50)
    finished_at: str = Field(min_length=1, max_length=50)

    @field_validator("started_at", "finished_at")
    @classmethod
    def require_utc_timestamp(cls, value: str) -> str:
        from datetime import datetime

        parsed = datetime.fromisoformat(value)
        if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
            raise ValueError("Audit timestamps must include a UTC offset")
        return value

    @model_validator(mode="after")
    def check_outcome_consistency(self) -> ExtractionResult:
        if self.status == "failed":
            if self.extraction is not None or self.quality is not None or not self.error_code:
                raise ValueError("Failed results require an error and no extraction or quality")
        elif self.extraction is None or self.quality is None or self.error_code is not None:
            raise ValueError("Review results require extraction and quality, with no error")
        from datetime import datetime

        if datetime.fromisoformat(self.finished_at) < datetime.fromisoformat(self.started_at):
            raise ValueError("finished_at cannot precede started_at")
        if [item.attempt for item in self.attempts] != list(range(1, len(self.attempts) + 1)):
            raise ValueError("Attempt numbers must be consecutive and start at one")
        return self
