"""The single search: route ``auto`` decides between code and keyword."""

import hashlib
import json
from pathlib import Path

import pytest

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchCandidate, SearchRequest
from ontotator.ontology.service import OntologyService, looks_like_code
from ontotator.packages.models import SearchEventRecord
from ontotator.vendor.hpo_span_annotator.search import shuffle_seed, shuffled

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _key(annotator_id: str = "dr-meier") -> WorkspaceKey:
    return WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id="targets-1",
    )


def _service(path: Path = FIXTURE_PATH) -> OntologyService:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return OntologyService.load(path, OntologyRef(release="2026-06-23", sha256=digest))


def _request(query: str, **overrides: object) -> SearchRequest:
    fields: dict[str, object] = {
        "workspace_key": _key(),
        "annotation_id": "ann-1",
        "query": query,
    }
    fields.update(overrides)
    return SearchRequest.model_validate(fields)


def test_route_defaults_to_auto_and_old_routes_stay_valid() -> None:
    assert _request("seizure").route == "auto"
    for route in ("lexical", "exact", "id", "browse"):
        assert _request("seizure", route=route).route == route


def test_candidate_carries_route_and_match_language() -> None:
    plain = SearchCandidate(term_id="HP:0001252", label="Hypotonia")
    assert plain.route == ""
    assert plain.match_language is None

    tagged = SearchCandidate(
        term_id="HP:0001252", label="Hypotonia", route="exact", match_language="de"
    )
    assert tagged.route == "exact"
    assert tagged.match_language == "de"


def test_search_event_keeps_candidate_routes_and_reads_old_events() -> None:
    old_payload = {
        "event_id": "evt-old",
        "workspace_key": _key().model_dump(),
        "annotation_id": "ann-1",
        "query": "hypotonia",
        "route": "exact",
        "candidates": ["HP:0001252"],
        "ontology_release": "2026-01-01",
        "index_identity": "idx",
        "timestamp": "2026-01-01T00:00:00+00:00",
    }
    old = SearchEventRecord.model_validate_json(json.dumps(old_payload))
    assert old.candidate_routes == {}

    new = SearchEventRecord.model_validate(
        {**old_payload, "route": "auto", "candidate_routes": {"HP:0001252": "exact"}}
    )
    again = SearchEventRecord.model_validate_json(new.model_dump_json())
    assert again.candidate_routes == {"HP:0001252": "exact"}


@pytest.mark.parametrize(
    "query", ["1250", "HP:0001250", "hp:0001250", "HP_0001250", " MONDO:1 "]
)
def test_looks_like_code_accepts_identifiers(query: str) -> None:
    assert looks_like_code(query) is True


@pytest.mark.parametrize(
    "query", ["", "Seizure", "HP:", "trisomy 21", "HP:00012A", "low muscle tone"]
)
def test_looks_like_code_rejects_keywords(query: str) -> None:
    assert looks_like_code(query) is False


@pytest.mark.parametrize(
    "query",
    [
        "HP:0001250",
        "hp:0001250",
        "1250",
        "HP_0001250",
        "HP 1250",
        "hp:1250",
        "Hp 0001250",
    ],
)
def test_code_query_returns_exactly_that_term(query: str) -> None:
    result = _service().search(_request(query))

    assert result.route == "auto"
    assert [c.term_id for c in result.candidates] == ["HP:0001250"]
    candidate = result.candidates[0]
    assert candidate.route == "id"
    assert candidate.match_kind == "id"
    assert (candidate.rank, candidate.display_pos) == (1, 1)
    assert result.displayed_ids == ["HP:0001250"]
    assert result.ranked_ids == ["HP:0001250"]
    assert result.shuffled is False
    assert result.seed is None


def test_spaced_code_needs_the_ontology_prefix() -> None:
    assert looks_like_code("HP 1250", "HP") is True
    assert looks_like_code("trisomy 21", "HP") is False
    assert looks_like_code("HP 1250") is False


