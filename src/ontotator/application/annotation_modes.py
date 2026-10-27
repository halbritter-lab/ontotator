"""Database facts of the annotation-mode rule (domain/annotation_modes.py)."""

from __future__ import annotations

from datetime import datetime
from typing import cast

from sqlalchemy import Connection, select

from ontotator.application.text_targets import text_documents, text_row
from ontotator.domain.annotation_modes import AnnotationMode, TextMode, text_mode
from ontotator.storage.plan_tables import WorkPlanFlagsRow
from ontotator.storage.proposal_queries import newest_proposal_refs
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
)

__all__ = ["SUBMISSION_MODES", "load_text_mode", "locked_modes", "work_modes"]

SUBMISSION_MODES: dict[str, AnnotationMode] = {
    "proposal_check": "proposals",
    "independent": "scratch",
}


def _work(
    conn: Connection, project_id: int, documents: list[str] | None
) -> list[tuple[str, str, datetime, AnnotationMode]]:
    """(case, language, time, mode) of annotation work (plan "Pure rule" 1):
    non-revoked annotate assignments, revoked ones with submitted work, and
    annotation submissions (also without an assignment); ``documents=None``
    reads the whole project."""
    doc = (DocumentRow.project_id == project_id) & (
        DocumentRow.document_id == AssignmentRow.document_id
    )
    assignments = (
        select(
            DocumentRow.case_id,
            DocumentRow.language,
            AssignmentRow.created_at,
            AssignmentRow.annotation_mode,
        )
        .join(DocumentRow, doc)
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.task == "annotate",
            AssignmentRow.revoked_at.is_(None)
            | AssignmentRow.last_submission_id.is_not(None),
        )
    )
    submissions = (
        select(
            DocumentRow.case_id,
            DocumentRow.language,
            SubmissionRow.recorded_at,
            SubmissionRow.mode,
        )
        .join(
            DocumentRow,
            (DocumentRow.project_id == project_id)
            & (DocumentRow.document_id == SubmissionRow.document_id),
        )
        .where(
            SubmissionRow.project_id == project_id,
            SubmissionRow.mode.in_(list(SUBMISSION_MODES)),
        )
    )
    if documents is not None:
        assignments = assignments.where(AssignmentRow.document_id.in_(documents))
        submissions = submissions.where(SubmissionRow.document_id.in_(documents))
    # Annotate rows always carry a mode (migration 0021 check constraint).
    work = [
        (case, language, at, cast(AnnotationMode, mode))
        for case, language, at, mode in conn.execute(assignments)
    ] + [
        (case, language, at, SUBMISSION_MODES[mode])
        for case, language, at, mode in conn.execute(submissions)
    ]
    return sorted(work, key=lambda item: item[2])


def work_modes(
    conn: Connection, project_id: int, documents: list[str]
) -> list[AnnotationMode]:
    """Modes of the text's annotation work, oldest first (see ``_work``)."""
    return [mode for *_rest, mode in _work(conn, project_id, documents)]


def locked_modes(
    conn: Connection, project_id: int
) -> dict[tuple[str, str], AnnotationMode]:
    """The fixed mode (oldest work) per locked text (case, language) of the
    project; two queries (the batch planner, plan P3 point 7)."""
    locked: dict[tuple[str, str], AnnotationMode] = {}
    for case, language, _at, mode in _work(conn, project_id, None):
        locked.setdefault((case, language), mode)
    return locked


def load_text_mode(conn: Connection, project_id: int, document_id: str) -> TextMode:
    """The effective mode of the text holding ``document_id``; the proposal
    count is that of ``document_id`` (callers pass the target document)."""
    row = text_row(conn, project_id, document_id)
    project_mode = cast(
        AnnotationMode,
        conn.execute(
            select(ProjectRow.tool_proposal_mode).where(ProjectRow.id == project_id)
        ).scalar_one(),
    )
    override = cast(
        AnnotationMode | None,
        conn.execute(
            select(WorkPlanFlagsRow.annotation_mode).where(
                WorkPlanFlagsRow.project_id == project_id,
                WorkPlanFlagsRow.case_id == row.case_id,
                WorkPlanFlagsRow.language == row.language,
            )
        ).scalar_one_or_none(),
    )
    return text_mode(
        project_mode=project_mode,
        plan_override=override,
        proposal_count=len(newest_proposal_refs(conn, project_id, document_id)),
        work_modes=work_modes(conn, project_id, text_documents(conn, project_id, row)),
    )
