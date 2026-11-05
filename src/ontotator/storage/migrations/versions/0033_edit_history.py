"""Undo, redo and reset in the editor (issue 320).

Purely additive, two nullable columns, so no existing row changes:

- ``edit_events.step_id``: the commands of one user action share it (an edit
  and the review decision it updates), so undo takes them back as one step.
  NULL for every existing event and for single-command actions.
- ``drafts.initial_state``: the content a draft started with (carried
  findings, a resumed submission or nothing), as a ``DraftState``. "Reset all
  my changes" returns to it. NULL for drafts created before this revision;
  their start is computed again from the same inputs.

The downgrade drops both columns.

Follows 0032 (empty proposal sets).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "edit_events", sa.Column("step_id", sa.Text(), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "drafts", sa.Column("initial_state", JSONB(), nullable=True), schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_column("drafts", "initial_state", schema=SCHEMA)
    op.drop_column("edit_events", "step_id", schema=SCHEMA)
