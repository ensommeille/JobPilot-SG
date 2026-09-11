"""Typed contracts at the Member 2 and Member 4 form-assistant boundary."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.applications.schemas import ApplicationRead


class ApplicationFormSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    template_version: str
    is_fixture: bool


class ApplicationFormRead(ApplicationFormSummary):
    fields_json: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class AssistantBootstrap(BaseModel):
    api_version: str
    mapping_contract_version: str
    manual_fallback: bool
    forms: list[ApplicationFormSummary]


class FormSnapshotField(BaseModel):
    field_id: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=500)
    name: str | None = Field(default=None, max_length=200)
    field_type: str = Field(alias="type", min_length=1, max_length=80)
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=200)
    placeholder: str | None = Field(default=None, max_length=500)
    context: str | None = Field(default=None, max_length=2000)


class FormMapRequest(BaseModel):
    form_id: UUID
    form_snapshot: list[FormSnapshotField] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def ensure_unique_fields(self) -> "FormMapRequest":
        identifiers = [item.field_id for item in self.form_snapshot]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("form_snapshot field_id values must be unique")
        return self


class MappingFieldSuggestion(BaseModel):
    field_id: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=500)
    value: Any = None
    confidence: float = Field(ge=0, le=1)
    needs_review: bool


class MappingDraft(BaseModel):
    mapping: list[MappingFieldSuggestion] = Field(default_factory=list, max_length=200)
    unmapped_fields: list[str] = Field(default_factory=list, max_length=200)
    missing_profile_fields: list[str] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def ensure_unique_mapping_fields(self) -> "MappingDraft":
        identifiers = [item.field_id for item in self.mapping]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("mapping field_id values must be unique")
        return self


class AssistantApplicationCreate(BaseModel):
    job_id: UUID
    form_id: UUID
    mapping_version: str = Field(min_length=1, max_length=100)
    provider: str = Field(min_length=1, max_length=100)
    prompt_version: str = Field(min_length=1, max_length=100)
    mapping_draft: MappingDraft
    confirmed_field_ids: set[str] = Field(min_length=1, max_length=200)
    edited_values: dict[str, Any] = Field(default_factory=dict, max_length=200)

    @model_validator(mode="after")
    def validate_confirmation_references(self) -> "AssistantApplicationCreate":
        suggested = {item.field_id for item in self.mapping_draft.mapping}
        unknown = self.confirmed_field_ids - suggested - set(self.edited_values)
        if unknown:
            raise ValueError("confirmed fields must exist in the mapping or edited values")
        return self


class MappingRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    application_id: UUID | None
    form_id: UUID
    mapping_version: str
    provider: str
    prompt_version: str
    result_json: dict[str, Any]
    confirmation_json: dict[str, Any]
    created_at: datetime


class AssistantApplicationRead(BaseModel):
    application: ApplicationRead
    mapping: MappingRecordRead
