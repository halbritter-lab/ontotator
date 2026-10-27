"""User languages, project settings, assignments and uploads.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "user_languages",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name="fk_user_languages_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "language", name="pk_user_languages"),
        sa.CheckConstraint(
            "language ~ '^[a-z]{2}$'", name=op.f("ck_user_languages_language")
        ),
        schema=SCHEMA,
    )
    for column in (
        sa.Column(
            "languages", _jsonb(), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("guideline_url", sa.Text(), nullable=True),
        sa.Column("guideline_version", sa.Text(), nullable=True),
        sa.Column(
            "require_chosen_axes",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "adjudicator_not_annotator",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "contiguous_mentions_only",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "hidden_axis_values",
            _jsonb(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("updated_at", _ts(), server_default=sa.func.now(), nullable=False),
    ):
        op.add_column("projects", column, schema=SCHEMA)

    op.create_table(
        "assignments",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'open'"), nullable=False
        ),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", _ts(), nullable=True),
        sa.Column("revoked_by", sa.BigInteger(), nullable=True),
        sa.Column("last_submission_id", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"], [f"{SCHEMA}.projects.id"], name="fk_assignments_project_id"
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
            name="fk_assignments_project_id_document_id",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{SCHEMA}.users.id"], name="fk_assignments_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], [f"{SCHEMA}.users.id"], name="fk_assignments_created_by"
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by"], [f"{SCHEMA}.users.id"], name="fk_assignments_revoked_by"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_assignments"),
        sa.CheckConstraint(
            "task IN ('annotate', 'review')", name=op.f("ck_assignments_task")
        ),
        sa.CheckConstraint(
            "status IN ('open', 'in_progress', 'submitted', 'reopened')",
            name=op.f("ck_assignments_status"),
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "uq_assignments_active",
        "assignments",
        ["project_id", "document_id", "user_id", "task"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_assignments_project_id_user_id",
        "assignments",
        ["project_id", "user_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_assignments_project_id_document_id",
        "assignments",
        ["project_id", "document_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "uploads",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("files", _jsonb(), nullable=False),
        sa.Column("language", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("preview", _jsonb(), nullable=True),
        sa.Column("plan_sha256", sa.Text(), nullable=True),
        sa.Column("preview_job_id", sa.BigInteger(), nullable=True),
        sa.Column("commit_job_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"], [f"{SCHEMA}.projects.id"], name="fk_uploads_project_id"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], [f"{SCHEMA}.users.id"], name="fk_uploads_created_by"
        ),
        sa.ForeignKeyConstraint(
            ["preview_job_id"], [f"{SCHEMA}.jobs.id"], name="fk_uploads_preview_job_id"
        ),
        sa.ForeignKeyConstraint(
            ["commit_job_id"], [f"{SCHEMA}.jobs.id"], name="fk_uploads_commit_job_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_uploads"),
        sa.CheckConstraint("kind IN ('t1', 'text')", name=op.f("ck_uploads_kind")),
        sa.CheckConstraint(
            "status IN ('previewing', 'ready', 'invalid', 'committing', 'committed', 'failed', 'discarded')",
            name=op.f("ck_uploads_status"),
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_uploads_project_id_created_at",
        "uploads",
        ["project_id", "created_at"],
        schema=SCHEMA,
    )
    for table in ("user_languages", "projects", "assignments", "uploads"):
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{table} TO {APP_ROLE}"
        )
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
