"""Public job, tag, favorite, and pagination schemas."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class JobSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    source_type: str
    base_url: str


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
    posted_at: date | None
    deadline: date | None
    status: str
    source: JobSourceRead
    tags: list[JobTagRead]
    created_at: datetime
    updated_at: datetime


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
