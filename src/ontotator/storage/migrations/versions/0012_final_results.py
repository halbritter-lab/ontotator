"""Explicit final pointers and immutable selection/export audit snapshots."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "final_selections",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey("ontotator.projects.id"),
            nullable=False,
        ),
        sa.Column("case_id", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("submission_id", sa.Text(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column(
            "actor_id",
            sa.BigInteger(),
            sa.ForeignKey("ontotator.users.id"),
            nullable=False,
        ),
        sa.Column("acknowledged_cause_ids", JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("project_id", "case_id", "language"),
        schema="ontotator",
    )
    op.create_table(
        "final_selection_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey("ontotator.projects.id"),
            nullable=False,
        ),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema="ontotator",
    )
    op.create_table(
        "export_selection_snapshots",
        sa.Column("snapshot_id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey("ontotator.projects.id"),
            nullable=False,
        ),
        sa.Column(
            "requester_id",
            sa.BigInteger(),
            sa.ForeignKey("ontotator.users.id"),
            nullable=False,
        ),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("project_id", "requester_id", "request_id"),
        schema="ontotator",
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE ON ontotator.final_selections TO ontotator_app"
    )
    for table in ("final_selection_events", "export_selection_snapshots"):
        op.execute(f"GRANT SELECT, INSERT ON ontotator.{table} TO ontotator_app")
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON ontotator.{table} FOR EACH ROW EXECUTE FUNCTION ontotator.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON ontotator.{table} FOR EACH STATEMENT EXECUTE FUNCTION ontotator.forbid_history_change()"
        )
    for sequence in ("final_selections_id_seq", "final_selection_events_id_seq"):
        op.execute(
            f"GRANT USAGE, SELECT ON SEQUENCE ontotator.{sequence} TO ontotator_app"
        )


def downgrade() -> None:
    for table in (
        "export_selection_snapshots",
        "final_selection_events",
        "final_selections",
    ):
        op.drop_table(table, schema="ontotator")
