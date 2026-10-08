"""Translation files through the HTTP API: start-up, listing, search event, upload."""

import io
import logging
import os
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from layered_fixtures import make_layered_package

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.ontology.service import OntologyService
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


# --- upload ----------------------------------------------------------------- #


def _upload(client: TestClient, name: str, data: bytes) -> Any:
    return client.post(
        "/api/v1/ontologies",
        files={"file": (name, data, "text/tab-separated-values")},
    )


def test_uploading_a_translation_reloads_the_ontology(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP, MONDO])
    key = _open_single(client)
    before = _search(client, key, "Muskelhypotonie")
    assert before["languages"] == ["en"]
    assert all(c["match_language"] in (None, "en") for c in before["candidates"])

    response = _upload(client, "HP-de.babelon.tsv", DE.read_bytes())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filename"] == "hp-de.babelon.tsv"
    assert body["language"] == "de"
    assert body["assigned"] is True
    assert body["message"] == "hp-de.babelon.tsv was added. HP 2026-06-23: de 4 terms."
    assert [item["ontology_id"] for item in body["ontologies"]] == ["hp"]
    assert body["ontologies"][0]["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 4}
    ]
    stored = tmp_path / "workspace" / "ontologies" / "hp-de.babelon.tsv"
    assert stored.read_bytes() == DE.read_bytes()
    # No staging folder is left behind.
    assert [p.name for p in stored.parent.iterdir() if p.name.startswith(".")] == []

    after = _search(client, key, "Muskelhypotonie")
    assert after["languages"] == ["en", "de"]
    assert after["candidates"][0]["match_language"] == "de"
    assert after["index_identity"] != before["index_identity"]
    listed = _listed(client)
    assert listed["hp"]["translations"] == body["ontologies"][0]["translations"]
    assert listed["mondo"]["translations"] == []


def test_uploading_the_same_name_replaces_the_file(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    assert _upload(client, "hp-de.babelon.tsv", DE.read_bytes()).status_code == 200
    assert _upload(client, "hp-es.babelon.tsv", ES.read_bytes()).status_code == 200

    smaller = (
        b"subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        b"HP:0001284\trdfs:label\tde\tAreflexie\n"
    )
    response = _upload(client, "hp-de.babelon.tsv", smaller)

    assert response.status_code == 200, response.text
    # German is replaced, Spanish is kept.
    assert response.json()["ontologies"][0]["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 1},
        {"language": "es", "filenames": ["hp-es.babelon.tsv"], "term_count": 3},
    ]
    folder = tmp_path / "workspace" / "ontologies"
    assert (folder / "hp-de.babelon.tsv").read_bytes() == smaller
    assert sorted(p.name for p in folder.iterdir()) == [
        "hp-de.babelon.tsv",
        "hp-es.babelon.tsv",
    ]
    # The names of the replaced file are gone, the new one is found.
    assert "HP:0001250" not in _search(client, key, "Krampfanfall")["displayed_ids"]
    assert _search(client, key, "Areflexie")["candidates"][0]["match_language"] == "de"
    assert _search(client, key, "Hipotonía")["candidates"][0]["match_language"] == "es"


@pytest.mark.parametrize(
    ("name", "data", "reason"),
    [
        ("hp-de.babelon.tsv", b"term\tname\nHP:0001250\tKrampf\n", "subject_id"),
        (
            "hp-de.babelon.tsv",
            b"subject_id\ttranslation_value\nHP:9999999\tUnbekannt\n",
            "holds no name",
        ),
        ("hp-de.babelon.tsv", b"", "subject_id"),
        ("hp-de.babelon.tsv", b"\xff\xfe\x00broken", "cannot be read"),
        ("german.tsv", DE.read_bytes(), "not a translation file name"),
    ],
)
def test_unusable_uploads_are_rejected_and_change_nothing(
    tmp_path: Path, name: str, data: bytes, reason: str
) -> None:
    folder = _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    before = _listed(client)

    response = _upload(client, name, data)

    assert response.status_code == 400, response.text
    assert reason in response.json()["detail"]
    assert sorted(p.name for p in folder.iterdir()) == ["hp-de.babelon.tsv"]
    assert (folder / "hp-de.babelon.tsv").read_bytes() == DE.read_bytes()
    assert _listed(client) == before


def test_upload_without_a_matching_ontology_is_stored_with_a_notice(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path, ontology_paths=[MONDO])

    response = _upload(client, "hp-de.babelon.tsv", DE.read_bytes())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["assigned"] is False
    assert body["ontologies"] == []
    assert "no loaded ontology has the prefix 'HP'" in body["message"]
    stored = tmp_path / "workspace" / "ontologies" / "hp-de.babelon.tsv"
    assert stored.read_bytes() == DE.read_bytes()
    assert _listed(client)["mondo"]["translations"] == []

    # Not a babelon file: rejected although no ontology could check its rows.
    bad = _upload(client, "hp-es.babelon.tsv", b"term\tname\nx\ty\n")
    assert bad.status_code == 400
    assert not (stored.parent / "hp-es.babelon.tsv").exists()

    # The ontology that arrives later picks the stored file up.
    added = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", HP.read_bytes(), "application/json")},
    )
    assert added.status_code == 200, added.text
    assert added.json()["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 4}
    ]


