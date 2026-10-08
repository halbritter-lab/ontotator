"""Translated term names in the search: loading, matches, languages."""

import hashlib
import json
import logging
from pathlib import Path

import pytest

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.provenance import SearchRequest, SearchResult
from ontocurator.ontology.service import OntologyService
from ontocurator.packages.models import SearchEventRecord

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


# --- exact matches ---------------------------------------------------------- #


def test_exact_match_on_a_german_name_reports_its_language() -> None:
    result = _search(_service(DE, ES), "Muskelhypotonie")

    first = result.candidates[0]
    assert (first.term_id, first.route, first.match_kind, first.match_language) == (
        "HP:0001252",
        "exact",
        "translation",
        "de",
    )
    assert first.matched_term == "Muskelhypotonie"
    assert first.label == "Hypotonia"
    assert (first.rank, first.display_pos, first.score) == (1, 1, None)
    assert result.displayed_ids[0] == result.ranked_ids[0] == "HP:0001252"
    # The exact hit is not repeated in the similar block.
    assert result.displayed_ids.count("HP:0001252") == 1


def test_exact_match_on_a_translated_name_ignores_case_and_accents() -> None:
    service = _service(DE, ES)

    german = _search(service, "schwerhorigkeit").candidates[0]
    assert (german.term_id, german.route, german.match_language) == (
        "HP:0000365",
        "exact",
        "de",
    )
    assert german.matched_term == "Schwerhörigkeit"

    spanish = _search(service, "HIPOTONIA").candidates[0]
    assert (spanish.term_id, spanish.route, spanish.match_language) == (
        "HP:0001252",
        "exact",
        "es",
    )
    assert spanish.matched_term == "Hipotonía"


def test_english_exact_matches_come_before_translated_ones(tmp_path: Path) -> None:
    # "Seizure" is the label of HP:0001250. Here it is also a German name of two
    # other terms, and a Spanish name of a third.
    german = tmp_path / "hp-de.babelon.tsv"
    german.write_text(
        "subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        "HP:0001284\trdfs:label\tde\tSeizure\n"
        "HP:0001252\trdfs:label\tde\tSeizure\n",
        encoding="utf-8",
    )
    spanish = tmp_path / "hp-es.babelon.tsv"
    spanish.write_text(
        "subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        "HP:0000365\trdfs:label\tes\tSeizure\n"
        "HP:0001252\trdfs:label\tes\tSeizure\n",
        encoding="utf-8",
    )
    service = _service(spanish, german)
    result = _search(service, "seizure")

    exact = [c for c in result.candidates if c.route == "exact"]
    # English first; then by language code and term id; each term once.
    assert [(c.term_id, c.match_kind, c.match_language) for c in exact] == [
        ("HP:0001250", "label", None),
        ("HP:0001252", "translation", "de"),
        ("HP:0001284", "translation", "de"),
        ("HP:0000365", "translation", "es"),
    ]
    assert [c.rank for c in exact] == [1, 2, 3, 4]
    assert [c.display_pos for c in exact] == [1, 2, 3, 4]
    assert result.displayed_ids[:4] == [c.term_id for c in exact]
    assert len(result.displayed_ids) == len(set(result.displayed_ids))
    assert {c.route for c in result.candidates[4:]} <= {"lexical"}

    # Exact matches take precedence within k, English first.
    two = _search(service, "seizure", k=2)
    assert two.displayed_ids == ["HP:0001250", "HP:0001252"]
    assert two.shuffled is False


# --- language selection ----------------------------------------------------- #


def test_request_and_result_carry_the_languages() -> None:
    assert (
        SearchRequest.model_validate(
            {"workspace_key": _key(), "annotation_id": "a", "query": "q"}
        ).languages
        is None
    )
    assert SearchResult(route="auto", query="q").languages == []

    plain = _service()
    assert _search(plain, "Muskelhypotonie").languages == ["en"]
    assert _search(plain, "Muskelhypotonie", languages=["de"]).languages == ["en"]
    assert _search(plain, "HP:0001250").languages == ["en"]


