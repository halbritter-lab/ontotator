"""The project-scoped tables of a project archive and how they relate (#306).

One registry drives export, import and verification: ``ARCHIVED`` names each
table that belongs to one project and how its rows are found, ``EXCLUDED``
names the project-scoped tables an archive leaves out, each with its reason.
``tests/test_project_archive_registry.py`` fails when a table with a
``project_id`` column, or one reachable from such a table by a foreign key, is
in neither, so a new table cannot be forgotten.

Everything else is read from the mapped schema: a column named ``project_id``
holds the project, a foreign key to ``users.id`` a person, a foreign key to
the identity column of an archived table one of that table's rows (the
import renumbers it), a foreign key to ``sessions.id`` a login session of the
source server (left out). ``EXTRA_REFERENCES`` adds the few integer
references without a foreign key, in plain columns or inside JSON.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache

from sqlalchemy import Column, String, Table

from ontotator.storage.tables import Base

USERS = "users"
SESSIONS = "sessions"
PROJECTS = "projects"


@dataclass(frozen=True)
class ArchivedTable:
    """A table of the archive.

    ``parent`` is ``(column, table, parent column)`` for a table without a
    ``project_id``: its rows are those whose ``column`` is the ``parent
    column`` of a row of ``table`` in the project.
    """

    name: str
    parent: tuple[str, str, str] | None = None


@dataclass(frozen=True)
class ExtraReference:
    """An integer reference the schema does not declare.

    ``path`` is empty for the column itself, else the keys into its JSON
    value; the value found is an integer or a list of integers. ``target``
    is an archived table (its identity column) or ``users``. ``orphans``:
    a value without a row in the archive is kept, negated, so it can never
    meet a row the target server numbers later (edit events outlive purged
    drafts).
    """

    table: str
    column: str
    path: tuple[str, ...]
    target: str
    orphans: bool = False


# In foreign-key order is not required: the import sorts by the schema.
ARCHIVED: tuple[ArchivedTable, ...] = (
    ArchivedTable(PROJECTS),
    ArchivedTable("project_resources"),
    ArchivedTable("project_search_conditions"),
    ArchivedTable("project_ontologies"),
    ArchivedTable("project_memberships"),
    ArchivedTable("documents"),
    ArchivedTable("annotation_snapshots"),
    ArchivedTable("evidence_snapshots"),
    ArchivedTable("proposal_sets"),
    ArchivedTable("proposal_annotations"),
    ArchivedTable("proposal_evidence"),
    ArchivedTable("drafts"),
    ArchivedTable("draft_annotations", parent=("draft_id", "drafts", "id")),
    ArchivedTable("draft_evidence", parent=("draft_id", "drafts", "id")),
    ArchivedTable("review_decisions", parent=("draft_id", "drafts", "id")),
    ArchivedTable("edit_events"),
    ArchivedTable("submissions"),
    ArchivedTable("search_events"),
    ArchivedTable("jobs"),
    ArchivedTable("uploads"),
    ArchivedTable("assignments"),
    ArchivedTable("translation_reviews"),
    ArchivedTable(
        "translation_review_drafts", parent=("assignment_id", "assignments", "id")
    ),
    ArchivedTable("work_rounds"),
    ArchivedTable("work_round_state", parent=("round_id", "work_rounds", "round_id")),
    ArchivedTable("round_workspace_bindings"),
    ArchivedTable("round_submission_bindings"),
    ArchivedTable("round_inputs"),
    ArchivedTable("review_obligation_resolutions"),
    ArchivedTable("problem_reports"),
    ArchivedTable(
        "problem_report_state",
        parent=("report_id", "problem_reports", "report_id"),
    ),
    ArchivedTable("task_holds"),
    ArchivedTable("task_hold_state", parent=("hold_id", "task_holds", "hold_id")),
    ArchivedTable("problem_report_events"),
    ArchivedTable("guideline_versions"),
    ArchivedTable("guideline_contents"),
    ArchivedTable("guideline_withdrawals"),
    ArchivedTable("guideline_reads"),
    ArchivedTable("annotation_mode_changes"),
    ArchivedTable("discarded_submissions"),
    ArchivedTable("documents_visits"),
    ArchivedTable("text_change_resolutions"),
    ArchivedTable("draft_snapshots"),
    ArchivedTable("work_plans"),
    ArchivedTable("work_plan_rows"),
    ArchivedTable("translation_acceptances"),
    ArchivedTable("discarded_variants"),
    ArchivedTable("final_selections"),
    ArchivedTable("final_selection_events"),
    ArchivedTable("export_selection_snapshots"),
    ArchivedTable("audit_events"),
    # Working time (#298): append-only, inserted with their recorded times.
    ArchivedTable("work_time_events"),
    ArchivedTable("work_intervals"),
)

# Project-scoped tables an archive leaves out, with the reason.
EXCLUDED: dict[str, str] = {
    "mutation_receipts": (
        "replay receipts of editor requests on the source server; a retry"
        " never reaches another server"
    ),
    "workflow_command_receipts": (
        "replay receipts of workflow commands on the source server; a retry"
        " never reaches another server"
    ),
    "practice_projects": "practice projects are never archived",
    "api_tokens": (
        "secrets bound to the source server and its accounts; not portable,"
        " tokens are issued again on the target"
    ),
    "imported_people": (
        "server record of the pseudonym-only people an archive import created"
    ),
}

EXTRA_REFERENCES: tuple[ExtraReference, ...] = (
    # No foreign key since 0020: edit events outlive purged drafts.
    ExtraReference("edit_events", "draft_id", (), "drafts", orphans=True),
    ExtraReference(
        "annotation_mode_changes", "revoked_assignment_ids", (), "assignments"
    ),
    ExtraReference("final_selection_events", "payload", ("actor_id",), USERS),
    ExtraReference(
        "problem_report_events", "details", ("assignment_ids",), "assignments"
    ),
    ExtraReference(
        "round_inputs", "payload", ("source_draft_snapshot_id",), "draft_snapshots"
    ),
    # No foreign key: working time outlives purged work, as edit events do.
    ExtraReference(
        "work_time_events", "assignment_id", (), "assignments", orphans=True
    ),
    ExtraReference("work_intervals", "assignment_id", (), "assignments", orphans=True),
)

# Integer columns named like references that are plain values.
PLAIN_INTEGER_COLUMNS: frozenset[tuple[str, str]] = frozenset()


def archived_names() -> tuple[str, ...]:
    return tuple(entry.name for entry in ARCHIVED)


def table(name: str) -> Table:
    return Base.metadata.tables[f"{Base.metadata.schema}.{name}"]


def all_tables() -> dict[str, Table]:
    return {t.name: t for t in Base.metadata.tables.values()}


def project_scoped(
    tables: dict[str, set[str]], columns: dict[str, set[str]]
) -> set[str]:
    """Tables with a ``project_id`` or a foreign key into such a table.

    ``tables`` maps each table to the tables its foreign keys refer to,
    ``columns`` to its column names.
    """
    scoped = {name for name, names in columns.items() if "project_id" in names}
    changed = True
    while changed:
        changed = False
        for name, targets in tables.items():
            if name not in scoped and targets & scoped:
                scoped.add(name)
                changed = True
    return scoped


def identity_column(t: Table) -> Column[int] | None:
    """The generated integer column the import renumbers, if any."""
    for column in t.columns:
        if column.identity is not None:
            return column
    return None


@dataclass(frozen=True)
class ColumnRole:
    """How the import treats one column."""

    kind: str  # project, person, session, row, identity, plain
    target: str | None = None


@cache
def column_roles(name: str) -> dict[str, ColumnRole]:
    """The role of every column of an archived table, read from the schema."""
    t = table(name)
    archived = set(archived_names())
    identities = {
        n: ident for n in archived if (ident := identity_column(table(n))) is not None
    }
    roles: dict[str, ColumnRole] = {}
    for column in t.columns:
        role = ColumnRole("plain")
        if column.name == "project_id" and name != PROJECTS:
            role = ColumnRole("project")
        elif column.identity is not None:
            role = ColumnRole("identity", name)
        else:
            for fk in column.foreign_keys:
                target = fk.column.table.name
                if target == USERS:
                    role = ColumnRole("person")
                elif target == SESSIONS:
                    role = ColumnRole("session")
                elif target == PROJECTS and fk.column.name == "id":
                    role = ColumnRole("project")
                elif (ident := identities.get(target)) is not None and (
                    fk.column.name == ident.name
                ):
                    role = ColumnRole("row", target)
        roles[column.name] = role
    for extra in EXTRA_REFERENCES:
        if extra.table == name and not extra.path:
            roles[extra.column] = ColumnRole("row", extra.target)
    return roles


def global_ids() -> list[tuple[str, str]]:
    """(table, column) of the text ids unique across the server, not per
    project (rounds, problem reports, ...): an import of an archive this
    server already holds gives them new values."""
    found = []
    for entry in ARCHIVED:
        if entry.parent is not None:
            continue
        key = list(table(entry.name).primary_key.columns)
        if (
            len(key) == 1
            and key[0].identity is None
            and key[0].name != "project_id"
            and isinstance(key[0].type, String)
        ):
            found.append((entry.name, key[0].name))
    return found


def insert_order() -> list[str]:
    """Archived tables, each after the tables it refers to (foreign keys and
    ``EXTRA_REFERENCES``), otherwise in schema order."""
    archived = set(archived_names())
    order = [t.name for t in Base.metadata.sorted_tables if t.name in archived]
    needs: dict[str, set[str]] = {name: set() for name in order}
    for name in order:
        for fk in table(name).foreign_keys:
            target = fk.column.table.name
            if target in archived and target != name:
                needs[name].add(target)
    for extra in EXTRA_REFERENCES:
        if extra.target in archived:
            needs[extra.table].add(extra.target)
    done: list[str] = []
    while len(done) < len(order):
        ready = [n for n in order if n not in done and needs[n] <= set(done)]
        if not ready:
            raise RuntimeError(f"Archived tables refer to each other: {needs}")
        done.append(ready[0])
    return done


def self_references(name: str) -> Iterator[tuple[list[str], list[str]]]:
    """(columns, referred columns) of each foreign key of a table to itself."""
    for constraint in table(name).foreign_key_constraints:
        if constraint.referred_table.name == name:
            yield (
                [c.name for c in constraint.columns],
                [e.column.name for e in constraint.elements],
            )
