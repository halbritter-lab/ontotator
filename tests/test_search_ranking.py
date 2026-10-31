"""Term search ranking: the queries of #190 on a small synthetic ontology.

The names are modelled on HPO; the ids are synthetic. Before #190, every
lexical hit was shuffled, so any name that shared one query word could come
first: "hemorrhage" showed "Hemorrhage of the eye", "esophageal hemorrhage"
showed "Epistaxis" (synonym "Nasal hemorrhage").
"""

import hashlib
import json

import pytest

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest, SearchResult
from ontotator.ontology.service import OntologyService
from ontotator.vendor.hpo_span_annotator.lexical import word_cover

TERMS: list[tuple[str, tuple[str, ...]]] = [
    ("Root", ()),
    ("Abnormal bleeding", ("Bleeding tendency",)),
    ("Hemorrhage of the eye", ("Ocular bleeding",)),
    ("Internal hemorrhage", ()),
    ("Retinal hemorrhage", ()),
    ("Epistaxis", ("Nasal hemorrhage", "Nosebleed")),
    ("Esophageal varix", ()),
    ("Esophageal varix hemorrhage", ()),
    ("Esophageal atresia", ()),
    ("Foot mass", ("Foot lump",)),
    ("Breast lump", ()),
    ("Soft tissue sarcoma", ()),
    ("Soft tissue swelling", ()),
    ("Subcutaneous soft tissue mass", ()),
    ("Abdominal mass", ()),
    ("Fractured metatarsal bone of digit 1", ()),
    ("Thumb hypoplasia grade 2", ()),
    ("Sclerotic foci in forearm bones", ()),
    ("Increased bone mineral density", ("Osteosclerosis",)),
    ("Seizure", ()),
]
ANNOTATORS = ("dr-a", "dr-b", "dr-c", "dr-d")


@pytest.fixture(scope="module")
def service(tmp_path_factory: pytest.TempPathFactory) -> OntologyService:
    def iri(index: int) -> str:
        return f"http://purl.obolibrary.org/obo/TEST_{index:07d}"

    payload = {
        "graphs": [
            {
                "id": "http://example.com/ranking.json",
                "meta": {
                    "version": "http://example.com/releases/2026-10-30/ranking.json"
                },
                "nodes": [
                    {
                        "id": iri(index),
                        "lbl": label,
                        "type": "CLASS",
                        "meta": {
                            "synonyms": [
                                {"pred": "hasExactSynonym", "val": value}
                                for value in synonyms
                            ]
                        },
                    }
                    for index, (label, synonyms) in enumerate(TERMS, start=1)
                ],
                "edges": [
                    {"sub": iri(index), "pred": "is_a", "obj": iri(1)}
                    for index in range(2, len(TERMS) + 1)
                ],
            }
        ]
    }
    path = tmp_path_factory.mktemp("ranking") / "ranking.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return OntologyService.load(path, OntologyRef(release="2026-10-30", sha256=digest))


def _search(service: OntologyService, query: str, annotator: str) -> SearchResult:
    return service.search(
        SearchRequest(
            workspace_key=WorkspaceKey(
                project_key="pkg-1",
                document_id="doc-1",
                annotator_id=annotator,
                mode="independent",
                target_set_id="targets-1",
            ),
            annotation_id="ann-1",
            query=query,
        )
    )


def _shown(service: OntologyService, query: str, annotator: str) -> list[str]:
    return [c.label for c in _search(service, query, annotator).candidates]


def test_word_cover_counts_query_words_and_other_words() -> None:
    assert word_cover("hemorrhage", "Retinal hemorrhage") == (0, 1, 1, True)
    # "of" is too short to count.
    assert word_cover("hemorrhage", "Hemorrhage of the eye") == (0, 1, 2, True)
    assert word_cover("esophageal hemorrhage", "Nasal hemorrhage") == (
        0,
        1,
        None,
        False,
    )
    assert word_cover("soft tissue mass", "Soft tissue sarcoma") == (0, 2, None, False)
    # A word typed so far still counts.
    assert word_cover("hemorr", "Internal hemorrhage") == (0, 1, 1, True)
    # Query words too short to check put no name in the fixed head.
    assert word_cover("of", "Hemorrhage of the eye") == (0, 0, None, False)