def test_failed_reload_keeps_the_old_index_and_stores_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    before = _search(client, key, "Krampfanfall")

    def broken(self: OntologyService, paths: object) -> OntologyService:
        raise RuntimeError("index build failed")

    monkeypatch.setattr(OntologyService, "with_translations", broken)
    response = _upload(client, "hp-es.babelon.tsv", ES.read_bytes())

    assert response.status_code == 500, response.text
    assert "index build failed" in response.json()["detail"]
    assert sorted(p.name for p in folder.iterdir()) == ["hp-de.babelon.tsv"]
    after = _search(client, key, "Krampfanfall")
    assert after["languages"] == ["en", "de"]
    assert after["index_identity"] == before["index_identity"]
    assert after["candidates"][0]["term_id"] == "HP:0001250"


def test_a_file_that_cannot_be_replaced_is_reported_and_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """On Windows a file that is open in another program cannot be replaced."""
    folder = _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    before = _search(client, key, "Krampfanfall")
    smaller = (
        b"subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        b"HP:0001284\trdfs:label\tde\tAreflexie\n"
    )
    replace = os.replace

    def locked(source: Any, target: Any) -> None:
        if str(target).endswith(".tsv"):
            raise PermissionError(13, "The file is used by another process")
        replace(source, target)

    monkeypatch.setattr(os, "replace", locked)
    response = _upload(client, "hp-de.babelon.tsv", smaller)

    assert response.status_code == 500, response.text
    detail = response.json()["detail"]
    assert "'hp-de.babelon.tsv' could not be replaced" in detail
    assert "used by another process" in detail
    assert "The file was not stored; the search is unchanged." in detail
    assert sorted(p.name for p in folder.iterdir()) == ["hp-de.babelon.tsv"]
    assert (folder / "hp-de.babelon.tsv").read_bytes() == DE.read_bytes()
    after = _search(client, key, "Krampfanfall")
    assert after["index_identity"] == before["index_identity"]
    assert after["candidates"][0]["term_id"] == "HP:0001250"
    # The name only the new file has is not searched.
    assert all(
        candidate["matched_term"] != "Areflexie"
        for candidate in _search(client, key, "Areflexie")["candidates"]
    )


def test_uploading_a_file_with_a_byte_order_mark_works(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    marked = b"\xef\xbb\xbf" + DE.read_bytes()

    response = _upload(client, "hp-de.babelon.tsv", marked)

    assert response.status_code == 200, response.text
    assert response.json()["message"] == (
        "hp-de.babelon.tsv was added. HP 2026-06-23: de 4 terms."
    )
    # Stored as it was sent, mark included.
    stored = tmp_path / "workspace" / "ontologies" / "hp-de.babelon.tsv"
    assert stored.read_bytes() == marked
    assert _search(client, key, "Krampfanfall")["candidates"][0]["term_id"] == (
        "HP:0001250"
    )
    # The mark is part of the content the index identity is made of.
    marked_identity = _search(client, key, "Krampfanfall")["index_identity"]
    assert _upload(client, "hp-de.babelon.tsv", DE.read_bytes()).status_code == 200
    assert _search(client, key, "Krampfanfall")["index_identity"] != marked_identity


def test_ontology_json_upload_still_answers_with_the_ontology(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", HP.read_bytes(), "application/json")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ontology_id"] == "hp"
    assert body["translations"] == []
    assert "filename" not in body
