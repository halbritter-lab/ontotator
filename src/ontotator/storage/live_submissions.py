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

from ontotator.storage.mode_change_tables import (
    AnnotationModeChangeRow,
    DiscardedSubmissionRow,
)
from ontotator.storage.tables import AssignmentRow, DraftRow, SubmissionRow, UserRow
from ontotator.storage.workflow_tables import RoundWorkspaceBindingRow, WorkRoundRow

# The workspace an annotate assignment of each annotation mode opens.
_WORKSPACE_MODES = {"proposals": "proposal_check", "scratch": "independent"}

__all__ = [
    "discarded_draft_keys",
    "discarded_ids",
    "live_submission",
    "live_submission_ref",
]


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


def discarded_draft_keys(
    conn: Connection,
    project_id: int,
    *,
    annotator_id: str | None = None,
    document_id: str | None = None,
    mode: str | None = None,
) -> set[str]:
    """Draft keys of annotation work a mode change revoked (not restored).

    A draft is discarded work when it belongs to the person, document and
    workspace mode of an annotate assignment revoked by an unrestored mode
    change, and it is either unbound (the legacy workspace) or bound to a
    round of such an assignment. The person's own workspace chain skips these
    so a new assignment starts fresh; a restore makes them count again.
    Optional filters narrow the drafts to one annotator, document or mode.
    """
    revoked: set[int] = set()
    for ids in conn.execute(
        select(AnnotationModeChangeRow.revoked_assignment_ids).where(
            AnnotationModeChangeRow.project_id == project_id,
            AnnotationModeChangeRow.restored_at.is_(None),
        )
    ).scalars():
        revoked.update(int(i) for i in ids)
    if not revoked:
        return set()
    work = {
        (row.pseudonym, row.document_id, _WORKSPACE_MODES[row.annotation_mode])
        for row in conn.execute(
            select(
                UserRow.pseudonym,
                AssignmentRow.document_id,
                AssignmentRow.annotation_mode,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.project_id == project_id,
                AssignmentRow.id.in_(sorted(revoked)),
                AssignmentRow.task == "annotate",
                AssignmentRow.revoked_at.is_not(None),
            )
        )
        if row.annotation_mode in _WORKSPACE_MODES
    }
    if annotator_id is not None:
        work = {item for item in work if item[0] == annotator_id}
    if document_id is not None:
        work = {item for item in work if item[1] == document_id}
    if mode is not None:
        work = {item for item in work if item[2] == mode}
    if not work:
        return set()
    query = (
        select(
            DraftRow.draft_key,
            DraftRow.document_id,
            DraftRow.annotator_id,
            DraftRow.mode,
            WorkRoundRow.assignment_id,
        )
        .outerjoin(
            RoundWorkspaceBindingRow,
            (RoundWorkspaceBindingRow.project_id == DraftRow.project_id)
            & (RoundWorkspaceBindingRow.workspace_key == DraftRow.draft_key),
        )
        .outerjoin(
            WorkRoundRow, WorkRoundRow.round_id == RoundWorkspaceBindingRow.round_id
        )
        .where(
            DraftRow.project_id == project_id,
            DraftRow.annotator_id.in_(sorted({item[0] for item in work})),
            DraftRow.document_id.in_(sorted({item[1] for item in work})),
        )
    )
    keys: set[str] = set()
    for draft_key, document, annotator, draft_mode, owner in conn.execute(query):
        # Unbound (the legacy workspace) or a round of the revoked work.
        if (annotator, document, draft_mode) in work and (
            owner is None or owner in revoked
        ):
            keys.add(draft_key)
    return keys
