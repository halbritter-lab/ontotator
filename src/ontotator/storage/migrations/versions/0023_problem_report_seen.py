"""Problem report answers: when the reporter last opened their report.

``problem_report_state.reporter_seen_at`` (NULL = never opened since this
revision). A lead event after it shows "Answer to your report" on the
reporter's task in My tasks.
"""

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "problem_report_state",
        sa.Column("reporter_seen_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("problem_report_state", "reporter_seen_at", schema=SCHEMA)
