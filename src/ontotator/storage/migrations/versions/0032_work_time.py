"""Annotation working time (issue 298).

``projects.record_working_time`` switches the recording on per project
(default off). ``work_time_events`` keeps the open and heartbeat events of a
task's work intervals as the server received them; ``work_intervals`` keeps
each closed interval once, with the server's start and end and why it ended.
Both are append-only like the edit log. ``assignment_id`` has no foreign key,
like ``edit_events.draft_id``: purging a unit of work keeps its working time
as history.

Purely additive: a column with a constant default and two new, empty tables.
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0030"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TASKS = "('annotate', 'translation_review')"
MODES = "('proposals', 'scratch', 'translation_review')"
END_REASONS = "('idle', 'hidden', 'manual_pause', 'closed', 'lost')"
TABLES = ("work_time_events", "work_intervals")


def _columns() -> list[sa.Column[Any]]:
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column("assignment_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=False,
        ),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("interval_id", sa.Text(), nullable=False),
    ]


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "record_working_time",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "work_time_events",
        *_columns(),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("client_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('open', 'heartbeat')", name="kind"),
        sa.CheckConstraint(f"task IN {TASKS}", name="task"),
        sa.CheckConstraint(f"mode IN {MODES}", name="mode"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_work_time_events_assignment_id_interval_id",
        "work_time_events",
        ["assignment_id", "interval_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "uq_work_time_events_open",
        "work_time_events",
        ["assignment_id", "interval_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'open'"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_work_time_events_project_id_user_id",
        "work_time_events",
        ["project_id", "user_id"],
        schema=SCHEMA,
    )
    op.create_table(
        "work_intervals",
        *_columns(),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_reason", sa.Text(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(f"task IN {TASKS}", name="task"),
        sa.CheckConstraint(f"mode IN {MODES}", name="mode"),
        sa.CheckConstraint(f"end_reason IN {END_REASONS}", name="end_reason"),
        sa.CheckConstraint("ended_at >= started_at", name="ordered"),
        sa.UniqueConstraint("assignment_id", "interval_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_work_intervals_project_id_document_id",
        "work_intervals",
        ["project_id", "document_id"],
        schema=SCHEMA,
    )
    for table in TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE"
            f" ON {SCHEMA}.{table} FOR EACH ROW"
            f" EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE"
            f" ON {SCHEMA}.{table} FOR EACH STATEMENT"
            f" EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{table} TO {APP_ROLE}")
        op.execute(
            f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{table}_id_seq TO {APP_ROLE}"
        )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table, schema=SCHEMA)
    op.drop_column("projects", "record_working_time", schema=SCHEMA)
