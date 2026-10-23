"""The newest tool proposal set of a document (spec 2026-10-23 §1 Targets).

Targets of an "Annotate from proposals" round, proposal counts (read model,
text view) and export precision all use this set. Seed-package proposals
(``proposal_set_id IS NULL``) form one set, used only when the document has
no imported set.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, Select, Subquery, and_, func, select

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    ProposalAnnotationRow,
    ProposalSetRow,
)

_SNAPSHOT_JOIN = and_(
    ProposalAnnotationRow.project_id == AnnotationSnapshotRow.project_id,
    ProposalAnnotationRow.annotation_id == AnnotationSnapshotRow.annotation_id,
    ProposalAnnotationRow.version == AnnotationSnapshotRow.version,
)


@dataclass(frozen=True)
class ProposalSetRef:
    id: int | None  # None: seed proposals without a set
    annotation_set_id: str | None


def _newest_set_ids(project_id: int) -> Subquery:
    """(document_id, newest) per document with proposals; ``max`` skips NULL sets."""
    return (
        select(
            AnnotationSnapshotRow.document_id,
            func.max(ProposalAnnotationRow.proposal_set_id).label("newest"),
        )
        .join(AnnotationSnapshotRow, _SNAPSHOT_JOIN)
        .where(ProposalAnnotationRow.project_id == project_id)
        .group_by(AnnotationSnapshotRow.document_id)
        .subquery()
    )


def _in_newest_set(project_id: int, *columns: Any) -> Select[Any]:
    """``columns`` of the proposals in each document's newest set."""
    newest = _newest_set_ids(project_id)
    return (
        select(*columns)
        .select_from(ProposalAnnotationRow)
        .join(AnnotationSnapshotRow, _SNAPSHOT_JOIN)
        .join(newest, newest.c.document_id == AnnotationSnapshotRow.document_id)
        .where(
            ProposalAnnotationRow.project_id == project_id,
            ProposalAnnotationRow.proposal_set_id.is_not_distinct_from(newest.c.newest),
        )
    )


def newest_proposal_set(
    conn: Connection, project_id: int, document_id: str
) -> ProposalSetRef | None:
    """The document's newest proposal set; ``None`` without any proposal."""
    newest, count = conn.execute(
        select(func.max(ProposalAnnotationRow.proposal_set_id), func.count())
        .join(AnnotationSnapshotRow, _SNAPSHOT_JOIN)
        .where(
            ProposalAnnotationRow.project_id == project_id,
            AnnotationSnapshotRow.document_id == document_id,
        )
    ).one()
    if not count:
        return None
    if newest is None:
        return ProposalSetRef(id=None, annotation_set_id=None)
    annotation_set_id = conn.execute(
        select(ProposalSetRow.annotation_set_id).where(ProposalSetRow.id == newest)
    ).scalar_one()
    return ProposalSetRef(id=newest, annotation_set_id=annotation_set_id)


def newest_proposal_refs(
    conn: Connection, project_id: int, document_id: str
) -> list[AnnotationRef]:
    """Proposals of the document's newest set, ordered by (annotation id, version)."""
    rows = conn.execute(
        _in_newest_set(
            project_id,
            ProposalAnnotationRow.annotation_id,
            ProposalAnnotationRow.version,
        )
        .where(AnnotationSnapshotRow.document_id == document_id)
        .order_by(ProposalAnnotationRow.annotation_id, ProposalAnnotationRow.version)
    ).all()
    return [AnnotationRef(annotation_id=row[0], version=row[1]) for row in rows]


def newest_proposal_counts(conn: Connection, project_id: int) -> dict[str, int]:
    """Proposals of the newest set per document id (documents without proposals absent); one query."""
    rows = conn.execute(
        _in_newest_set(
            project_id, AnnotationSnapshotRow.document_id, func.count()
        ).group_by(AnnotationSnapshotRow.document_id)
    ).all()
    return {document_id: count for document_id, count in rows}
