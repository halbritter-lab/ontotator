"""Final selections: selection time, rule state and stable round acknowledgement ids."""

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
_ROUND = re.compile(r"^(SELECTED_ROUND_(?:ABANDONED|SUPERSEDED):[^:]+):\d+$")


def _rewrite(ack: str) -> str:
    """Only round ids lose their workflow revision; every other id is kept verbatim."""
    match = _ROUND.match(ack)
    return match.group(1) if match else ack


def upgrade() -> None:
    op.add_column(
        "final_selections",
        sa.Column("selected_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "final_selections",
        sa.Column("adjudicator_not_annotator", sa.Boolean(), nullable=True),
        schema=SCHEMA,
    )
    conn = op.get_bind()
    selections = conn.execute(
        sa.text(
            f"SELECT id, project_id, case_id, language, document_id, submission_id, updated_at, acknowledged_cause_ids FROM {SCHEMA}.final_selections"
        )
    ).all()
    for sel in selections:
        # Events are scoped by project: document ids are only unique per project.
        events = conn.execute(
            sa.text(
                f"SELECT payload, created_at FROM {SCHEMA}.final_selection_events "
                "WHERE project_id = :pid AND payload->>'case_id' = :case AND payload->>'language' = :lang ORDER BY id"
            ),
            {"pid": sel.project_id, "case": sel.case_id, "lang": sel.language},
        ).all()
        selected_at = sel.updated_at
        previous = None
        for event in events:
            current = (
                event.payload.get("document_id"),
                event.payload.get("submission_id"),
            )
            if current != previous:
                selected_at = event.created_at
                previous = current
        if previous != (sel.document_id, sel.submission_id):
            selected_at = sel.updated_at
        acks = sorted({_rewrite(a) for a in sel.acknowledged_cause_ids})
        conn.execute(
            sa.text(
                f"UPDATE {SCHEMA}.final_selections SET selected_at = :at, acknowledged_cause_ids = CAST(:acks AS jsonb) WHERE id = :id"
            ),
            {"at": selected_at, "acks": json.dumps(acks), "id": sel.id},
        )
    op.alter_column(
        "final_selections",
        "selected_at",
        nullable=False,
        server_default=sa.func.now(),
        schema=SCHEMA,
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
