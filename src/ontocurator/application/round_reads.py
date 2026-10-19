"""Read-only facts for rounds, carried inputs and carry sources (no writes).

Every function here enriches items the caller has already read through an
authorized (scoped) repository call. The SQL below is restricted to the round
ids, assignment ids and submission ids named by those items; nothing here
fetches inputs or rounds on its own.

Each function reads in ``db.snapshot()``; a caller that opens the snapshot
around its own authorized read gets one consistent state for both.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from ontocurator.domain.submission_labels import round_ordinals
from ontocurator.domain.work_rounds import RoundInputView, WorkRoundView
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import SubmissionRow
from ontocurator.storage.workflow_tables import (
    RoundInputRow,
    RoundSubmissionBindingRow,
    WorkRoundRow,
)


def _ordinals(
    conn: Any,
    pid: int,
    assignment_ids: Iterable[int],
    archived: dict[str, dict[str, Any]],
) -> dict[str, int]:
    """Round numbers per assignment chain, archived rounds included."""
    wanted = set(assignment_ids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(WorkRoundRow.round_id, WorkRoundRow.predecessor_round_id)
        .where(
            WorkRoundRow.project_id == pid,
            WorkRoundRow.assignment_id.in_(sorted(wanted)),
        )
        .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
    ).all()
    pairs = [(r.round_id, r.predecessor_round_id) for r in rows]
    known = {rid for rid, _ in pairs}
    pairs.extend(
        (rid, item["round"].get("predecessor_round_id"))
        for rid, item in archived.items()
        if rid not in known and item["round"].get("assignment_id") in wanted
    )
    return round_ordinals(pairs)


def _round_of_submission(
    conn: Any,
    pid: int,
    sids: Iterable[str],
    archived: dict[str, dict[str, Any]],
) -> dict[str, tuple[str, int]]:
    """submission_id -> (round_id, assignment_id)."""
    wanted = set(sids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(
            RoundSubmissionBindingRow.submission_id,
            RoundSubmissionBindingRow.round_id,
            WorkRoundRow.assignment_id,
        )
        .join(
            WorkRoundRow,
            WorkRoundRow.round_id == RoundSubmissionBindingRow.round_id,
        )
        .where(
            RoundSubmissionBindingRow.project_id == pid,
            RoundSubmissionBindingRow.submission_id.in_(sorted(wanted)),
        )
    ).all()
    result = {r.submission_id: (r.round_id, r.assignment_id) for r in rows}
    for rid, item in archived.items():
        for sid in item.get("submission_ids", []):
            if sid in wanted and sid not in result:
                result[sid] = (rid, item["round"].get("assignment_id"))
    return result


def _recorded(conn: Any, pid: int, sids: Iterable[str]) -> dict[str, Any]:
    """submission_id -> row with ``recorded_at`` and ``findings`` (snapshot count)."""
    wanted = set(sids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(
            SubmissionRow.submission_id,
            SubmissionRow.recorded_at,
            func.coalesce(
                func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
            ).label("findings"),
        ).where(
            SubmissionRow.project_id == pid,
            SubmissionRow.submission_id.in_(sorted(wanted)),
        )
    ).all()
    return {r.submission_id: r for r in rows}


def _counts(conn: Any, pid: int, column: Any, round_ids: list[str]) -> dict[str, int]:
    if not round_ids:
        return {}
    table = column.class_
    rows = conn.execute(
        select(column, func.count())
        .where(table.project_id == pid, column.in_(round_ids))
        .group_by(column)
    ).all()
    return {rid: count for rid, count in rows}


def _source_facts(
    conn: Connection,
    pid: int,
    sids: Iterable[str],
    archived: dict[str, dict[str, Any]],
) -> tuple[dict[str, tuple[str, int]], dict[str, int], dict[str, Any]]:
    """Owning rounds, round ordinals and recorded rows of these submissions."""
    sids = set(sids)
    owners = _round_of_submission(conn, pid, sids, archived)
    ordinals = _ordinals(conn, pid, {a for _, a in owners.values()}, archived)
    return owners, ordinals, _recorded(conn, pid, sids)


def enrich_rounds(
    repo: Repository, project_key: str, views: list[WorkRoundView]
) -> list[WorkRoundView]:
    """Add ordinals, times, counts and text identity to authorized round views."""
    if not views:
        return []
    with repo.db.snapshot() as conn:
        variants = {v.document_id: v for v in repo.list_variants(project_key)}
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        round_ids = sorted({v.round_id for v in views})
        sources = {
            v.input_submission_ids[0]
            for v in views
            if v.kind == "carry_forward" and v.input_submission_ids
        }
        latest = {v.latest_submission_id for v in views if v.latest_submission_id}
        owners, source_ordinals, recorded = _source_facts(
            conn, pid, sources | latest, archived
        )
        ordinals = source_ordinals | _ordinals(
            conn, pid, {v.assignment_id for v in views}, archived
        )
        created: dict[str, datetime] = {
            r.round_id: r.created_at
            for r in conn.execute(
                select(WorkRoundRow.round_id, WorkRoundRow.created_at).where(
                    WorkRoundRow.project_id == pid,
                    WorkRoundRow.round_id.in_(round_ids),
                )
            )
        }
        submissions = _counts(conn, pid, RoundSubmissionBindingRow.round_id, round_ids)
        inputs = _counts(conn, pid, RoundInputRow.round_id, round_ids)

    result = []
    for view in views:
        stored = archived.get(view.round_id) if view.round_id not in created else None
        latest_row = recorded.get(view.latest_submission_id or "")
        update: dict[str, Any] = {
            "round_ordinal": ordinals.get(view.round_id),
            "created_at": created.get(view.round_id),
            "submission_count": (
                len(stored.get("submission_ids", []))
                if stored is not None
                else submissions.get(view.round_id, 0)
            ),
            "latest_submission_recorded_at": (
                latest_row.recorded_at if latest_row is not None else None
            ),
            "input_count": (
                len(stored.get("inputs", []))
                if stored is not None
                else inputs.get(view.round_id, 0)
            ),
        }
        if view.kind == "carry_forward" and view.input_submission_ids:
            sid = view.input_submission_ids[0]
            owner = owners.get(sid)
            source_row = recorded.get(sid)
            update["source_round_ordinal"] = (
                ordinals.get(owner[0]) if owner is not None else None
            )
            update["source_submission_recorded_at"] = (
                source_row.recorded_at if source_row is not None else None
            )
        variant = variants.get(view.document_id)
        if variant is not None:
            update["document_language"] = variant.language
            update["document_version"] = variant.version
        result.append(view.model_copy(update=update))
    return result


def enrich_inputs(
    repo: Repository, project_key: str, items: list[dict[str, Any]]
) -> list[RoundInputView]:
    """Validate authorized input payloads and add their source facts."""
    views = [RoundInputView.model_validate(item) for item in items]
    if not views:
        return []
    with repo.db.snapshot() as conn:
        variants = {v.document_id: v for v in repo.list_variants(project_key)}
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        owners, ordinals, recorded = _source_facts(
            conn, pid, {v.source_submission_id for v in views}, archived
        )
    result = []
    for view in views:
        owner = owners.get(view.source_submission_id)
        row = recorded.get(view.source_submission_id)
        variant = variants.get(view.source_snapshot.annotation.document_id)
        result.append(
            view.model_copy(
                update={
                    "source_round_ordinal": (
                        ordinals.get(owner[0]) if owner is not None else None
                    ),
                    "source_recorded_at": row.recorded_at if row is not None else None,
                    "source_language": variant.language if variant else None,
                    "source_version": variant.version if variant else None,
                }
            )
        )
    return result


def enrich_sources(
    repo: Repository, project_key: str, sids: list[str]
) -> list[dict[str, Any]]:
    """Round ordinal, server time and finding count per authorized submission id."""
    if not sids:
        return []
    with repo.db.snapshot() as conn:
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        owners, ordinals, recorded = _source_facts(conn, pid, sids, archived)
    result = []
    for sid in sids:
        owner = owners.get(sid)
        row = recorded.get(sid)
        result.append(
            {
                "round_ordinal": ordinals.get(owner[0]) if owner is not None else None,
                "recorded_at": row.recorded_at if row is not None else None,
                "finding_count": int(row.findings) if row is not None else 0,
            }
        )
    return result


def assignment_submissions(
    repo: Repository, project_key: str, assignment_id: int
) -> list[dict[str, Any]]:
    """Submissions bound to any round of the assignment, oldest recorded first.

    The caller has authorized the assignment (owner or lead). Archived rounds of
    the assignment count; a legacy ``last_submission_id`` without any round
    binding is listed without a round.
    """
    from ontocurator.storage.tables import AssignmentRow

    with repo.db.snapshot() as conn:
        variants = {v.document_id: v for v in repo.list_variants(project_key)}
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        owners: dict[str, str | None] = {
            r.submission_id: r.round_id
            for r in conn.execute(
                select(
                    RoundSubmissionBindingRow.submission_id,
                    RoundSubmissionBindingRow.round_id,
                )
                .join(
                    WorkRoundRow,
                    (WorkRoundRow.project_id == RoundSubmissionBindingRow.project_id)
                    & (WorkRoundRow.round_id == RoundSubmissionBindingRow.round_id),
                )
                .where(
                    RoundSubmissionBindingRow.project_id == pid,
                    WorkRoundRow.assignment_id == assignment_id,
                )
            )
        }
        for rid, item in archived.items():
            if item["round"].get("assignment_id") == assignment_id:
                for sid in item.get("submission_ids", []):
                    owners.setdefault(sid, rid)
        legacy = conn.execute(
            select(AssignmentRow.last_submission_id).where(
                AssignmentRow.project_id == pid, AssignmentRow.id == assignment_id
            )
        ).scalar_one_or_none()
        if legacy is not None and legacy not in owners:
            bound = _round_of_submission(conn, pid, [legacy], archived)
            if legacy not in bound:
                owners[legacy] = None
        if not owners:
            return []
        ordinals = _ordinals(conn, pid, [assignment_id], archived)
        rows = conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.document_id,
                SubmissionRow.recorded_at,
                func.coalesce(
                    func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
                ).label("findings"),
            )
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(sorted(owners)),
            )
            .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
        ).all()
    result = []
    for row in rows:
        variant = variants.get(row.document_id)
        if variant is None:
            continue
        owner = owners[row.submission_id]
        result.append(
            {
                "submission_id": row.submission_id,
                "round_id": owner,
                "round_ordinal": ordinals.get(owner) if owner is not None else None,
                "recorded_at": row.recorded_at,
                "finding_count": int(row.findings),
                "document_id": row.document_id,
                "language": variant.language,
                "version": variant.version,
            }
        )
    return result
