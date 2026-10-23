"""Private once-per-input AI recommendation batches and durable failure cache."""

import sqlalchemy as sa

from alembic import op

revision = "20261023_0008"
down_revision = "20261023_0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_recommendation_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("owner_token", sa.Uuid(), nullable=True),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("pipeline_json", sa.JSON(), nullable=False),
        sa.Column("candidates_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("usage_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "input_hash", name="uq_ai_recommendation_cache"),
    )
    op.create_index("ix_ai_recommendation_runs_user_id", "ai_recommendation_runs", ["user_id"])


def downgrade():
    op.drop_table("ai_recommendation_runs")
