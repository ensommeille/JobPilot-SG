"""Strict public preparation requests; model output selects evidence, not new facts."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.jobs.application_channels import supported_application_type


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Option(StrictModel):
    value: str = Field(max_length=240)
    label: str = Field(min_length=1, max_length=240)


class AnswerField(StrictModel):
    id: str = Field(min_length=1, max_length=220)
    label: str = Field(min_length=1, max_length=500)
    kind: Literal["text", "date", "select", "combobox", "number"]
    maxLength: int = Field(default=10000, ge=1, le=10000)
    options: list[Option] = Field(default_factory=list, max_length=100)
    manualOnly: bool = False
    draftable: bool = False
    searchable: bool = False
    optionsPending: bool = False


class Confirmation(StrictModel):
    confirmed: Literal[True]
    cache_only: bool = False

    @field_validator("confirmed", mode="before")
    @classmethod
    def explicit_authorization(cls, value):
        if value is not True:
            raise ValueError("Explicit preparation authorization is required")
        return value


class PrepareRequest(Confirmation):
    page_url: str = Field(min_length=1, max_length=500)
    profile_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    fields: list[AnswerField] = Field(min_length=1, max_length=40)

    @field_validator("page_url")
    @classmethod
    def canonical_page(cls, value):
        if supported_application_type(value) not in {"internsg", "ats"}:
            raise ValueError("Use an exact supported application page")
        return value

    @field_validator("fields")
    @classmethod
    def unique_fields(cls, fields):
        if len({field.id for field in fields}) != len(fields):
            raise ValueError("Duplicate fields")
        return fields


class WarmRequest(Confirmation):
    job_id: UUID
    profile_fingerprint: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    resume_id: UUID | None = None

    @field_validator("job_id", "resume_id", mode="before")
    @classmethod
    def json_uuid(cls, value):
        return UUID(value) if isinstance(value, str) else value


class SelectedMapping(StrictModel):
    field_id: str = Field(min_length=1, max_length=220)
    fact_key: str = Field(min_length=1, max_length=80)


class SelectedDraft(StrictModel):
    kind: Literal["intro", "experience", "motivation"]
    profile_source_ids: list[str] = Field(min_length=1, max_length=3)
    job_source_ids: list[str] = Field(max_length=2)


class AnswerExcerpt(StrictModel):
    source_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=700)


class AnswerChoice(StrictModel):
    option_value: str | None = Field(max_length=240)
    source_value: str = Field(min_length=1, max_length=240)
    normalization: Literal["literal", "month", "country", "degree"]


class FieldAnswer(StrictModel):
    field_id: str = Field(min_length=1, max_length=220)
    disposition: Literal["saved_fact", "resume_evidence", "role_connection", "missing"]
    fact_key: str | None = Field(max_length=80)
    excerpts: list[AnswerExcerpt] = Field(max_length=3)
    choice: AnswerChoice | None = None


class EvidencePlan(StrictModel):
    mappings: list[SelectedMapping] = Field(max_length=12)
    drafts: list[SelectedDraft] = Field(max_length=3)
    field_answers: list[FieldAnswer] = Field(max_length=40)
