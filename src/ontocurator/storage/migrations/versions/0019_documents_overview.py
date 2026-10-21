"""Documents overview: decided plan rows, lead visits and text changes.

``work_plan_rows.decided`` is false only for rows the system wrote (no lead
``updated_by``) that are not in plan in a project importing with "Nothing
planned" (spec VD3); source rows stay decided (they show "not planned"). Text changes after annotation record their resolutions
and freeze drafts append-only; a round input comes from a submission or from
such a draft snapshot.
"""

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"
APPEND_ONLY = ("text_change_resolutions", "draft_snapshots")

BACKFILL_DECIDED = f"""
UPDATE {SCHEMA}.work_plan_rows SET decided = false
WHERE review = false AND annotate = false AND updated_by IS NULL
  AND project_id IN (SELECT id FROM {SCHEMA}.projects WHERE import_plan = 'nothing')
  AND NOT EXISTS (
    SELECT 1 FROM {SCHEMA}.documents d
    WHERE d.project_id = work_plan_rows.project_id
      AND d.case_id = work_plan_rows.case_id
      AND d.language = work_plan_rows.language
      AND d.origin = 'native')
"""


def _id() -> sa.Column[Any]:
    return sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True)


def _fk(
    name: str, target: str, *, nullable: bool = False, primary_key: bool = False
) -> sa.Column[Any]:
    return sa.Column(
        name,
        sa.BigInteger(),
        sa.ForeignKey(f"{SCHEMA}.{target}"),
        nullable=nullable,
        primary_key=primary_key,
    )


def _now(name: str) -> sa.Column[Any]:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _composite_fk(column: str, table: str, key: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["project_id", column],
        [f"{SCHEMA}.{table}.project_id", f"{SCHEMA}.{table}.{key}"],
    )


def upgrade() -> None:
    op.add_column(
        "work_plan_rows",
        sa.Column("decided", sa.Boolean(), nullable=False, server_default=sa.true()),
        schema=SCHEMA,
    )
    op.execute(BACKFILL_DECIDED)
    # Every writer states the value from now on.
    op.alter_column("work_plan_rows", "decided", server_default=None, schema=SCHEMA)

    op.create_table(
        "documents_visits",
        _fk("user_id", "users.id", primary_key=True),
        _fk("project_id", "projects.id", primary_key=True),
        sa.Column("baseline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "text_change_resolutions",
        _id(),
        _fk("project_id", "projects.id"),
        sa.Column("case_id", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("from_document_id", sa.Text(), nullable=False),
        sa.Column("to_document_id", sa.Text(), nullable=False),
        _fk("assignment_id", "assignments.id", nullable=True),
        sa.Column("submission_id", sa.Text(), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=False),
        sa.Column("round_id", sa.Text(), nullable=True),
        _fk("decided_by", "users.id", nullable=True),
        _now("decided_at"),
        _composite_fk("from_document_id", "documents", "document_id"),
        _composite_fk("to_document_id", "documents", "document_id"),
        _composite_fk("submission_id", "submissions", "submission_id"),
        _composite_fk("round_id", "work_rounds", "round_id"),
        sa.CheckConstraint(
            "resolution IN ('moved', 'finish_then_carry', 'withdrawn', 'carried',"
            " 'handed_over', 'dismissed')",
            name="resolution",
        ),
        sa.CheckConstraint(
            "num_nonnulls(assignment_id, submission_id) >= 1",
            name="assignment_or_submission",
        ),
        sa.UniqueConstraint("project_id", "assignment_id"),
        sa.UniqueConstraint(
            "project_id",
            "submission_id",
            "to_document_id",
            name="uq_text_change_resolutions_submission_target",
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "draft_snapshots",
        _id(),
        _fk("project_id", "projects.id"),
        _fk("assignment_id", "assignments.id"),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("workspace_key", sa.Text(), nullable=False),
        sa.Column("draft_revision", sa.BigInteger(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        _now("created_at"),
        _composite_fk("document_id", "documents", "document_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_draft_snapshots_project_assignment",
        "draft_snapshots",
        ["project_id", "assignment_id"],
        schema=SCHEMA,
    )

    op.alter_column(
        "round_inputs", "source_submission_id", nullable=True, schema=SCHEMA
    )
    op.add_column(
        "round_inputs",
        sa.Column("source_draft_snapshot_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        op.f("fk_round_inputs_source_draft_snapshot_id"),
        "round_inputs",
        "draft_snapshots",
        ["source_draft_snapshot_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
    op.create_index(
        "ix_round_inputs_source_draft_snapshot_id",
        "round_inputs",
        ["source_draft_snapshot_id"],
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_round_inputs_one_source"),
        "round_inputs",
        "num_nonnulls(source_submission_id, source_draft_snapshot_id) = 1",
        schema=SCHEMA,
    )

    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.documents_visits TO {APP_ROLE}"
    )
    for name in APPEND_ONLY:
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{name} TO {APP_ROLE}")
        op.execute(
            f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{name}_id_seq TO {APP_ROLE}"
        )
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.{name} FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {name}_no_truncate BEFORE TRUNCATE ON {SCHEMA}.{name} FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )


def downgrade() -> None:
    bound = op.get_bind().execute(
        sa.text(
            f"SELECT EXISTS (SELECT 1 FROM {SCHEMA}.round_inputs"
            " WHERE source_draft_snapshot_id IS NOT NULL)"
        )
    )
    if bound.scalar_one():
        raise RuntimeError(
            "Cannot downgrade: round inputs come from draft snapshots;"
            " their source would be lost"
        )
    rounds = op.get_bind().execute(
        sa.text(
            f"SELECT EXISTS (SELECT 1 FROM {SCHEMA}.work_rounds"
            " WHERE kind IN ('text_change', 'handover'))"
        )
    )
    if rounds.scalar_one():
        raise RuntimeError(
            "Cannot downgrade: text-change or handover rounds exist;"
            " the previous revision does not know them"
        )
    # No round input uses a snapshot, so dropping the text_change_resolutions
    # and draft_snapshots rows below is intended (nothing depends on them).
    op.drop_constraint(
        op.f("ck_round_inputs_one_source"), "round_inputs", schema=SCHEMA
    )
    op.drop_constraint(
        op.f("fk_round_inputs_source_draft_snapshot_id"),
        "round_inputs",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_round_inputs_source_draft_snapshot_id",
        table_name="round_inputs",
        schema=SCHEMA,
    )
    op.drop_column("round_inputs", "source_draft_snapshot_id", schema=SCHEMA)
    op.alter_column(
        "round_inputs", "source_submission_id", nullable=False, schema=SCHEMA
    )
    for name in ("draft_snapshots", "text_change_resolutions", "documents_visits"):
        op.drop_table(name, schema=SCHEMA)
    op.drop_column("work_plan_rows", "decided", schema=SCHEMA)
