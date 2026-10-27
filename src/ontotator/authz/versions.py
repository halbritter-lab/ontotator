"""One current offered-ref policy for immutable annotation version reads."""

from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, RowMapping, and_, func, or_, select
from sqlalchemy.orm import aliased

from ontotator.authz.policy import Access, Action, can
from ontotator.authz.visibility import (
    current_access,
    qualifying_assignment,
    require_case_text,
    visible_documents,
)
from ontotator.domain.errors import DomainError
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.proposal_queries import (
    newest_proposal_refs,
    newest_proposal_set,
)
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProposalSetRow,
    SubmissionRow,
    UserRow,
)


class VersionRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["own", "proposals", "stage_result", "release", "submission", "final"]
    id: str
    label: str
    created_at: datetime


# Own-submission history labels by workspace mode (plan review R9).
_OWN_LABELS = {
    "proposal_check": "My annotation, from proposals",
    "independent": "My annotation, from scratch",
    "review": "My consolidation",
}


def may_read_proposals(
    conn: Connection, access: Access, project_id: int, key: str, doc: str
) -> bool:
    fresh = current_access(conn, access, project_id, key)
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, key):
        return True
    return (
        conn.execute(
            select(AssignmentRow.id)
            .where(
                AssignmentRow.project_id == project_id,
                AssignmentRow.document_id == doc,
                # The consolidator, and an annotator annotating from proposals
                # (spec 2026-10-23 §1); never an annotator from scratch.
                or_(
                    AssignmentRow.task == "review",
                    and_(
                        AssignmentRow.task == "annotate",
                        AssignmentRow.annotation_mode == "proposals",
                    ),
                ),
                qualifying_assignment(fresh.user_id),
            )
            .limit(1)
        ).first()
        is not None
    )


def require_proposals(
    conn: Connection, access: Access, project_id: int, key: str, doc: str
) -> None:
    if not may_read_proposals(conn, access, project_id, key, doc):
        raise DomainError("DOCUMENT_NOT_FOUND")


def proposal_rows(
    conn: Connection, project_id: int, document_id: str
) -> Sequence[RowMapping]:
    """Bounded metadata, including the actual target's correction predecessor."""
    previous = aliased(DocumentRow)
    return (
        conn.execute(
            select(
                ProposalSetRow.id,
                ProposalSetRow.actors,
                ProposalSetRow.origin,
                ProposalSetRow.imported_at,
                previous.document_id.label("source_document_id"),
                previous.version.label("source_version"),
            )
            .join(
                DocumentRow,
                and_(
                    DocumentRow.project_id == ProposalSetRow.project_id,
                    DocumentRow.document_id == ProposalSetRow.document_id,
                ),
            )
            .outerjoin(
                previous,
                and_(
                    previous.project_id == DocumentRow.project_id,
                    previous.document_id == DocumentRow.derived_from,
                    previous.case_id == DocumentRow.case_id,
                    previous.language == DocumentRow.language,
                ),
            )
            .where(
                ProposalSetRow.project_id == project_id,
                ProposalSetRow.document_id == document_id,
            )
            .order_by(ProposalSetRow.imported_at, ProposalSetRow.id)
        )
        .mappings()
        .all()
    )


