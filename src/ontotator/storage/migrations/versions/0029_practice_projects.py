"""Practice projects (issue 266).

Purely additive: ``projects.practice`` (``NOT NULL DEFAULT false``; a
constant default, so PostgreSQL adds it without rewriting the table and every
existing project reads ``false``) and ``practice_projects`` (the owner of
each practice project). No existing row changes.

A practice project is deleted by ``delete_practice_project(project_id)``, a
``SECURITY DEFINER`` function of the schema owner: the application role has no
DELETE on the append-only history tables and gets none. The function refuses
any project whose ``practice`` flag is not set. It keeps the project's audit
events, detached from the project and marked ``practice``. The append-only
trigger function lets a row DELETE through only inside that function: while
``ontotator.practice_purge`` names the project being deleted, and only for a
row of that project, and only while the project is still flagged practice.
UPDATE and TRUNCATE stay forbidden. ``projects.practice`` is fixed at
insert by a trigger, without any bypass, and a ``practice_projects`` row must
name a practice project: rows of real projects can never be deleted this way.
"""

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"

_FORBID_ORIGINAL = f"""
CREATE OR REPLACE FUNCTION {SCHEMA}.forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ontotator: % on %.% is not allowed, the table is append-only',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$$
"""

_FORBID_WITH_PRACTICE = f"""
CREATE OR REPLACE FUNCTION {SCHEMA}.forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  purge text := coalesce(current_setting('ontotator.practice_purge', true), '');
BEGIN
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW' AND purge <> ''
     AND (to_jsonb(OLD) ->> 'project_id') = purge
     AND EXISTS (SELECT 1 FROM {SCHEMA}.projects p
                 WHERE p.id = purge::bigint AND p.practice) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ontotator: % on %.% is not allowed, the table is append-only',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$$
"""

# Rows without a project_id column hang on a project-scoped row; they go first.
# Every table with a project_id column is then emptied of the project's rows,
# children before parents (a pass retries the tables a foreign key still held).
_DELETE_PRACTICE = f"""
CREATE FUNCTION {SCHEMA}.delete_practice_project(p_project bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_key text;
  v_tables text[];
  v_left text[];
  v_table text;
  v_count bigint;
  v_counts jsonb := '{{}}'::jsonb;
BEGIN
  SELECT project_key INTO v_key FROM {SCHEMA}.projects
   WHERE id = p_project AND practice FOR UPDATE;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'ontotator: project % is not a practice project', p_project
      USING ERRCODE = '42501';
  END IF;
  -- The audit trail keeps its entries, marked practice, without the project.
  PERFORM set_config('ontotator.erasure', 'on', true);
  UPDATE {SCHEMA}.audit_events
     SET project_id = NULL,
         details = details || jsonb_build_object(
           'practice', true, 'practice_project_key', v_key)
   WHERE project_id = p_project;
  PERFORM set_config('ontotator.erasure', '', true);
  PERFORM set_config('ontotator.practice_purge', p_project::text, true);
  DELETE FROM {SCHEMA}.work_round_state WHERE round_id IN
    (SELECT round_id FROM {SCHEMA}.work_rounds WHERE project_id = p_project);
  DELETE FROM {SCHEMA}.task_hold_state WHERE hold_id IN
    (SELECT hold_id FROM {SCHEMA}.task_holds WHERE project_id = p_project);
  DELETE FROM {SCHEMA}.problem_report_state WHERE report_id IN
    (SELECT report_id FROM {SCHEMA}.problem_reports WHERE project_id = p_project);
  DELETE FROM {SCHEMA}.translation_review_drafts WHERE assignment_id IN
    (SELECT id FROM {SCHEMA}.assignments WHERE project_id = p_project);
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO v_tables
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = '{SCHEMA}' AND c.relkind IN ('r', 'p')
     AND a.attname = 'project_id' AND NOT a.attisdropped
     AND c.relname <> 'audit_events';
  LOOP
    v_left := '{{}}';
    FOREACH v_table IN ARRAY v_tables LOOP
      BEGIN
        EXECUTE format('DELETE FROM {SCHEMA}.%I WHERE project_id = $1', v_table)
          USING p_project;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count > 0 THEN
          v_counts := v_counts || jsonb_build_object(v_table, v_count);
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        v_left := v_left || v_table;
      END;
    END LOOP;
    EXIT WHEN cardinality(v_left) = 0;
    IF cardinality(v_left) = cardinality(v_tables) THEN
      RAISE EXCEPTION 'ontotator: practice project % still referenced from %',
        p_project, v_left;
    END IF;
    v_tables := v_left;
  END LOOP;
  DELETE FROM {SCHEMA}.projects WHERE id = p_project AND practice;
  PERFORM set_config('ontotator.practice_purge', '', true);
  RETURN v_counts;
END
$$
"""


