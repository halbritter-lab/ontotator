"""Add the project spanless finding policy without rewriting snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "allow_spanless_findings",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="ontocurator",
    )
    # Existing drafts stay unclassified; only future inserts get policy v1.
    op.add_column(
        "drafts",
        sa.Column("spanless_policy_version", sa.Integer(), nullable=True),
        schema="ontocurator",
    )
    op.alter_column(
        "drafts",
        "spanless_policy_version",
        server_default=sa.text("1"),
        schema="ontocurator",
    )


def downgrade() -> None:
    op.drop_column("drafts", "spanless_policy_version", schema="ontocurator")
    op.drop_column("projects", "allow_spanless_findings", schema="ontocurator")