@pytest.mark.parametrize("annotator", ANNOTATORS)
def test_a_single_word_lists_the_shortest_names_holding_it_first(
    service: OntologyService, annotator: str
) -> None:
    shown = _shown(service, "hemorrhage", annotator)
    assert shown[:5] == [
        "Internal hemorrhage",
        "Retinal hemorrhage",
        # A synonym after the labels with as many other words.
        "Epistaxis",
        "Esophageal varix hemorrhage",
        "Hemorrhage of the eye",
    ]


@pytest.mark.parametrize("annotator", ANNOTATORS)
def test_a_name_with_every_query_word_comes_first(
    service: OntologyService, annotator: str
) -> None:
    shown = _shown(service, "esophageal hemorrhage", annotator)
    assert shown[0] == "Esophageal varix hemorrhage"
    assert set(shown[1:]) >= {"Epistaxis", "Esophageal varix", "Internal hemorrhage"}

    shown = _shown(service, "soft tissue mass", annotator)
    assert shown[0] == "Subcutaneous soft tissue mass"
    assert "Soft tissue sarcoma" in shown[1:]


@pytest.mark.parametrize("annotator", ANNOTATORS)
def test_a_label_comes_before_a_synonym(
    service: OntologyService, annotator: str
) -> None:
    result = _search(service, "lump", annotator)
    assert [c.label for c in result.candidates][:2] == ["Breast lump", "Foot mass"]
    assert result.candidates[1].matched_term == "Foot lump"


def test_ranks_prefer_names_covering_more_query_words(
    service: OntologyService,
) -> None:
    result = _search(service, "esophageal hemorrhage", "dr-a")
    ranked = [c.label for c in sorted(result.candidates, key=lambda c: c.rank)]
    assert ranked[0] == "Esophageal varix hemorrhage"
    # Labels holding one query word rank before a synonym holding one.
    assert ranked.index("Epistaxis") > ranked.index("Internal hemorrhage")
    assert ranked.index("Epistaxis") > ranked.index("Esophageal varix")


@pytest.mark.parametrize(
    ("query", "label", "weak"),
    [
        # #247: one shared word, or a name word inside the query word.
        ("bone metastases", "Fractured metatarsal bone of digit 1", True),
        ("sangrado", "Thumb hypoplasia grade 2", True),
        # Every query word starts a word of the name.
        ("sclerotic foci", "Sclerotic foci in forearm bones", False),
        ("sclero", "Sclerotic foci in forearm bones", False),
        # An exact synonym, a typo, a plural.
        ("osteosclerosis", "Increased bone mineral density", False),
        ("osteosclerrosis", "Increased bone mineral density", False),
        ("seizures", "Seizure", False),
    ],
)
def test_a_hit_is_weak_unless_every_query_word_is_close(
    service: OntologyService, query: str, label: str, weak: bool
) -> None:
    hits = {c.label: c for c in _search(service, query, "dr-a").candidates}
    assert hits[label].weak_match is weak


@pytest.mark.parametrize("annotator", ANNOTATORS)
def test_weak_hits_are_listed_after_close_ones(
    service: OntologyService, annotator: str
) -> None:
    # "Hemorrhage" hits are a typo away, "Thumb hypoplasia grade 2" only near.
    weak = [
        c.weak_match for c in _search(service, "hemorhage grade", annotator).candidates
    ]
    assert True in weak
    assert weak == sorted(weak)

    # With a typo alone, a close hit stays on top although it is shuffled.
    assert _search(service, "seizures", annotator).candidates[0].label == "Seizure"
