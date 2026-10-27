"""Sparse layout avoids repeated ontology conversion without changing scores."""

import copy
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import scipy.sparse as sp

from ontotator.ontology.translations import LanguageLexicalIndex
from ontotator.vendor.hpo_span_annotator.hpo import load, load_translations
from ontotator.vendor.hpo_span_annotator.lexical import LexicalIndex

FIXTURES = Path(__file__).parent / "fixtures"
QUERIES = (
    "Seizure",
    "hypoton",
    "low muscle tone",
    "Krampfanfall",
    "Convulsión",
    "shared tie",
    "zzzzzz",
    "",
)


@pytest.fixture
def index() -> LanguageLexicalIndex:
    ontology = load(FIXTURES / "hp.json")
    load_translations(
        ontology, [FIXTURES / f"hp-{code}.babelon.tsv" for code in ("de", "es")]
    )
    for term_id in ("HP:0001250", "HP:0001252"):
        ontology.terms[term_id].synonyms.append(("hasExactSynonym", "shared tie"))
    result = LanguageLexicalIndex(ontology, languages=["de", "es"])
    result.build()
    return result


@pytest.mark.parametrize("languages", [None, [], ["de"], ["es"]])
def test_search_does_not_reconvert_fitted_ontology(
    index: LanguageLexicalIndex,
    languages: list[str] | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Warm subset fitting separately: only subsequent query work is observed.
    index.search("Seizure", 10, languages=languages)
    conversions: list[tuple[int, int]] = []
    original = sp.csc_matrix.tocsr

    def observed(matrix: Any, *args: Any, **kwargs: Any) -> Any:
        if min(matrix.shape) > 1:
            conversions.append(matrix.shape)
        return original(matrix, *args, **kwargs)

    monkeypatch.setattr(sp.csc_matrix, "tocsr", observed)
    for query in QUERIES:
        index.search(query, 10, languages=languages)
    assert conversions == [], "search converted the full fitted ontology matrix"


@pytest.mark.parametrize("languages", [None, [], ["de"], ["es"]])
@pytest.mark.parametrize("k", [1, 3, 10, 100])
def test_search_exactly_matches_csr_reference(
    index: LanguageLexicalIndex, languages: list[str] | None, k: int
) -> None:
    selected = index.languages if languages is None else languages
    reference = LexicalIndex(index.ontology, languages=selected)
    reference.build()
    # Recreate the original build path directly, without a CSC round trip.
    reference._matrix = sp.csr_matrix(
        reference._vectorizer.fit_transform(reference._terms)
    )
    index.search("Seizure", k, languages=languages)
    fitted = (
        index if selected == index.languages else index._subset_indexes[tuple(selected)]
    )
    for query in QUERIES:
        # Compare unrounded floats as well as the public hit dictionaries/order.
        expected = (
            reference._vectorizer.transform([query]) @ reference._matrix.T
        ).toarray()
        actual = (fitted._vectorizer.transform([query]) @ fitted._matrix.T).toarray()
        np.testing.assert_array_equal(actual, expected)
        assert index.search(query, k, languages=languages) == reference.search(query, k)
    if k >= 3:
        tied = index.search("shared tie", k, languages=languages)
        assert {hit["hpo_id"] for hit in tied[:2]} == {"HP:0001250", "HP:0001252"}
        assert tied[0]["score"] == tied[1]["score"]
    assert index.search("zzzzzz", k, languages=languages) == []


def test_pinned_view_shares_fit_but_owns_subset_cache(
    index: LanguageLexicalIndex,
) -> None:
    index.search("Seizure", 10, languages=[])
    view = index.with_ontology(copy.deepcopy(index.ontology))
    assert view._matrix is index._matrix
    assert not view._subset_indexes
    expected = view.search("Seizure", 10, languages=[])
    index.ontology.terms["HP:0001250"].label = "Ambient mutation"
    assert view.search("Seizure", 10, languages=[]) == expected
    assert view._subset_indexes[()]._matrix is not index._subset_indexes[()]._matrix
