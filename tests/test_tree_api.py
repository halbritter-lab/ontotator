"""The tree endpoints: what they return and what the walk's event records."""

import hashlib
import io

import pytest
from fastapi.testclient import TestClient
from layered_fixtures import HP_DIGEST, make_layered_package
from test_api import app_client as _shared_app_client
from test_ontology_tree import (
    FIXTURE_PATH,
    MIXED,
    tid,
    write_graph_ontology,
    write_mixed_ontology,
)

from ontocurator.api.app import create_app
from ontocurator.application.exports import ExportService
from ontocurator.config import AppConfig
from ontocurator.domain.profiles import profile_hash
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.packages.writer import PackageWriter

app_client = _shared_app_client

# Everything a walk that opens at Seizure shows, in order of first appearance:
# the root, then the children under each node of the path.
SEIZURE_WALK = [
    "HP:0000001",
    "HP:0000118",
    "HP:0000707",
    "HP:0000365",
    "HP:0001284",
    "HP:0001252",
    "HP:0001250",
    "HP:0011146",
    "HP:0002133",
]


def _import(client, package) -> None:
    buf = io.BytesIO()
    PackageWriter.write_to_stream(package, buf)
    files = {"file": ("package.zip", buf.getvalue(), "application/zip")}
    resp = client.post("/api/v1/packages", files=files)
    assert resp.status_code == 200, resp.text


def _open(client, package_id, annotator="annotator-1", mode="independent"):
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": package_id,
            "document_id": "doc-beta",
            "annotator_id": annotator,
            "mode": mode,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["workspace_id"], resp.json()["view"]["key"]


def _command(client, ws_id, revision, payload, mutation_id=None):
    return client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": mutation_id or f"mut-{revision}",
            "expected_revision": revision,
            "payload": payload,
        },
    )


def _tree(client, ws_key, endpoint, **fields):
    body = {
        "workspace_key": ws_key,
        "annotation_id": "ann-1",
        "layer_id": "hpo-layer",
        **fields,
    }
    return client.post(f"/api/v1/terms/tree/{endpoint}", json=body)


def _open_walk(client, ws_key, term_id="HP:0001250") -> str:
    resp = _tree(client, ws_key, "open", term_id=term_id)
    assert resp.status_code == 200, resp.text
    return resp.json()["browse_id"]


def _event(client, event_id):
    event = client.app.state.repo.get_search_event(event_id)
    assert event is not None
    return event


def _events(client, ws_key):
    return client.app.state.repo.get_search_events_for_workspace(
        WorkspaceKey.model_validate(ws_key)
    )


def _set_term(term_id, browse_id):
    return {
        "command": "set_term",
        "annotation_id": "ann-1",
        "term_id": term_id,
        "search_event_id": browse_id,
    }


@pytest.fixture
def walk(app_client):
    """A workspace with one annotation on Seizure, ready for the tree."""
    client, _ = app_client
    _import(client, make_layered_package("single"))
    ws_id, ws_key = _open(client, "pkg-scenario-a")
    resp = _command(
        client,
        ws_id,
        0,
        {
            "command": "create_annotation",
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "term_id": "HP:0001250",
        },
    )
    assert resp.status_code == 200, resp.text
    return client, ws_id, ws_key


def _walk_on(tmp_path, path, term_id):
    """A workspace whose layer uses the ontology file at ``path``."""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    package = make_layered_package("single")
    profile = package.manifest.task_profile
    definition = profile.ontologies[0].model_copy(
        update={"sha256": digest, "release": "2026-06-23", "resource_path": None}
    )
    profile = profile.model_copy(update={"ontologies": [definition]})
    manifest = package.manifest.model_copy(
        update={
            "package_id": "pkg-graph",
            "task_profile": profile,
            "task_profile_sha256": profile_hash(profile),
        }
    )
    package = package.model_copy(update={"manifest": manifest})

    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=tmp_path / "graph.db",
        ontology_paths=[path],
        session_token="secret-session-token",
    )
    client = TestClient(
        create_app(config), headers={"Authorization": "Bearer secret-session-token"}
    )
    _import(client, package)
    ws_id, ws_key = _open(client, "pkg-graph")
    resp = _command(
        client,
        ws_id,
        0,
        {
            "command": "create_annotation",
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "term_id": term_id,
        },
    )
    assert resp.status_code == 200, resp.text
    return client, ws_id, ws_key


