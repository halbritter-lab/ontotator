"""Exports carry the ended search conditions their events name (#282)."""

import io
from pathlib import Path
from typing import Any

import pytest
from auth_harness import HARNESS, AutoLoginClient, upload_package
from pg_harness import database_url_for
from sqlalchemy import delete, select
from support.v2_writer import PackageWriter
from test_translation_freeze import DE, ES, HP, _add, _client, _conditions, _project
from test_translation_refresh import _refresh, _search

from ontotator.api.app import create_app
from ontotator.config import AppConfig
from ontotator.domain.errors import InvalidPackage
from ontotator.packages import ValidatedPackage
from ontotator.storage.tables import (
    AuditEventRow,
    ProjectResourceRow,
    ProjectSearchConditionsRow,
)


def _export(client: AutoLoginClient, project: str) -> ValidatedPackage:
    return client.app.state.repo.export_package(project)  # type: ignore[attr-defined,no-any-return]


def _zip(package: ValidatedPackage) -> bytes:
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    return stream.getvalue()


def _other_server(tmp_path: Path) -> AutoLoginClient:
    workspace = tmp_path / "other"
    return AutoLoginClient(
        create_app(
            AppConfig(
                workspace_dir=workspace,
                database_url=database_url_for(workspace / "editor.db"),
                ontology_paths=[HP],
            )
        )
    )


def _ids(conditions: list[Any] | None) -> list[str]:
    return [c.condition_id for c in conditions or []]


def _resources(package: ValidatedPackage) -> set[str]:
    return {p for p in package.embedded_files if p.startswith("search-resources/")}


def _roundtrip(tmp_path: Path, package: ValidatedPackage) -> ValidatedPackage:
    """Read and import on another server, export again there."""
    data = _zip(package)
    other = _other_server(tmp_path)
    imported = upload_package(other, files={"file": ("study.zip", data)})
    assert imported.status_code == 200, imported.text
    return _export(other, imported.json()["project_key"])


def test_an_export_after_a_refresh_carries_the_replaced_condition(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    de = _add(client, DE)
    project, key = _project(client)
    before = _search(client, key, "Hipotonía")["search_condition_id"]
    es = _add(client, ES)
    assert _refresh(client, project).status_code == 200
    after = _search(client, key, "Hipotonía")["search_condition_id"]

    package = _export(client, project)

    assert _ids(package.manifest.search_conditions) == [after]
    assert _ids(package.manifest.earlier_search_conditions) == [before]
    assert package.manifest.unrecoverable_search_condition_ids is None
    assert [e.search_condition_id for e in package.search_events] == [before, after]
    assert _resources(package) == {
        f"search-resources/{de}/hp-de.babelon.tsv",
        f"search-resources/{es}/hp-es.babelon.tsv",
    }

    again = _roundtrip(tmp_path, package)
    assert _ids(again.manifest.search_conditions) == [after]
    assert _ids(again.manifest.earlier_search_conditions) == [before]
    assert [e.search_condition_id for e in again.search_events] == [before, after]
    assert _resources(again) == _resources(package)


def test_an_export_after_a_pin_change_carries_the_ended_condition(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    client.app.state.ontology_store.add_ontology(  # type: ignore[attr-defined]
        HARNESS, "hp.json", HP.read_bytes()
    )
    de = _add(client, DE)
    project, key = _project(client)
    ended = _search(client, key, "Muskelhypotonie")["search_condition_id"]
    profile = client.get(f"/api/v1/projects/{project}/settings").json()["profile"]
    body = [
        {"ontology_id": item["ontology_id"], "sha256": item["sha256"]}
        for item in profile["ontologies"]
    ]
    assert client.put(f"/api/v1/projects/{project}/pins", json=body).status_code == 200

    # Not searched since: the project has no current conditions.
    package = _export(client, project)

    assert package.manifest.search_conditions is None
    assert _ids(package.manifest.earlier_search_conditions) == [ended]
    assert _resources(package) == {f"search-resources/{de}/hp-de.babelon.tsv"}
    again = _roundtrip(tmp_path, package)
    assert _ids(again.manifest.earlier_search_conditions) == [ended]
    assert _resources(again) == _resources(package)


def test_a_condition_ended_before_it_was_kept_is_declared_unrecoverable(
    tmp_path: Path,
) -> None:
    """A pin change before 0.8.0 deleted the conditions and their files."""
    client = _client(tmp_path)
    _add(client, DE)
    project, key = _project(client)
    lost = _search(client, key, "Muskelhypotonie")["search_condition_id"]
    repo = client.app.state.repo  # type: ignore[attr-defined]
    with repo.db.transaction() as conn:
        conn.execute(delete(ProjectSearchConditionsRow))
        conn.execute(
            delete(ProjectResourceRow).where(
                ProjectResourceRow.resource_path.startswith("search-resources/")
            )
        )
        assert not conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.details.has_key("superseded_search_conditions")
            )
        ).all()
    assert _conditions(client) == []

    package = _export(client, project)

    assert package.manifest.search_conditions is None
    assert package.manifest.earlier_search_conditions is None
    assert package.manifest.unrecoverable_search_condition_ids == [lost]
    assert [e.search_condition_id for e in package.search_events] == [lost]
    assert _resources(package) == set()
    again = _roundtrip(tmp_path, package)
    assert again.manifest.unrecoverable_search_condition_ids == [lost]

    # Undeclared, the dangling reference is refused.
    silent = package.model_copy(
        update={
            "manifest": package.manifest.model_copy(
                update={
                    "package_id": "silent",
                    "unrecoverable_search_condition_ids": None,
                }
            )
        }
    )
    with pytest.raises(InvalidPackage, match="condition is missing"):
        repo.import_package(silent)
    with pytest.raises(InvalidPackage, match="condition is missing"):
        _zip(silent)
