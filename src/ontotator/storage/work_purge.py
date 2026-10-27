"""Delete whole units of annotation work (D1 legacy clean-up, D4 test resets).

Plain SQL on table names, no ORM models: migration 0020 imports this module
and must stay valid when the models change. A unit is an assignment with its
rounds, drafts, submissions, frozen drafts, reports, holds, text-change
resolutions and the final selections, export snapshots and command receipts
that point at its submissions or rounds. Work built on purged work (a round
whose inputs, bindings or predecessor are purged) is purged with it, until no
new ids appear. Audit and edit events stay as history: audit rows hold ids
only, and migration 0020 drops the ``edit_events.draft_id`` foreign key, so
edit events may point at a purged draft.

Runs as the schema owner: the append-only triggers of the tables it deletes
from are lifted for the transaction only.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import Connection, text

S = "ontotator"

# Leaf first; every table that references assignments, work_rounds, drafts,
# draft_snapshots or submissions.
_TABLES = (
    "task_hold_state",
    "task_holds",
    "problem_report_events",
    "problem_report_state",
    "problem_reports",
    "text_change_resolutions",
    "final_selection_events",
    "final_selections",
    "export_selection_snapshots",
    "workflow_command_receipts",
    "review_obligation_resolutions",
    "round_inputs",
    "round_submission_bindings",
    "round_workspace_bindings",
    "work_round_state",
    "work_rounds",
    "drafts",
    "draft_snapshots",
    "submissions",
    "assignments",
)

Sub = tuple[int, str]  # (project_id, submission_id)


def _ids(conn: Connection, sql: str, **params: Any) -> set[Any]:
    return {row[0] for row in conn.execute(text(sql), params)}


def _subs(conn: Connection, sql: str, **params: Any) -> set[Sub]:
    return {(row[0], row[1]) for row in conn.execute(text(sql), params)}


def _unzip(subs: Iterable[Sub]) -> dict[str, list[Any]]:
    items = sorted(subs)
    return {"sp": [p for p, _ in items], "ss": [s for _, s in items]}


_IN_SUBS = "(project_id, {col}) IN (SELECT * FROM unnest(CAST(:sp AS bigint[]), CAST(:ss AS text[])))"


def _closure(
    conn: Connection, assignments: set[int], subs: set[Sub], drafts: set[int]
) -> tuple[set[int], set[str], set[Sub], set[int]]:
    """Grow the seeds to whole units of work and the work built on them."""
    rounds: set[str] = set()
    while True:
        p = {"a": sorted(assignments), "r": sorted(rounds), "d": sorted(drafts)}
        p |= _unzip(subs)
        new_rounds = rounds | _ids(
            conn,
            f"SELECT round_id FROM {S}.work_rounds WHERE assignment_id = ANY(:a)"
            " OR predecessor_round_id = ANY(:r)"
            f" UNION SELECT round_id FROM {S}.round_submission_bindings"
            f" WHERE {_IN_SUBS.format(col='submission_id')}"
            f" UNION SELECT b.round_id FROM {S}.round_workspace_bindings b"
            f" JOIN {S}.drafts d ON d.project_id = b.project_id"
            " AND d.draft_key = b.workspace_key WHERE d.id = ANY(:d)"
            f" UNION SELECT round_id FROM {S}.round_inputs"
            f" WHERE {_IN_SUBS.format(col='source_submission_id')}"
            f" OR source_draft_snapshot_id IN (SELECT id FROM {S}.draft_snapshots"
            " WHERE assignment_id = ANY(:a))",
            **p,
        )
        p["r"] = sorted(new_rounds)
        new_assignments = assignments | _ids(
            conn,
            f"SELECT assignment_id FROM {S}.work_rounds WHERE round_id = ANY(:r)"
            f" UNION SELECT id FROM {S}.assignments"
            f" WHERE {_IN_SUBS.format(col='last_submission_id')}",
            **p,
        )
        p["a"] = sorted(new_assignments)
        new_subs = subs | _subs(
            conn,
            f"SELECT project_id, submission_id FROM {S}.round_submission_bindings"
            " WHERE round_id = ANY(:r)"
            f" UNION SELECT s.project_id, s.submission_id FROM {S}.submissions s"
            f" JOIN {S}.round_workspace_bindings b ON b.project_id = s.project_id"
            " AND b.workspace_key = s.local_key WHERE b.round_id = ANY(:r)"
            f" UNION SELECT project_id, last_submission_id FROM {S}.assignments"
            " WHERE id = ANY(:a) AND last_submission_id IS NOT NULL",
            **p,
        )
        new_drafts = drafts | _ids(
            conn,
            f"SELECT d.id FROM {S}.drafts d JOIN {S}.round_workspace_bindings b"
            " ON b.project_id = d.project_id AND b.workspace_key = d.draft_key"
            " WHERE b.round_id = ANY(:r)",
            **p,
        )
        if (new_assignments, new_rounds, new_subs, new_drafts) == (
            assignments,
            rounds,
            subs,
            drafts,
        ):
            return assignments, rounds, subs, drafts
        assignments, rounds, subs, drafts = (
            new_assignments,
            new_rounds,
            new_subs,
            new_drafts,
        )


def purge(
    conn: Connection,
    assignments: Iterable[int] = (),
    subs: Iterable[Sub] = (),
    drafts: Iterable[int] = (),
) -> dict[str, int]:
    """Delete the seeds with their whole work; rows deleted per table."""
    a, r, s, d = _closure(conn, set(assignments), set(subs), set(drafts))
    counts = dict.fromkeys(_TABLES, 0)
    if not (a or s or d):
        return counts
    p: dict[str, Any] = {"a": sorted(a), "r": sorted(r), "d": sorted(d)}
    p |= _unzip(s)
    p["refs"] = sorted(r | {sid for _, sid in s})
    reports = _ids(
        conn,
        f"SELECT report_id FROM {S}.problem_reports WHERE assignment_id = ANY(:a)"
        " OR round_id = ANY(:r)"
        f" OR {_IN_SUBS.format(col='submission_id')}",
        **p,
    )
    p["rep"] = sorted(reports)
    holds = _ids(
        conn,
        f"SELECT hold_id FROM {S}.task_holds"
        " WHERE assignment_id = ANY(:a) OR report_id = ANY(:rep)",
        **p,
    )
    p["h"] = sorted(holds)
    # Other people's tasks paused by a purged report lose that hold.
    released = _ids(
        conn,
        f"SELECT assignment_id FROM {S}.task_holds"
        " WHERE hold_id = ANY(:h) AND NOT assignment_id = ANY(:a)",
        **p,
    )
    # Any of the ids (round or submission) inside a JSON payload.
    mentions = (
        "EXISTS (SELECT 1 FROM unnest(CAST(:refs AS text[])) AS ref"
        " WHERE {col}::text LIKE '%\"' || ref || '\"%')"
    )
    deletes = {
        "task_hold_state": "hold_id = ANY(:h)",
        "task_holds": "hold_id = ANY(:h)",
        "problem_report_events": "report_id = ANY(:rep)",
        "problem_report_state": "report_id = ANY(:rep)",
        "problem_reports": "report_id = ANY(:rep)",
        "text_change_resolutions": "assignment_id = ANY(:a) OR round_id = ANY(:r)"
        f" OR {_IN_SUBS.format(col='submission_id')}",
        "final_selection_events": "(project_id, payload->>'submission_id') IN"
        " (SELECT * FROM unnest(CAST(:sp AS bigint[]), CAST(:ss AS text[])))",
        "final_selections": _IN_SUBS.format(col="submission_id"),
        "export_selection_snapshots": mentions.format(col="payload"),
        "workflow_command_receipts": mentions.format(col="response"),
        "review_obligation_resolutions": mentions.format(col="payload"),
        "round_inputs": "round_id = ANY(:r)",
        "round_submission_bindings": "round_id = ANY(:r)"
        f" OR {_IN_SUBS.format(col='submission_id')}",
        "round_workspace_bindings": "round_id = ANY(:r)",
        "work_round_state": "round_id = ANY(:r)",
        "work_rounds": "round_id = ANY(:r)",
        "drafts": "id = ANY(:d)",  # draft_annotations, draft_evidence, decisions cascade
        "draft_snapshots": "assignment_id = ANY(:a)",
        "submissions": _IN_SUBS.format(col="submission_id"),
        "assignments": "id = ANY(:a)",
    }
    for table in _TABLES:
        conn.execute(text(f"ALTER TABLE {S}.{table} DISABLE TRIGGER USER"))
    for table in _TABLES:
        counts[table] = conn.execute(
            text(f"DELETE FROM {S}.{table} WHERE {deletes[table]}"), p
        ).rowcount
    for table in _TABLES:
        conn.execute(text(f"ALTER TABLE {S}.{table} ENABLE TRIGGER USER"))
    conn.execute(
        text(
            f"UPDATE {S}.assignments a SET held = false, hold_reason = NULL"
            " WHERE a.id = ANY(:released) AND NOT EXISTS (SELECT 1"
            f" FROM {S}.task_holds h JOIN {S}.task_hold_state t"
            " ON t.hold_id = h.hold_id WHERE h.assignment_id = a.id AND t.active)"
        ),
        {"released": sorted(released)},
    )
    return counts


_KEEP_BOTH_DRAFT = (
    f"EXISTS (SELECT 1 FROM {S}.round_workspace_bindings b"
    f" JOIN {S}.drafts d ON d.project_id = b.project_id"
    " AND d.draft_key = b.workspace_key"
    f" JOIN {S}.review_decisions x ON x.draft_id = d.id"
    " WHERE b.round_id = r.round_id"
    " AND (x.payload->'consolidation'->>'action' = 'keep_both'"
    " OR x.payload->'consolidation' ? 'term_choices'))"
)
_KEEP_BOTH_SUBMISSION = (
    f"EXISTS (SELECT 1 FROM {S}.round_submission_bindings b"
    f" JOIN {S}.submissions x ON x.project_id = b.project_id"
    " AND x.submission_id = b.submission_id"
    " WHERE b.round_id = r.round_id AND jsonb_path_exists(x.payload,"
    ' \'$.decisions[*].consolidation ? (@.action == "keep_both"'
    " || exists(@.term_choices))'))"
)


def purge_legacy(conn: Connection) -> dict[str, int]:
    """D1: annotation review tasks, ``assisted`` work and keep-both
    consolidations with their work; ``assisted`` and ``review`` mode
    preferences become ``independent``."""
    assignments = _ids(
        conn,
        f"SELECT a.id FROM {S}.assignments a WHERE a.task = 'review'"
        f" AND NOT EXISTS (SELECT 1 FROM {S}.work_rounds r"
        " WHERE r.assignment_id = a.id AND r.kind = 'consolidation')"
        f" UNION SELECT assignment_id FROM {S}.work_rounds WHERE mode = 'assisted'"
        f" UNION SELECT r.assignment_id FROM {S}.work_rounds r"
        f" WHERE r.kind = 'consolidation'"
        f" AND ({_KEEP_BOTH_DRAFT} OR {_KEEP_BOTH_SUBMISSION})",
    )
    subs = _subs(
        conn,
        f"SELECT project_id, submission_id FROM {S}.submissions"
        " WHERE mode = 'assisted'",
    )
    drafts = _ids(conn, f"SELECT id FROM {S}.drafts WHERE mode = 'assisted'")
    counts = purge(conn, assignments, subs, drafts)
    counts["user_preferences_converted"] = conn.execute(
        text(
            f"UPDATE {S}.user_preferences SET preferences = jsonb_set(preferences,"
            " '{mode_by_package}', (SELECT jsonb_object_agg(e.key,"
            " CASE WHEN e.value IN ('\"assisted\"', '\"review\"')"
            " THEN '\"independent\"'::jsonb ELSE e.value END)"
            " FROM jsonb_each(preferences->'mode_by_package') AS e))"
            " WHERE jsonb_typeof(preferences->'mode_by_package') = 'object'"
            " AND EXISTS (SELECT 1 FROM jsonb_each_text("
            "preferences->'mode_by_package') AS e"
            " WHERE e.value IN ('assisted', 'review'))"
        )
    ).rowcount
    return counts


def purge_annotation_work(
    conn: Connection,
    project_key: str,
    case_id: str | None = None,
    language: str | None = None,
) -> dict[str, int]:
    """D4: every annotate assignment of a project (or of one text) with its
    work and the consolidations built on it."""
    pid = conn.execute(
        text(f"SELECT id FROM {S}.projects WHERE project_key = :k"),
        {"k": project_key},
    ).scalar_one()
    sql = (
        f"SELECT a.id FROM {S}.assignments a JOIN {S}.documents d"
        " ON d.project_id = a.project_id AND d.document_id = a.document_id"
        " WHERE a.project_id = :pid AND a.task = 'annotate'"
    )
    if case_id is not None:
        sql += " AND d.case_id = :case AND d.language = :lang"
    return purge(conn, _ids(conn, sql, pid=pid, case=case_id, lang=language))
