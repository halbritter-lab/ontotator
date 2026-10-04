import json
from pathlib import Path

from fastapi.testclient import TestClient

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
        database_path=tmp_path / "workspace" / "editor.db",
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
        database_path=tmp_path / "workspace" / "editor.db",
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
