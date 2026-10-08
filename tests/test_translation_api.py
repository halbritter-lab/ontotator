"""Translation files through the HTTP API: start-up, listing, search event, upload."""

import io
import logging
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from layered_fixtures import make_layered_package

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.packages.writer import PackageWriter

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"
TOKEN = "translation-test"


def _folder(tmp_path: Path, *files: Path) -> Path:
    """``<workspace>/ontologies`` holding copies of the given files."""
    folder = tmp_path / "workspace" / "ontologies"
    folder.mkdir(parents=True, exist_ok=True)
    for source in files:
        shutil.copyfile(source, folder / source.name)
    return folder


def _client(tmp_path: Path, **config: Any) -> TestClient:
    workspace = tmp_path / "workspace"
    app = create_app(
        AppConfig(
            workspace_dir=workspace,
            database_path=workspace / "editor.db",
            session_token=TOKEN,
            **config,
        )
    )
    return TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"})


def _listed(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/ontologies")
    assert response.status_code == 200, response.text
    return {item["ontology_id"]: item for item in response.json()}


def _open_single(client: TestClient, embedded: bool = False) -> Any:
    """Import the single-layer HPO package and open a case; returns its key."""
    package = make_layered_package("single")
    resources = {"ontologies/hp.json": HP.read_bytes()} if embedded else {}
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream, embedded_files=resources)
    imported = client.post(
        "/api/v1/packages",
        files={"file": ("cases.zip", stream.getvalue(), "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": imported.json()["package_id"],
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    return opened.json()["view"]["key"]


def _search(client: TestClient, key: Any, query: str, **extra: Any) -> Any:
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": query,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- start-up and listing --------------------------------------------------- #


def test_start_loads_translations_from_both_ontology_folders(tmp_path: Path) -> None:
    _folder(tmp_path, DE)
    bundle = tmp_path / "bundle" / "ontologies"
    bundle.mkdir(parents=True)
    shutil.copyfile(ES, bundle / ES.name)

    client = _client(tmp_path, ontology_paths=[HP, MONDO], translation_dirs=[bundle])
    listed = _listed(client)

    assert listed["hp"]["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 4},
        {"language": "es", "filenames": ["hp-es.babelon.tsv"], "term_count": 3},
    ]
    assert listed["mondo"]["translations"] == []


def test_without_translation_files_the_list_is_empty(tmp_path: Path) -> None:
    listed = _listed(_client(tmp_path, ontology_paths=[HP]))

    assert listed["hp"]["translations"] == []
    assert listed["hp"]["term_count"] == 11


def test_two_files_of_one_language_are_listed_together(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE)
    (folder / "hp-de.synonyms.tsv").write_text(
        "subject_id\ttranslation_value\tStatus\n"
        "HP:0001250\tKrampf|Anfall\tOFFICIAL\n"
        "HP:0001284\tReflexlosigkeit\tOFFICIAL\n",
        encoding="utf-8",
    )
    listed = _listed(_client(tmp_path, ontology_paths=[HP]))

    # Five terms have a German name now: four from the first file, one more
    # (HP:0001284) from the second.
    assert listed["hp"]["translations"] == [
        {
            "language": "de",
            "filenames": ["hp-de.babelon.tsv", "hp-de.synonyms.tsv"],
            "term_count": 5,
        }
    ]


def test_broken_and_stray_files_do_not_block_the_start(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    folder = _folder(tmp_path, DE)
    (folder / "hp-fr.babelon.tsv").write_text("term\tname\nx\ty\n", encoding="utf-8")
    (folder / "hp-nl.babelon.tsv").write_bytes(b"\xff\xfe\x00broken")
    (folder / "xx-de.babelon.tsv").write_text(
        "subject_id\ttranslation_value\nXX:1\tEtwas\n", encoding="utf-8"
    )

    with caplog.at_level(logging.WARNING, logger="ontocurator"):
        client = _client(tmp_path, ontology_paths=[HP])

    listed = _listed(client)
    assert listed["hp"]["status"] == "loaded"
    assert [item["language"] for item in listed["hp"]["translations"]] == ["de"]
    assert "Skipping translation file hp-fr.babelon.tsv" in caplog.text
    assert "Skipping translation file hp-nl.babelon.tsv" in caplog.text
    assert "xx-de.babelon.tsv matches no loaded ontology" in caplog.text


def test_package_shipped_ontology_is_searchable_in_german(tmp_path: Path) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path)  # no ontology registered: the package brings it
    key = _open_single(client, embedded=True)

    result = _search(client, key, "Muskelhypotonie")

    first = result["candidates"][0]
    assert (first["term_id"], first["route"], first["match_language"]) == (
        "HP:0001252",
        "exact",
        "de",
    )
    assert [item["language"] for item in _listed(client)["hp"]["translations"]] == [
        "de"
    ]


# --- search event ----------------------------------------------------------- #


def test_search_event_records_the_active_languages(tmp_path: Path) -> None:
    _folder(tmp_path, DE, ES)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    repo = client.app.state.repo  # type: ignore[attr-defined]

    everything = _search(client, key, "Krampfanfall")
    assert everything["languages"] == ["en", "de", "es"]
    assert everything["candidates"][0]["match_language"] == "de"
    assert repo.get_search_event(everything["search_id"]).languages == [
        "en",
        "de",
        "es",
    ]

    spanish = _search(client, key, "Krampfanfall", languages=["es"])
    assert spanish["languages"] == ["en", "es"]
    assert "HP:0001250" not in spanish["displayed_ids"]
    assert repo.get_search_event(spanish["search_id"]).languages == ["en", "es"]
    assert spanish["index_identity"] == everything["index_identity"]

    english = _search(client, key, "Krampfanfall", languages=[])
    assert repo.get_search_event(english["search_id"]).languages == ["en"]
