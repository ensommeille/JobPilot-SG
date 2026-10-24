"""One durable private result per user and exact model input/pipeline identity."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AIRecommendationRun(Base):
    __tablename__ = "ai_recommendation_runs"
    __table_args__ = (UniqueConstraint("user_id", "input_hash", name="uq_ai_recommendation_cache"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    owner_token: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    input_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    pipeline_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    candidates_json: Mapped[list] = mapped_column(JSON, nullable=False)
    result_json: Mapped[dict | None] = mapped_column(JSON)
    usage_json: Mapped[dict | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
