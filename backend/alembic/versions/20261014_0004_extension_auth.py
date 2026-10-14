"""Add revocable, restricted extension grants; existing JWTs remain compatible."""

import sqlalchemy as sa

from alembic import op

revision = "20261014_0004"
down_revision = "20261014_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revoked_access_tokens",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )
    op.create_table(
        "extension_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("parent_digest", sa.String(64), nullable=False),
        sa.Column("client_id", sa.String(32), nullable=False),
        sa.Column("challenge", sa.String(43), nullable=False),
        sa.Column("code_digest", sa.String(64), unique=True, nullable=False),
        sa.Column("token_digest", sa.String(64), unique=True, nullable=True),
        sa.Column("code_expires_at", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_extension_grants_parent_digest", "extension_grants", ["parent_digest"])


def downgrade() -> None:
    op.drop_table("extension_grants")
    op.drop_table("revoked_access_tokens")
