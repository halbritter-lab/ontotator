"""The project archive registry covers every project-scoped table (#306).

A table with a ``project_id`` column, or one reachable from such a table by a
foreign key, must be archived (``ARCHIVED``) or left out with a reason
(``EXCLUDED``). A new table, for example of a merged branch, fails here until
it is classified.
"""

from pathlib import Path

from pg_harness import database_for
from sqlalchemy import JSON, Integer, String, text

from ontotator.exchange.archive_tables import (
    ARCHIVED,
    EXCLUDED,
    EXTRA_REFERENCES,
    PLAIN_INTEGER_COLUMNS,
    PLAIN_TEXT_ID_COLUMNS,
    PSEUDONYM_COLUMNS,
    PSEUDONYM_LABEL_COLUMNS,
    TEXT_REFERENCES,
    WORKSPACE_KEY_COLUMNS,
    all_tables,
    archived_names,
    column_roles,
    global_ids,
    insert_order,
    project_scoped,
    table,
)
from ontotator.storage.tables import SCHEMA


def _mapped_scope() -> set[str]:
    tables = all_tables()
    return project_scoped(
        {
            name: {fk.column.table.name for fk in t.foreign_keys}
            for name, t in tables.items()
        },
        {name: {c.name for c in t.columns} for name, t in tables.items()},
    )


def test_every_project_scoped_mapped_table_is_archived_or_excluded() -> None:
    classified = set(archived_names()) | set(EXCLUDED)
    missing = sorted(_mapped_scope() - classified)
    assert not missing, (
        f"Project-scoped tables {missing} are neither in archive_tables.ARCHIVED"
        " nor in archive_tables.EXCLUDED (with a reason)."
    )


def test_every_project_scoped_table_of_the_migrated_schema_is_classified(
    tmp_path: Path,
) -> None:
    """The database itself, so a table only a migration creates is caught too."""
    db = database_for(tmp_path / "a.db")
    with db.engine.connect() as conn:
        columns: dict[str, set[str]] = {}
        for name, column in conn.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns"
                " WHERE table_schema = :s"
            ),
            {"s": SCHEMA},
        ):
            columns.setdefault(name, set()).add(column)
        references: dict[str, set[str]] = {name: set() for name in columns}
        for name, target in conn.execute(
            text(
                "SELECT src.relname, dst.relname FROM pg_constraint c"
                " JOIN pg_class src ON src.oid = c.conrelid"
                " JOIN pg_class dst ON dst.oid = c.confrelid"
                " JOIN pg_namespace n ON n.oid = src.relnamespace"
                " WHERE c.contype = 'f' AND n.nspname = :s"
            ),
            {"s": SCHEMA},
        ):
            references.setdefault(name, set()).add(target)
    columns.pop("alembic_version", None)
    references.pop("alembic_version", None)
    scoped = project_scoped(references, columns)
    classified = set(archived_names()) | set(EXCLUDED)
    assert sorted(scoped - classified) == []


def test_archived_and_excluded_tables_exist_and_do_not_overlap() -> None:
    names = archived_names()
    assert len(names) == len(set(names))
    assert not set(names) & set(EXCLUDED)
    for name in [*names, *EXCLUDED]:
        assert table(name) is not None
    assert all(reason.strip() for reason in EXCLUDED.values())
    # Only project-scoped tables: users, files and server state stay out.
    assert set(names) - {"projects"} <= _mapped_scope()


def test_tables_without_project_id_name_their_parent() -> None:
    for entry in ARCHIVED:
        columns = {c.name for c in table(entry.name).columns}
        if entry.name == "projects":
            continue
        if "project_id" in columns:
            assert entry.parent is None, entry.name
        else:
            assert entry.parent is not None, entry.name
            column, parent, parent_column = entry.parent
            assert column in columns
            assert parent in archived_names()
            assert parent_column in {c.name for c in table(parent).columns}


