import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.ontology.discovery import discover_ontologies

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


def test_get_and_post_ontologies_endpoint(tmp_path: Path) -> None:
    config = AppConfig(
        workspace_dir=tmp_path / "workspace",
        database_url=database_url_for(tmp_path / "workspace" / "editor.db"),
        session_token="test-token",
        port=8000,
        host="127.0.0.1",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    # Initial list is empty
    res = client.get("/api/v1/ontologies")
    assert res.status_code == 200
    assert res.json() == []

    # Upload ontology
    file_bytes = json.dumps(SAMPLE_OBO_JSON).encode("utf-8")
    res_upload = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", file_bytes, "application/json")},
    )
    assert res_upload.status_code == 200
    data = res_upload.json()
    assert data["term_count"] == 2
    assert "sha256" in data
    assert data["ontology_id"] == "hp" or "hp" in data["ontology_id"]

    # Verify listed now
    res_after = client.get("/api/v1/ontologies")
    assert res_after.status_code == 200
    items = res_after.json()
    assert len(items) == 1
    assert items[0]["sha256"] == data["sha256"]

    # Uploading the same ontology again returns 200 without duplicate registration
    res_again = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", file_bytes, "application/json")},
    )
    assert res_again.status_code == 200
    res_after_again = client.get("/api/v1/ontologies")
    assert len(res_after_again.json()) == 1


def test_upload_invalid_ontology_returns_400(tmp_path: Path) -> None:
    config = AppConfig(
        workspace_dir=tmp_path / "workspace",
        database_url=database_url_for(tmp_path / "workspace" / "editor.db"),
        session_token="test-token",
        port=8000,
        host="127.0.0.1",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    res_upload = client.post(
        "/api/v1/ontologies",
        files={"file": ("broken.json", b"{not valid json", "application/json")},
    )
    assert res_upload.status_code == 400


def test_invalid_upload_does_not_overwrite_or_delete_existing_ontology(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "workspace"
    ont_dir = ws / "ontologies"
    ont_dir.mkdir(parents=True)
    existing_ont = ont_dir / "hp.json"
    original_content = json.dumps(SAMPLE_OBO_JSON)
    existing_ont.write_text(original_content, encoding="utf-8")

    config = AppConfig(
        workspace_dir=ws,
        database_url=database_url_for(ws / "editor.db"),
        session_token="test-token",
        port=8000,
        host="127.0.0.1",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    # Attempt to upload an invalid file with the same filename
    res_upload = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", b"{corrupted content...", "application/json")},
    )
    assert res_upload.status_code == 400

    # The original file must still exist and be completely intact!
    assert existing_ont.is_file()
    assert existing_ont.read_text(encoding="utf-8") == original_content


def test_uploaded_ontologies_are_listed_after_a_restart(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "workspace"
    config_1 = AppConfig(
        workspace_dir=ws,
        database_url=database_url_for(ws / "editor.db"),
        session_token="test-token",
        port=8000,
        host="127.0.0.1",
    )
    app_1 = create_app(config_1)
    client_1 = TestClient(app_1, headers={"Authorization": "Bearer test-token"})

    # Upload ontology to App 1
    res_upload = client_1.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", json.dumps(SAMPLE_OBO_JSON), "application/json")},
    )
    assert res_upload.status_code == 200

    # Restart: the second app finds the upload in <workspace>/ontologies.
    assert len(list((ws / "ontologies").glob("*.json"))) == 1

    config_2 = AppConfig(
        workspace_dir=ws,
        database_url=database_url_for(ws / "editor.db"),
        session_token="test-token-2",
        port=8001,
        host="127.0.0.1",
    )
    app_2 = create_app(config_2)
    client_2 = TestClient(app_2, headers={"Authorization": "Bearer test-token-2"})

    res_list = client_2.get("/api/v1/ontologies")
    assert res_list.status_code == 200
    ontologies = res_list.json()
    assert len(ontologies) == 1
    assert ontologies[0]["ontology_id"] == "hp"
    assert ontologies[0]["term_count"] == 2


def test_a_broken_entry_in_the_ontologies_folder_does_not_stop_the_start(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "workspace"
    stored = ws / "ontologies"
    stored.mkdir(parents=True)
    (stored / "hp.json").write_text(json.dumps(SAMPLE_OBO_JSON), encoding="utf-8")
    # A folder whose name looks like an ontology file is skipped.
    (stored / "folder.json").mkdir()
    (stored / "broken.json").write_text("{not json", encoding="utf-8")

    app = create_app(
        AppConfig(
            workspace_dir=ws,
            database_url=database_url_for(ws / "editor.db"),
            session_token="test-token",
        )
    )
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    listed = client.get("/api/v1/ontologies").json()
    loaded = [item for item in listed if item.get("status") != "failed"]
    assert [item["ontology_id"] for item in loaded] == ["hp"]


def test_an_unreadable_stored_ontology_does_not_stop_the_start(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.ontology.registry import OntologyRegistry

    ws = tmp_path / "workspace"
    stored = ws / "ontologies"
    stored.mkdir(parents=True)
    (stored / "hp.json").write_text(json.dumps(SAMPLE_OBO_JSON), encoding="utf-8")
    (stored / "locked.json").write_text("{}", encoding="utf-8")
    original = OntologyRegistry.register_path

    def register_path(self: OntologyRegistry, path: Path | str) -> str:
        if Path(path).name == "locked.json":
            raise PermissionError("locked by another process")
        return original(self, path)

    monkeypatch.setattr(OntologyRegistry, "register_path", register_path)

    app = create_app(
        AppConfig(
            workspace_dir=ws,
            database_url=database_url_for(ws / "editor.db"),
            session_token="test-token",
        )
    )
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    listed = client.get("/api/v1/ontologies").json()
    assert [item["ontology_id"] for item in listed] == ["hp"]
