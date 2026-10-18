"""Make the spanless finding reason requirement configurable."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "require_spanless_note",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="ontocurator",
    )


def downgrade() -> None:
    op.drop_column("projects", "require_spanless_note", schema="ontocurator")