def test_every_integer_reference_column_has_a_role() -> None:
    """An integer ``*_id`` or ``*_by`` column is a foreign key the archive maps,
    an extra reference, or declared plain: a new reference is not copied blindly."""
    unclassified = []
    for name in archived_names():
        roles = column_roles(name)
        for column in table(name).columns:
            if not isinstance(column.type, Integer):
                continue
            if not (column.name.endswith("_id") or column.name.endswith("_by")):
                continue
            if roles[column.name].kind == "plain" and (
                (name, column.name) not in PLAIN_INTEGER_COLUMNS
            ):
                unclassified.append(f"{name}.{column.name}")
    assert unclassified == []


def test_every_text_reference_must_name_a_row_of_the_archive() -> None:
    """A text id that can name a row of another project here (a foreign key
    without the project, or a column named like a server-wide id) has the
    ``key`` role, which the import checks against the archive, or is declared
    plain: a new reference is not copied blindly (#325 review)."""
    archived = set(archived_names())
    server_wide = {column for _, column in global_ids()}
    unclassified = []
    for name in archived_names():
        roles = column_roles(name)
        own_key = {c.name for c in table(name).primary_key.columns}
        for column in table(name).columns:
            if (name, column.name) in PLAIN_TEXT_ID_COLUMNS:
                continue
            scoped = {
                "project_id" in {c.name for c in fk.constraint.columns}
                for fk in column.foreign_keys
                if fk.column.table.name in archived
            }
            named_like = column.name not in own_key and any(
                column.name == key or column.name.endswith(f"_{key}")
                for key in server_wide
            )
            # A foreign key with the project: the database keeps it inside.
            if (False in scoped or (named_like and True not in scoped)) and roles[
                column.name
            ].kind not in {"key", "row"}:
                unclassified.append(f"{name}.{column.name}")
    assert unclassified == []
    for (name, column), (target, referred) in TEXT_REFERENCES.items():
        assert column_roles(name)[column].kind == "key"
        assert referred in {c.name for c in table(target).columns}
    assert column_roles("problem_report_events")["report_id"].kind == "key"
    assert column_roles("task_hold_state")["release_event_id"].kind == "key"


def test_extra_references_name_archived_columns() -> None:
    for extra in EXTRA_REFERENCES:
        assert extra.table in archived_names()
        assert extra.column in {c.name for c in table(extra.table).columns}
        assert extra.target in {*archived_names(), "users"}


def test_insert_order_puts_referred_tables_first() -> None:
    order = insert_order()
    assert sorted(order) == sorted(archived_names())
    assert order[0] == "projects"
    position = {name: index for index, name in enumerate(order)}
    for name in order:
        for fk in table(name).foreign_keys:
            target = fk.column.table.name
            if target in position and target != name:
                assert position[target] < position[name], (name, target)
    for extra in EXTRA_REFERENCES:
        # A job names the job it came from: inserted in id order instead.
        if extra.target in position and extra.target != extra.table:
            assert position[extra.target] < position[extra.table]


def test_every_column_that_can_name_a_person_is_classified() -> None:
    """A text column named like an annotator id, pseudonym, workspace key or
    person label is one ``--rename-pseudonyms`` knows; any other text column
    is free text it never changes."""
    classified = PSEUDONYM_COLUMNS | PSEUDONYM_LABEL_COLUMNS | WORKSPACE_KEY_COLUMNS
    looks_like = ("annotator", "reviewer_id", "pseudonym", "workspace_key", "_by_label")
    unclassified = [
        f"{name}.{column.name}"
        for name in archived_names()
        if name != "audit_events"
        for column in table(name).columns
        if isinstance(column.type, String)
        and not isinstance(column.type, JSON)
        and any(part in column.name for part in looks_like)
        and (name, column.name) not in classified
    ]
    assert unclassified == []
    for name, column in classified:
        assert column in {c.name for c in table(name).columns}, (name, column)
