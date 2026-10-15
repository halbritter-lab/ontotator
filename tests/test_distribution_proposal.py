from collections import Counter
from dataclasses import FrozenInstanceError

import pytest

from ontocurator.assignments.distribution import (
    Candidate,
    DistributionProposal,
    DocumentItem,
    Unassignable,
    propose_distribution,
)


def candidate(user_id: int, *, languages: str = "en", load: int = 0) -> Candidate:
    return Candidate(user_id, f"reader-{user_id}", frozenset(languages.split()), load)


def document(document_id: str, language: str = "en", *excluded: int) -> DocumentItem:
    return DocumentItem(document_id, language, frozenset(excluded))


def test_the_same_seed_gives_the_same_proposal() -> None:
    documents = [document(str(i)) for i in range(10)]
    candidates = [candidate(i) for i in range(3)]
    first = propose_distribution(documents, candidates, per_document=2, seed=42)
    assert first == propose_distribution(documents, candidates, per_document=2, seed=42)
    assert first.seed == 42
    assert first.per_document == 2
    assert len(first.rows) == 20
    assert first.unassignable == ()
    for item in documents:
        assert len({user for doc, user in first.rows if doc == item.document_id}) == 2


def test_another_seed_may_differ() -> None:
    candidates = [candidate(i) for i in (1, 2, 3)]
    assert propose_distribution(
        [document("a")], candidates, per_document=1, seed=0
    ).rows == (("a", 3),)
    assert propose_distribution(
        [document("a")], candidates, per_document=1, seed=1
    ).rows == (("a", 1),)


def test_load_is_balanced_within_one() -> None:
    candidates = [candidate(i, load=4) for i in (1, 2, 3)]
    proposal = propose_distribution(
        [document(str(i)) for i in range(10)], candidates, per_document=1, seed=17
    )
    counts = Counter(user for _, user in proposal.rows)
    loads = [c.load + counts[c.user_id] for c in candidates]
    assert max(loads) - min(loads) <= 1


def test_only_readers_of_the_language_are_proposed() -> None:
    proposal = propose_distribution(
        [document("english"), document("german", "de")],
        [candidate(1), candidate(2, languages="de"), candidate(3, languages="fr")],
        per_document=1,
        seed=0,
    )
    assert proposal.rows == (("english", 1), ("german", 2))


def test_documents_without_readers_are_listed_without_partial_rows() -> None:
    proposal = propose_distribution(
        [document("none", "fr"), document("few", "de"), document("enough")],
        [candidate(1, languages="en de"), candidate(2), candidate(3)],
        per_document=2,
        seed=3,
    )
    assert proposal.unassignable == (
        Unassignable("none", "NO_READER", 0),
        Unassignable("few", "TOO_FEW_READERS", 1),
    )
    # The failed partial allocation must not increase user 1's load. Seed 3's
    # third document draws .013, .837, .259, so users 1 and 3 are picked in order.
    assert proposal.rows == (("enough", 1), ("enough", 3))


def test_existing_load_is_respected() -> None:
    proposal = propose_distribution(
        [document(str(i)) for i in range(8)],
        [candidate(1, load=5), candidate(2), candidate(3)],
        per_document=1,
        seed=2,
    )
    assert Counter(user for _, user in proposal.rows) == {2: 4, 3: 4}


def test_excluded_users_are_never_proposed() -> None:
    proposal = propose_distribution(
        [document("a", "en", 1)],
        [candidate(1), candidate(2, load=20)],
        per_document=1,
        seed=0,
    )
    assert proposal.rows == (("a", 2),)


def test_inputs_and_results_are_immutable() -> None:
    documents = [document("a")]
    candidates = [candidate(1), candidate(2)]
    before = (documents.copy(), candidates.copy())
    result = propose_distribution(documents, candidates, per_document=1, seed=0)
    assert (documents, candidates) == before
    assert isinstance(result.rows, tuple)
    assert isinstance(result.rows[0], tuple)
    with pytest.raises(FrozenInstanceError):
        candidates[0].load = 10  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        documents[0].language = "de"  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        result.seed = 10  # type: ignore[misc]
    unassignable = Unassignable("a", "NO_READER", 0)
    with pytest.raises(FrozenInstanceError):
        unassignable.eligible_count = 1  # type: ignore[misc]


def test_candidate_order_does_not_change_draws_or_output() -> None:
    documents = [document(str(i)) for i in range(5)]
    candidates = [candidate(i) for i in (3, 1, 2)]
    assert propose_distribution(
        documents, candidates, per_document=2, seed=0
    ) == propose_distribution(documents, candidates[::-1], per_document=2, seed=0)


def test_ineligible_candidates_still_consume_their_seeded_draw() -> None:
    # Seed 1 draws .134, .847, .764: user 1 consumes the first draw.
    proposal = propose_distribution(
        [document("a")],
        [candidate(1, languages="de"), candidate(2), candidate(3)],
        per_document=1,
        seed=1,
    )
    assert proposal.rows == (("a", 3),)


def test_unassignable_documents_still_consume_draws() -> None:
    # Seed 0: the first three draws are consumed by the unreadable document;
    # the next three are .259, .511, .405, selecting user 1.
    proposal = propose_distribution(
        [document("none", "de"), document("a")],
        [candidate(i) for i in (1, 2, 3)],
        per_document=1,
        seed=0,
    )
    assert proposal.rows == (("a", 1),)
    assert proposal.unassignable == (Unassignable("none", "NO_READER", 0),)


def test_document_order_controls_draws_and_row_order() -> None:
    candidates = [candidate(i) for i in (1, 2, 3)]
    assert propose_distribution(
        [document("b"), document("a")], candidates, per_document=1, seed=0
    ).rows == (("b", 3), ("a", 1))
    assert propose_distribution(
        [document("a"), document("b")], candidates, per_document=1, seed=0
    ).rows == (("a", 3), ("b", 1))


def test_required_languages_can_require_both_translation_languages() -> None:
    proposal = propose_distribution(
        [document("translation", "de")],
        [
            candidate(1, languages="de"),
            candidate(2, languages="en"),
            candidate(3, languages="de en"),
        ],
        per_document=1,
        seed=0,
        required_languages=lambda doc: frozenset({doc.language, "en"}),
    )
    assert proposal.rows == (("translation", 3),)


@pytest.mark.parametrize("per_document", [0, -1])
def test_invalid_per_document_is_rejected_even_for_empty_inputs(
    per_document: int,
) -> None:
    with pytest.raises(ValueError, match="per_document"):
        propose_distribution([], [], per_document=per_document, seed=0)


def test_duplicate_candidate_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match=r"candidate.*user_id"):
        propose_distribution(
            [], [candidate(1), candidate(1, languages="de")], per_document=1, seed=0
        )


def test_duplicate_document_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match=r"document.*document_id"):
        propose_distribution(
            [document("a"), document("a", "de")], [], per_document=1, seed=0
        )


def test_negative_load_is_rejected() -> None:
    with pytest.raises(ValueError, match="load"):
        propose_distribution([], [candidate(1, load=-1)], per_document=1, seed=0)


def test_empty_inputs_return_an_empty_proposal() -> None:
    assert propose_distribution([], [], per_document=1, seed=0) == DistributionProposal(
        (), (), 0, 1
    )


def test_empty_candidates_report_every_document() -> None:
    assert propose_distribution(
        [document("a")], [], per_document=1, seed=0
    ).unassignable == (Unassignable("a", "NO_READER", 0),)
