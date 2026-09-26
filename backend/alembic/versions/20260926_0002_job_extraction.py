"""Add original job URLs and independent extraction history.

Revision ID: 20260926_0002
Revises: 20260909_0001
"""

import sqlalchemy as sa

from alembic import op

revision = "20260926_0002"
down_revision = "20260909_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_postings", sa.Column("source_url", sa.String(2048), nullable=True))
    # Legacy apply_url may point at an application form; do not invent provenance.
    op.create_table(
        "job_extraction_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("active_key", sa.String(36), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("pipeline_hash", sa.String(64), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("pipeline_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["job_id"], ["job_postings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("active_key"),
        sa.CheckConstraint(
            "status IN ('running', 'needs_review', 'failed')", name="extraction_status"
        ),
        sa.CheckConstraint(
            "(status = 'running' AND active_key IS NOT NULL AND finished_at IS NULL) OR "
            "(status <> 'running' AND active_key IS NULL AND finished_at IS NOT NULL)",
            name="extraction_lease",
        ),
    )
    op.create_index("ix_extraction_job_started", "job_extraction_runs", ["job_id", "started_at"])
    op.create_index(
        "ix_extraction_cache",
        "job_extraction_runs",
        ["job_id", "input_hash", "pipeline_hash", "status"],
    )


def downgrade() -> None:
    op.drop_table("job_extraction_runs")
    op.drop_column("job_postings", "source_url")
