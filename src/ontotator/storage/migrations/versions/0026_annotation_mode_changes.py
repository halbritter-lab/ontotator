"""Annotation-mode changes after submissions (#109).

``annotation_mode_changes`` records a lead's change of a text's annotation
mode that discarded submitted work, ``discarded_submissions`` marks each
discarded submission (who, when, why, which change). Submissions stay
append-only: a restore deletes the marks and stamps the change restored.
"""

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
MODES = "('proposals', 'scratch')"


def _user(name: str, *, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=nullable
    )


def _now(name: str) -> sa.Column[Any]:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    op.create_table(
        "annotation_mode_changes",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column("case_id", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("from_mode", sa.Text(), nullable=False),
        sa.Column("to_mode", sa.Text(), nullable=False),
        sa.Column("previous_override", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "revoked_assignment_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        _user("changed_by"),
        _now("changed_at"),
        sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True),
        _user("restored_by", nullable=True),
        sa.CheckConstraint(f"from_mode IN {MODES}", name="from_mode"),
        sa.CheckConstraint(f"to_mode IN {MODES}", name="to_mode"),
        sa.CheckConstraint(
            f"previous_override IS NULL OR previous_override IN {MODES}",
            name="previous_override",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_annotation_mode_changes_project_id_case_id_language",
        "annotation_mode_changes",
        ["project_id", "case_id", "language"],
        schema=SCHEMA,
    )
    op.create_table(
        "discarded_submissions",
        sa.Column("project_id", sa.BigInteger(), primary_key=True),
        sa.Column("submission_id", sa.Text(), primary_key=True),
        sa.Column(
            "change_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.annotation_mode_changes.id"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        _user("discarded_by"),
        _now("discarded_at"),
        sa.ForeignKeyConstraint(
            ["project_id", "submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_discarded_submissions_change_id",
        "discarded_submissions",
        ["change_id"],
        schema=SCHEMA,
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.annotation_mode_changes"
        f" TO {APP_ROLE}"
    )
    op.execute(
        f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.annotation_mode_changes_id_seq"
        f" TO {APP_ROLE}"
    )
    # A restore removes the marks; the submissions themselves never change.
    op.execute(
        f"GRANT SELECT, INSERT, DELETE ON {SCHEMA}.discarded_submissions TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.drop_table("discarded_submissions", schema=SCHEMA)
    op.drop_table("annotation_mode_changes", schema=SCHEMA)
