"""Private immutable file content, separate from the compatible resume metadata table."""

from uuid import UUID

from sqlalchemy import JSON, ForeignKey, Integer, LargeBinary, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ResumeFileContent(Base):
    __tablename__ = "resume_file_contents"

    resume_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("resume_documents.id", ondelete="CASCADE"), primary_key=True
    )
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    extraction_status: Mapped[str] = mapped_column(String(30), nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False, deferred=True)
    suggestions: Mapped[dict] = mapped_column(JSON, nullable=False, deferred=True)
