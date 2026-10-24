"""Relational model for JobPilot SG's modular monolith."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserRole(StrEnum):
    JOB_SEEKER = "job_seeker"
    ADMIN = "admin"


class ApplicationMethod(StrEnum):
    MANUAL = "manual"
    ASSISTANT = "assistant"
    EXTENSION = "extension"


class ApplicationStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    INTERVIEWING = "interviewing"
    OFFERED = "offered"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class CrawlRunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    FAILED = "failed"


def _enum_values(enum_class: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_class]


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class UUIDPrimaryKeyMixin:
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)


job_posting_tags = Table(
    "job_posting_tags",
    Base.metadata,
    Column(
        "job_id",
        Uuid(as_uuid=True),
        ForeignKey("job_postings.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        Uuid(as_uuid=True),
        ForeignKey("job_tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            native_enum=False,
            validate_strings=True,
            values_callable=_enum_values,
        ),
        default=UserRole.JOB_SEEKER,
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    profile: Mapped[UserProfile | None] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    favorites: Mapped[list[Favorite]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    applications: Mapped[list[Application]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    form_mappings: Mapped[list[FormMappingRecord]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list[AuditLog]] = relationship(back_populates="actor")


class RevokedAccessToken(Base):
    __tablename__ = "revoked_access_tokens"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)


class ExtensionGrant(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "extension_grants"
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_digest: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(32), nullable=False)
    challenge: Mapped[str] = mapped_column(String(43), nullable=False)
    code_digest: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    token_digest: Mapped[str | None] = mapped_column(String(64), unique=True)
    code_expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class UserProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_profiles"
    __table_args__ = (UniqueConstraint("user_id"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    full_name: Mapped[str | None] = mapped_column(String(200))
    given_name: Mapped[str | None] = mapped_column(String(100))
    family_name: Mapped[str | None] = mapped_column(String(100))
    autofill_details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    resume_summary: Mapped[str | None] = mapped_column(Text)
    availability_period: Mapped[str | None] = mapped_column(String(500))
    nationality: Mapped[str | None] = mapped_column(String(2))
    study_country: Mapped[str | None] = mapped_column(String(2))
    education: Mapped[str | None] = mapped_column(Text)
    experience: Mapped[str | None] = mapped_column(Text)
    skills: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    links: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)

    user: Mapped[User] = relationship(back_populates="profile")
    resumes: Mapped[list[ResumeDocument]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )


class ResumeDocument(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "resume_documents"

    profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    profile: Mapped[UserProfile] = relationship(back_populates="resumes")


class JobSource(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "job_sources"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)
    base_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    schedule: Mapped[str | None] = mapped_column(String(120))
    max_links: Mapped[int] = mapped_column(Integer, default=20, server_default="20", nullable=False)
    max_details: Mapped[int] = mapped_column(Integer, default=5, server_default="5", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="healthy", nullable=False)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    jobs: Mapped[list[JobPosting]] = relationship(back_populates="source")
    crawl_runs: Mapped[list[CrawlRun]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class JobPosting(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "job_postings"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id"),
        UniqueConstraint("dedup_hash"),
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max",
            name="salary_range",
        ),
        Index("ix_job_postings_city_type_deadline", "city", "job_type", "deadline"),
        Index("ix_job_postings_salary", "salary_min", "salary_max"),
    )

    source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_sources.id", ondelete="RESTRICT"), nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    company: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    city: Mapped[str | None] = mapped_column(String(120), index=True)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    salary_currency: Mapped[str | None] = mapped_column(String(3))
    salary_period: Mapped[str | None] = mapped_column(String(30))
    education: Mapped[str | None] = mapped_column(String(200))
    experience: Mapped[str | None] = mapped_column(String(200))
    job_type: Mapped[str | None] = mapped_column(String(80), index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    description_blocks: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    apply_url: Mapped[str] = mapped_column(String(2000), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    posted_at: Mapped[date | None] = mapped_column(Date, index=True)
    deadline: Mapped[date | None] = mapped_column(Date, index=True)
    dedup_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False, index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source: Mapped[JobSource] = relationship(back_populates="jobs")
    tags: Mapped[list[JobTag]] = relationship(secondary=job_posting_tags, back_populates="jobs")
    favorites: Mapped[list[Favorite]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    applications: Mapped[list[Application]] = relationship(back_populates="job")
    forms: Mapped[list[ApplicationForm]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )

    @property
    def assistant_form_available(self) -> bool:
        """Whether this job can use the Phase 1 in-platform form assistant."""

        return any(form.is_fixture for form in self.forms)


class JobTag(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "job_tags"
    __table_args__ = (UniqueConstraint("name", "category"),)

    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(80), default="general", nullable=False)

    jobs: Mapped[list[JobPosting]] = relationship(secondary=job_posting_tags, back_populates="tags")


class Favorite(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "job_id"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="favorites")
    job: Mapped[JobPosting] = relationship(back_populates="favorites")


class ApplicationForm(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "application_forms"
    __table_args__ = (UniqueConstraint("job_id", "template_version"),)

    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False
    )
    template_version: Mapped[str] = mapped_column(String(80), nullable=False)
    fields_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    job: Mapped[JobPosting] = relationship(back_populates="forms")
    mappings: Mapped[list[FormMappingRecord]] = relationship(back_populates="form")


class Application(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("user_id", "job_id"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_postings.id", ondelete="RESTRICT"), nullable=False
    )
    method: Mapped[ApplicationMethod] = mapped_column(
        Enum(
            ApplicationMethod,
            name="application_method",
            native_enum=False,
            values_callable=_enum_values,
        ),
        nullable=False,
    )
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(
            ApplicationStatus,
            name="application_status",
            native_enum=False,
            values_callable=_enum_values,
        ),
        default=ApplicationStatus.DRAFT,
        nullable=False,
        index=True,
    )
    applied_url: Mapped[str | None] = mapped_column(String(2000))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mapping_version: Mapped[str | None] = mapped_column(String(100))
    confirmation_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    user: Mapped[User] = relationship(back_populates="applications")
    job: Mapped[JobPosting] = relationship(back_populates="applications")
    mappings: Mapped[list[FormMappingRecord]] = relationship(back_populates="application")


class FormMappingRecord(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "form_mapping_records"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    form_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("application_forms.id", ondelete="CASCADE"), nullable=False
    )
    application_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("applications.id", ondelete="SET NULL")
    )
    mapping_version: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(100), nullable=False)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    confirmation_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="form_mappings")
    form: Mapped[ApplicationForm] = relationship(back_populates="mappings")
    application: Mapped[Application | None] = relationship(back_populates="mappings")


class CrawlRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "crawl_runs"

    source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_sources.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[CrawlRunStatus] = mapped_column(
        Enum(
            CrawlRunStatus,
            name="crawl_run_status",
            native_enum=False,
            values_callable=_enum_values,
        ),
        default=CrawlRunStatus.PENDING,
        nullable=False,
        index=True,
    )
    trigger: Mapped[str] = mapped_column(String(30), default="scheduled", nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    items_found: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    items_new: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    items_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    items_failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    items_attempted: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    items_unchanged: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    items_closed: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    is_complete: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    error_summary: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    source: Mapped[JobSource] = relationship(back_populates="crawl_runs")


class SourceCrawlLease(Base):
    """A portable source-level lease shared by manual and scheduled ingestion."""

    __tablename__ = "source_crawl_leases"

    source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_sources.id", ondelete="CASCADE"), primary_key=True
    )
    owner_token: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), unique=True)
    run_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("crawl_runs.id", ondelete="SET NULL")
    )
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_entity", "entity_type", "entity_id"),)

    actor_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(100))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    actor: Mapped[User | None] = relationship(back_populates="audit_logs")


class JobExtractionRun(UUIDPrimaryKeyMixin, Base):
    """Append-only extraction history with a database-enforced per-job running lease."""

    __tablename__ = "job_extraction_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'needs_review', 'failed')", name="extraction_status"
        ),
        CheckConstraint(
            "(status = 'running' AND active_key IS NOT NULL AND finished_at IS NULL) OR "
            "(status <> 'running' AND active_key IS NULL AND finished_at IS NOT NULL)",
            name="extraction_lease",
        ),
        Index("ix_extraction_job_started", "job_id", "started_at"),
        Index("ix_extraction_cache", "job_id", "input_hash", "pipeline_hash", "status"),
    )

    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    active_key: Mapped[str | None] = mapped_column(String(36), unique=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    pipeline_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    pipeline_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# Register private discovery results, email pilot tables and resume contents.
from app.ai_recommendations.models import AIRecommendationRun as AIRecommendationRun  # noqa: E402
from app.email_applications.models import (  # noqa: E402
    EmailApplication as EmailApplication,
)
from app.email_applications.models import (  # noqa: E402
    EmailApplicationPolicy as EmailApplicationPolicy,
)

# Private file contents are separate from the backwards-compatible resume metadata.
from app.profiles.resume_models import ResumeFileContent as ResumeFileContent  # noqa: E402
