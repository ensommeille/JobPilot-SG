"""Store private PDF content separately from compatible resume metadata."""

import sqlalchemy as sa

from alembic import op

revision = "20261023_0007"
down_revision = "20261023_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resume_file_contents",
        sa.Column(
            "resume_id",
            sa.Uuid(),
            sa.ForeignKey("resume_documents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("extraction_status", sa.String(30), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("suggestions", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("resume_file_contents")