@pytest.fixture
def graph_walk(tmp_path):
    """A workspace whose layer uses the multi-parent ontology of the tree tests."""
    return _walk_on(tmp_path, write_graph_ontology(tmp_path), tid("0000006"))


@pytest.fixture
def mixed_walk(tmp_path):
    """A workspace whose ontology carries many classes of other ontologies."""
    own = {f"OWN:{number:07d}": ("OWN:0000001",) for number in range(100, 500)}
    path = write_mixed_ontology(tmp_path, {**MIXED, **own})
    return _walk_on(tmp_path, path, "OWN:0000003")


def test_open_returns_the_path_to_the_term_and_logs_everything_it_shows(walk):
    client, _, ws_key = walk

    resp = _tree(client, ws_key, "open", term_id="HP:0001250")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["start_status"] == "valid"
    assert body["roots"] == [
        {"term_id": "HP:0000001", "label": "All", "child_count": 1}
    ]
    assert body["path"] == ["HP:0000001", "HP:0000118", "HP:0000707", "HP:0001250"]
    assert [level["term_id"] for level in body["levels"]] == body["path"]
    assert [n["term_id"] for n in body["levels"][2]["children"]] == [
        "HP:0001284",
        "HP:0001252",
        "HP:0001250",
    ]
    assert body["levels"][3]["children"] == [
        {"term_id": "HP:0011146", "label": "Dialeptic seizure", "child_count": 0},
        {"term_id": "HP:0002133", "label": "Status epilepticus", "child_count": 0},
    ]
    detail = body["detail"]
    assert (detail["term_id"], detail["label"]) == ("HP:0001250", "Seizure")
    assert detail["definition"]
    assert sorted(detail["synonyms"]) == ["Convulsion", "Epileptic seizure", "Seizures"]
    assert detail["translations"] == {}
    assert detail["parents"] == [
        {
            "term_id": "HP:0000707",
            "label": "Abnormality of the nervous system",
            "child_count": 3,
        }
    ]

    event = _event(client, body["browse_id"])
    assert event.route == "browse"
    assert event.query == "HP:0001250"
    assert event.workspace_key == WorkspaceKey.model_validate(ws_key)
    assert (event.annotation_id, event.layer_id) == ("ann-1", "hpo-layer")
    assert event.candidates == SEIZURE_WALK
    assert event.ranked_ids == SEIZURE_WALK
    assert event.candidate_scores == {}
    assert event.selected_term_id is None
    assert event.ontology_sha256 == HP_DIGEST
    assert event.ontology_release == "2026-06-23"


def test_every_open_starts_a_walk_of_its_own(walk):
    client, _, ws_key = walk

    first = _open_walk(client, ws_key)
    second = _open_walk(client, ws_key)

    assert first != second
    assert sorted(e.event_id for e in _events(client, ws_key)) == sorted(
        [first, second]
    )


@pytest.mark.parametrize(
    ("term_id", "status"), [("HP:9999999", "unknown"), ("HP:0000123", "obsolete")]
)
def test_open_at_an_unknown_or_obsolete_term_shows_the_roots_and_says_so(
    walk, term_id, status
):
    client, _, ws_key = walk

    resp = _tree(client, ws_key, "open", term_id=term_id)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["start_status"] == status
    assert [n["term_id"] for n in body["roots"]] == ["HP:0000001"]
    assert (body["path"], body["levels"], body["detail"]) == ([], [], None)
    event = _event(client, body["browse_id"])
    assert event.query == term_id
    assert event.candidates == ["HP:0000001"]


def test_expanding_a_node_returns_its_children_and_adds_them_to_the_walk(walk):
    client, _, ws_key = walk
    browse_id = _open_walk(client, ws_key, "HP:0001252")
    before = _event(client, browse_id).candidates
    assert before == SEIZURE_WALK[:7]

    resp = _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["detail"]["label"] == "Hearing impairment"
    assert body["children"] == [
        {
            "term_id": "HP:0000407",
            "label": "Sensorineural hearing impairment",
            "child_count": 0,
        }
    ]
    assert (body["path"], body["levels"]) == ([], [])
    assert _event(client, browse_id).candidates == [*before, "HP:0000407"]

    # Opening the same node again shows nothing new.
    _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )
    assert _event(client, browse_id).candidates == [*before, "HP:0000407"]

    _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0001250", expand=True
    )
    event = _event(client, browse_id)
    assert event.candidates == [*before, "HP:0000407", "HP:0011146", "HP:0002133"]
    assert event.ranked_ids == event.candidates


