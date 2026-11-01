"""Frozen translations are named, never changed (#254)."""

import io
from pathlib import Path
from typing import Any

import pytest
from auth_harness import HARNESS, AutoLoginClient, upload_package
from layered_fixtures import make_layered_package
from pg_harness import database_url_for
from sqlalchemy import select
from support.v2_writer import PackageWriter
from typer.testing import CliRunner

from ontotator.api.app import create_app
from ontotator.cli import app as cli_app
from ontotator.config import AppConfig
from ontotator.ontology.translation_freeze import (
    frozen_files,
    not_included,
    projects_without,
)
from ontotator.storage.tables import ProjectSearchConditionsRow

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"
BASE = "/api/v1/admin/ontologies/"


def _client(tmp_path: Path) -> AutoLoginClient:
    workspace = tmp_path / "workspace"
    app = create_app(
        AppConfig(
            workspace_dir=workspace,
            database_url=database_url_for(workspace / "editor.db"),
            ontology_paths=[HP],
        )
    )
    return AutoLoginClient(app)


def _project(client: AutoLoginClient) -> tuple[str, Any]:
    """Import a bundle and open a case; returns the project key and view key."""
    stream = io.BytesIO()
    PackageWriter.write_to_stream(make_layered_package("single"), stream)
    imported = upload_package(
        client, files={"file": ("cases.zip", stream.getvalue(), "application/zip")}
    )
    assert imported.status_code == 200, imported.text
    project = imported.json()["project_key"]
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": project,
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    return project, opened.json()["view"]["key"]


def _search(client: AutoLoginClient, key: Any) -> None:
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": "Muskelhypotonie",
        },
    )
    assert response.status_code == 200, response.text


def _add(client: AutoLoginClient, path: Path, name: str | None = None) -> str:
    store = client.app.state.ontology_store  # type: ignore[attr-defined]
    item, _stored = store.add_translation(HARNESS, name or path.name, path.read_bytes())
    return str(item.sha256)


def _inventory(client: AutoLoginClient) -> dict[str, list[str]]:
    response = client.get(BASE)
    assert response.status_code == 200, response.text
    return {item["filename"]: item["frozen_without"] for item in response.json()}


def _settings(client: AutoLoginClient, project: str) -> Any:
    response = client.get(f"/api/v1/projects/{project}/settings")
    assert response.status_code == 200, response.text
    return response.json()["frozen_translations"]


def _conditions(client: AutoLoginClient) -> list[Any]:
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        return list(
            conn.execute(select(ProjectSearchConditionsRow.conditions)).scalars()
        )