def visible_annotation_versions(
    conn: Connection,
    access: Access,
    project_id: int,
    key: str,
    document_id: str,
    *,
    assignment: int | None = None,
) -> list[VersionRef]:
    fresh = current_access(conn, access, project_id, key)
    require_case_text(conn, fresh, project_id, key, document_id)
    if assignment is not None:
        hint = conn.execute(
            select(AssignmentRow.id).where(
                AssignmentRow.id == assignment,
                AssignmentRow.project_id == project_id,
                AssignmentRow.document_id == document_id,
                qualifying_assignment(fresh.user_id),
            )
        ).first()
        if hint is None:
            raise DomainError("VERSION_NOT_FOUND")
    exact = visible_documents(conn, fresh, project_id, key)
    # Exact own-submission history remains available within current authority.
    own = (
        conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.mode,
                SubmissionRow.created_at,
            )
            .where(
                SubmissionRow.project_id == project_id,
                SubmissionRow.document_id == document_id,
                SubmissionRow.annotator_id == fresh.pseudonym,
            )
            .order_by(
                SubmissionRow.created_at.desc(), SubmissionRow.submission_id.desc()
            )
        ).all()
        if exact.all or document_id in exact.document_ids
        else []
    )
    result = [
        VersionRef(
            kind="own",
            id=row.submission_id,
            label=f"{_OWN_LABELS.get(row.mode, 'My submission')}, {row.created_at}",
            created_at=row.created_at,
        )
        for row in own
    ]
    if can(fresh, Action.EXPORT_ALL_WORK, key):
        # Leads read every submission of the text (all authors) for the history table.
        result.extend(
            VersionRef(
                kind="submission",
                id=row.submission_id,
                label=f"{row.annotator_id} · {row.recorded_at.isoformat()}",
                created_at=row.recorded_at,
            )
            for row in conn.execute(
                select(
                    SubmissionRow.submission_id,
                    SubmissionRow.annotator_id,
                    SubmissionRow.recorded_at,
                )
                .where(
                    SubmissionRow.project_id == project_id,
                    SubmissionRow.document_id == document_id,
                )
                .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
            )
        )
    if can(fresh, Action.BROWSE_VERSIONS, key) and may_read_proposals(
        conn, fresh, project_id, key, document_id
    ):
        result.extend(_proposal_refs(conn, project_id, document_id))
    return result


def _proposal_refs(
    conn: Connection, project_id: int, document_id: str
) -> list[VersionRef]:
    result = []
    for row in proposal_rows(conn, project_id, document_id):
        if row["origin"] == "reanchor":
            if row["source_version"] is None:
                raise DomainError("VERSION_NOT_FOUND")
            label = f"Carried over from version {row['source_version']}"
        else:
            label = (
                "; ".join(
                    " ".join(
                        str(actor[name])
                        for name in ("name", "version", "model")
                        if actor.get(name)
                    )
                    for actor in row["actors"]
                    if actor.get("kind") == "tool"
                )
                or "Imported proposals"
            )
        result.append(
            VersionRef(
                kind="proposals",
                id=str(row["id"]),
                label=label,
                created_at=row["imported_at"],
            )
        )
    return result


