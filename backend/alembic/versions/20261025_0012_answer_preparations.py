"""Owner-scoped persistent application answer cache and in-flight claims."""

import sqlalchemy as sa

from alembic import op

revision = "20261025_0012"
down_revision = "20261024_0011"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "answer_preparations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("context_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.String(80), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("owner_token", sa.Uuid()),
        sa.Column("cache_json", sa.JSON(), nullable=False),
        sa.Column("pending_json", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(64)),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "context_hash", name="uq_answer_preparation_context"),
    )
    op.create_index("ix_answer_preparations_user_id", "answer_preparations", ["user_id"])


def downgrade():
    op.drop_table("answer_preparations")
