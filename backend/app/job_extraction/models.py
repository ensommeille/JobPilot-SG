"""Source-neutral extraction input, model output schema, and audit records."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.llm import TokenUsage

SCHEMA_VERSION = "job-extraction-v2"
QUALITY_VERSION = "evidence-coverage-v2"
SchemaVersion = Literal["job-extraction-v1", "job-extraction-v2"]


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


class ResponsibilityFact(TextFact):
    priority: Literal["primary", "secondary", "conditional", "unspecified"]
    condition: TextFact | None

    @model_validator(mode="after")
    def preserve_conditional_scope(self) -> ResponsibilityFact:
        if self.priority == "conditional" and self.condition is None:
            raise ValueError("Conditional responsibilities require a source-backed condition")
        if self.priority != "conditional" and self.condition is not None:
            raise ValueError("Responsibilities with a condition must be marked conditional")
        return self


class RequirementAtom(TextFact):
    kind: Literal["skill", "language", "trait", "interest", "qualification"]
    qualifier: TextFact | None


class RequirementGroup(TextFact):
    """A source statement and its explicit AND/OR conditions; never a bag of skills."""

    importance: Literal["required", "preferred", "unspecified"]
    operator: Literal["all_of", "any_of", "unspecified"]
    requirements: list[RequirementAtom] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def reject_duplicate_atoms(self) -> RequirementGroup:
        identities = [
            (atom.kind, " ".join(atom.value.casefold().split())) for atom in self.requirements
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("Duplicate requirement atoms within a group")
        return self


class HoursFact(StrictModel):
    minimum: float | None = Field(ge=0, le=168)
    maximum: float | None = Field(ge=0, le=168)
    unit: Literal["hours_per_week", "hours_per_day"]
    evidence: str = Field(min_length=1, max_length=2500)
    condition: TextFact | None

    @model_validator(mode="after")
    def validate_bounds(self) -> HoursFact:
        if self.minimum is None and self.maximum is None:
            raise ValueError("Hours require at least one explicitly stated bound")
        limit = 24 if self.unit == "hours_per_day" else 168
        if any(value is not None and value > limit for value in (self.minimum, self.maximum)):
            raise ValueError("Hours exceed the stated unit")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Minimum hours cannot exceed maximum hours")
        return self


class DurationFact(StrictModel):
    value: float = Field(gt=0, le=10000)
    unit: Literal["days", "weeks", "months", "years"]
    evidence: str = Field(min_length=1, max_length=2500)
    condition: TextFact | None


class WorkModeFact(StrictModel):
    value: Literal["onsite", "remote", "hybrid"]
    allowed: bool
    evidence: str = Field(min_length=1, max_length=2500)
    condition: TextFact | None


class WorkConstraints(StrictModel):
    schedule: TextFact | None
    hours: HoursFact | None
    minimum_duration: DurationFact | None
    work_modes: list[WorkModeFact] = Field(max_length=12)
    locations: list[TextFact] = Field(max_length=20)


class JobExtractionSchemaV2(StrictModel):
    """Typed, source-backed facts. Parallel requirement groups are conjunctive.

    An any_of group retains alternatives, while unspecified logic must be reviewed.
    For Python AND (PyTorch OR TensorFlow), use a Python all_of group and a second
    any_of group. Do not flatten more complex logic into a false all_of statement.
    """

    summary: TextFact | None
    responsibilities: list[ResponsibilityFact] = Field(max_length=40)
    requirement_groups: list[RequirementGroup] = Field(max_length=60)
    education: EducationRequirements
    experience: ExperienceRequirements
    work_constraints: WorkConstraints

    @model_validator(mode="after")
    def reject_duplicate_statements(self) -> JobExtractionSchemaV2:
        for facts in (
            self.responsibilities,
            self.requirement_groups,
            self.work_constraints.locations,
        ):
            values = [" ".join(fact.value.casefold().split()) for fact in facts]
            if len(values) != len(set(values)):
                raise ValueError("Duplicate extracted statements")
        modes = [
            (fact.value, fact.allowed, fact.condition.value if fact.condition else None)
            for fact in self.work_constraints.work_modes
        ]
        if len(modes) != len(set(modes)):
            raise ValueError("Duplicate work-mode constraints")
        return self


ExtractionPayload = JobExtractionSchema | JobExtractionSchemaV2


def payload_model(schema_version: SchemaVersion):
    if schema_version not in {"job-extraction-v1", "job-extraction-v2"}:
        raise ValueError("Unsupported extraction schema version")
    return JobExtractionSchemaV2 if schema_version == "job-extraction-v2" else JobExtractionSchema


def prompt_version_for(schema_version: SchemaVersion) -> str:
    return (
        "job-extraction-prompt-v2"
        if schema_version == "job-extraction-v2"
        else "job-extraction-prompt-v1"
    )


def quality_version_for(schema_version: SchemaVersion) -> str:
    return (
        "evidence-coverage-v2" if schema_version == "job-extraction-v2" else "evidence-coverage-v1"
    )


class FixtureCase(StrictModel):
    """A source-bound annotation used for deterministic demos or reviewed evaluation sets."""

    case_id: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_.-]+$")
    source_id: str = Field(min_length=1, max_length=100)
    external_id: str = Field(min_length=1, max_length=300)
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    annotation_status: Literal["draft_requires_human_review", "human_reviewed"]
    schema_version: SchemaVersion = "job-extraction-v1"
    extraction: ExtractionPayload

    @model_validator(mode="after")
    def check_schema_version(self) -> FixtureCase:
        if not isinstance(self.extraction, payload_model(self.schema_version)):
            raise ValueError("Fixture schema version does not match its extraction payload")
        return self


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
    schema_version: SchemaVersion
    prompt_version: Literal["job-extraction-prompt-v1", "job-extraction-prompt-v2"]
    contract_version: Literal["0.1.0"]
    execution_mode: Literal["mock", "live"]
    status: Literal["needs_review", "failed"]
    extraction: ExtractionPayload | None
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
        if self.prompt_version != prompt_version_for(self.schema_version):
            raise ValueError("Schema and prompt versions must correspond")
        if self.extraction is not None and not isinstance(
            self.extraction, payload_model(self.schema_version)
        ):
            raise ValueError("Schema version does not match the extraction payload")
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