def test_missing_languages_field_means_all_loaded_languages() -> None:
    service = _service(DE, ES)

    assert _search(service, "Krampfanfall").languages == ["en", "de", "es"]
    assert _search(service, "Krampfanfall", languages=None).languages == [
        "en",
        "de",
        "es",
    ]
    assert _search(service, "Krampfanfall").candidates[0].match_language == "de"
    assert _search(service, "Hipotonía").candidates[0].match_language == "es"


def test_a_deselected_language_yields_no_match_through_its_names() -> None:
    service = _service(DE, ES)

    # Exact block: the German name does not count, the Spanish one still does.
    spanish_only = _search(service, "Krampfanfall", languages=["es"])
    assert spanish_only.languages == ["en", "es"]
    assert "HP:0001250" not in spanish_only.displayed_ids
    assert all(c.match_language != "de" for c in spanish_only.candidates)
    assert (
        _search(service, "Hipotonía", languages=["es"]).candidates[0].route == "exact"
    )

    # Similar block.
    english_only = _search(service, "Krampfanfälle", languages=[])
    assert english_only.languages == ["en"]
    assert "HP:0001250" not in english_only.displayed_ids
    assert all(c.match_language in (None, "en") for c in english_only.candidates)

    # Codes that are not loaded are ignored; case and spaces do not matter.
    odd = _search(service, "Krampfanfall", languages=[" DE ", "xx", "en"])
    assert odd.languages == ["en", "de"]
    assert odd.candidates[0].term_id == "HP:0001250"


def test_a_term_stays_findable_through_an_allowed_name() -> None:
    """The best name of Hypotonia for this query is German. With German off the
    term must still be listed, through an English name of its own. Filtering
    the finished list by the language of the best name would lose it."""
    service = _service(DE, ES)

    with_german = _search(service, "Muskelhypotonie")
    assert with_german.candidates[0].route == "exact"
    assert with_german.candidates[0].match_language == "de"

    without = _search(service, "Muskelhypotonie", languages=["es"])
    hit = next(c for c in without.candidates if c.term_id == "HP:0001252")
    assert (hit.route, hit.match_language) == ("lexical", "en")
    assert hit.matched_term == "Hypotonia"
    assert hit.score is not None and 0 < hit.score < 1

    # The same on the explicit lexical route.
    legacy = _search(service, "Muskelhypotonie", languages=[], route="lexical")
    hit = next(c for c in legacy.candidates if c.term_id == "HP:0001252")
    assert (hit.match_language, hit.matched_term) == ("en", "Hypotonia")
    assert legacy.shuffled is True
    assert {c.route for c in legacy.candidates} == {"lexical"}
    everything = _search(service, "Muskelhypotonie", route="lexical")
    hit = next(c for c in everything.candidates if c.term_id == "HP:0001252")
    assert (hit.match_language, hit.matched_term) == ("de", "Muskelhypotonie")


def _shared_name_files(tmp_path: Path) -> tuple[Path, Path]:
    """A French and a Dutch file that give Hypotonia the same name."""
    paths = []
    for code in ("fr", "nl"):
        path = tmp_path / f"hp-{code}.babelon.tsv"
        path.write_text(
            "subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
            f"HP:0001252\trdfs:label\t{code}\tHypotonie\n",
            encoding="utf-8",
        )
        paths.append(path)
    return paths[0], paths[1]


