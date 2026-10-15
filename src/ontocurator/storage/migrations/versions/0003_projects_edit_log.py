"""Projects and the edit log: memberships, edit events, submission references.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column(
        "projects", sa.Column("description", sa.Text(), nullable=True), schema=SCHEMA
    )

    op.create_table(
        "project_memberships",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("added_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("added_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name="fk_project_memberships_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{SCHEMA}.users.id"], name="fk_project_memberships_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["added_by"],
            [f"{SCHEMA}.users.id"],
            name="fk_project_memberships_added_by",
        ),
        sa.PrimaryKeyConstraint(
            "project_id", "user_id", "role", name="pk_project_memberships"
        ),
        sa.CheckConstraint(
            "role IN ('lead', 'annotator', 'adjudicator')",
            name="ck_project_memberships_role",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_project_memberships_user_id",
        "project_memberships",
        ["user_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "edit_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("draft_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("session_id", sa.BigInteger(), nullable=True),
        sa.Column("at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("mutation_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("command", _jsonb(), nullable=False),
        sa.Column("revision_before", sa.Integer(), nullable=False),
        sa.Column("revision_after", sa.Integer(), nullable=False),
        sa.Column("state", _jsonb(), nullable=False),
        sa.Column("submission_id", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"], [f"{SCHEMA}.projects.id"], name="fk_edit_events_project_id"
        ),
        sa.ForeignKeyConstraint(
            ["draft_id"], [f"{SCHEMA}.drafts.id"], name="fk_edit_events_draft_id"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{SCHEMA}.users.id"], name="fk_edit_events_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id"], name="fk_edit_events_session_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_edit_events"),
        sa.CheckConstraint("kind IN ('edit', 'submit')", name="ck_edit_events_kind"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_edit_events_project_id_draft_id_id",
        "edit_events",
        ["project_id", "draft_id", "id"],
        schema=SCHEMA,
    )

    # A nullable column added by the owner; the append-only trigger of
    # submissions fires on row changes only.
    op.add_column(
        "submissions",
        sa.Column("last_edit_event_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_submissions_last_edit_event_id",
        "submissions",
        "edit_events",
        ["last_edit_event_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )

    # The edit log is history: the same triggers as in 0001.
    op.execute(
        f"CREATE TRIGGER edit_events_append_only BEFORE UPDATE OR DELETE"
        f" ON {SCHEMA}.edit_events"
        f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"CREATE TRIGGER edit_events_no_truncate BEFORE TRUNCATE"
        f" ON {SCHEMA}.edit_events"
        f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.project_memberships"
        f" TO {APP_ROLE}"
    )
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.edit_events TO {APP_ROLE}")
    # The identity sequence of edit_events needs the grant again.
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
