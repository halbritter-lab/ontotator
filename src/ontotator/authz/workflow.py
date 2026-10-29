"""Exact human-work visibility, shared by history and immutable readers."""

from typing import Any, Literal

from sqlalchemy import Connection, select

from ontotator.authz.policy import Access, Action, can
from ontotator.authz.visibility import current_access, qualifying_assignment
from ontotator.storage.live_submissions import live_submission_ref
from ontotator.storage.tables import AssignmentRow, SubmissionRow
from ontotator.storage.workflow_tables import RoundInputRow, WorkRoundRow


def may_read_snapshot(
    conn: Connection,
    access: Access,
    project_id: int,
    project_key: str,
    kind: Literal["annotation", "evidence"],
    identity: str,
    version: str,
) -> bool:
    """Authorize exact content ownership, never merely a shared document ID."""
    from sqlalchemy import false, or_

    from ontotator.authz.versions import may_read_proposals
    from ontotator.storage.tables import (
        AnnotationSnapshotRow,
        DraftAnnotationRow,
        DraftEvidenceRow,
        DraftRow,
        EditEventRow,
        EvidenceSnapshotRow,
        ProposalAnnotationRow,
        ProposalEvidenceRow,
    )

    fresh = current_access(conn, access, project_id, project_key)
    if can(fresh, Action.EXPORT_ALL_WORK, project_key):
        return True
    if not can(fresh, Action.VIEW_PROJECT, project_key):
        return False
    draft_link: type[DraftAnnotationRow] | type[DraftEvidenceRow]
    proposal: type[ProposalAnnotationRow] | type[ProposalEvidenceRow]
    snapshot: type[AnnotationSnapshotRow] | type[EvidenceSnapshotRow]
    match: dict[str, Any]
    if kind == "annotation":
        draft_link = DraftAnnotationRow
        proposal = ProposalAnnotationRow
        snapshot = AnnotationSnapshotRow
        draft_identity = DraftAnnotationRow.annotation_id
        proposal_identity = ProposalAnnotationRow.annotation_id
        snapshot_identity = AnnotationSnapshotRow.annotation_id
        match = {"annotation": {"annotation_id": identity}, "version": version}
    else:
        draft_link = DraftEvidenceRow
        proposal = ProposalEvidenceRow
        snapshot = EvidenceSnapshotRow
        draft_identity = DraftEvidenceRow.evidence_id
        proposal_identity = ProposalEvidenceRow.evidence_id
        snapshot_identity = EvidenceSnapshotRow.evidence_id
        match = {
            "evidence": [{"mention": {"evidence_id": identity}, "version": version}]
        }
    owned_draft = (
        select(DraftRow.id)
        .join(draft_link, draft_link.draft_id == DraftRow.id)
        .where(
            DraftRow.project_id == project_id,
            DraftRow.annotator_id == fresh.pseudonym,
            draft_identity == identity,
            draft_link.version == version,
        )
        .limit(1)
    )
    if conn.execute(owned_draft).first() is not None:
        return True
    own_history = (
        select(EditEventRow.id)
        .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
        .where(
            DraftRow.project_id == project_id,
            DraftRow.annotator_id == fresh.pseudonym,
            or_(
                EditEventRow.state.contains({"annotations": [match]}),
                EditEventRow.state.contains(match) if kind == "evidence" else false(),
            ),
        )
        .limit(1)
    )
    if conn.execute(own_history).first() is not None:
        return True
    own_submission = (
        select(SubmissionRow.submission_id)
        .where(
            SubmissionRow.project_id == project_id,
            SubmissionRow.annotator_id == fresh.pseudonym,
            SubmissionRow.payload.contains({"snapshots": [match]}),
        )
        .limit(1)
    )
    if conn.execute(own_submission).first() is not None:
        return True
    assigned_input = (
        select(RoundInputRow.input_id)
        .join(WorkRoundRow, WorkRoundRow.round_id == RoundInputRow.round_id)
        .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
        .where(
            RoundInputRow.project_id == project_id,
            qualifying_assignment(fresh.user_id),
            or_(
                RoundInputRow.payload["source_snapshot"].contains(match),
                RoundInputRow.payload["target_snapshot"].contains(match),
            ),
        )
        .limit(1)
    )
    if conn.execute(assigned_input).first() is not None:
        return True
    offered = conn.execute(
        select(snapshot.document_id)
        .join(
            proposal,
            (proposal.project_id == snapshot.project_id)
            & (proposal_identity == snapshot_identity)
            & (proposal.version == snapshot.version),
        )
        .where(
            snapshot.project_id == project_id,
            snapshot_identity == identity,
            snapshot.version == version,
        )
    ).scalar_one_or_none()
    return offered is not None and may_read_proposals(
        conn, fresh, project_id, project_key, offered
    )


def may_read_human_submission(
    conn: Connection,
    access: Access,
    project_id: int,
    project_key: str,
    submission_id: str,
) -> bool:
    fresh = current_access(conn, access, project_id, project_key)
    if can(fresh, Action.EXPORT_ALL_WORK, project_key):
        return True
    owner = conn.execute(
        select(SubmissionRow.annotator_id).where(
            SubmissionRow.project_id == project_id,
            SubmissionRow.submission_id == submission_id,
        )
    ).scalar_one_or_none()
    if owner == fresh.pseudonym and can(fresh, Action.VIEW_PROJECT, project_key):
        return True
    return (
        conn.execute(
            select(RoundInputRow.input_id)
            .join(WorkRoundRow, WorkRoundRow.round_id == RoundInputRow.round_id)
            .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
            .where(
                RoundInputRow.project_id == project_id,
                RoundInputRow.source_submission_id == submission_id,
                qualifying_assignment(fresh.user_id),
                # Owners and leads keep reading discarded work; offered
                # inputs of a discarded submission do not (#109).
                live_submission_ref(
                    RoundInputRow.project_id, RoundInputRow.source_submission_id
                ),
            )
            .limit(1)
        ).first()
        is not None
    )
