"""The single search: route ``auto`` decides between code and keyword."""

import hashlib
import json
from pathlib import Path

import pytest

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.provenance import SearchCandidate, SearchRequest
from ontocurator.ontology.service import OntologyService, looks_like_code
from ontocurator.packages.models import SearchEventRecord

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _key(annotator_id: str = "dr-meier") -> WorkspaceKey:
    return WorkspaceKey(
        package_id="pkg-1",
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


@pytest.mark.parametrize("query", ["HP:0001250", "hp:0001250", "1250", "HP_0001250"])
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
