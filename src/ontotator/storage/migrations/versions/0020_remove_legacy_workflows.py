"""Remove legacy workflows (D1): annotation review, ``assisted``, keep both.

Deletes the assignable "Annotation review" tasks (task ``review`` without a
consolidation round), ``assisted`` drafts and submissions with the annotate
assignments bound to them, and consolidations that kept both findings, each
with its whole work (``storage.work_purge``); converts ``assisted`` and
``review`` mode preferences to ``independent``. Edit events stay as history,
so the ``edit_events.draft_id`` foreign key is dropped first. Irreversible: the
downgrade restores no work (back up the database before upgrading).
"""

import logging

from alembic import op

from ontotator.storage.work_purge import purge_legacy

SCHEMA = "ontotator"
FK = "fk_edit_events_draft_id"
# The purged tables as of this revision (leaf first), frozen: tables added to
# the live purge list later do not exist yet when this migration runs.
TABLES = (
    "task_hold_state",
    "task_holds",
    "problem_report_events",
    "problem_report_state",
    "problem_reports",
    "text_change_resolutions",
    "final_selection_events",
    "final_selections",
    "export_selection_snapshots",
    "workflow_command_receipts",
    "review_obligation_resolutions",
    "round_inputs",
    "round_submission_bindings",
    "round_workspace_bindings",
    "work_round_state",
    "work_rounds",
    "drafts",
    "draft_snapshots",
    "submissions",
    "assignments",
)

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(FK, "edit_events", schema=SCHEMA)
    counts = purge_legacy(op.get_bind(), TABLES)
    # WARNING reaches stderr without any logging setup (M1 records the line).
    logging.getLogger("ontotator.migrations").warning("0020 legacy purge: %s", counts)


def downgrade() -> None:
    """The purged work is gone; the foreign key comes back NOT VALID, because
    edit events of purged drafts may point at no draft any more."""
    op.create_foreign_key(
        FK,
        "edit_events",
        "drafts",
        ["draft_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        postgresql_not_valid=True,
    )
