"""The one filter for submissions that count: those without a discard mark.

A lead's annotation-mode change after submitted work marks that work in
``discarded_submissions`` (#109); the submission rows stay append-only. Every
reader that derives state from submissions (the mode lock, progress and the
Documents rows, eligibility and finalization, consolidation inputs, exports,
visibility through round inputs, text changes) goes through these helpers so
a discarded submission counts as if it had never been submitted, and counts
again after a restore. History and integrity readers (identity checks on
import, account erasure, the project-settings lock, by-id reads of an
existing round's inputs) deliberately see every row.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import ColumnElement, Connection, exists, select

from ontotator.storage.mode_change_tables import DiscardedSubmissionRow
from ontotator.storage.tables import SubmissionRow

__all__ = ["discarded_ids", "live_submission", "live_submission_ref"]


def live_submission_ref(
    project_id: ColumnElement[Any] | Any, submission_id: ColumnElement[Any] | Any
) -> ColumnElement[bool]:
    """True unless ``(project_id, submission_id)`` carries a discard mark.

    For columns that name a submission (``assignments.last_submission_id``,
    ``round_inputs.source_submission_id``, ...). A NULL id is live: the
    correlated ``EXISTS`` finds no mark for it.
    """
    return ~exists().where(
        DiscardedSubmissionRow.project_id == project_id,
        DiscardedSubmissionRow.submission_id == submission_id,
    )


def live_submission() -> ColumnElement[bool]:
    """True for a ``SubmissionRow`` without a discard mark (the shared filter)."""
    return live_submission_ref(SubmissionRow.project_id, SubmissionRow.submission_id)


def discarded_ids(
    conn: Connection, project_id: int, submission_ids: Iterable[str] | None = None
) -> set[str]:
    """The discarded submission IDs of a project (of ``submission_ids`` if
    given)."""
    query = select(DiscardedSubmissionRow.submission_id).where(
        DiscardedSubmissionRow.project_id == project_id
    )
    if submission_ids is not None:
        wanted = sorted(set(submission_ids))
        if not wanted:
            return set()
        query = query.where(DiscardedSubmissionRow.submission_id.in_(wanted))
    return set(conn.execute(query).scalars())
