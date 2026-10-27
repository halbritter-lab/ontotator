"""Consolidation mark on review decisions (acceptance fixes spec, Persistence).

A decision without a mark dumps exactly as before (no key, same hash); a
decision with a mark round-trips through the JSON payload.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from ontotator.application.consolidation import consolidated_content_sha256
from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
)
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import EvidenceRef
from ontotator.domain.review import ConsolidationMark, ReviewDecision

# canonical_hash(decision().model_dump()) computed on fd667c1, before the mark.
HASH_BEFORE_MARK = "a88f4f0d628a0dc4437a563923ec4a505ae7773f8a352d3e1543461e69ea3c5a"
# Computed on f2ae25fc (before M2); attach and modifiers must not move them.
CONTENT_HASH = "3ad95e911a6047ecea26c2ff110d17a9463716fe71cbe7dbb74670cba22fac85"
MARKED_DECISION_HASH = (
    "dcddbc7ad9a13d936bda80548d2f2465f3077b22b4d89f31639dbdcd6a04dbbb"
)
LEAVE_OUT_DECISION_HASH = (
    "a6f6270a13c55be927877d51825183fa4e586f5e0afad545611d101d6313da4c"
)


def decision(**extra: object) -> ReviewDecision:
    return ReviewDecision(
        decision_id="dec-1",
        target=AnnotationRef(annotation_id="ann-1", version="v1"),
        outcome="confirmed",
        note="ok",
        reviewer_id="rev-1",
        **extra,  # type: ignore[arg-type]
    )


def test_decision_without_mark_dumps_without_key_and_keeps_hash() -> None:
    dumped = decision().model_dump()
    assert "consolidation" not in dumped
    assert "consolidation" not in decision().model_dump(mode="json")
    assert canonical_hash(dumped) == HASH_BEFORE_MARK


def test_decision_with_mark_round_trips() -> None:
    mark = ConsolidationMark(
        action="choose", guidelines_unclear=True, content_sha256="abc"
    )
    original = decision(consolidation=mark)
    payload = original.model_dump(mode="json")
    assert payload["consolidation"] == {
        "action": "choose",
        "guidelines_unclear": True,
        "content_sha256": "abc",
    }
    assert ReviewDecision.model_validate(payload) == original


def test_mark_defaults() -> None:
    mark = ConsolidationMark(action="leave_out")
    assert mark.guidelines_unclear is False
    assert mark.content_sha256 is None
    assert mark.attached_to is None
    assert "attached_to" not in mark.model_dump()
    attached = ConsolidationMark(action="leave_out", attached_to="cons-1")
    assert attached.model_dump()["attached_to"] == "cons-1"


def test_mark_forbids_extra_fields_and_unknown_actions() -> None:
    with pytest.raises(ValidationError):
        ConsolidationMark.model_validate({"action": "keep", "extra": 1})
    with pytest.raises(ValidationError):
        ConsolidationMark.model_validate({"action": "merge"})


# --- pinned hashes (modifiers plan M2): unchanged by modifiers and attach --- #


def cons_annotation() -> Annotation:
    """A fixed ``cons-…`` result without modifiers; axes written out."""
    return Annotation(
        annotation_id="cons-0123456789abcdef",
        document_id="doc-1",
        layer_id="hpo",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values={
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version="e1")],
        provenance=Provenance(
            actor=ActorRef(actor_id="adj-1", kind="human"),
            method="merged",
            source_refs=["round-input:i1", "round-input:i2"],
        ),
    )


def test_consolidated_content_hash_is_pinned() -> None:
    assert consolidated_content_sha256(cons_annotation()) == CONTENT_HASH


def test_marked_decision_hash_is_pinned() -> None:
    marked = decision(
        consolidation=ConsolidationMark(action="keep", content_sha256=CONTENT_HASH)
    )
    assert canonical_hash(marked.model_dump()) == MARKED_DECISION_HASH
    left_out = decision(consolidation=ConsolidationMark(action="leave_out"))
    assert canonical_hash(left_out.model_dump()) == LEAVE_OUT_DECISION_HASH