def test_unknown_code_returns_nothing_and_no_similar_terms() -> None:
    result = _service().search(_request("HP:9999999"))

    assert result.candidates == []
    assert result.displayed_ids == []
    assert result.shuffled is False


def test_explicit_routes_tag_their_candidates() -> None:
    service = _service()

    by_id = service.search(_request("HP:0001250", route="id"))
    assert [c.route for c in by_id.candidates] == ["id"]

    # The explicit exact route keeps its prefix fallback.
    prefix = service.search(_request("hypoton", route="exact"))
    assert prefix.route == "exact"
    assert prefix.candidates[0].term_id == "HP:0001252"
    assert prefix.candidates[0].route == "exact"
    assert prefix.candidates[0].match_kind.startswith("prefix:")

    lexical = service.search(_request("hypoton", route="lexical"))
    assert lexical.shuffled is True
    assert lexical.candidates
    assert {c.route for c in lexical.candidates} == {"lexical"}
    assert {c.match_language for c in lexical.candidates} == {"en"}


def _tiny_ontology(tmp_path: Path) -> Path:
    """`Deafness` is the label of one term and a synonym of another."""

    def node(
        local: str, label: str, synonyms: tuple[str, ...] = ()
    ) -> dict[str, object]:
        return {
            "id": f"http://purl.obolibrary.org/obo/TEST_{local}",
            "lbl": label,
            "type": "CLASS",
            "meta": {
                "synonyms": [
                    {"pred": "hasExactSynonym", "val": value} for value in synonyms
                ]
            },
        }

    payload = {
        "graphs": [
            {
                "id": "http://example.com/tiny.json",
                "meta": {"version": "http://example.com/releases/2026-06-23/tiny.json"},
                "nodes": [
                    node("0000001", "Root"),
                    node("0000002", "Deafness"),
                    node("0000003", "Hearing impairment", ("Deafness",)),
                    node("0000004", "Partial deafness"),
                ],
                "edges": [
                    {
                        "sub": f"http://purl.obolibrary.org/obo/TEST_{local}",
                        "pred": "is_a",
                        "obj": "http://purl.obolibrary.org/obo/TEST_0000001",
                    }
                    for local in ("0000002", "0000003", "0000004")
                ],
            }
        ]
    }
    path = tmp_path / "tiny.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_keyword_lists_exact_matches_first_then_similar(tmp_path: Path) -> None:
    result = _service(_tiny_ontology(tmp_path)).search(_request("deafness"))

    assert [(c.term_id, c.route, c.match_kind) for c in result.candidates] == [
        ("TEST:0000002", "exact", "label"),
        ("TEST:0000003", "exact", "hasExactSynonym"),
        ("TEST:0000004", "lexical", "ngram"),
    ]
    assert result.displayed_ids == ["TEST:0000002", "TEST:0000003", "TEST:0000004"]
    assert result.ranked_ids == ["TEST:0000002", "TEST:0000003", "TEST:0000004"]
    assert [c.rank for c in result.candidates] == [1, 2, 3]
    assert [c.display_pos for c in result.candidates] == [1, 2, 3]
    assert result.shuffled is True
    assert result.candidates[0].match_language is None
    assert result.candidates[2].match_language == "en"
    assert result.candidates[0].score is None
    assert result.candidates[2].score is not None


def test_exact_matches_take_precedence_within_k(tmp_path: Path) -> None:
    service = _service(_tiny_ontology(tmp_path))

    two = service.search(_request("deafness", k=2))
    assert two.displayed_ids == ["TEST:0000002", "TEST:0000003"]
    assert two.shuffled is False
    assert two.seed is None

    one = service.search(_request("deafness", k=1))
    assert one.displayed_ids == ["TEST:0000002"]


