"""Text-only display structure, separate from canonical JD evidence."""

import sqlalchemy as sa

from alembic import op

revision = "20261024_0009"
down_revision = "20261023_0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("job_postings", sa.Column("description_blocks", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("job_postings", "description_blocks")
