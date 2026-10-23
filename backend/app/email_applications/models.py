"""Isolated email policy/draft tables sharing the application's declarative metadata."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmailApplicationPolicy(Base):
    """An operator-verified official email channel, never created by candidate requests."""

    __tablename__ = "email_application_policies"

    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_postings.id", ondelete="CASCADE"), primary_key=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    evidence: Mapped[str] = mapped_column(Text, nullable=False)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class EmailApplication(Base):
    """One durable, single-attempt email application per candidate and posting."""

    __tablename__ = "email_applications"
    __table_args__ = (UniqueConstraint("user_id", "job_id"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("job_postings.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_filename: Mapped[str | None] = mapped_column(String(200))
    attachment_content: Mapped[bytes | None] = mapped_column(LargeBinary)
    attachment_sha256: Mapped[str | None] = mapped_column(String(64))
    attachment_size: Mapped[int | None] = mapped_column(Integer)
    review_digest: Mapped[str | None] = mapped_column(String(64))
    review_content_hash: Mapped[str | None] = mapped_column(String(64))
    review_expires_at: Mapped[int | None] = mapped_column(Integer)
    reviewed_snapshot: Mapped[dict | None] = mapped_column(JSON)
    receipt: Mapped[dict | None] = mapped_column(JSON)
    failure_code: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
