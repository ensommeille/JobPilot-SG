"""Add verified email policies and private single-attempt email draft history."""

import sqlalchemy as sa

from alembic import op

revision = "20261023_0006"
down_revision = "20261023_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_application_policies",
        sa.Column(
            "job_id",
            sa.Uuid(),
            sa.ForeignKey("job_postings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("source_url", sa.String(2048), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "email_applications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "job_id",
            sa.Uuid(),
            sa.ForeignKey("job_postings.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("attachment_filename", sa.String(200)),
        sa.Column("attachment_content", sa.LargeBinary()),
        sa.Column("attachment_sha256", sa.String(64)),
        sa.Column("attachment_size", sa.Integer()),
        sa.Column("review_digest", sa.String(64)),
        sa.Column("review_content_hash", sa.String(64)),
        sa.Column("review_expires_at", sa.Integer()),
        sa.Column("reviewed_snapshot", sa.JSON()),
        sa.Column("receipt", sa.JSON()),
        sa.Column("failure_code", sa.String(64)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "job_id"),
    )
    op.create_index("ix_email_applications_user_id", "email_applications", ["user_id"])


def downgrade() -> None:
    op.drop_table("email_applications")
    op.drop_table("email_application_policies")
