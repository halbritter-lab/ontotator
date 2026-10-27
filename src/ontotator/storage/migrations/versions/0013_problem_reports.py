"""Whole-task holds and immutable problem reports/events."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("held", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )
    op.add_column(
        "assignments", sa.Column("hold_reason", sa.Text(), nullable=True), schema=SCHEMA
    )
    op.create_table(
        "problem_reports",
        sa.Column("report_id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.assignments.id"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=False,
        ),
        sa.Column("round_id", sa.Text()),
        sa.Column("submission_id", sa.Text()),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "problem_report_state",
        sa.Column(
            "report_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.problem_reports.report_id"),
            primary_key=True,
        ),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("resolution", sa.Text()),
        schema=SCHEMA,
    )
    op.create_table(
        "task_holds",
        sa.Column("hold_id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.assignments.id"),
            nullable=False,
        ),
        sa.Column(
            "report_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.problem_reports.report_id"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "task_hold_state",
        sa.Column(
            "hold_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.task_holds.hold_id"),
            primary_key=True,
        ),
        sa.Column("active", sa.Boolean(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "problem_report_events",
        sa.Column("event_id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column(
            "report_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.problem_reports.report_id"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=False,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("details", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        schema=SCHEMA,
    )
    for name in ("problem_reports", "task_holds", "problem_report_events"):
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.{name} FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {name}_no_truncate BEFORE TRUNCATE ON {SCHEMA}.{name} FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{name} TO ontotator_app")
    for name in ("problem_report_state", "task_hold_state"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.{name} TO ontotator_app")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
