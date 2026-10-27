"""Every problem report of a Documents row, open and closed (lead view).

The expanded row's "More" section lists them so closed and withdrawn reports
stay findable. One query per page build; the caller holds the project lock.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy import Connection, and_, func, select

from ontotator.storage.tables import AssignmentRow, DocumentRow, UserRow
from ontotator.storage.workflow_tables import (
    ProblemReportRow,
    ProblemReportStateRow,
    TaskHoldRow,
    TaskHoldStateRow,
)

TITLE_LENGTH = 80

RowKey = tuple[str, str]


def report_title(text: str, limit: int = TITLE_LENGTH) -> str:
    """First line, cut at a word boundary to ``limit`` chars plus "…".

    Same rule as ``reportTitle`` in ``frontend/src/problems/labels.ts``.
    """
    line = text.replace("\r\n", "\n").split("\n", 1)[0].strip()
    if len(line) <= limit:
        return line
    if line[limit] == " ":
        return f"{line[:limit].rstrip()}…"
    head = line[:limit]
    boundary = head.rfind(" ")
    return f"{(head[:boundary] if boundary > 0 else head).rstrip()}…"


def load_row_reports(
    conn: Connection,
    pid: int,
    row_keys: Iterable[RowKey],
    people: Mapping[int, Mapping[str, Any]] | None = None,
) -> dict[RowKey, list[dict[str, Any]]]:
    """Reports per (case_id, language), newest first; rows without one are absent.

    ``people`` (user id -> PersonRefView fields) names the reporters; a
    reporter missing there is shown by pseudonym alone.
    """
    wanted = set(row_keys)
    if not wanted:
        return {}
    active_holds = (
        select(func.count())
        .select_from(TaskHoldRow)
        .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
        .where(
            TaskHoldRow.report_id == ProblemReportRow.report_id,
            TaskHoldStateRow.active.is_(True),
        )
        .correlate(ProblemReportRow)
        .scalar_subquery()
    )
    rows = conn.execute(
        select(
            DocumentRow.case_id,
            DocumentRow.language,
            ProblemReportRow.report_id,
            ProblemReportRow.reason,
            ProblemReportRow.created_at,
            ProblemReportStateRow.state,
            ProblemReportRow.reporter_id,
            UserRow.pseudonym,
            active_holds.label("active_hold_count"),
        )
        .join(
            ProblemReportStateRow,
            ProblemReportStateRow.report_id == ProblemReportRow.report_id,
        )
        .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == AssignmentRow.project_id,
                DocumentRow.document_id == AssignmentRow.document_id,
            ),
        )
        .join(UserRow, UserRow.id == ProblemReportRow.reporter_id)
        .where(ProblemReportRow.project_id == pid)
        .order_by(ProblemReportRow.created_at.desc(), ProblemReportRow.report_id)
    )
    result: dict[RowKey, list[dict[str, Any]]] = {}
    for row in rows:
        key = (row.case_id, row.language)
        if key not in wanted:
            continue
        result.setdefault(key, []).append(
            {
                "report_id": row.report_id,
                "title": report_title(row.reason),
                "reporter_label": row.pseudonym,
                "created_at": row.created_at,
                "state": row.state,
                "active_hold_count": row.active_hold_count,
                "reporter": dict(
                    (people or {}).get(row.reporter_id)
                    or {
                        "pseudonym": row.pseudonym,
                        "display_name": None,
                        "is_me": False,
                    }
                ),
            }
        )
    return result
