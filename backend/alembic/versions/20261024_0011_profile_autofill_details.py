"""Private reusable form facts, independent of recommendation profile inputs."""

import sqlalchemy as sa

from alembic import op

revision = "20261024_0011"
down_revision = "20261024_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column("autofill_details", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    with op.batch_alter_table("user_profiles") as batch:
        batch.drop_column("autofill_details")
