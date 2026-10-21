"""A pinned view over the loaded translations is cheap and searches the same (C3).

The reference is the former construction: a deep copy of the base ontology with
the captured translation files parsed again onto it. The fast view restores
the names kept from the base's own build instead and shares the fitted
language subsets with every other view of that build.
"""

import copy
import hashlib
import json
import threading
from pathlib import Path
from typing import Any

import pytest

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology import service as service_module
from ontocurator.ontology import translations as translations_module
from ontocurator.ontology.provenance import SearchRequest
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.ontology.translations import LanguageLexicalIndex, apply_translations
from ontocurator.vendor.hpo_span_annotator.lexical import LexicalIndex
from ontocurator.vendor.hpo_span_annotator.search import SearchEngine

KEY = WorkspaceKey(
    project_key="p",
    document_id="doc",
    annotator_id="alice",
    mode="independent",
    target_set_id="targets-0",
)
WORDS = [
    "abnormal",
    "muscle",
    "tone",
    "hearing",
    "loss",
    "seizure",
    "kidney",
    "cyst",
    "heart",
    "defect",
    "short",
    "stature",
    "eye",
    "lens",
    "skin",
    "rash",
]
GERMAN = {
    "abnormal": "abnorm",
    "muscle": "Muskel",
    "tone": "Tonus",
    "hearing": "Hör",
    "loss": "verlust",
    "seizure": "Krampfanfall",
    "kidney": "Niere",
    "cyst": "Zyste",
    "heart": "Herz",
    "defect": "Fehler",
    "short": "klein",
    "stature": "Wuchs",
    "eye": "Auge",
    "lens": "Linse",
    "skin": "Haut",
    "rash": "Ausschlag",
}
FRENCH = {
    "abnormal": "anormal",
    "muscle": "muscle",
    "tone": "tonus",
    "hearing": "audition",
    "loss": "perte",
    "seizure": "crise",
    "kidney": "rein",
    "cyst": "kyste",
    "heart": "coeur",
    "defect": "défaut",
    "short": "petite",
    "stature": "taille",
    "eye": "oeil",
    "lens": "cristallin",
    "skin": "peau",
    "rash": "éruption",
}
HEADER = (
    "subject_id\tpredicate_id\tsource_language\tsource_value\t"
    "translation_language\ttranslation_value\ttranslation_status\n"
)
QUERIES = ["Muskel Tonus", "hearing loss", "Niere Zyste", "crise", "Haut", "kyste"]
LANGUAGE_SETS: list[list[str] | None] = [None, [], ["de"], ["fr"], ["de", "fr"]]


