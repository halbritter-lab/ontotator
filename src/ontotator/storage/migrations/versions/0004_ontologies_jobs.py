"""Ontology files, project pins and jobs.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
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
        "ontology_files",
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("prefix", sa.Text(), nullable=False),
        sa.Column("release", sa.Text(), nullable=True),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.BigInteger(), nullable=True),
        sa.Column("uploaded_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["sha256"],
            [f"{SCHEMA}.stored_files.sha256"],
            name="fk_ontology_files_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            [f"{SCHEMA}.users.id"],
            name="fk_ontology_files_uploaded_by",
        ),
        sa.PrimaryKeyConstraint("sha256", name="pk_ontology_files"),
        sa.CheckConstraint(
            "kind IN ('ontology', 'translation')", name="ck_ontology_files_kind"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_ontology_files_prefix_kind",
        "ontology_files",
        ["prefix", "kind"],
        schema=SCHEMA,
    )

    op.create_table(
        "project_ontologies",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("ontology_id", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column(
            "allowed_roots",
            _jsonb(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "t1_profile",
            sa.Text(),
            server_default=sa.text("'generic'"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name="fk_project_ontologies_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["sha256"],
            [f"{SCHEMA}.ontology_files.sha256"],
            name="fk_project_ontologies_sha256",
        ),
        sa.PrimaryKeyConstraint(
            "project_id", "ontology_id", name="pk_project_ontologies"
        ),
        sa.CheckConstraint(
            "t1_profile IN ('generic', 'hpo-phenotype')",
            name="ck_project_ontologies_t1_profile",
        ),
        schema=SCHEMA,
    )

    for table in ("ontology_files", "project_ontologies"):
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{table} TO {APP_ROLE}"
        )

    op.create_table(
        "jobs",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("requested_by", sa.BigInteger(), nullable=True),
        sa.Column("requested_label", sa.Text(), nullable=False),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.Column("result", _jsonb(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", _ts(), nullable=True),
        sa.Column("finished_at", _ts(), nullable=True),
        sa.Column("worker", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"], [f"{SCHEMA}.projects.id"], name="fk_jobs_project_id"
        ),
        sa.ForeignKeyConstraint(
            ["requested_by"], [f"{SCHEMA}.users.id"], name="fk_jobs_requested_by"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_jobs"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')",
            name="ck_jobs_status",
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_jobs_status_id", "jobs", ["status", "id"], schema=SCHEMA)
    # Jobs are claimed and finished by updates; they are never deleted.
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.jobs TO {APP_ROLE}")

    # Imported annotation sets, kept as delivered (T7 O1, I1, I9).
    op.create_table(
        "proposal_sets",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("bundle_id", sa.Text(), nullable=True),
        sa.Column("manifest_sha256", sa.Text(), nullable=True),
        sa.Column("annotation_set_id", sa.Text(), nullable=False),
        sa.Column("set_kind", sa.Text(), nullable=False),
        sa.Column("actors", _jsonb(), nullable=False),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.Column("source_sha256", sa.Text(), nullable=False),
        sa.Column("imported_by", sa.BigInteger(), nullable=True),
        sa.Column("imported_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name="fk_proposal_sets_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
            name="fk_proposal_sets_project_id_document_id",
        ),
        sa.ForeignKeyConstraint(
            ["source_sha256"],
            [f"{SCHEMA}.stored_files.sha256"],
            name="fk_proposal_sets_source_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["imported_by"], [f"{SCHEMA}.users.id"], name="fk_proposal_sets_imported_by"
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], [f"{SCHEMA}.jobs.id"], name="fk_proposal_sets_job_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_proposal_sets"),
        sa.UniqueConstraint(
            "project_id",
            "bundle_id",
            "annotation_set_id",
            "document_id",
            name="uq_proposal_sets_identity",
            postgresql_nulls_not_distinct=True,
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "proposal_annotations",
        sa.Column("proposal_set_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "proposal_annotations",
        sa.Column(
            "notes", _jsonb(), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_proposal_annotations_proposal_set_id",
        "proposal_annotations",
        "proposal_sets",
        ["proposal_set_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
    op.create_index(
        "ix_proposal_annotations_project_id_proposal_set_id",
        "proposal_annotations",
        ["project_id", "proposal_set_id"],
        schema=SCHEMA,
    )
    op.execute(
        f"CREATE TRIGGER proposal_sets_append_only BEFORE UPDATE OR DELETE"
        f" ON {SCHEMA}.proposal_sets"
        f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"CREATE TRIGGER proposal_sets_no_truncate BEFORE TRUNCATE"
        f" ON {SCHEMA}.proposal_sets"
        f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.proposal_sets TO {APP_ROLE}")
    # The identity sequence of jobs needs the grant again.
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
