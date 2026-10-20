"""A lead's own translation review of a rejected or queried version (spec FD1).

``assignments.lead_correction`` marks the lead's self-assigned translation
review; it grants authority through the lead role instead of a task role.
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "lead_correction",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("assignments", "lead_correction", schema=SCHEMA)
