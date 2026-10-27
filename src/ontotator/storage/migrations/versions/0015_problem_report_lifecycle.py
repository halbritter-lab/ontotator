"""Problem report lifecycle: withdrawn state and recorded hold releases."""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"

BACKFILL = f"""
UPDATE {SCHEMA}.task_hold_state AS s
SET released_at = m.created_at, released_by = m.actor_id,
    release_action = m.action, release_event_id = m.event_id
FROM (
  SELECT h.hold_id, e.event_id, e.created_at, e.actor_id, e.action
  FROM {SCHEMA}.task_holds h
  JOIN {SCHEMA}.task_hold_state hs ON hs.hold_id = h.hold_id AND NOT hs.active
  JOIN LATERAL (
    SELECT ev.event_id, ev.created_at, ev.actor_id, ev.action
    FROM {SCHEMA}.problem_report_events ev
    WHERE ev.report_id = h.report_id
      AND ev.action IN ('resume', 'restart')
      AND ev.created_at >= h.created_at
      AND ev.details -> 'assignment_ids' @> to_jsonb(h.assignment_id)
    ORDER BY ev.created_at, ev.event_id
    LIMIT 1
  ) e ON TRUE
) AS m
WHERE s.hold_id = m.hold_id
"""


def upgrade() -> None:
    op.add_column(
        "task_hold_state",
        sa.Column("released_at", sa.DateTime(timezone=True)),
        schema=SCHEMA,
    )
    op.add_column(
        "task_hold_state",
        sa.Column("released_by", sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.users.id")),
        schema=SCHEMA,
    )
    op.add_column(
        "task_hold_state", sa.Column("release_action", sa.Text()), schema=SCHEMA
    )
    op.add_column(
        "task_hold_state", sa.Column("release_event_id", sa.Text()), schema=SCHEMA
    )
    # Check constraints before the backfill; the deferred FK after it, since
    # pending deferred trigger events would block a later ALTER TABLE.
    op.create_check_constraint(
        op.f("ck_problem_report_state_state"),
        "problem_report_state",
        "state IN ('open', 'resolved', 'withdrawn')",
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_task_hold_state_release"),
        "task_hold_state",
        "(release_action IS NULL OR release_action IN ('resume', 'restart', 'withdraw'))"
        " AND (NOT active OR (released_at IS NULL AND release_event_id IS NULL))",
        schema=SCHEMA,
    )
    op.execute(BACKFILL)
    # Deferred: the event row is inserted after the release in one transaction.
    op.create_foreign_key(
        op.f("fk_task_hold_state_release_event"),
        "task_hold_state",
        "problem_report_events",
        ["release_event_id"],
        ["event_id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        deferrable=True,
        initially="DEFERRED",
    )
    op.create_index(
        "ix_problem_reports_project_assignment",
        "problem_reports",
        ["project_id", "assignment_id"],
        schema=SCHEMA,
    )
    op.create_index("ix_task_holds_report", "task_holds", ["report_id"], schema=SCHEMA)
    op.create_index(
        "ix_task_holds_assignment", "task_holds", ["assignment_id"], schema=SCHEMA
    )
    op.create_index(
        "ix_problem_report_events_report",
        "problem_report_events",
        ["report_id", "created_at"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