# projects.practice is fixed when the row is inserted: no role (app or owner)
# can turn a real project into a practice project, or back, so the purge can
# never reach a real project's history. There is no bypass.
_FORBID_PRACTICE_CHANGE = f"""
CREATE FUNCTION {SCHEMA}.forbid_practice_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.practice IS DISTINCT FROM OLD.practice THEN
    RAISE EXCEPTION 'ontotator: projects.practice cannot change after insert'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$
"""

# A practice_projects row may only name a practice project.
_REQUIRE_PRACTICE_PROJECT = f"""
CREATE FUNCTION {SCHEMA}.require_practice_project() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM {SCHEMA}.projects p
                 WHERE p.id = NEW.project_id AND p.practice) THEN
    RAISE EXCEPTION 'ontotator: project % is not a practice project', NEW.project_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$
"""


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("practice", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )
    op.create_table(
        "practice_projects",
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=False,
        ),
        sa.Column(
            "consolidation", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("project_id", name="pk_practice_projects"),
        sa.UniqueConstraint("user_id", name="uq_practice_projects_user_id"),
        schema=SCHEMA,
    )
    # Inserted by the application; removed only by delete_practice_project.
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.practice_projects TO {APP_ROLE}")
    op.execute(_FORBID_WITH_PRACTICE)
    op.execute(_DELETE_PRACTICE)
    op.execute(_FORBID_PRACTICE_CHANGE)
    op.execute(
        f"CREATE TRIGGER projects_practice_fixed BEFORE UPDATE ON {SCHEMA}.projects"
        f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_practice_change()"
    )
    op.execute(_REQUIRE_PRACTICE_PROJECT)
    op.execute(
        f"CREATE TRIGGER practice_projects_practice_only"
        f" BEFORE INSERT OR UPDATE ON {SCHEMA}.practice_projects"
        f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.require_practice_project()"
    )
    op.execute(
        f"REVOKE ALL ON FUNCTION {SCHEMA}.delete_practice_project(bigint) FROM PUBLIC"
    )
    op.execute(
        f"GRANT EXECUTE ON FUNCTION {SCHEMA}.delete_practice_project(bigint)"
        f" TO {APP_ROLE}"
    )


def downgrade() -> None:
    # A practice project left behind would turn into a real one: refuse. The
    # flag counts, not practice_projects: a project without its owner row too.
    left = (
        op.get_bind()
        .execute(sa.text(f"SELECT count(*) FROM {SCHEMA}.projects WHERE practice"))
        .scalar_one()
    )
    if left:
        raise RuntimeError(
            f"{left} practice projects exist; delete them before downgrading."
        )
    op.execute(f"DROP FUNCTION {SCHEMA}.delete_practice_project(bigint)")
    op.execute(f"DROP TRIGGER projects_practice_fixed ON {SCHEMA}.projects")
    op.execute(f"DROP FUNCTION {SCHEMA}.forbid_practice_change()")
    op.execute(_FORBID_ORIGINAL)
    op.drop_table("practice_projects", schema=SCHEMA)
    op.execute(f"DROP FUNCTION {SCHEMA}.require_practice_project()")
    op.drop_column("projects", "practice", schema=SCHEMA)