@pytest.mark.parametrize(
    ("languages", "reported"),
    [
        (["nl"], "nl"),
        (["fr"], "fr"),
        (["fr", "nl"], "fr"),
        (["nl", "fr"], "fr"),
        (None, "fr"),
    ],
)
def test_a_name_shared_by_two_languages_counts_for_each_of_them(
    tmp_path: Path, languages: list[str] | None, reported: str
) -> None:
    """The index holds a string once per term. A name that two languages share
    must stay findable when one of them is switched off, and the hit names a
    language that was searched."""
    service = _service(*_shared_name_files(tmp_path))
    assert service.translation_counts == {"fr": 1, "nl": 1}

    legacy = _search(service, "Hypotonie", languages=languages, route="lexical")
    hit = next(c for c in legacy.candidates if c.term_id == "HP:0001252")
    assert (hit.matched_term, hit.score, hit.match_language) == (
        "Hypotonie",
        1.0,
        reported,
    )

    # The similar block of the single search, with a query that equals no name.
    similar = _search(service, "Hypotonies", languages=languages)
    hit = next(c for c in similar.candidates if c.term_id == "HP:0001252")
    assert (hit.route, hit.matched_term, hit.match_language) == (
        "lexical",
        "Hypotonie",
        reported,
    )


def test_a_shared_name_is_off_when_all_its_languages_are_off(tmp_path: Path) -> None:
    service = _service(*_shared_name_files(tmp_path), DE)

    for languages in ([], ["de"]):
        result = _search(service, "Hypotonie", languages=languages, route="lexical")
        hit = next(c for c in result.candidates if c.term_id == "HP:0001252")
        assert (hit.matched_term, hit.match_language) == ("Hypotonia", "en")
        assert hit.score is not None and hit.score < 1


def test_english_stays_on_whatever_is_selected() -> None:
    service = _service(DE, ES)

    for languages in ([], ["de"], ["es"], ["de", "es"], None):
        result = _search(service, "Hypotonia", languages=languages)
        first = result.candidates[0]
        assert (first.term_id, first.route, first.match_kind) == (
            "HP:0001252",
            "exact",
            "label",
        )
        assert result.languages[0] == "en"

    similar = _search(service, "low muscle", languages=[])
    hit = next(c for c in similar.candidates if c.term_id == "HP:0001252")
    assert (hit.match_language, hit.matched_term) == ("en", "Low muscle tone")


def test_the_language_selection_is_part_of_the_shuffle_seed() -> None:
    service = _service(DE, ES)
    query = "hearing"

    seeds = {
        name: _search(service, query, languages=languages).seed
        for name, languages in {
            "none": [],
            "de": ["de"],
            "es": ["es"],
            "both": ["de", "es"],
            "all": None,
        }.items()
    }
    assert None not in seeds.values()
    assert seeds["both"] == seeds["all"]
    assert len({seeds["none"], seeds["de"], seeds["es"], seeds["both"]}) == 4
    # Order and spelling of the request do not make a new question.
    assert _search(service, query, languages=["ES", "de"]).seed == seeds["both"]
    # English only is the question the search asked before translations.
    assert _search(_service(), query).seed == seeds["none"]
    assert _search(_service(DE), query).seed == seeds["de"]
    # Still keyed by annotator.
    other = _search(service, query, workspace_key=_key("dr-other"), languages=["de"])
    assert other.seed != seeds["de"]
    # The explicit lexical route uses the same key.
    assert (
        _search(service, query, languages=["de"], route="lexical").seed == seeds["de"]
    )


def test_the_language_selection_is_not_part_of_the_index_identity() -> None:
    service = _service(DE, ES)

    assert {
        _search(service, "Krampfanfall", languages=languages).index_identity
        for languages in ([], ["de"], ["es"], None)
    } == {service.index_identity}


def test_search_event_keeps_languages_and_reads_old_events() -> None:
    old_payload = {
        "event_id": "evt-old",
        "workspace_key": _key().model_dump(),
        "annotation_id": "ann-1",
        "query": "hypotonia",
        "route": "auto",
        "candidates": ["HP:0001252"],
        "ontology_release": "2026-01-01",
        "index_identity": "idx",
        "timestamp": "2026-01-01T00:00:00+00:00",
    }
    old = SearchEventRecord.model_validate_json(json.dumps(old_payload))
    assert old.languages == []

    new = SearchEventRecord.model_validate({**old_payload, "languages": ["en", "de"]})
    again = SearchEventRecord.model_validate_json(new.model_dump_json())
    assert again.languages == ["en", "de"]