def test_keyword_on_the_fixture_has_no_duplicates_and_consistent_ranks() -> None:
    result = _service().search(_request("Seizure"))
    ids = [c.term_id for c in result.candidates]

    assert ids[0] == "HP:0001250"
    assert result.candidates[0].route == "exact"
    assert {c.route for c in result.candidates[1:]} == {"lexical"}
    assert {"HP:0011146", "HP:0002133"} <= set(ids)
    assert len(ids) == len(set(ids))
    assert len(ids) <= 10

    assert result.displayed_ids == ids
    assert [c.display_pos for c in result.candidates] == list(range(1, len(ids) + 1))
    assert sorted(c.rank for c in result.candidates) == list(range(1, len(ids) + 1))
    assert result.ranked_ids[0] == "HP:0001250"
    assert result.ranked_ids == [
        c.term_id for c in sorted(result.candidates, key=lambda c: c.rank)
    ]


def test_auto_has_no_prefix_fallback() -> None:
    result = _service().search(_request("hypoton"))

    assert result.candidates
    assert {c.route for c in result.candidates} == {"lexical"}
    assert "HP:0001252" in result.displayed_ids


def test_similar_block_is_stable_per_annotator_and_keyed_by_annotator() -> None:
    service = _service()

    first = service.search(_request("Seizure"))
    again = service.search(_request("Seizure"))
    other = service.search(_request("Seizure", workspace_key=_key("dr-other")))

    assert first.seed is not None
    assert again.seed == first.seed
    assert again.displayed_ids == first.displayed_ids
    assert other.seed != first.seed
    assert set(other.displayed_ids) == set(first.displayed_ids)
    assert other.ranked_ids == first.ranked_ids


def _deafness_ontology(tmp_path: Path) -> Path:
    """One exact match for `deafness` and eight terms that merely resemble it."""
    labels = [
        "Root",
        "Deafness",
        "Mild deafness",
        "Severe deafness",
        "Partial deafness",
        "Profound deafness",
        "Congenital deafness",
        "Unilateral deafness",
        "Bilateral deafness",
        "Progressive deafness",
    ]
    payload = {
        "graphs": [
            {
                "id": "http://example.com/deaf.json",
                "meta": {"version": "http://example.com/releases/2026-06-23/deaf.json"},
                "nodes": [
                    {
                        "id": f"http://purl.obolibrary.org/obo/TEST_{index:07d}",
                        "lbl": label,
                        "type": "CLASS",
                    }
                    for index, label in enumerate(labels, start=1)
                ],
                "edges": [
                    {
                        "sub": f"http://purl.obolibrary.org/obo/TEST_{index:07d}",
                        "pred": "is_a",
                        "obj": "http://purl.obolibrary.org/obo/TEST_0000001",
                    }
                    for index in range(2, len(labels) + 1)
                ],
            }
        ]
    }
    path = tmp_path / "deaf.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_similar_block_is_shuffled_by_the_annotators_seed(tmp_path: Path) -> None:
    service = _service(_deafness_ontology(tmp_path))
    annotators = ["dr-a", "dr-b", "dr-c", "dr-d", "dr-e", "dr-f"]
    results = {
        annotator: service.search(_request("deafness", workspace_key=_key(annotator)))
        for annotator in annotators
    }

    ranked = results["dr-a"].ranked_ids
    assert ranked[0] == "TEST:0000002"
    assert len(ranked) == 9

    for annotator, result in results.items():
        assert result.shuffled is True
        assert result.ranked_ids == ranked
        # The exact match stays on top; only the similar block moves.
        assert result.displayed_ids[0] == "TEST:0000002"
        seed = shuffle_seed(annotator, "ann-1", "deafness", 10)
        assert result.seed == seed
        expected = shuffled([{"hpo_id": term_id} for term_id in ranked[1:]], seed)
        assert result.displayed_ids[1:] == [hit["hpo_id"] for hit in expected]

    orders = {tuple(result.displayed_ids) for result in results.values()}
    assert len(orders) > 1
    assert any(result.displayed_ids != ranked for result in results.values())
