"""Variant identities and translation review storage.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    for name in ("case_id", "external_id"):
        op.add_column(
            "documents", sa.Column(name, sa.Text(), nullable=True), schema=SCHEMA
        )
    op.execute(
        f"UPDATE {SCHEMA}.documents SET case_id = document_id, external_id = document_id"
    )
    for name in ("case_id", "external_id"):
        op.alter_column("documents", name, nullable=False, schema=SCHEMA)
    for column in (
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "origin", sa.Text(), server_default=sa.text("'native'"), nullable=False
        ),
        sa.Column("derived_from", sa.Text(), nullable=True),
        sa.Column("translation", _jsonb(), nullable=True),
        sa.Column("translation_status", sa.Text(), nullable=True),
        sa.Column("status_reason", sa.Text(), nullable=True),
    ):
        op.add_column("documents", column, schema=SCHEMA)
    for name, clause in (
        ("version", "version >= 1"),
        (
            "origin",
            "origin IN ('native', 'machine_translation', 'human_translation', 'correction')",
        ),
        (
            "translation_status",
            "translation_status IN ('translated', 'automatic_check_failed', 'ready_for_review', 'reviewed', 'accepted')",
        ),
        (
            "translation_status_required",
            "origin NOT IN ('machine_translation', 'human_translation') OR translation_status IS NOT NULL",
        ),
    ):
        op.create_check_constraint(
            op.f(f"ck_documents_{name}"), "documents", clause, schema=SCHEMA
        )
    op.create_foreign_key(
        "fk_documents_project_id_derived_from",
        "documents",
        "documents",
        ["project_id", "derived_from"],
        ["project_id", "document_id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
    op.create_unique_constraint(
        "uq_documents_variant",
        "documents",
        ["project_id", "external_id", "language", "version"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_documents_project_id_case_id",
        "documents",
        ["project_id", "case_id"],
        schema=SCHEMA,
    )
    op.add_column(
        "users", sa.Column("qualification", sa.Text(), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "projects",
        sa.Column(
            "annotate_accepted_translations_only",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "proposal_sets",
        sa.Column(
            "origin", sa.Text(), server_default=sa.text("'import'"), nullable=False
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "proposal_sets",
        sa.Column(
            "pending_items",
            _jsonb(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        schema=SCHEMA,
    )
    op.alter_column("proposal_sets", "source_sha256", nullable=True, schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_proposal_sets_origin"),
        "proposal_sets",
        "origin IN ('import', 'reanchor')",
        schema=SCHEMA,
    )
    op.drop_constraint(
        op.f("ck_assignments_task"), "assignments", type_="check", schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_assignments_task"),
        "assignments",
        "task IN ('annotate', 'review', 'translation_review')",
        schema=SCHEMA,
    )
    op.create_table(
        "translation_reviews",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("assignment_id", sa.BigInteger(), nullable=False),
        sa.Column("reviewer_user_id", sa.BigInteger(), nullable=False),
        sa.Column("reviewer_pseudonym", sa.Text(), nullable=False),
        sa.Column("reviewer_qualification", sa.Text(), nullable=False),
        sa.Column("reviewer_languages", _jsonb(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("clinical_change", sa.Boolean(), nullable=False),
        sa.Column(
            "categories",
            _jsonb(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("machine_text_sha256", sa.Text(), nullable=False),
        sa.Column("proposed_text", sa.Text(), nullable=False),
        sa.Column("proposed_text_sha256", sa.Text(), nullable=False),
        sa.Column("status_before", sa.Text(), nullable=False),
        sa.Column("status_after", sa.Text(), nullable=False),
        sa.Column("created_variant_id", sa.Text(), nullable=True),
        sa.Column("review_policy", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_translation_reviews"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name="fk_translation_reviews_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
            name="fk_translation_reviews_project_id_document_id",
        ),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            [f"{SCHEMA}.assignments.id"],
            name="fk_translation_reviews_assignment_id",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_user_id"],
            [f"{SCHEMA}.users.id"],
            name="fk_translation_reviews_reviewer_user_id",
        ),
        sa.CheckConstraint(
            "decision IN ('accepted_unchanged', 'accepted_corrected', 'query', 'rejected')",
            name=op.f("ck_translation_reviews_decision"),
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_translation_reviews_project_id_document_id_id",
        "translation_reviews",
        ["project_id", "document_id", "id"],
        schema=SCHEMA,
    )
    op.create_table(
        "translation_review_drafts",
        sa.Column("assignment_id", sa.BigInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "form", _jsonb(), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column(
            "revision", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("assignment_id", name="pk_translation_review_drafts"),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            [f"{SCHEMA}.assignments.id"],
            name="fk_translation_review_drafts_assignment_id",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            [f"{SCHEMA}.users.id"],
            name="fk_translation_review_drafts_updated_by",
        ),
        schema=SCHEMA,
    )
    op.execute(
        f"CREATE TRIGGER translation_reviews_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.translation_reviews FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"CREATE TRIGGER translation_reviews_no_truncate BEFORE TRUNCATE ON {SCHEMA}.translation_reviews FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.translation_reviews TO {APP_ROLE}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.translation_review_drafts TO {APP_ROLE}"
    )
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
