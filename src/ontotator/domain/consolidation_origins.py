"""How each finding of a submitted consolidation came about (#133).

Derived only from the submission itself: its snapshots (the findings) and
its review decisions with their ``ConsolidationMark``. Nothing new is
stored, so the rule also holds for consolidations submitted before it.

A finding is the resulting annotation of the decisions that name it (their
``replacement``, or the target of a ``confirmed`` decision):

* ``matched``: the group matched and was taken over automatically (mark
  ``auto``) and the finding is unchanged since (its content hash equals the
  mark's ``content_sha256``).
* ``decided``: the consolidator decided the group (``keep`` or ``choose``),
  changed an automatically taken-over finding in the editor (``edited``),
  or decided it in the editor without the consolidation view (no mark,
  ``decision`` None).
* ``added``: no decision names it; the consolidator added it outside every
  group.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

from ontotator.domain.annotations import AnnotationSnapshot, annotation_content
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.review import ConsolidationAction, ReviewDecision

__all__ = [
    "FindingOrigin",
    "Origin",
    "OriginCounts",
    "finding_origins",
    "origin_counts",
]

Origin = Literal["matched", "decided", "added"]


@dataclass(frozen=True)
class FindingOrigin:
    annotation_id: str
    version: str
    origin: Origin
    # The group's consolidation action; None for an added finding or a
    # decision made in the editor without a consolidation mark.
    decision: ConsolidationAction | None
    # Changed after the group was resolved (content hash differs from the mark).
    edited: bool
    guidelines_unclear: bool
    decision_ids: tuple[str, ...]


@dataclass(frozen=True)
class OriginCounts:
    matched: int = 0
    decided: int = 0
    added: int = 0


def _content_sha256(snapshot: AnnotationSnapshot) -> str:
    # Same hash as ``consolidation.consolidated_content_sha256``.
    return canonical_hash(annotation_content(snapshot.annotation))


def finding_origins(
    snapshots: Sequence[AnnotationSnapshot], decisions: Iterable[ReviewDecision]
) -> list[FindingOrigin]:
    """One entry per finding, in the order of ``snapshots``."""
    naming: dict[str, list[ReviewDecision]] = {}
    for decision in decisions:
        if decision.outcome == "uncertain":
            continue
        if decision.replacement is not None:
            result = decision.replacement.annotation_id
        elif decision.outcome == "confirmed":
            result = decision.target.annotation_id
        else:
            continue
        naming.setdefault(result, []).append(decision)
    origins = []
    for snapshot in snapshots:
        annotation_id = snapshot.annotation.annotation_id
        named = naming.get(annotation_id, [])
        marks = [d.consolidation for d in named if d.consolidation is not None]
        action = marks[0].action if marks else None
        digest = _content_sha256(snapshot)
        edited = any(
            mark.content_sha256 is not None and mark.content_sha256 != digest
            for mark in marks
        )
        origin: Origin
        if not named:
            origin = "added"
        elif action == "auto" and not edited:
            origin = "matched"
        else:
            origin = "decided"
        origins.append(
            FindingOrigin(
                annotation_id=annotation_id,
                version=snapshot.version,
                origin=origin,
                decision=action,
                edited=edited,
                guidelines_unclear=any(mark.guidelines_unclear for mark in marks),
                decision_ids=tuple(sorted(d.decision_id for d in named)),
            )
        )
    return origins


def origin_counts(origins: Iterable[FindingOrigin]) -> OriginCounts:
    found = [item.origin for item in origins]
    return OriginCounts(
        matched=found.count("matched"),
        decided=found.count("decided"),
        added=found.count("added"),
    )