class TextLayerEntry(BaseModel):
    """One entry of the text view's "Show" list (spec 2026-10-23 §4)."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["proposals", "submission", "own", "final", "person"]
    ref: VersionRef | None  # None when not available
    label: str
    state: (
        Literal["submitted", "in_progress", "not_started", "accepted", "not_accepted"]
        | None
    ) = None
    count: int | None = None  # findings (submissions) or proposals
    available: bool
    reason: str | None = None


def _day(value: datetime) -> str:
    return f"{value.day} {value:%b}"


def text_layers(
    conn: Connection, access: Access, project_id: int, key: str, doc: str
) -> list[TextLayerEntry]:
    """Proposals, people (lead only, D3), own work, final result (lead only)."""
    # Local import: application.work_plans imports authz modules.
    from ontotator.application.text_targets import text_documents, text_row

    fresh = current_access(conn, access, project_id, key)
    refs = visible_annotation_versions(conn, fresh, project_id, key, doc)
    lead = can(fresh, Action.EXPORT_ALL_WORK, key)
    findings: dict[str, int] = {
        row[0]: row[1]
        for row in conn.execute(
            select(
                SubmissionRow.submission_id,
                func.coalesce(
                    func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
                ),
            ).where(
                SubmissionRow.project_id == project_id,
                SubmissionRow.document_id == doc,
            )
        )
    }
    text = text_row(conn, project_id, doc)
    entries: list[TextLayerEntry] = []
    proposals = len(newest_proposal_refs(conn, project_id, doc))
    if proposals:
        newest = newest_proposal_set(conn, project_id, doc)
        # The layer offers the newest set to everyone who may read proposals
        # (annotators from proposals lack BROWSE_VERSIONS, spec §4).
        ref = (
            next(
                (
                    r
                    for r in _proposal_refs(conn, project_id, doc)
                    if newest is not None and r.id == str(newest.id)
                ),
                None,
            )
            if may_read_proposals(conn, fresh, project_id, key, doc)
            else None
        )
        scratch = conn.execute(
            select(AssignmentRow.id)
            .where(
                AssignmentRow.project_id == project_id,
                AssignmentRow.document_id.in_(text_documents(conn, project_id, text)),
                AssignmentRow.task == "annotate",
                AssignmentRow.annotation_mode == "scratch",
                qualifying_assignment(fresh.user_id),
            )
            .limit(1)
        ).first()
        entries.append(
            TextLayerEntry(
                kind="proposals",
                ref=ref,
                label=f"Tool proposals ({proposals})",
                count=proposals,
                available=ref is not None,
                reason=None
                if ref is not None
                else "Hidden while you annotate from scratch."
                if scratch is not None
                else "Only the project lead and people annotating from proposals"
                " see them.",
            )
        )
    if lead:
        submissions = {r.id: r for r in refs if r.kind == "submission"}
        for row in conn.execute(
            select(
                UserRow.display_name,
                AssignmentRow.status,
                AssignmentRow.last_submission_id,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.project_id == project_id,
                AssignmentRow.document_id == doc,
                AssignmentRow.task.in_(("annotate", "review")),
                AssignmentRow.revoked_at.is_(None),
            )
            .order_by(AssignmentRow.id)
        ):
            submitted = submissions.get(row.last_submission_id or "")
            if submitted is not None:
                entries.append(
                    TextLayerEntry(
                        kind="submission",
                        ref=submitted,
                        label=f"{row.display_name}, submitted "
                        f"{_day(submitted.created_at)}",
                        state="submitted",
                        count=findings.get(submitted.id),
                        available=True,
                    )
                )
            else:
                started = row.status != "open"
                entries.append(
                    TextLayerEntry(
                        kind="person",
                        ref=None,
                        label=f"{row.display_name}, "
                        f"{'in progress' if started else 'not started'}",
                        state="in_progress" if started else "not_started",
                        available=False,
                        reason="Not submitted yet.",
                    )
                )
    entries.extend(
        TextLayerEntry(
            kind="own",
            ref=r,
            label=r.label,
            state="submitted",
            count=findings.get(r.id),
            available=True,
        )
        for r in refs
        if r.kind == "own"
    )
    if lead:
        entries.append(_final_entry(conn, project_id, doc, text.case_id, text.language))
    return entries


def _final_entry(
    conn: Connection, project_id: int, doc: str, case_id: str, language: str
) -> TextLayerEntry:
    selection = conn.execute(
        select(
            FinalSelectionRow.document_id,
            FinalSelectionRow.submission_id,
            FinalSelectionRow.selected_at,
            DocumentRow.version,
        )
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == FinalSelectionRow.project_id,
                DocumentRow.document_id == FinalSelectionRow.document_id,
            ),
        )
        .where(
            FinalSelectionRow.project_id == project_id,
            FinalSelectionRow.case_id == case_id,
            FinalSelectionRow.language == language,
        )
    ).first()
    if selection is None:
        return TextLayerEntry(
            kind="final",
            ref=None,
            label="Final result (not yet accepted)",
            state="not_accepted",
            available=False,
            reason="Not accepted yet.",
        )
    if selection.document_id != doc:
        return TextLayerEntry(
            kind="final",
            ref=None,
            label="Final result",
            state="accepted",
            available=False,
            reason=f"Accepted on version {selection.version}.",
        )
    return TextLayerEntry(
        kind="final",
        ref=VersionRef(
            kind="final",
            id=selection.submission_id,
            label="Final result",
            created_at=selection.selected_at,
        ),
        label=f"Final result, accepted {_day(selection.selected_at)}",
        state="accepted",
        available=True,
    )
