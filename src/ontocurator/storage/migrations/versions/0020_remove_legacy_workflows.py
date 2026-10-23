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

from ontocurator.storage.work_purge import purge_legacy

SCHEMA = "ontocurator"
FK = "fk_edit_events_draft_id"

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(FK, "edit_events", schema=SCHEMA)
    counts = purge_legacy(op.get_bind())
    # WARNING reaches stderr without any logging setup (M1 records the line).
    logging.getLogger("ontocurator.migrations").warning("0020 legacy purge: %s", counts)


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
