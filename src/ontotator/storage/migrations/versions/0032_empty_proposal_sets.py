"""Imported tool sets without any finding (PR 321, proposals.csv recall).

``empty_proposal_sets`` records, per text, a delivered tool set that holds no
annotation: the import keeps no ``proposal_sets`` row for it, but the tool
had the chance to propose there. Append-only like ``proposal_sets``; the
identity (project, bundle, set, document) makes a re-import a no-op.

Purely additive: one new, empty table. Texts imported before this migration
have no such record; nothing in the database names the empty sets they came
with, so there is no backfill.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "empty_proposal_sets"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("bundle_id", sa.Text(), nullable=True),
        sa.Column("manifest_sha256", sa.Text(), nullable=True),
        sa.Column("annotation_set_id", sa.Text(), nullable=False),
        sa.Column("set_kind", sa.Text(), nullable=False),
        sa.Column("actors", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("imported_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("job_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name=f"fk_{TABLE}_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
            name=f"fk_{TABLE}_project_id_document_id",
        ),
        sa.ForeignKeyConstraint(
            ["imported_by"], [f"{SCHEMA}.users.id"], name=f"fk_{TABLE}_imported_by"
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], [f"{SCHEMA}.jobs.id"], name=f"fk_{TABLE}_job_id"
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{TABLE}"),
        sa.UniqueConstraint(
            "project_id",
            "bundle_id",
            "annotation_set_id",
            "document_id",
            name=f"uq_{TABLE}_identity",
            postgresql_nulls_not_distinct=True,
        ),
        schema=SCHEMA,
    )
    op.execute(
        f"CREATE TRIGGER {TABLE}_append_only BEFORE UPDATE OR DELETE"
        f" ON {SCHEMA}.{TABLE} FOR EACH ROW"
        f" EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"CREATE TRIGGER {TABLE}_no_truncate BEFORE TRUNCATE"
        f" ON {SCHEMA}.{TABLE} FOR EACH STATEMENT"
        f" EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{TABLE} TO {APP_ROLE}")
    op.execute(f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{TABLE}_id_seq TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table(TABLE, schema=SCHEMA)
