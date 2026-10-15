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

SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"


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


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