def test_selecting_a_node_returns_its_details_and_logs_nothing(walk):
    client, _, ws_key = walk
    browse_id = _open_walk(client, ws_key, "HP:0001252")
    before = _event(client, browse_id).candidates

    resp = _tree(client, ws_key, "node", browse_id=browse_id, term_id="HP:0001250")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["detail"]["label"] == "Seizure"
    assert body["detail"]["parents"][0]["term_id"] == "HP:0000707"
    # Its children were not asked for, so they were not shown.
    assert body["children"] == []
    assert _event(client, browse_id).candidates == before


@pytest.mark.parametrize("term_id", ["HP:0000407", "HP:0000123", "HP:9999999"])
def test_a_node_that_was_never_shown_cannot_be_asked_for(walk, term_id):
    client, _, ws_key = walk
    browse_id = _open_walk(client, ws_key)

    resp = _tree(
        client, ws_key, "node", browse_id=browse_id, term_id=term_id, expand=True
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == "TREE_TERM_NOT_SHOWN"
    assert _event(client, browse_id).candidates == SEIZURE_WALK


def test_a_shown_term_is_assigned_from_the_walk_and_logged_as_browse(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)

    resp = _command(client, ws_id, 1, _set_term("HP:0002133", browse_id))

    assert resp.status_code == 200, resp.text
    terms = [a["annotation"]["term_id"] for a in resp.json()["annotations"]]
    assert terms == ["HP:0002133"]

    selections = [e for e in _events(client, ws_key) if e.selected_term_id]
    assert len(selections) == 1
    selection = selections[0]
    assert selection.source_search_event_id == browse_id
    assert selection.route == "browse"
    assert selection.query == "HP:0001250"
    assert selection.selected_term_id == "HP:0002133"
    assert selection.candidates == SEIZURE_WALK
    assert selection.displayed_position == 9
    assert selection.ranked_position == 9
    # The walk itself stays a search without a selection.
    assert _event(client, browse_id).selected_term_id is None


def test_a_term_the_walk_never_showed_is_rejected_until_it_was_shown(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)
    payload = _set_term("HP:0000407", browse_id)

    early = _command(client, ws_id, 1, payload, "mut-early")
    assert early.status_code == 422
    assert early.json()["code"] == "INVALID_SEARCH_SELECTION"

    opened = _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )
    assert opened.status_code == 200, opened.text

    late = _command(client, ws_id, 1, payload, "mut-late")
    assert late.status_code == 200, late.text
    terms = [a["annotation"]["term_id"] for a in late.json()["annotations"]]
    assert terms == ["HP:0000407"]


def test_a_walk_belongs_to_its_workspace_and_annotation(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)
    _, other_key = _open(client, "pkg-scenario-a", annotator="annotator-2")
    search = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "query": "Seizure",
        },
    )
    assert search.status_code == 200, search.text
    search_id = search.json()["search_id"]
    searched = _event(client, search_id).candidates
    done = _command(client, ws_id, 1, _set_term("HP:0002133", browse_id))
    assert done.status_code == 200, done.text
    selection_id = next(
        e.event_id for e in _events(client, ws_key) if e.selected_term_id
    )

    attempts = [
        {"browse_id": "no-such-walk"},
        {"browse_id": browse_id, "annotation_id": "ann-2"},
        {"browse_id": browse_id, "workspace_key": other_key},
        # A search is not a walk, and neither is the selection made from one.
        {"browse_id": search_id},
        {"browse_id": selection_id},
    ]
    for fields in attempts:
        resp = _tree(
            client, ws_key, "node", term_id="HP:0000365", expand=True, **fields
        )
        assert resp.status_code == 422, (fields, resp.text)
        assert resp.json()["code"] == "INVALID_TREE_WALK", fields

    assert _event(client, browse_id).candidates == SEIZURE_WALK
    assert _event(client, search_id).candidates == searched
    assert _event(client, selection_id).candidates == SEIZURE_WALK


