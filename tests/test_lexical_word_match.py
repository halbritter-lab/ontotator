"""The lexical route keeps typo tolerance but drops hits that only share an ending (21.4)."""

from pathlib import Path

from ontotator.vendor.hpo_span_annotator.hpo import load
from ontotator.vendor.hpo_span_annotator.lexical import LexicalIndex, word_tier

FIXTURES = Path(__file__).parent / "fixtures"


def _index() -> LexicalIndex:
    ontology = load(FIXTURES / "hp.json")
    ontology.terms["HP:0001284"].synonyms.append(
        ("hasExactSynonym", "Transient areflexia")
    )
    index = LexicalIndex(ontology)
    index.build()
    return index


def test_patient_does_not_find_transient() -> None:
    assert word_tier("patient", "Transient areflexia") is None
    assert all(
        "ransient" not in hit["matched_term"] for hit in _index().search("patient", 16)
    )


def test_a_typo_still_finds_its_term() -> None:
    hits = _index().search("seizrue", 16)
    assert hits[0]["hpo_id"] == "HP:0001250"
    assert word_tier("hypotonya", "Hypotonia") is not None
    assert word_tier("seizrue", "Celiac sprue") is None


def test_word_matches_rank_before_typo_matches() -> None:
    assert word_tier("hypoton", "Hypotonia") == 0
    assert word_tier("hypotonie", "Muskelhypotonie") == 1
    assert word_tier("Muskelhypotonie", "Hypotonia") == 1
