"""Delete a project without work (issue 191).

Purely additive: one ``SECURITY DEFINER`` function of the schema owner,
``delete_empty_project(project_id)``, executable by the application role.
No table, column or row changes, and no trigger changes: the function
deletes only rows of tables that are not append-only.

A project has work when any project-scoped table other than the setup
tables below holds a row of it, or an upload of it is committing or
committed. Texts, tool proposals, tasks, drafts, submissions, rounds,
work plans, guidelines, problem reports, final results, receipts of
workflow commands and working time are all work; so is any table added
later, since only the setup tables are named. The audit trail does not
count and is kept: its entries are detached from the project and name it
by key (``details.deleted_project_key``), since the id goes.

For a project without work the function deletes the setup rows
(memberships, ontology pins, resources, search conditions, uploads that
never committed, jobs, project API tokens, Documents visits, editor
receipts, imported people) and the project row; the key is free again. A
practice project is refused: it has its own ``delete_practice_project``.
The function returns ``{"deleted": false, "work": [tables]}`` without
changing anything when the project has work, so the caller can say why.
"""

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"

# Rows of these tables are setup, not work; uploads only while uncommitted.
# Deleted in this order (uploads name their jobs).
SETUP_TABLES = (
    "uploads",
    "jobs",
    "api_tokens",
    "documents_visits",
    "mutation_receipts",
    "imported_people",
    "project_search_conditions",
    "project_resources",
    "project_ontologies",
    "project_memberships",
)

_SETUP = ", ".join(f"'{name}'" for name in SETUP_TABLES)

_DELETE_EMPTY = f"""
CREATE FUNCTION {SCHEMA}.delete_empty_project(p_project bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_key text;
  v_setup text[] := ARRAY[{_SETUP}];
  v_table text;
  v_found boolean;
  v_work text[] := '{{}}';
  v_count bigint;
  v_counts jsonb := '{{}}'::jsonb;
BEGIN
  SELECT project_key INTO v_key FROM {SCHEMA}.projects
   WHERE id = p_project AND NOT practice FOR UPDATE;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'ontotator: project % is no real project', p_project
      USING ERRCODE = '42501';
  END IF;
  FOR v_table IN
    SELECT c.relname::text
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = '{SCHEMA}' AND c.relkind IN ('r', 'p')
       AND a.attname = 'project_id' AND NOT a.attisdropped
       AND c.relname <> 'audit_events'
       AND c.relname <> ALL (v_setup)
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM {SCHEMA}.%I WHERE project_id = $1)', v_table)
      INTO v_found USING p_project;
    IF v_found THEN
      v_work := v_work || v_table;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM {SCHEMA}.uploads WHERE project_id = p_project
              AND status IN ('committing', 'committed')) THEN
    v_work := v_work || 'uploads'::text;
  END IF;
  IF cardinality(v_work) > 0 THEN
    RETURN jsonb_build_object('deleted', false, 'work', to_jsonb(v_work));
  END IF;
  -- The audit trail keeps its entries, without the project, by key.
  PERFORM set_config('ontotator.erasure', 'on', true);
  UPDATE {SCHEMA}.audit_events
     SET project_id = NULL,
         details = details || jsonb_build_object('deleted_project_key', v_key)
   WHERE project_id = p_project;
  PERFORM set_config('ontotator.erasure', '', true);
  FOREACH v_table IN ARRAY v_setup LOOP
    EXECUTE format('DELETE FROM {SCHEMA}.%I WHERE project_id = $1', v_table)
      USING p_project;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;
  DELETE FROM {SCHEMA}.projects WHERE id = p_project AND NOT practice;
  RETURN jsonb_build_object('deleted', true, 'rows', v_counts);
END
$$
"""


def upgrade() -> None:
    op.execute(_DELETE_EMPTY)
    op.execute(
        f"REVOKE ALL ON FUNCTION {SCHEMA}.delete_empty_project(bigint) FROM PUBLIC"
    )
    op.execute(
        f"GRANT EXECUTE ON FUNCTION {SCHEMA}.delete_empty_project(bigint) TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.execute(f"DROP FUNCTION {SCHEMA}.delete_empty_project(bigint)")