def test_a_search_with_the_old_browse_route_is_not_a_tree_walk(walk):
    client, _, ws_key = walk
    # The legacy "browse" route of the search: the children of a term. Its
    # event has the same route as a walk, and the same owner as this request.
    search = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "query": "HP:0000707",
            "route": "browse",
        },
    )
    assert search.status_code == 200, search.text
    search_id = search.json()["search_id"]
    before = _event(client, search_id)
    assert before.route == "browse"
    assert "HP:0001250" in before.candidates
    assert set(before.candidate_routes) == set(before.candidates)

    for extra in ({}, {"expand": True}):
        resp = _tree(
            client, ws_key, "node", browse_id=search_id, term_id="HP:0001250", **extra
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["code"] == "INVALID_TREE_WALK"

    assert _event(client, search_id) == before


def test_the_tree_follows_the_layer_and_a_walk_cannot_change_layers(app_client):
    client, _ = app_client
    _import(client, make_layered_package("assisted"))
    _, ws_key = _open(client, "pkg-scenario-b", mode="assisted")

    opened = _tree(
        client,
        ws_key,
        "open",
        annotation_id="note-1",
        layer_id="reference-layer",
        term_id="MONDO:0001250",
    )

    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert [n["term_id"] for n in body["roots"]] == ["MONDO:0000001"]
    assert body["path"] == ["MONDO:0000001", "MONDO:0005070", "MONDO:0001250"]
    assert _event(client, body["browse_id"]).layer_id == "reference-layer"

    resp = _tree(
        client,
        ws_key,
        "node",
        annotation_id="note-1",
        layer_id="target-layer",
        browse_id=body["browse_id"],
        term_id="MONDO:0001250",
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "INVALID_TREE_WALK"


def test_tree_requests_pass_the_same_checks_as_a_search(app_client):
    client, _ = app_client
    _import(client, make_layered_package("multi_editable"))
    ws_id, ws_key = _open(client, "pkg-scenario-c")
    created = _command(
        client,
        ws_id,
        0,
        {
            "command": "create_annotation",
            "annotation_id": "ann-1",
            "layer_id": "layer-1",
            "type_id": "type-opt",
            "term_id": "HP:0001250",
        },
    )
    assert created.status_code == 200, created.text

    cases = [
        ({"layer_id": "no-such-layer"}, "UNKNOWN_LAYER"),
        # ann-1 lives in layer-1.
        ({"layer_id": "layer-2"}, "LAYER_MISMATCH"),
        (
            {
                "layer_id": "layer-1",
                "workspace_key": {**ws_key, "document_id": "no-such-doc"},
            },
            "DOCUMENT_NOT_FOUND",
        ),
    ]
    for fields, code in cases:
        for endpoint, extra in (("open", {}), ("node", {"browse_id": "any"})):
            resp = _tree(
                client, ws_key, endpoint, term_id="HP:0001250", **extra, **fields
            )
            assert resp.status_code == 422, (endpoint, fields, resp.text)
            assert resp.json()["code"] == code, (endpoint, fields)

    assert _events(client, ws_key) == []


def test_also_under_returns_the_other_path_and_logs_what_it_reveals(graph_walk):
    client, _, ws_key = graph_walk
    root, beta, alpha, twin = (
        tid("0000001"),
        tid("0000002"),
        tid("0000003"),
        tid("0000006"),
    )

    opened = _tree(client, ws_key, "open", term_id=twin).json()
    assert opened["path"] == [root, alpha, twin]
    assert [n["label"] for n in opened["detail"]["parents"]] == ["Alpha", "Beta"]
    shown = _event(client, opened["browse_id"]).candidates
    # The three roots, Root's children, Alpha's children.
    assert shown == [
        tid(local)
        for local in (
            "0000013",
            "0000012",
            "0000001",
            "0000003",
            "0000002",
            "0000004",
            "0000006",
            "0000007",
        )
    ]

    resp = _tree(
        client,
        ws_key,
        "node",
        browse_id=opened["browse_id"],
        term_id=twin,
        via_parent_id=beta,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["path"] == [root, beta, twin]
    assert [level["term_id"] for level in body["levels"]] == [root, beta]
    assert [n["label"] for n in body["levels"][1]["children"]] == [
        "Able",
        "Shortcut",
        "Twin",
    ]
    assert body["children"] == []
    # Able and Shortcut became visible under Beta.
    assert _event(client, opened["browse_id"]).candidates == [
        *shown,
        tid("0000008"),
        tid("0000005"),
    ]


def test_classes_of_other_ontologies_are_neither_returned_nor_logged_as_roots(
    mixed_walk,
):
    client, _, ws_key = mixed_walk

    opened = _tree(client, ws_key, "open", term_id="OWN:0000003")

    assert opened.status_code == 200, opened.text
    body = opened.json()
    tops = ["EXT:0000001", "EXT:0000002", "EXT:0000003", "OWN:0000001"]
    assert [n["term_id"] for n in body["roots"]] == tops
    assert body["path"] == ["OWN:0000001", "OWN:0000002", "OWN:0000003"]
    shown = _event(client, body["browse_id"]).candidates
    assert shown[:4] == tops
    # None of the 300 parentless stubs was shown, so none is logged.
    assert not [t for t in shown if t.startswith(("STUB:", "REF:"))]
    assert "EXT:0000005" not in shown
    assert len(opened.content) < 40_000

    # A term of the ontology that hangs under a foreign class is reached there.
    via = _tree(client, ws_key, "open", term_id="OWN:0000006").json()
    assert via["path"] == ["EXT:0000003", "EXT:0000004", "OWN:0000006"]
    assert [n["term_id"] for n in via["roots"]] == tops

    # Opened at a stub itself, the walk shows that one stub and can select it.
    stub = _tree(client, ws_key, "open", term_id="STUB:0000007").json()
    assert stub["start_status"] == "valid"
    assert stub["path"] == ["STUB:0000007"]
    assert sorted(n["term_id"] for n in stub["roots"]) == [*tops, "STUB:0000007"]
    logged = _event(client, stub["browse_id"]).candidates
    assert sorted(logged) == [*tops, "STUB:0000007"]
    node = _tree(
        client, ws_key, "node", browse_id=stub["browse_id"], term_id="STUB:0000007"
    )
    assert node.status_code == 200, node.text


def test_also_under_refuses_a_term_that_is_not_a_parent(graph_walk):
    client, _, ws_key = graph_walk
    opened = _tree(client, ws_key, "open", term_id=tid("0000006")).json()
    shown = _event(client, opened["browse_id"]).candidates

    # Gamma was shown, but it is a sibling of Twin, not a parent.
    resp = _tree(
        client,
        ws_key,
        "node",
        browse_id=opened["browse_id"],
        term_id=tid("0000006"),
        via_parent_id=tid("0000004"),
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == "INVALID_TREE_PARENT"
    assert _event(client, opened["browse_id"]).candidates == shown


def test_the_export_carries_the_walk_with_everything_it_showed(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)
    _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )
    done = _command(client, ws_id, 1, _set_term("HP:0000407", browse_id))
    assert done.status_code == 200, done.text

    exported = (
        ExportService(client.app.state.repo)
        .for_workspace(WorkspaceKey.model_validate(ws_key))
        .search_events
    )

    assert len(exported) == 2
    by_id = {e.event_id: e for e in exported}
    assert by_id[browse_id].candidates == [*SEIZURE_WALK, "HP:0000407"]
    assert by_id[browse_id].selected_term_id is None
    selection = next(e for e in exported if e.selected_term_id == "HP:0000407")
    assert selection.source_search_event_id == browse_id
    assert selection.displayed_position == 10


def test_details_carry_translated_names_once_they_are_loaded(walk):
    client, _, ws_key = walk
    repo = client.app.state.repo
    service = client.app.state.ontology_registry.for_layer(
        repo.get_task_profile("pkg-scenario-a"), "hpo-layer"
    )
    # What Part 2's translation files leave on a term.
    service.ontology.terms["HP:0001250"].translations["de"] = ["Krampfanfall"]

    opened = _tree(client, ws_key, "open", term_id="HP:0001250").json()
    assert opened["detail"]["translations"] == {"de": ["Krampfanfall"]}

    node = _tree(
        client,
        ws_key,
        "node",
        browse_id=opened["browse_id"],
        term_id="HP:0001252",
    ).json()
    assert node["detail"]["translations"] == {}


def test_details_show_the_names_of_translation_files_that_are_loaded(tmp_path):
    """Beyond the plan: Part 2's files, read from a translation folder."""
    fixtures = FIXTURE_PATH.parent
    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=tmp_path / "translated.db",
        ontology_paths=[FIXTURE_PATH, fixtures / "mondo.json"],
        translation_dirs=[fixtures],
        session_token="secret-session-token",
    )
    client = TestClient(
        create_app(config), headers={"Authorization": "Bearer secret-session-token"}
    )
    _import(client, make_layered_package("single"))
    _, ws_key = _open(client, "pkg-scenario-a")

    opened = _tree(client, ws_key, "open", term_id="HP:0001250").json()

    assert opened["detail"]["translations"] == {
        "de": ["Krampfanfall"],
        "es": ["Crisis epiléptica"],
    }
    # Translated names are never the label of a row.
    assert opened["levels"][2]["children"][2] == {
        "term_id": "HP:0001250",
        "label": "Seizure",
        "child_count": 2,
    }
