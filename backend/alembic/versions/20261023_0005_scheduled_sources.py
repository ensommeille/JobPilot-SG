"""Persist bounded source schedules, freshness and source-level ingestion leases."""

import sqlalchemy as sa

from alembic import op

revision = "20261023_0005"
down_revision = "20261014_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_sources", sa.Column("max_links", sa.Integer(), server_default="20", nullable=False)
    )
    op.add_column(
        "job_sources", sa.Column("max_details", sa.Integer(), server_default="5", nullable=False)
    )
    for name in ("last_attempt_at", "last_success_at", "next_run_at"):
        op.add_column("job_sources", sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_job_sources_next_run_at", "job_sources", ["next_run_at"])
    op.add_column(
        "job_postings", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True)
    )
    for name in ("items_attempted", "items_unchanged", "items_closed"):
        op.add_column(
            "crawl_runs", sa.Column(name, sa.Integer(), server_default="0", nullable=False)
        )
    op.add_column(
        "crawl_runs",
        sa.Column("is_complete", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_table(
        "source_crawl_leases",
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey("job_sources.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("owner_token", sa.Uuid(), unique=True, nullable=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("crawl_runs.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_source_crawl_leases_expires_at", "source_crawl_leases", ["expires_at"])


def downgrade() -> None:
    op.drop_table("source_crawl_leases")
    for name in ("is_complete", "items_closed", "items_unchanged", "items_attempted"):
        op.drop_column("crawl_runs", name)
    op.drop_column("job_postings", "last_seen_at")
    op.drop_index("ix_job_sources_next_run_at", table_name="job_sources")
    for name in ("next_run_at", "last_success_at", "last_attempt_at", "max_details", "max_links"):
        op.drop_column("job_sources", name)
