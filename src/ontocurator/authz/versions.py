"""One current offered-ref policy for immutable annotation version reads."""

from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, RowMapping, and_, select
from sqlalchemy.orm import aliased

from ontocurator.authz.policy import Access, Action, can
from ontocurator.authz.visibility import (
    current_access,
    qualifying_assignment,
    require_case_text,
    visible_documents,
)
from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProposalSetRow,
    SubmissionRow,
)


class VersionRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["own", "proposals", "stage_result", "release"]
    id: str
    label: str
    created_at: datetime


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
                AssignmentRow.task == "review",
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
            label=f"My submission ({'review' if row.mode == 'review' else 'annotate'}), {row.created_at}",
            created_at=row.created_at,
        )
        for row in own
    ]
    if may_read_proposals(conn, fresh, project_id, key, document_id):
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
