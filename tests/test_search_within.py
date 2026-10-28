"""Search restricted to modifier subtrees (``within``) and term roles (C4)."""

from __future__ import annotations

import pytest
from modifier_fixtures import MOD_DE, MOD_PATH, MOD_PIN
from t1_fixtures import FIXTURES, HP_PATH, HP_SHA

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest
from ontotator.ontology.service import OntologyService

KEY = WorkspaceKey(
    project_key="pkg-1",
    document_id="doc-1",
    annotator_id="dr-meier",
    mode="independent",
    target_set_id="targets-1",
)


def _request(query: str, **kwargs: object) -> SearchRequest:
    return SearchRequest(
        workspace_key=KEY, annotation_id="ann-1", query=query, **kwargs
    )


@pytest.fixture(scope="module")
def hp() -> OntologyService:
    return OntologyService.load(
        HP_PATH,
        OntologyRef(release="2026-06-23", sha256=HP_SHA),
        translation_paths=[FIXTURES / "hp-de.babelon.tsv"],
    )


@pytest.fixture(scope="module")
def mods() -> OntologyService:
    return OntologyService.load(
        MOD_PATH,
        OntologyRef(release="2026-06-23", sha256=MOD_PIN.sha256),
        translation_paths=[MOD_DE],
    )


# Recorded on the unchanged code (characterization): searches without
# ``within`` keep their seeds.
@pytest.mark.parametrize(
    ("query", "route", "languages", "seed"),
    [
        ("seiz", "auto", None, "9f1e3a0070532352"),
        ("seiz", "lexical", None, "9f1e3a0070532352"),
        ("seiz", "auto", [], "9befef749f02fd83"),
        ("seiz", "lexical", [], "9befef749f02fd83"),
    ],
)
def test_seeds_without_within_are_unchanged(
    hp: OntologyService,
    query: str,
    route: str,
    languages: list[str] | None,
    seed: str,
) -> None:
    result = hp.search(_request(query, route=route, languages=languages))
    assert result.seed == seed


ROOTS = ["HP:0012823", "HP:0040279"]


def _subtree_terms(service: OntologyService) -> set[str]:
    from ontotator.ontology.modifiers import subtree

    return set().union(*(subtree(service, root) for root in ROOTS))


@pytest.mark.parametrize("route", ["auto", "lexical", "exact"])
def test_within_returns_only_subtree_terms(mods: OntologyService, route: str) -> None:
    allowed = _subtree_terms(mods)
    result = mods.search(_request("sev", route=route, k=100, within=ROOTS))
    assert result.candidates
    assert {c.term_id for c in result.candidates} <= allowed


def test_within_renumbers_kept_exact_hits(mods: OntologyService) -> None:
    # Unrestricted, "fre" answers Frequency (1) and Frequent (2).
    result = mods.search(_request("fre", route="exact", within=["HP:0040282"]))
    assert [(c.term_id, c.rank, c.display_pos) for c in result.candidates] == [
        ("HP:0040282", 1, 1)
    ]


def test_within_filters_before_the_cut(mods: OntologyService) -> None:
    allowed = _subtree_terms(mods)
    everything = mods.search(_request("se", k=100))
    matching = [c.term_id for c in everything.candidates if c.term_id in allowed]
    top = mods.search(_request("se", k=3))
    assert len([c for c in top.candidates if c.term_id in allowed]) < 3
    restricted = mods.search(_request("se", k=3, within=ROOTS))
    assert len(restricted.candidates) == min(3, len(matching))
    assert {c.term_id for c in restricted.candidates} <= set(matching)


def test_within_changes_the_seed(mods: OntologyService) -> None:
    plain = mods.search(_request("se"))
    restricted = mods.search(_request("se", within=ROOTS))
    reordered = mods.search(_request("se", within=list(reversed(ROOTS))))
    assert plain.seed is not None and restricted.seed is not None
    assert restricted.seed != plain.seed
    assert reordered.seed == restricted.seed


def test_code_query_within(mods: OntologyService) -> None:
    assert [
        c.term_id for c in mods.search(_request("HP:0012828", within=ROOTS)).candidates
    ] == ["HP:0012828"]
    assert mods.search(_request("HP:0001250", within=ROOTS)).candidates == []


def test_browse_within_returns_the_roots(mods: OntologyService) -> None:
    result = mods.search(_request("HP:0001250", route="browse", within=ROOTS))
    assert [c.term_id for c in result.candidates] == ROOTS


def test_within_must_be_curies() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _request("se", within=["not a curie"])
    with pytest.raises(ValidationError):
        _request("se", within=["HP:1"] * 9)


# --- API: role, stored ``within``, labels and tree on a MOD_PIN project ---- #


