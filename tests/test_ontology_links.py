"""Where a term can be looked up outside Ontotator."""

import pytest

from ontotator.ontology.links import external_term_url


@pytest.mark.parametrize(
    ("term_id", "expected"),
    [
        ("HP:0001250", "https://hpo.jax.org/browse/term/HP:0001250"),
        ("MONDO:0007739", "https://monarchinitiative.org/MONDO:0007739"),
        ("GO:0008150", "https://www.ebi.ac.uk/ols4/search?q=GO%3A0008150"),
        ("TEST:0000001", "https://www.ebi.ac.uk/ols4/search?q=TEST%3A0000001"),
    ],
)
def test_each_prefix_links_to_its_term_page(term_id: str, expected: str) -> None:
    assert external_term_url(term_id) == expected


def test_the_id_is_encoded_where_it_could_break_the_url() -> None:
    assert (
        external_term_url("HP:12 3/4")
        == "https://hpo.jax.org/browse/term/HP%3A12%203%2F4"
    )


@pytest.mark.parametrize("term_id", ["", "no-prefix", ":0001", "HP:"])
def test_something_that_is_no_curie_has_no_link(term_id: str) -> None:
    assert external_term_url(term_id) is None
