"""Add optional reusable application details without changing existing records."""

import sqlalchemy as sa

from alembic import op

revision = "20261014_0003"
down_revision = "20260926_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("resume_summary", sa.Text(), nullable=True))
    op.add_column("user_profiles", sa.Column("availability_period", sa.String(500), nullable=True))
    op.add_column("user_profiles", sa.Column("nationality", sa.String(2), nullable=True))
    op.add_column("user_profiles", sa.Column("study_country", sa.String(2), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_profiles") as batch:
        for name in ("study_country", "nationality", "availability_period", "resume_summary"):
            batch.drop_column(name)
