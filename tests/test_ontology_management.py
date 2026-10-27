import json
from pathlib import Path
from typing import Any

import pytest
from auth_harness import HARNESS, AutoLoginClient, logged_in
from pg_harness import database_url_for

from ontotator.api.app import create_app
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.ontology.discovery import discover_ontologies

SAMPLE_OBO_JSON = {
    "graphs": [
        {
            "id": "http://purl.obolibrary.org/obo/hp.json",
            "meta": {"version": "2024-06-01"},
            "nodes": [
                {
                    "id": "http://purl.obolibrary.org/obo/HP_0000001",
                    "lbl": "All",
                    "type": "CLASS",
                },
                {
                    "id": "http://purl.obolibrary.org/obo/HP_0000118",
                    "lbl": "Phenotypic abnormality",
                    "type": "CLASS",
                },
            ],
            "edges": [],
        }
    ]
}


def test_discover_ontologies(tmp_path: Path) -> None:
    ont_dir = tmp_path / "ontologies"
    ont_dir.mkdir()
    valid_ont = ont_dir / "hp.json"
    valid_ont.write_text(json.dumps(SAMPLE_OBO_JSON), encoding="utf-8")
    invalid_file = ont_dir / "other.txt"
    invalid_file.write_text("not json", encoding="utf-8")
    not_obo_json = ont_dir / "random.json"
    not_obo_json.write_text('{"foo": "bar"}', encoding="utf-8")

    discovered = discover_ontologies([ont_dir])
    assert valid_ont.resolve() in discovered
    assert invalid_file.resolve() not in discovered
    assert not_obo_json.resolve() not in discovered


def _app(ws: Path) -> Any:
    return create_app(
        AppConfig(workspace_dir=ws, database_url=database_url_for(ws / "editor.db"))
    )


def test_stored_ontologies_are_listed_once(tmp_path: Path) -> None:
    app = _app(tmp_path / "workspace")
    client = AutoLoginClient(app)
    store = app.state.ontology_store

    assert client.get("/api/v1/ontologies").json() == []

    file_bytes = json.dumps(SAMPLE_OBO_JSON).encode("utf-8")
    stored = store.add(HARNESS, "hp.json", file_bytes)

    items = client.get("/api/v1/ontologies").json()
    assert [(i["sha256"], i["ontology_id"], i["term_count"]) for i in items] == [
        (stored.sha256, "hp", 2)
    ]
    # Adding the same ontology again registers nothing new.
    assert store.add(HARNESS, "hp.json", file_bytes) == stored
    assert len(client.get("/api/v1/ontologies").json()) == 1


def test_an_invalid_ontology_is_refused(tmp_path: Path) -> None:
    app = _app(tmp_path / "workspace")

    with pytest.raises(DomainError) as error:
        app.state.ontology_store.add(HARNESS, "broken.json", b"{not valid json")

    assert error.value.code == "INVALID_ONTOLOGY"


def test_an_invalid_upload_leaves_the_stored_ontology(tmp_path: Path) -> None:
    app = _app(tmp_path / "workspace")
    client = AutoLoginClient(app)
    store = app.state.ontology_store
    original = json.dumps(SAMPLE_OBO_JSON).encode("utf-8")
    stored = store.add(HARNESS, "hp.json", original)

    # An invalid file with the same filename
    with pytest.raises(DomainError):
        store.add(HARNESS, "hp.json", b"{corrupted content...")

    listed = client.get("/api/v1/ontologies").json()
    assert [item["sha256"] for item in listed] == [stored.sha256]
    assert app.state.repo.db.blobs.get(stored.sha256) == original


def test_uploaded_ontologies_are_listed_after_a_restart(tmp_path: Path) -> None:
    ws = tmp_path / "workspace"
    first = _app(ws)
    stored = first.state.ontology_store.add(
        HARNESS, "hp.json", json.dumps(SAMPLE_OBO_JSON).encode("utf-8")
    )
    assert first.state.repo.db.blobs.path(stored.sha256).is_file()

    # Restart: the second app finds the file in the ontology store.
    client = AutoLoginClient(_app(ws))

    ontologies = client.get("/api/v1/ontologies").json()
    assert len(ontologies) == 1
    assert ontologies[0]["ontology_id"] == "hp"
    assert ontologies[0]["term_count"] == 2


def test_only_system_admins_see_server_paths(tmp_path: Path) -> None:
    app = _app(tmp_path / "workspace")
    app.state.ontology_store.add(
        HARNESS, "hp.json", json.dumps(SAMPLE_OBO_JSON).encode("utf-8")
    )

    [admin] = logged_in(app, "root", system_admin=True).get("/api/v1/ontologies").json()
    [member] = logged_in(app, "member").get("/api/v1/ontologies").json()

    assert admin["path"]
    assert member["path"] is None
    assert member["error"] is None
    assert member["sha256"] == admin["sha256"]
