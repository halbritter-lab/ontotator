"""Work plans per language version, translation acceptances and discards.

Existing projects are migrated flag by flag (spec D23): a flag forced on by
existing work is on, any other flag takes the import default "Review and
annotate all translations".
"""

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"

# A language row is (project_id, case_id, language) of the documents; it is a
# source row when it holds a native document.
MIGRATE_ROWS = f"""
WITH lang AS (
  SELECT project_id, case_id, language, bool_or(origin = 'native') AS is_source
  FROM {SCHEMA}.documents
  GROUP BY project_id, case_id, language
),
cases AS (
  SELECT project_id, case_id, bool_or(NOT is_source) AS translated
  FROM lang GROUP BY project_id, case_id
),
work AS (
  SELECT l.project_id, l.case_id, l.language, l.is_source, c.translated,
    EXISTS (
      SELECT 1 FROM {SCHEMA}.assignments a
      JOIN {SCHEMA}.documents d
        ON d.project_id = a.project_id AND d.document_id = a.document_id
      WHERE d.project_id = l.project_id AND d.case_id = l.case_id
        AND d.language = l.language AND a.task = 'translation_review'
    ) OR EXISTS (
      SELECT 1 FROM {SCHEMA}.translation_reviews t
      JOIN {SCHEMA}.documents d
        ON d.project_id = t.project_id AND d.document_id = t.document_id
      WHERE d.project_id = l.project_id AND d.case_id = l.case_id
        AND d.language = l.language
    ) AS review_work,
    EXISTS (
      SELECT 1 FROM {SCHEMA}.assignments a
      JOIN {SCHEMA}.documents d
        ON d.project_id = a.project_id AND d.document_id = a.document_id
      WHERE d.project_id = l.project_id AND d.case_id = l.case_id
        AND d.language = l.language AND a.task IN ('annotate', 'review')
    ) OR EXISTS (
      SELECT 1 FROM {SCHEMA}.submissions s
      JOIN {SCHEMA}.documents d
        ON d.project_id = s.project_id AND d.document_id = s.document_id
      WHERE d.project_id = l.project_id AND d.case_id = l.case_id
        AND d.language = l.language
    ) OR EXISTS (
      SELECT 1 FROM {SCHEMA}.final_selections f
      WHERE f.project_id = l.project_id AND f.case_id = l.case_id
        AND f.language = l.language
    ) AS annotation_work
  FROM lang l JOIN cases c USING (project_id, case_id)
)
INSERT INTO {SCHEMA}.work_plan_rows (project_id, case_id, language, review, annotate)
SELECT project_id, case_id, language,
  -- default Review: translations on; other work without review work: off
  NOT is_source AND (review_work OR NOT annotation_work),
  -- default Annotate: translations on; a source only without a translation
  annotation_work OR NOT is_source OR NOT translated
FROM work
"""

MIGRATE_PLANS = f"""
INSERT INTO {SCHEMA}.work_plans (project_id, case_id, revision)
SELECT DISTINCT project_id, case_id, 1 FROM {SCHEMA}.work_plan_rows
"""

# The newest status event per document decides, as the Documents projection
# does: an override later followed by a translation review is not an
# accepted-without-review override any more.
MIGRATE_OVERRIDES = f"""
INSERT INTO {SCHEMA}.translation_acceptances
  (project_id, document_id, source, reason, accepted_by, accepted_at, upload_id)
SELECT e.project_id, e.target_id, 'override',
  COALESCE(NULLIF(btrim(e.details->>'reason'), ''), 'Accepted without review'),
  e.actor_user_id, e.at, NULL
FROM (
  SELECT DISTINCT ON (project_id, target_id)
    id, project_id, target_id, action, details, actor_user_id, at
  FROM {SCHEMA}.audit_events
  WHERE target_type = 'document' AND project_id IS NOT NULL
    AND action IN ('variant.status_override', 'translation.review')
  ORDER BY project_id, target_id, id DESC
) e
JOIN {SCHEMA}.documents d
  ON d.project_id = e.project_id AND d.document_id = e.target_id
WHERE e.action = 'variant.status_override' AND d.translation_status = 'accepted'
"""

