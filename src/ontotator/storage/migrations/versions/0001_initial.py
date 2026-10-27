"""Initial server schema: projects, documents, drafts, submissions, search events.

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
APPEND_ONLY = ("annotation_snapshots", "evidence_snapshots", "submissions")
MUTABLE = (
    "projects",
    "stored_files",
    "project_resources",
    "project_search_conditions",
    "documents",
    "proposal_annotations",
    "proposal_evidence",
    "drafts",
    "draft_annotations",
    "draft_evidence",
    "review_decisions",
    "search_events",
    "mutation_receipts",
)


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def _project_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["project_id"], [f"{SCHEMA}.projects.id"], name=f"fk_{table}_project_id"
    )


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("manifest", _jsonb(), nullable=False),
        sa.Column("manifest_sha256", sa.Text(), nullable=False),
        sa.Column("task_profile", _jsonb(), nullable=False),
        sa.Column("task_profile_sha256", sa.Text(), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
        sa.UniqueConstraint("project_key", name="uq_projects_project_key"),
        schema=SCHEMA,
    )
    op.create_table(
        "stored_files",
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("sha256", name="pk_stored_files"),
        schema=SCHEMA,
    )
    op.create_table(
        "project_resources",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("resource_path", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        _project_fk("project_resources"),
        sa.ForeignKeyConstraint(
            ["sha256"],
            [f"{SCHEMA}.stored_files.sha256"],
            name="fk_project_resources_sha256",
        ),
        sa.PrimaryKeyConstraint(
            "project_id", "resource_path", name="pk_project_resources"
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "project_search_conditions",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("conditions", _jsonb(), nullable=False),
        _project_fk("project_search_conditions"),
        sa.PrimaryKeyConstraint("project_id", name="pk_project_search_conditions"),
        schema=SCHEMA,
    )
    op.create_table(
        "documents",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("text_sha256", sa.Text(), nullable=False),
        sa.Column("source_text_sha256", sa.Text(), nullable=True),
        _project_fk("documents"),
        sa.PrimaryKeyConstraint("project_id", "document_id", name="pk_documents"),
        schema=SCHEMA,
    )
    for table, id_column in (
        ("annotation_snapshots", "annotation_id"),
        ("evidence_snapshots", "evidence_id"),
    ):
        op.create_table(
            table,
            sa.Column("project_id", sa.BigInteger(), nullable=False),
            sa.Column(id_column, sa.Text(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.Column("document_id", sa.Text(), nullable=False),
            sa.Column("payload", _jsonb(), nullable=False),
            sa.Column(
                "created_at", _ts(), server_default=sa.func.now(), nullable=False
            ),
            _project_fk(table),
            sa.PrimaryKeyConstraint(
                "project_id", id_column, "version", name=f"pk_{table}"
            ),
            schema=SCHEMA,
        )
    for table, id_column, snapshots in (
        ("proposal_annotations", "annotation_id", "annotation_snapshots"),
        ("proposal_evidence", "evidence_id", "evidence_snapshots"),
    ):
        op.create_table(
            table,
            sa.Column("project_id", sa.BigInteger(), nullable=False),
            sa.Column(id_column, sa.Text(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.ForeignKeyConstraint(
                ["project_id", id_column, "version"],
                [
                    f"{SCHEMA}.{snapshots}.project_id",
                    f"{SCHEMA}.{snapshots}.{id_column}",
                    f"{SCHEMA}.{snapshots}.version",
                ],
                name=f"fk_{table}_project_id_{id_column}_version",
            ),
            sa.PrimaryKeyConstraint(
                "project_id", id_column, "version", name=f"pk_{table}"
            ),
            schema=SCHEMA,
        )
    op.create_table(
        "drafts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("draft_key", sa.Text(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("annotator_id", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("scope_id", sa.Text(), nullable=False),
        sa.Column("target_set_id", sa.Text(), nullable=False),
        sa.Column("targets", _jsonb(), nullable=False),
        sa.Column(
            "revision", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "checked_layer_ids",
            _jsonb(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("updated_at", _ts(), nullable=False),
        _project_fk("drafts"),
        sa.PrimaryKeyConstraint("id", name="pk_drafts"),
        sa.UniqueConstraint(
            "project_id", "draft_key", name="uq_drafts_project_id_draft_key"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_drafts_project_annotator_document",
        "drafts",
        ["project_id", "annotator_id", "document_id"],
        schema=SCHEMA,
    )
    for table, id_column in (
        ("draft_annotations", "annotation_id"),
        ("draft_evidence", "evidence_id"),
    ):
        op.create_table(
            table,
            sa.Column("draft_id", sa.BigInteger(), nullable=False),
            sa.Column(id_column, sa.Text(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.ForeignKeyConstraint(
                ["draft_id"],
                [f"{SCHEMA}.drafts.id"],
                name=f"fk_{table}_draft_id",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint(
                "draft_id", id_column, "version", name=f"pk_{table}"
            ),
            schema=SCHEMA,
        )
    op.create_table(
        "review_decisions",
        sa.Column("draft_id", sa.BigInteger(), nullable=False),
        sa.Column("decision_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("target_version", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("replacement_id", sa.Text(), nullable=True),
        sa.Column("replacement_version", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reviewer_id", sa.Text(), nullable=False),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.ForeignKeyConstraint(
            ["draft_id"],
            [f"{SCHEMA}.drafts.id"],
            name="fk_review_decisions_draft_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("draft_id", "decision_id", name="pk_review_decisions"),
        schema=SCHEMA,
    )
    op.create_table(
        "submissions",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("submission_id", sa.Text(), nullable=False),
        sa.Column("local_key", sa.Text(), nullable=False),
        sa.Column("origin_key", sa.Text(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("annotator_id", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("recorded_at", _ts(), server_default=sa.func.now(), nullable=False),
        _project_fk("submissions"),
        sa.PrimaryKeyConstraint("project_id", "submission_id", name="pk_submissions"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_submissions_project_local_key",
        "submissions",
        ["project_id", "local_key"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_submissions_project_document",
        "submissions",
        ["project_id", "document_id"],
        schema=SCHEMA,
    )
    op.create_table(
        "search_events",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("workspace_key", sa.Text(), nullable=False),
        sa.Column("local_key", sa.Text(), nullable=False),
        sa.Column(
            "imported", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("annotation_id", sa.Text(), nullable=False),
        sa.Column("layer_id", sa.Text(), nullable=True),
        sa.Column("ontology_sha256", sa.Text(), nullable=True),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.Column("timestamp", sa.Text(), nullable=False),
        _project_fk("search_events"),
        sa.PrimaryKeyConstraint("project_id", "event_id", name="pk_search_events"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_search_events_project_local_key",
        "search_events",
        ["project_id", "local_key"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_search_events_project_workspace_key",
        "search_events",
        ["project_id", "workspace_key"],
        schema=SCHEMA,
    )
    op.create_table(
        "mutation_receipts",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_key", sa.Text(), nullable=False),
        sa.Column("mutation_id", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("response", _jsonb(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        _project_fk("mutation_receipts"),
        sa.PrimaryKeyConstraint(
            "project_id", "workspace_key", "mutation_id", name="pk_mutation_receipts"
        ),
        schema=SCHEMA,
    )

    # History cannot be rewritten: not by the application role (grants below)
    # and not by the owner either, short of dropping these triggers.
    op.execute(
        f"""
        CREATE FUNCTION {SCHEMA}.forbid_history_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'ontotator: % on %.% is not allowed, the table is append-only',
            TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '42501';
        END
        $$
        """
    )
    for table in APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE"
            f" ON {SCHEMA}.{table}"
            f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE"
            f" ON {SCHEMA}.{table}"
            f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )

    for table in MUTABLE:
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{table} TO {APP_ROLE}"
        )
    for table in APPEND_ONLY:
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{table} TO {APP_ROLE}")
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")
    op.execute(f"GRANT SELECT ON {SCHEMA}.alembic_version TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