def _phrase(number: int) -> list[str]:
    return [WORDS[number % 16], WORDS[(number // 3) % 16], WORDS[(number * 7) % 16]]


@pytest.fixture(scope="module")
def corpus(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, list[Path]]:
    """A few hundred terms with English, German and French names.

    The German synonym file repeats French names, so a name in two languages
    (and its first-language attribution) is part of what must stay identical.
    """
    root = tmp_path_factory.mktemp("c3-corpus")
    nodes: list[dict[str, Any]] = [
        {
            "id": "http://purl.obolibrary.org/obo/HP_0000001",
            "lbl": "All",
            "type": "CLASS",
        }
    ]
    edges = []
    for number in range(1, 400):
        words = _phrase(number)
        meta: dict[str, Any] = {
            "synonyms": [
                {"pred": "hasExactSynonym", "val": f"{words[1]} {words[2]}"},
                {"pred": "hasRelatedSynonym", "val": f"{words[2]} of {words[0]}"},
            ]
        }
        if number % 50 == 0:
            meta["deprecated"] = True
        nodes.append(
            {
                "id": f"http://purl.obolibrary.org/obo/HP_{number + 1:07d}",
                "lbl": " ".join(words) + f" {number}",
                "type": "CLASS",
                "meta": meta,
            }
        )
        parent = 1 if number < 10 else (number // 10) + 1
        edges.append(
            {
                "sub": f"http://purl.obolibrary.org/obo/HP_{number + 1:07d}",
                "pred": "is_a",
                "obj": f"http://purl.obolibrary.org/obo/HP_{parent:07d}",
            }
        )
    ontology = root / "hp.json"
    ontology.write_text(
        json.dumps({"graphs": [{"id": "hp", "nodes": nodes, "edges": edges}]}),
        encoding="utf-8",
    )

    def rows(table: dict[str, str], language: str, synonyms: bool) -> str:
        lines = [HEADER]
        for number in range(1, 400):
            words = _phrase(number)
            term = f"HP:{number + 1:07d}"
            if synonyms:
                value = f"{FRENCH[words[0]]} {FRENCH[words[1]]}|{table[words[2]]}"
                predicate = "oboInOwl:hasExactSynonym"
            else:
                value = " ".join(table[word] for word in words)
                predicate = "rdfs:label"
            if number % 7 == 0:
                continue
            lines.append(f"{term}\t{predicate}\ten\tx\t{language}\t{value}\tOFFICIAL\n")
        return "".join(lines)

    files = [
        root / "hp-de.babelon.tsv",
        root / "hp-de.synonyms.tsv",
        root / "hp-fr.babelon.tsv",
        root / "hp-it.synonyms.tsv",
    ]
    files[0].write_text(rows(GERMAN, "de", False), encoding="utf-8")
    files[1].write_text(rows(GERMAN, "de", True), encoding="utf-8")
    files[2].write_text(rows(FRENCH, "fr", False), encoding="utf-8")
    # Contributes nothing: skipped by the base, absent from the pins.
    files[3].write_text(HEADER, encoding="utf-8")
    return ontology, files


def _base(corpus: tuple[Path, list[Path]]) -> OntologyService:
    ontology, files = corpus
    sha = hashlib.sha256(ontology.read_bytes()).hexdigest()
    return OntologyService.load(ontology, OntologyRef(release="x", sha256=sha), files)


def _pin(base: OntologyService) -> OntologyService:
    condition = base.capture_condition()
    resources = {
        f"search-resources/{item.sha256}/{item.filename}": item.content
        for item in base.translations
    }
    return OntologyRegistry._pinned_service(base, condition, resources)


def _reference(base: OntologyService, files: list[Path]) -> OntologyService:
    """The former pinned view: deep copy, then the files parsed again."""
    ontology = copy.deepcopy(base.ontology)
    for term in ontology.terms.values():
        term.translations = {}
    loaded, skipped = apply_translations(ontology, files)
    lexical = base.engine.lexical
    assert isinstance(lexical, LanguageLexicalIndex)
    return OntologyService(
        ontology,
        SearchEngine(ontology, lexical.with_ontology(ontology)),
        base.ref,
        translations=loaded,
        skipped_translations=skipped,
    )


def _top(service: OntologyService, query: str, languages, route: str) -> list:
    result = service.search(
        SearchRequest(
            workspace_key=KEY,
            annotation_id="a1",
            query=query,
            route=route,
            k=20,
            languages=languages,
        )
    )
    return [
        (c.term_id, c.label, c.matched_term, c.match_kind, c.score, c.rank)
        for c in result.candidates
    ]


def test_pinned_view_ranks_exactly_like_the_reparsed_view(
    corpus: tuple[Path, list[Path]],
) -> None:
    base = _base(corpus)
    assert [item.filename for item in base.skipped_translations] == [
        "hp-it.synonyms.tsv"
    ]
    view = _pin(base)
    reference = _reference(base, [corpus[1][index] for index in (0, 1, 2)])
    for term_id, term in reference.ontology.terms.items():
        assert view.ontology.terms[term_id].translations == term.translations
    assert view.translation_counts == reference.translation_counts
    compared = 0
    for query in QUERIES:
        for languages in LANGUAGE_SETS:
            for route in ("auto", "lexical"):
                expected = _top(reference, query, languages, route)
                assert _top(view, query, languages, route) == expected
                assert _top(base, query, languages, route) == expected
                compared += bool(expected)
    assert compared > 40


def test_pinned_view_neither_reparses_nor_deep_copies(
    corpus: tuple[Path, list[Path]], monkeypatch: pytest.MonkeyPatch
) -> None:
    base = _base(corpus)

    def forbidden(*_: Any, **__: Any) -> Any:
        raise AssertionError("the fast pinned view must not do this")

    monkeypatch.setattr(translations_module, "load_translations", forbidden)
    monkeypatch.setattr(service_module.copy, "deepcopy", forbidden)
    view = _pin(base)
    assert view.search_condition is not None
    assert view.engine.lexical._matrix is base.engine.lexical._matrix
    assert view._translated._names is base._translated._names


def test_pinned_view_owns_its_terms(corpus: tuple[Path, list[Path]]) -> None:
    base = _base(corpus)
    view = _pin(base)
    assert view.ontology is not base.ontology
    for name, value in vars(base.ontology).items():
        copied = getattr(view.ontology, name)
        if isinstance(value, (dict, list)):
            assert copied is not value, name
    for term_id, term in base.ontology.terms.items():
        mine = view.ontology.terms[term_id]
        assert mine is not term
        assert mine == term
        for field in ("synonyms", "parents", "alt_ids", "consider", "translations"):
            assert getattr(mine, field) is not getattr(term, field)
    for key, term in view.ontology._ci_terms.items():
        assert term is view.ontology.terms[term.hpo_id], key
    for key, kids in view.ontology._children.items():
        assert kids == base.ontology._children[key]
        assert kids is not base.ontology._children[key]

    view.ontology.terms["HP:0000002"].translations["de"].append("Nur hier")
    view.ontology.terms["HP:0000002"].parents.append("HP:9999999")
    assert "Nur hier" not in base.ontology.terms["HP:0000002"].translations["de"]
    assert "HP:9999999" not in base.ontology.terms["HP:0000002"].parents
    again = _pin(base)
    assert "Nur hier" not in again.ontology.terms["HP:0000002"].translations["de"]


def test_views_of_one_build_share_language_subsets_but_not_the_base_cache(
    corpus: tuple[Path, list[Path]],
) -> None:
    base = _base(corpus)
    base.engine.lexical.search("Muskel", 5, languages=["de"])
    first, second = _pin(base), _pin(base)
    expected = first.engine.lexical.search("Muskel Tonus", 20, languages=["de"])
    assert second.engine.lexical.search("Muskel Tonus", 20, languages=["de"]) == (
        expected
    )
    fitted = first.engine.lexical._subset_indexes[("de",)]
    reused = second.engine.lexical._subset_indexes[("de",)]
    assert reused._matrix is fitted._matrix
    assert reused.ontology is second.ontology
    assert fitted.ontology is first.ontology
    assert fitted._matrix is not base.engine.lexical._subset_indexes[("de",)]._matrix
    hit = second.engine.lexical.search("Muskel Tonus", 1, languages=["de"])[0]
    second.ontology.terms[hit["hpo_id"]].label = "Only in the second view"
    assert (
        first.engine.lexical.search("Muskel Tonus", 1, languages=["de"])[0]["label"]
        == hit["label"]
    )


def test_concurrent_first_searches_fit_each_subset_once(
    corpus: tuple[Path, list[Path]], monkeypatch: pytest.MonkeyPatch
) -> None:
    base = _base(corpus)
    views = [_pin(base) for _ in range(3)]
    fits: list[tuple[str, ...]] = []
    lock = threading.Lock()
    original = LexicalIndex.build

    def counted(self: LexicalIndex) -> None:
        with lock:
            fits.append(tuple(self.languages))
        original(self)

    monkeypatch.setattr(LexicalIndex, "build", counted)
    barrier = threading.Barrier(12)
    results: list[list[dict[str, Any]]] = []
    errors: list[BaseException] = []

    def search(view: OntologyService, languages: list[str]) -> None:
        try:
            barrier.wait(5)
            hits = view.engine.lexical.search("Niere Zyste", 10, languages=languages)
            with lock:
                results.append([(h["hpo_id"], h["score"]) for h in hits])
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=search, args=(views[n % 3], ["de"] if n % 2 else []))
        for n in range(12)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert not errors
    assert sorted(fits) == [(), ("de",)]
    assert len(results) == 12
