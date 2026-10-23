"""Public job, tag, favorite, and pagination schemas."""

from datetime import UTC, date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class JobSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    source_type: str
    base_url: str
    last_success_at: datetime | None = None

    @field_validator("last_success_at")
    @classmethod
    def utc_time(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class JobTagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    category: str


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    external_id: str
    title: str
    company: str
    city: str | None
    salary_min: int | None
    salary_max: int | None
    salary_currency: str | None
    salary_period: str | None
    education: str | None
    experience: str | None
    job_type: str | None
    description: str
    apply_url: str
    source_url: str | None = None
    posted_at: date | None
    deadline: date | None
    status: str
    assistant_form_available: bool
    is_favorited: bool = False
    source: JobSourceRead
    tags: list[JobTagRead]
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime | None = None

    @field_validator("last_seen_at")
    @classmethod
    def utc_last_seen(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class JobPage(BaseModel):
    items: list[JobRead]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)


class FavoriteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    job: JobRead


class FavoritePage(BaseModel):
    items: list[FavoriteRead]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)
