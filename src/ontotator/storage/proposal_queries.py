"""The newest tool proposal set of a document (spec 2026-10-23 §1 Targets).

Targets of an "Annotate from proposals" round, proposal counts (read model,
text view) and export precision all use this set. Seed-package proposals
(``proposal_set_id IS NULL``) form one set, used only when the document has
no imported set.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Connection, Subquery, and_, func, select

from ontotator.domain.annotations import AnnotationRef
from ontotator.storage.tables import (
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


def _in_newest_set(project_id: int) -> Subquery:
    """(document_id, annotation_id, version) of each document's newest set.

    One join on purpose: right after an import the planner has no statistics
    for the project, and joining the proposals to a per-document ``max`` of
    themselves then ran for minutes. NULLS LAST: seed proposals rank first
    only without an imported set.
    """
    ranked = (
        select(
            AnnotationSnapshotRow.document_id,
            ProposalAnnotationRow.annotation_id,
            ProposalAnnotationRow.version,
            func.rank()
            .over(
                partition_by=AnnotationSnapshotRow.document_id,
                order_by=ProposalAnnotationRow.proposal_set_id.desc().nulls_last(),
            )
            .label("set_rank"),
        )
        .join(AnnotationSnapshotRow, _SNAPSHOT_JOIN)
        .where(ProposalAnnotationRow.project_id == project_id)
        .subquery()
    )
    return select(ranked).where(ranked.c.set_rank == 1).subquery()


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
    newest = _in_newest_set(project_id)
    rows = conn.execute(
        select(newest.c.annotation_id, newest.c.version)
        .where(newest.c.document_id == document_id)
        .order_by(newest.c.annotation_id, newest.c.version)
    ).all()
    return [AnnotationRef(annotation_id=row[0], version=row[1]) for row in rows]


def newest_proposal_counts(conn: Connection, project_id: int) -> dict[str, int]:
    """Proposals of the newest set per document id (documents without proposals absent); one query."""
    newest = _in_newest_set(project_id)
    rows = conn.execute(
        select(newest.c.document_id, func.count()).group_by(newest.c.document_id)
    ).all()
    return {document_id: count for document_id, count in rows}
