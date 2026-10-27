"""Exact personal work rounds and frozen human inputs; legacy payloads are untouched."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def upgrade() -> None:
    op.add_column(
        "drafts",
        sa.Column(
            "round_input_resolutions",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "assignments",
        sa.Column("active_round_id", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "assignments",
        sa.Column(
            "workflow_revision",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "work_rounds",
        sa.Column("round_id", sa.Text(), primary_key=True),
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
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("annotator_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=True),
        sa.Column(
            "predecessor_round_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.work_rounds.round_id"),
            nullable=True,
        ),
        sa.Column("input_manifest_sha256", sa.Text(), nullable=False),
        sa.Column("input_submission_ids", postgresql.JSONB(), nullable=False),
        sa.Column("workspace_key", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "round_id"),
        sa.ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "work_round_state",
        sa.Column(
            "round_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.work_rounds.round_id"),
            primary_key=True,
        ),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column(
            "revision", sa.BigInteger(), nullable=False, server_default=sa.text("1")
        ),
        sa.Column("latest_submission_id", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    for name, identity in (
        ("round_workspace_bindings", "workspace_key"),
        ("round_submission_bindings", "submission_id"),
    ):
        constraints = [
            sa.ForeignKeyConstraint(
                ["project_id", "round_id"],
                [f"{SCHEMA}.work_rounds.project_id", f"{SCHEMA}.work_rounds.round_id"],
            )
        ]
        if identity == "submission_id":
            constraints.append(
                sa.ForeignKeyConstraint(
                    ["project_id", "submission_id"],
                    [
                        f"{SCHEMA}.submissions.project_id",
                        f"{SCHEMA}.submissions.submission_id",
                    ],
                )
            )
        op.create_table(
            name,
            sa.Column("project_id", sa.BigInteger(), primary_key=True),
            sa.Column(identity, sa.Text(), primary_key=True),
            sa.Column("round_id", sa.Text(), nullable=False),
            *constraints,
            schema=SCHEMA,
        )
    op.create_table(
        "round_inputs",
        sa.Column("input_id", sa.Text(), primary_key=True),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("round_id", sa.Text(), nullable=False),
        sa.Column("source_submission_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id", "round_id"],
            [f"{SCHEMA}.work_rounds.project_id", f"{SCHEMA}.work_rounds.round_id"],
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "source_submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "workflow_command_receipts",
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            primary_key=True,
        ),
        sa.Column("actor_key", sa.Text(), primary_key=True),
        sa.Column("request_id", sa.Text(), primary_key=True),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("response", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "review_obligation_resolutions",
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            primary_key=True,
        ),
        sa.Column("cause_id", sa.Text(), primary_key=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "resolved_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        schema=SCHEMA,
    )
    for name in (
        "work_rounds",
        "round_workspace_bindings",
        "round_submission_bindings",
        "round_inputs",
        "workflow_command_receipts",
        "review_obligation_resolutions",
    ):
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.{name} FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {name}_no_truncate BEFORE TRUNCATE ON {SCHEMA}.{name} FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{name} TO {APP_ROLE}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.work_round_state TO {APP_ROLE}"
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