def test_an_unfrozen_project_is_not_named_and_shows_nothing_frozen(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    project, _key = _project(client)
    _add(client, DE)

    # The bundle import and opening a case freeze nothing.
    assert _settings(client, project) is None
    assert _inventory(client) == {"hp-de.babelon.tsv": []}
    assert _conditions(client) == []


def test_an_upload_after_the_first_search_names_the_frozen_project(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    de = _add(client, DE)
    project, key = _project(client)
    _search(client, key)
    frozen = _conditions(client)

    es = _add(client, ES)

    assert _inventory(client) == {
        "hp-de.babelon.tsv": [],
        "hp-es.babelon.tsv": [project],
    }
    settings = _settings(client, project)
    assert settings == {
        "files": [
            {
                "ontology_id": "hp",
                "filename": "hp-de.babelon.tsv",
                "sha256": de,
                "languages": ["de"],
            }
        ],
        "not_included": ["hp-es.babelon.tsv"],
        "updated": None,
        "history": [],
    }
    # Reading changed nothing: the project keeps searching as it froze.
    assert _conditions(client) == frozen
    assert es not in str(frozen)


def test_a_newer_file_of_a_frozen_name_is_named_too(tmp_path: Path) -> None:
    client = _client(tmp_path)
    old = _add(client, DE)
    project, key = _project(client)
    _search(client, key)
    newer = tmp_path / "hp-de.babelon.tsv"
    newer.write_bytes(
        b"subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        b"HP:0001284\trdfs:label\tde\tAreflexie\n"
    )
    new = _add(client, newer)

    listed = {
        item["sha256"]: item["frozen_without"] for item in client.get(BASE).json()
    }
    assert listed == {old: [], new: [project]}
    assert _settings(client, project)["not_included"] == ["hp-de.babelon.tsv"]
    assert _settings(client, project)["files"][0]["sha256"] == old


def test_the_upload_result_names_the_projects(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project, key = _project(client)
    _search(client, key)

    response = client.post(
        BASE + "upload-results",
        files=[("files[]", ("hp-de.babelon.tsv", DE.read_bytes()))],
    )

    assert response.status_code == 200, response.text
    [result] = response.json()
    assert result["status"] == "added"
    assert result["ontology"]["frozen_without"] == [project]
    # Frozen with no translation at all: an empty list, not "not frozen".
    assert _settings(client, project) == {
        "files": [],
        "not_included": ["hp-de.babelon.tsv"],
        "updated": None,
        "history": [],
    }


def test_the_cli_names_the_projects_on_stderr(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _client(tmp_path)
    # The CLI loads no ontology: it knows the prefix of uploaded ones only.
    client.app.state.ontology_store.add_ontology(  # type: ignore[attr-defined]
        HARNESS, "hp.json", HP.read_bytes()
    )
    project, key = _project(client)
    _search(client, key)
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(tmp_path / "workspace"))
    url = database_url_for(tmp_path / "workspace" / "editor.db")

    result = CliRunner().invoke(
        cli_app, ["admin", "--database-url", url, "ontologies", "add", str(DE)]
    )

    assert result.exit_code == 0, result.output
    assert result.stdout.strip().endswith("translation")
    assert (
        f"hp-de.babelon.tsv does not reach {project}: these projects froze "
        "their translations at first use."
    ) in result.stderr


def test_conditions_of_another_prefix_do_not_name_the_project() -> None:
    conditions = [
        {
            "ontology_sha256": "a" * 64,
            "translations": [
                {
                    "filename": "mondo-de.babelon.tsv",
                    "sha256": "b" * 64,
                    "languages": ["de"],
                }
            ],
        }
    ]
    assert [item.filename for item in frozen_files(conditions)] == [
        "mondo-de.babelon.tsv"
    ]

    class _Conn:
        def __init__(self, *results: list[tuple[Any, ...]]) -> None:
            self.results = list(results)

        def execute(self, _query: Any) -> Any:
            rows = self.results.pop(0)

            class _Result:
                def tuples(self) -> Any:
                    return self

                def all(self) -> list[tuple[Any, ...]]:
                    return rows

                def __iter__(self) -> Any:
                    return iter(rows)

            return _Result()

    # The project's ontology is unknown here; its captured file names it mondo.
    hp_file = [("c" * 64, "hp")]
    assert projects_without(_Conn(hp_file, [("p", conditions)]), {}) == {}  # type: ignore[arg-type]
    mondo_file = [("d" * 64, "mondo")]
    assert projects_without(_Conn(mondo_file, [("p", conditions)]), {}) == {  # type: ignore[arg-type]
        "d" * 64: ["p"]
    }
    latest = [
        ("d" * 64, "mondo-es.babelon.tsv", "mondo"),
        ("c" * 64, "hp-es.babelon.tsv", "hp"),
    ]
    assert not_included(_Conn(latest), conditions, {}) == ["mondo-es.babelon.tsv"]  # type: ignore[arg-type]


def test_a_pin_change_ends_the_freeze_as_documented(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.app.state.ontology_store.add_ontology(  # type: ignore[attr-defined]
        HARNESS, "hp.json", HP.read_bytes()
    )
    _add(client, DE)
    project, key = _project(client)
    _search(client, key)
    assert _settings(client, project) is not None
    profile = client.get(f"/api/v1/projects/{project}/settings").json()["profile"]
    body = [
        {"ontology_id": item["ontology_id"], "sha256": item["sha256"]}
        for item in profile["ontologies"]
    ]

    response = client.put(f"/api/v1/projects/{project}/pins", json=body)

    assert response.status_code == 200, response.text
    assert response.json()["frozen_translations"] is None
    assert _conditions(client) == []
