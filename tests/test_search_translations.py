"""Translated term names in the search: loading, matches, languages."""

import hashlib
import logging
from pathlib import Path

import pytest

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.provenance import SearchRequest, SearchResult
from ontocurator.ontology.service import OntologyService

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"


def _key(annotator_id: str = "dr-meier") -> WorkspaceKey:
    return WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id="targets-1",
    )


def _service(*translations: Path, ontology: Path = HP) -> OntologyService:
    digest = hashlib.sha256(ontology.read_bytes()).hexdigest()
    return OntologyService.load(
        ontology,
        OntologyRef(release="2026-06-23", sha256=digest),
        translation_paths=translations,
    )


def _search(service: OntologyService, query: str, **overrides: object) -> SearchResult:
    fields: dict[str, object] = {
        "workspace_key": _key(),
        "annotation_id": "ann-1",
        "query": query,
    }
    fields.update(overrides)
    return service.search(SearchRequest.model_validate(fields))


def _plain_identity(ontology: Path) -> str:
    """The identity an index of this file had before translations existed."""
    return canonical_hash(
        {
            "ontology_sha256": hashlib.sha256(ontology.read_bytes()).hexdigest(),
            "algorithm": "char_wb_tfidf/1",
            "ngram_range": [3, 5],
            "id_normalization": "dominant_prefix_int_v1",
        }
    )


# --- loading ---------------------------------------------------------------- #


def test_service_knows_its_languages_files_and_counts() -> None:
    plain = _service()
    assert (plain.languages, plain.translations, plain.translation_counts) == (
        [],
        [],
        {},
    )

    both = _service(ES, DE)
    assert both.languages == ["de", "es"]
    assert both.translation_counts == {"de": 4, "es": 3}
    assert [item.filename for item in both.translations] == [
        "hp-de.babelon.tsv",
        "hp-es.babelon.tsv",
    ]
    assert both.skipped_translations == []

    # Files of another ontology are not this one's.
    mondo = _service(DE, ES, ontology=MONDO)
    assert (mondo.languages, mondo.translations, mondo.skipped_translations) == (
        [],
        [],
        [],
    )


def test_unusable_files_are_logged_and_do_not_stop_the_load(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    no_header = tmp_path / "hp-fr.babelon.tsv"
    no_header.write_text("term\tname\nHP:0001250\tCrise\n", encoding="utf-8")
    no_rows = tmp_path / "hp-nl.babelon.tsv"
    no_rows.write_text(
        "subject_id\tpredicate_id\ttranslation_value\n"
        "HP:9999999\trdfs:label\tOnbekend\n",
        encoding="utf-8",
    )

    with caplog.at_level(logging.WARNING, logger="ontocurator.ontology.service"):
        service = _service(no_header, DE, no_rows)

    assert service.languages == ["de"]
    assert [item.filename for item in service.translations] == ["hp-de.babelon.tsv"]
    assert {item.filename for item in service.skipped_translations} == {
        "hp-fr.babelon.tsv",
        "hp-nl.babelon.tsv",
    }
    assert "Skipping translation file hp-fr.babelon.tsv" in caplog.text
    assert "Skipping translation file hp-nl.babelon.tsv" in caplog.text
    assert "HP:0001250" in _search(service, "Krampfanfall").displayed_ids


def test_identity_changes_with_and_only_with_the_translation_files(
    tmp_path: Path,
) -> None:
    plain = _service()
    german = _service(DE)
    both = _service(DE, ES)

    # Without translations the identity is the one it always was.
    assert plain.index_identity == _plain_identity(HP)
    # Files of another ontology leave the identity alone.
    assert _service(DE, ES, ontology=MONDO).index_identity == _plain_identity(MONDO)
    # A file that contributes nothing is not part of the index.
    useless = tmp_path / "hp-nl.babelon.tsv"
    useless.write_text("subject_id\ttranslation_value\nHP:9\tx\n", encoding="utf-8")
    assert _service(useless).index_identity == _plain_identity(HP)

    assert len({plain.index_identity, german.index_identity, both.index_identity}) == 3
    # The order the files are given in does not matter.
    assert _service(ES, DE).index_identity == both.index_identity

    # Same name, other content: another index.
    changed = tmp_path / "hp-de.babelon.tsv"
    changed.write_bytes(
        DE.read_bytes() + b"HP:0001284\trdfs:label\ten\tAreflexia\tde\tAreflexie\tOK\n"
    )
    assert _service(changed).index_identity != german.index_identity


# --- similar matches -------------------------------------------------------- #


def test_similar_match_on_a_german_name_reports_its_language() -> None:
    result = _search(_service(DE, ES), "Krampfanfälle")

    hit = next(c for c in result.candidates if c.term_id == "HP:0001250")
    assert (hit.route, hit.match_kind, hit.match_language) == ("lexical", "ngram", "de")
    assert hit.matched_term == "Krampfanfall"
    assert hit.label == "Seizure"
    assert hit.score is not None and hit.score > 0.5
    assert result.shuffled is True

    spanish = _search(_service(DE, ES), "crisis epileptica")
    hit = next(c for c in spanish.candidates if c.term_id == "HP:0001250")
    assert (hit.match_language, hit.matched_term) == ("es", "Crisis epiléptica")


def test_without_translation_files_german_names_find_nothing() -> None:
    plain = _service()

    assert all(
        c.match_language in (None, "en")
        for query in ("Muskelhypotonie", "Krampfanfall", "Schwerhörigkeit")
        for c in _search(plain, query).candidates
    )
    assert "HP:0001250" not in _search(plain, "Krampfanfall").displayed_ids


# --- reloading -------------------------------------------------------------- #


def test_with_translations_builds_a_new_service_and_leaves_the_old_one() -> None:
    german = _service(DE)

    both = german.with_translations([DE, ES])
    assert both is not german
    assert both.languages == ["de", "es"]
    assert both.ref == german.ref
    assert both.index_identity == _service(DE, ES).index_identity
    hit = next(
        c for c in _search(both, "Hipotonía").candidates if c.term_id == "HP:0001252"
    )
    assert hit.match_language == "es"

    # The old service is untouched.
    assert german.languages == ["de"]
    assert german.ontology.terms["HP:0001252"].translations == {
        "de": ["Muskelhypotonie"]
    }
    assert german.index_identity == _service(DE).index_identity

    # A file that is no longer given leaves nothing behind.
    spanish = both.with_translations([ES])
    assert spanish.languages == ["es"]
    assert spanish.ontology.terms["HP:0001252"].translations == {"es": ["Hipotonía"]}
    assert "HP:0001250" not in _search(spanish, "Krampfanfall").displayed_ids
    assert spanish.with_translations([]).index_identity == _plain_identity(HP)