@pytest.fixture
def api(tmp_path):  # type: ignore[no-untyped-def]
    from browser_modifier_scenarios import register_modifier_scenario_route
    from browser_server import ONTOLOGY
    from fastapi.testclient import TestClient
    from pg_harness import database_url_for
    from test_browser_review_flow_fixture import Session

    from ontotator.api.app import create_app
    from ontotator.config import AppConfig

    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "search.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_modifier_scenario_route(app)
    with TestClient(app) as client:
        response = client.post("/__test_modifiers__", params={"with_finding": 1})
        assert response.status_code == 200, response.text
        built = response.json()
        session = Session(client, built["users"]["annotator"])
        view = session.post(f"/api/v1/rounds/{built['round_id']}/open", {})["view"]
        yield app, session, built["project"], view["key"]


def _search(session, key, **extra):  # type: ignore[no-untyped-def]
    return session.post(
        "/api/v1/search",
        {
            "workspace_key": key,
            "annotation_id": "seizure",
            "layer_id": "hpo",
            "query": "se",
            **extra,
        },
    )


def test_search_api_roles_and_stored_within(api) -> None:  # type: ignore[no-untyped-def]
    app, session, project, key = api
    result = _search(session, key, within=ROOTS, k=20)
    roles = {c["term_id"]: c["role"] for c in result["candidates"]}
    assert roles["HP:0012828"] == "modifier"
    assert set(roles.values()) <= {"modifier", "cohort"}
    event = app.state.repo.get_search_event(result["search_id"], project)
    assert event.within == ROOTS
    plain = _search(session, key, query="Seizure")
    plain_roles = {c["term_id"]: c["role"] for c in plain["candidates"]}
    assert plain_roles["HP:0001250"] == "finding"
    stored = app.state.repo.get_search_event(plain["search_id"], project)
    # The pin's allowed roots (HP:0000118) and the modifier roots (#85).
    assert stored.within == ["HP:0000118", *ROOTS]


def test_finding_search_keeps_to_the_allowed_roots(api) -> None:  # type: ignore[no-untyped-def]
    from sqlalchemy import update

    from ontotator.storage.tables import ProjectOntologyRow

    app, session, project, key = api
    assert _search(session, key, query="HP:0000001")["candidates"] == []
    with app.state.repo.db.transaction() as conn:
        conn.execute(update(ProjectOntologyRow).values(allowed_roots=[]))
    unrestricted = _search(session, key, query="HP:0000001")
    assert [c["term_id"] for c in unrestricted["candidates"]] == ["HP:0000001"]
    stored = app.state.repo.get_search_event(unrestricted["search_id"], project)
    assert stored.within is None
    assert "within" not in stored.model_dump()


def test_search_api_role_is_finding_on_a_generic_pin(api) -> None:  # type: ignore[no-untyped-def]
    from sqlalchemy import update

    from ontotator.storage.tables import ProjectOntologyRow

    app, session, _, key = api
    with app.state.repo.db.transaction() as conn:
        conn.execute(update(ProjectOntologyRow).values(t1_profile="generic"))
    result = _search(session, key, within=ROOTS)
    assert result["candidates"]
    assert {c["role"] for c in result["candidates"]} == {"finding"}


def test_labels_api_roles(api) -> None:  # type: ignore[no-untyped-def]
    _, session, project, _ = api
    labels = session.post(
        "/api/v1/terms/labels",
        {
            "project_key": project,
            "terms": [
                {"layer_id": "hpo", "term_id": term}
                for term in ("HP:0012828", "HP:0040282", "HP:0001250", "HP:0003623")
            ],
        },
    )
    assert [(t["role"], t["exclusive_class"]) for t in labels] == [
        ("modifier", "severity"),
        ("cohort", None),
        ("finding", None),
        ("modifier", "onset"),
    ]


def test_tree_api_roles(api) -> None:  # type: ignore[no-untyped-def]
    _, session, _, key = api
    opened = session.post(
        "/api/v1/terms/tree/open",
        {
            "workspace_key": key,
            "annotation_id": "seizure",
            "layer_id": "hpo",
            "term_id": "HP:0012828",
        },
    )
    nodes = {
        node["term_id"]: node["role"]
        for level in opened["levels"]
        for node in level["children"]
    } | {node["term_id"]: node["role"] for node in opened["roots"]}
    assert nodes["HP:0012823"] == "modifier"
    assert nodes["HP:0040279"] == "cohort"
    assert nodes["HP:0012828"] == "modifier"
    assert nodes["HP:0000118"] == "finding"
    node = session.post(
        "/api/v1/terms/tree/node",
        {
            "workspace_key": key,
            "annotation_id": "seizure",
            "layer_id": "hpo",
            "browse_id": opened["browse_id"],
            "term_id": "HP:0040279",
            "expand": True,
        },
    )
    assert {c["role"] for c in node["children"]} == {"cohort"}
