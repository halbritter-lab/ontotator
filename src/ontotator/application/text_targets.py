"""The text (case + language) of a document and the text's target document.

The one derivation (plan P3, review R11): P3, P4, P5 and P8 import it. It
reuses the work plan's version chains (``work_plans._chains`` and ``_target``,
the derivation ``TextChangeService.current_target`` uses).
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import Connection, select

from ontotator.application.work_plans import _chains, _live, _target
from ontotator.domain.document_rows import Chain
from ontotator.domain.errors import DomainError
from ontotator.domain.variants import VariantInfo
from ontotator.domain.work_plans import RowKey
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import AssignmentRow, DocumentRow

__all__ = [
    "TextRow",
    "finished_translation_documents",
    "superseded_versions",
    "text_documents",
    "text_row",
    "text_target_document",
    "text_translation_statuses",
]


@dataclass(frozen=True)
class TextRow:
    case_id: str
    language: str


def text_row(conn: Connection, project_id: int, document_id: str) -> TextRow:
    row = conn.execute(
        select(DocumentRow.case_id, DocumentRow.language).where(
            DocumentRow.project_id == project_id,
            DocumentRow.document_id == document_id,
        )
    ).one_or_none()
    if row is None:
        raise DomainError("DOCUMENT_NOT_FOUND")
    return TextRow(row.case_id, row.language)


def text_documents(conn: Connection, project_id: int, row: TextRow) -> list[str]:
    """Every version's document id of the text, oldest first."""
    return list(
        conn.execute(
            select(DocumentRow.document_id)
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.case_id == row.case_id,
                DocumentRow.language == row.language,
            )
            .order_by(DocumentRow.version, DocumentRow.document_id)
        ).scalars()
    )


def _live_chains(conn: Connection, project_id: int, row: TextRow) -> list[Chain]:
    chains = _chains(conn, project_id, [row.case_id]).get(
        RowKey(row.case_id, row.language), []
    )
    discarded = conn.execute(
        select(DiscardedVariantRow.document_id).where(
            DiscardedVariantRow.project_id == project_id,
            DiscardedVariantRow.document_id.in_(
                [v.document_id for chain in chains for v in chain.versions]
            ),
        )
    ).scalars()
    return _live(chains, set(discarded))


def text_translation_statuses(
    conn: Connection, project_id: int, row: TextRow
) -> tuple[str | None, ...]:
    """The target version's translation status of every live root, as the
    next steps see them (``StepFacts.translation_statuses``)."""
    return tuple(
        _target(chain).translation_status
        for chain in _live_chains(conn, project_id, row)
    )


def superseded_versions(
    conn: Connection, project_id: int, variants: Collection[VariantInfo]
) -> set[str]:
    """Those of ``variants`` that are no target of their root: a counted
    correction exists, or they are a correction that does not count. A task
    closed on one opens only through the lead (issue 213)."""
    chains = _chains(conn, project_id, sorted({v.case_id for v in variants}))
    targets = {_target(chain).document_id for row in chains.values() for chain in row}
    return {v.document_id for v in variants} - targets


def text_target_document(conn: Connection, project_id: int, row: TextRow) -> str:
    """The newest counted version: the document new work goes to.

    Chains with a discarded version never hold the target. With several live
    roots (parallel translations) the root with the highest position wins, as
    ``document_rows.open_target`` picks the text to open.
    """
    chains = _live_chains(conn, project_id, row)
    if not chains:
        raise DomainError("NOT_IN_WORK_PLAN")
    latest = max(
        chains,
        key=lambda c: (-1 if c.root.position is None else c.root.position, c.root_id),
    )
    return _target(latest).document_id


def finished_translation_documents(
    conn: Connection, project_id: int, case_ids: Collection[str]
) -> set[str]:
    """The target versions of the translated texts of ``case_ids`` whose
    translation is finished for annotation.

    A text (case + language) is finished when every live root's target
    version is accepted (parallel translations included, as
    ``next_steps.translations_accepted``) and no translation review of any of
    its versions is open (a second or a correction review). A rejected or
    queried version is "reviewed", not accepted, so it waits for the lead's
    decision. Source texts have no translation status and never count.
    """
    if not case_ids:
        return set()
    chains = _chains(conn, project_id, sorted(set(case_ids)))
    discarded = set(
        conn.execute(
            select(DiscardedVariantRow.document_id).where(
                DiscardedVariantRow.project_id == project_id,
                DiscardedVariantRow.document_id.in_(
                    [
                        v.document_id
                        for row in chains.values()
                        for chain in row
                        for v in chain.versions
                    ]
                ),
            )
        ).scalars()
    )
    reviewed = set(
        conn.execute(
            select(DocumentRow.case_id, DocumentRow.language)
            .join(
                AssignmentRow,
                (AssignmentRow.project_id == DocumentRow.project_id)
                & (AssignmentRow.document_id == DocumentRow.document_id),
            )
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.case_id.in_(sorted(set(case_ids))),
                AssignmentRow.task == "translation_review",
                AssignmentRow.revoked_at.is_(None),
                AssignmentRow.status != "submitted",
            )
        ).tuples()
    )
    finished: set[str] = set()
    for key, row in chains.items():
        live = _live(row, discarded)
        targets = [_target(chain) for chain in live]
        if (
            targets
            and (key.case_id, key.language) not in reviewed
            and all(t.translation_status == "accepted" for t in targets)
        ):
            finished |= {t.document_id for t in targets}
    return finished
