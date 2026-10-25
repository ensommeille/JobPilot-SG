"""Store explicitly reviewed name parts without guessing existing name order."""

import sqlalchemy as sa

from alembic import op

revision = "20261024_0010"
down_revision = "20261024_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("given_name", sa.String(100), nullable=True))
    op.add_column("user_profiles", sa.Column("family_name", sa.String(100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_profiles") as batch:
        batch.drop_column("family_name")
        batch.drop_column("given_name")
