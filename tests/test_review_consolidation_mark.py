"""Consolidation mark on review decisions (acceptance fixes spec, Persistence).

A decision without a mark dumps exactly as before (no key, same hash); a
decision with a mark round-trips through the JSON payload.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.review import ConsolidationMark, ReviewDecision

# canonical_hash(decision().model_dump()) computed on fd667c1, before the mark.
HASH_BEFORE_MARK = "a88f4f0d628a0dc4437a563923ec4a505ae7773f8a352d3e1543461e69ea3c5a"


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


def test_mark_forbids_extra_fields_and_unknown_actions() -> None:
    with pytest.raises(ValidationError):
        ConsolidationMark.model_validate({"action": "keep", "extra": 1})
    with pytest.raises(ValidationError):
        ConsolidationMark.model_validate({"action": "merge"})
