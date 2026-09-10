"""Application API schemas and validation rules."""

from datetime import datetime
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

from app.db.models import ApplicationMethod, ApplicationStatus
from app.jobs.schemas import JobRead


class ManualApplicationCreate(BaseModel):
    status: ApplicationStatus = ApplicationStatus.SUBMITTED
    applied_url: AnyHttpUrl | None = None
    submitted_at: datetime | None = None

    @model_validator(mode="after")
    def validate_initial_state(self) -> "ManualApplicationCreate":
        if self.status not in {ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED}:
            raise ValueError("a new manual application must be draft or submitted")
        if self.status == ApplicationStatus.DRAFT and self.submitted_at is not None:
            raise ValueError("a draft application cannot have submitted_at")
        return self


class ApplicationStatusUpdate(BaseModel):
    status: ApplicationStatus


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    method: ApplicationMethod
    status: ApplicationStatus
    applied_url: str | None
    submitted_at: datetime | None
    mapping_version: str | None
    confirmation_json: dict[str, object]
    job: JobRead
    created_at: datetime
    updated_at: datetime


class ApplicationPage(BaseModel):
    items: list[ApplicationRead]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)