AUDIT = f"""
INSERT INTO {SCHEMA}.audit_events
  (at, actor_user_id, actor_label, action, target_type, target_id, project_id, details)
SELECT now(), NULL, 'migration', 'work_plan.migrate', 'project', p.project_key, p.id,
  jsonb_build_object(
    'rows', count(r.id),
    'review', count(r.id) FILTER (WHERE r.review),
    'annotate', count(r.id) FILTER (WHERE r.annotate),
    'not_in_plan', count(r.id) FILTER (WHERE NOT r.review AND NOT r.annotate)
  )
FROM {SCHEMA}.projects p
LEFT JOIN {SCHEMA}.work_plan_rows r ON r.project_id = p.id
GROUP BY p.id, p.project_key
"""


def _id() -> sa.Column[Any]:
    return sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True)


def _fk(name: str, target: str, *, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.{target}"), nullable=nullable
    )


def _now(name: str) -> sa.Column[Any]:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _document_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["project_id", "document_id"],
        [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
    )


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "annotations_per_text",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "projects",
        sa.Column(
            "import_plan",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'review_and_annotate_translations'"),
        ),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_projects_annotations_per_text"),
        "projects",
        "annotations_per_text BETWEEN 1 AND 5",
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_projects_import_plan"),
        "projects",
        "import_plan IN ('nothing', 'review_and_annotate_translations')",
        schema=SCHEMA,
    )
    op.create_table(
        "work_plans",
        _id(),
        _fk("project_id", "projects.id"),
        sa.Column("case_id", sa.Text(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        _now("updated_at"),
        sa.UniqueConstraint("project_id", "case_id"),
        sa.CheckConstraint("revision >= 1", name="revision"),
        schema=SCHEMA,
    )
    op.create_table(
        "work_plan_rows",
        _id(),
        _fk("project_id", "projects.id"),
        sa.Column("case_id", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("review", sa.Boolean(), nullable=False),
        sa.Column("annotate", sa.Boolean(), nullable=False),
        sa.Column("restored_revision", sa.BigInteger(), nullable=True),
        _fk("updated_by", "users.id", nullable=True),
        _now("updated_at"),
        _now("created_at"),
        sa.UniqueConstraint("project_id", "case_id", "language"),
        schema=SCHEMA,
    )
    op.create_table(
        "translation_acceptances",
        _id(),
        _fk("project_id", "projects.id"),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        _fk("accepted_by", "users.id", nullable=True),
        _now("accepted_at"),
        _fk("upload_id", "uploads.id", nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        _document_fk(),
        sa.CheckConstraint("source IN ('package', 'lead', 'override')", name="source"),
        sa.CheckConstraint(
            "source = 'package' OR reason IS NOT NULL", name="reason_required"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_translation_acceptances_project_document",
        "translation_acceptances",
        ["project_id", "document_id"],
        schema=SCHEMA,
    )
    op.create_table(
        "discarded_variants",
        _id(),
        _fk("project_id", "projects.id"),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        _fk("discarded_by", "users.id"),
        _now("discarded_at"),
        _document_fk(),
        sa.UniqueConstraint("project_id", "document_id"),
        schema=SCHEMA,
    )
    for name in ("work_plans", "work_plan_rows"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.{name} TO {APP_ROLE}")
    for name in ("translation_acceptances", "discarded_variants"):
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{name} TO {APP_ROLE}")
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.{name} FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {name}_no_truncate BEFORE TRUNCATE ON {SCHEMA}.{name} FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
    for name in (
        "work_plans",
        "work_plan_rows",
        "translation_acceptances",
        "discarded_variants",
    ):
        op.execute(
            f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{name}_id_seq TO {APP_ROLE}"
        )

    op.execute(MIGRATE_ROWS)
    op.execute(MIGRATE_PLANS)
    op.execute(MIGRATE_OVERRIDES)
    op.execute(AUDIT)


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
