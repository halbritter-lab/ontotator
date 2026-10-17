"""Persist review-scoped frozen reanchor inputs and reviewer decisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("reanchor_inputs", "reanchor_resolutions"):
        op.add_column(
            "drafts",
            sa.Column(
                name,
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            schema="ontocurator",
        )
    op.add_column(
        "drafts",
        sa.Column(
            "reanchor_inputs_initialized_at", sa.DateTime(timezone=True), nullable=True
        ),
        schema="ontocurator",
    )


def downgrade() -> None:
    for name in (
        "reanchor_inputs_initialized_at",
        "reanchor_resolutions",
        "reanchor_inputs",
    ):
        op.drop_column("drafts", name, schema="ontocurator")
