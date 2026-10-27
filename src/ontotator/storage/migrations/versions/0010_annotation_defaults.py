"""Project-owned creation presets and a revision for submission acknowledgement."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "creation_defaults",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema="ontotator",
    )
    op.add_column(
        "projects",
        sa.Column(
            "annotation_policy_revision",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        schema="ontotator",
    )


def downgrade() -> None:
    op.drop_column("projects", "annotation_policy_revision", schema="ontotator")
    op.drop_column("projects", "creation_defaults", schema="ontotator")
