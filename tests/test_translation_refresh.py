"""A lead moves a project to the newest translations; history is kept (#254)."""

from pathlib import Path
from typing import Any

import pytest
from auth_harness import HARNESS, AutoLoginClient, logged_in, upload_package
from pg_harness import database_url_for
from sqlalchemy import select
from support.v2_exports import package_export_zip
from test_translation_freeze import (
    DE,
    ES,
    HP,
    _add,
    _client,
    _conditions,
    _inventory,
    _project,
    _settings,
)
from typer.testing import CliRunner

from ontotator.api.app import create_app
from ontotator.cli import app as cli_app
from ontotator.config import AppConfig
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import InvalidPackage
from ontotator.ontology.conditions import SearchCondition
from ontotator.storage.tables import (
    AuditEventRow,
    ProjectResourceRow,
    ProjectRow,
    SearchEventRow,
)


def _refresh(client: Any, project: str) -> Any:
    return client.post(f"/api/v1/projects/{project}/translations/refresh")


def _search(client: AutoLoginClient, key: Any, query: str) -> Any:
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": query,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _event_conditions(client: AutoLoginClient) -> list[str]:
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        return [
            payload["search_condition_id"]
            for payload in conn.execute(
                select(SearchEventRow.payload).order_by(SearchEventRow.seq)
            ).scalars()
        ]


def _audit(client: AutoLoginClient, action: str) -> list[dict[str, Any]]:
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        return list(
            conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            ).scalars()
        )


def _labels(client: AutoLoginClient, action: str) -> list[str]:
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        return list(
            conn.execute(
                select(AuditEventRow.actor_label)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            ).scalars()
        )


def test_a_refresh_takes_the_newest_files_and_keeps_the_old_condition(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    de = _add(client, DE)
    project, key = _project(client)
    before = _search(client, key, "Hipotonía")
    assert before["languages"] == ["en", "de"]
    [old] = _conditions(client)
    es = _add(client, ES)
    assert _inventory(client)["hp-es.babelon.tsv"] == [project]

    response = _refresh(client, project)

    assert response.status_code == 200, response.text
    frozen = response.json()["frozen_translations"]
    assert [(f["filename"], f["sha256"]) for f in frozen["files"]] == [
        ("hp-de.babelon.tsv", de),
        ("hp-es.babelon.tsv", es),
    ]
    assert frozen["not_included"] == []
    # The refreshing account, as a person reference (#281).
    assert frozen["updated"]["by"]["is_me"] is True
    assert frozen["updated"]["by_command_line"] is False
    [earlier] = frozen["history"]
    assert earlier["reason"] == "refresh"
    assert earlier["condition_ids"] == [old[0]["condition_id"]]
    assert [f["filename"] for f in earlier["files"]] == ["hp-de.babelon.tsv"]
    assert earlier["until"] == frozen["updated"]["at"]
    # The upload reaches the project now.
    assert _inventory(client)["hp-es.babelon.tsv"] == []

    # The next search uses the new files at once; the old search keeps its
    # condition, which the history still resolves.
    after = _search(client, key, "Hipotonía")
    assert after["languages"] == ["en", "de", "es"]
    [new] = _conditions(client)
    assert after["search_condition_id"] == new[0]["condition_id"]
    assert after["search_condition_id"] != before["search_condition_id"]
    assert _event_conditions(client) == [
        before["search_condition_id"],
        after["search_condition_id"],
    ]
    assert before["search_condition_id"] in earlier["condition_ids"]

    [details] = _audit(client, "project.translations_refresh")
    assert details["added"] == ["hp-es.babelon.tsv"]
    assert details["replaced"] == details["removed"] == []
    assert details["files_before"] == [{"filename": "hp-de.babelon.tsv", "sha256": de}]
    assert details["condition_ids_before"] == [old[0]["condition_id"]]
    assert details["condition_ids_after"] == [new[0]["condition_id"]]
    assert details["superseded_search_conditions"] == old
    # The captured bytes of both conditions stay with the project.
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        paths = set(
            conn.execute(
                select(ProjectResourceRow.resource_path).where(
                    ProjectResourceRow.resource_path.startswith("search-resources/")
                )
            ).scalars()
        )
    assert paths == {
        f"search-resources/{de}/hp-de.babelon.tsv",
        f"search-resources/{es}/hp-es.babelon.tsv",
    }


def test_a_newer_file_of_a_frozen_name_replaces_it(tmp_path: Path) -> None:
    client = _client(tmp_path)
    old = _add(client, DE)
    project, key = _project(client)
    _search(client, key, "Muskelhypotonie")
    newer = tmp_path / "hp-de.babelon.tsv"
    newer.write_bytes(
        b"subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        b"HP:0001284\trdfs:label\tde\tAreflexie\n"
    )
    new = _add(client, newer)

    response = _refresh(client, project)

    assert response.status_code == 200, response.text
    frozen = response.json()["frozen_translations"]
    assert [f["sha256"] for f in frozen["files"]] == [new]
    assert [f["sha256"] for f in frozen["history"][0]["files"]] == [old]
    [details] = _audit(client, "project.translations_refresh")
    assert details["replaced"] == ["hp-de.babelon.tsv"]
    assert details["added"] == []


def test_nothing_newer_or_nothing_frozen_is_refused(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _add(client, DE)
    project, key = _project(client)

    response = _refresh(client, project)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "TRANSLATIONS_NOT_FROZEN"

    _search(client, key, "Muskelhypotonie")
    frozen = _conditions(client)
    response = _refresh(client, project)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "TRANSLATIONS_CURRENT"
    assert _conditions(client) == frozen
    assert _audit(client, "project.translations_refresh") == []


def test_only_a_lead_or_a_system_admin_refreshes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project, key = _project(client)
    _search(client, key, "Muskelhypotonie")
    app = client.app
    annotator = logged_in(app, "anna", projects={project: ["annotator"]})  # type: ignore[arg-type]
    stranger = logged_in(app, "stranger")  # type: ignore[arg-type]
    lead = logged_in(app, "lena", projects={project: ["lead"]})  # type: ignore[arg-type]
    admin = logged_in(app, "root", system_admin=True)  # type: ignore[arg-type]
    _add(client, DE)

    assert _refresh(annotator, project).status_code == 403
    assert _refresh(stranger, project).status_code == 404
    assert _audit(client, "project.translations_refresh") == []
    response = _refresh(lead, project)
    assert response.status_code == 200, response.text
    by = response.json()["frozen_translations"]["updated"]["by"]
    assert (by["display_name"], by["is_me"]) == ("lena", True)

    _add(client, ES)
    response = _refresh(admin, project)
    assert response.status_code == 200, response.text
    history = response.json()["frozen_translations"]["history"]
    assert [item["by"]["display_name"] for item in history] == ["root", "lena"]
    assert [len(item["files"]) for item in history] == [1, 0]


def test_only_leads_see_who_changed_the_translations(tmp_path: Path) -> None:
    """Members see when, not who: never the audit label (D1, #281)."""
    client = _client(tmp_path)
    project, key = _project(client)
    _search(client, key, "Muskelhypotonie")
    app = client.app
    lead = logged_in(app, "zelda-lead", projects={project: ["lead"]})  # type: ignore[arg-type]
    annotator = logged_in(app, "anna", projects={project: ["annotator"]})  # type: ignore[arg-type]
    _add(client, DE)
    assert _refresh(lead, project).status_code == 200
    _add(client, ES)
    assert _refresh(client, project).status_code == 200

    seen = lead.get(f"/api/v1/projects/{project}/settings").json()
    frozen = seen["frozen_translations"]
    zelda = frozen["history"][1]["by"]
    assert (zelda["display_name"], zelda["is_me"]) == ("zelda-lead", True)
    assert zelda["pseudonym"]
    assert frozen["updated"]["by"]["is_me"] is False
    assert frozen["updated"]["by"]["display_name"]

    response = annotator.get(f"/api/v1/projects/{project}/settings")
    assert response.status_code == 200, response.text
    frozen = response.json()["frozen_translations"]
    assert frozen["updated"]["at"]
    assert (frozen["updated"]["by"], frozen["updated"]["by_command_line"]) == (
        None,
        False,
    )
    assert [(item["by"], item["by_command_line"]) for item in frozen["history"]] == [
        (None, False),
        (None, False),
    ]
    assert "zelda-lead" not in response.text
    assert zelda["pseudonym"] not in response.text
    assert "user:" not in response.text


def test_a_refresh_keeps_a_file_the_server_no_longer_offers(tmp_path: Path) -> None:
    """A refresh adds and replaces files; it never drops a language."""
    source = _client(tmp_path)
    _add(source, DE)
    project, key = _project(source)
    _search(source, key, "Muskelhypotonie")
    data = package_export_zip(source.app, project, key["annotator_id"], key["mode"])

    # Another server, without the German file: the package brings its bytes.
    workspace = tmp_path / "other"
    fresh = AutoLoginClient(
        create_app(
            AppConfig(
                workspace_dir=workspace,
                database_url=database_url_for(workspace / "editor.db"),
                ontology_paths=[HP],
            )
        )
    )
    imported = upload_package(fresh, files={"file": ("study.zip", data)})
    assert imported.status_code == 200, imported.text
    imported_key = imported.json()["project_key"]
    [packaged] = _conditions(fresh)
    _add(fresh, ES)

    response = _refresh(fresh, imported_key)

    assert response.status_code == 200, response.text
    names = [f["filename"] for f in response.json()["frozen_translations"]["files"]]
    assert sorted(names) == ["hp-de.babelon.tsv", "hp-es.babelon.tsv"]

    # Importing the same package again still works: its conditions are an
    # earlier state of the project, which keeps searching with the new ones.
    [current] = _conditions(fresh)
    again = upload_package(fresh, files={"file": ("study.zip", data)})
    assert again.status_code == 200, again.text
    assert _conditions(fresh) == [current]
    assert current != packaged

    new_key = dict(key, project_key=imported_key)
    opened = fresh.post(
        "/api/v1/workspaces/open",
        json={
            f: new_key[f]
            for f in ("project_key", "document_id", "annotator_id", "mode")
        },
    )
    assert opened.status_code == 200, opened.text
    result = _search(fresh, new_key, "Hipotonía")
    assert result["languages"] == ["en", "de", "es"]
    assert result["search_condition_id"] == current[0]["condition_id"]

    # Conditions the project never had still conflict.
    repo = fresh.app.state.repo  # type: ignore[attr-defined]
    other = SearchCondition.model_validate(packaged[0]).model_dump()
    other["runtime"]["python"] = "another-runtime"
    del other["condition_id"]
    foreign = SearchCondition.model_validate(
        {"condition_id": canonical_hash(other), **other}
    )
    with repo.db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == imported_key)
        ).scalar_one()
        with pytest.raises(InvalidPackage, match="Conflicting immutable"):
            repo._store_resources(conn, project_id, [foreign], {})


def test_a_pin_change_keeps_the_ended_conditions(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.app.state.ontology_store.add_ontology(  # type: ignore[attr-defined]
        HARNESS, "hp.json", HP.read_bytes()
    )
    de = _add(client, DE)
    project, key = _project(client)
    first = _search(client, key, "Muskelhypotonie")
    [ended] = _conditions(client)
    profile = client.get(f"/api/v1/projects/{project}/settings").json()["profile"]
    body = [
        {"ontology_id": item["ontology_id"], "sha256": item["sha256"]}
        for item in profile["ontologies"]
    ]

    response = client.put(f"/api/v1/projects/{project}/pins", json=body)

    assert response.status_code == 200, response.text
    assert response.json()["frozen_translations"] is None
    assert _conditions(client) == []
    [update] = [d for d in _audit(client, "project.update") if "fields" in d]
    assert update["fields"] == ["pins"]
    assert update["superseded_search_conditions"] == ended
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        assert f"search-resources/{de}/hp-de.babelon.tsv" in set(
            conn.execute(select(ProjectResourceRow.resource_path)).scalars()
        )

    # The next use freezes again; the ended conditions are listed as earlier.
    _search(client, key, "Muskelhypotonie")
    frozen = _settings(client, project)
    assert frozen["updated"] is None
    [earlier] = frozen["history"]
    assert earlier["reason"] == "ontology"
    assert earlier["condition_ids"] == [first["search_condition_id"]]


def test_the_cli_refreshes_like_the_settings_page(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _client(tmp_path)
    client.app.state.ontology_store.add_ontology(  # type: ignore[attr-defined]
        HARNESS, "hp.json", HP.read_bytes()
    )
    _add(client, DE)
    project, key = _project(client)
    _search(client, key, "Muskelhypotonie")
    _add(client, ES)
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(tmp_path / "workspace"))
    url = database_url_for(tmp_path / "workspace" / "editor.db")
    command = ["admin", "--database-url", url, "projects", "refresh-translations"]

    result = CliRunner().invoke(cli_app, [*command, project])

    assert result.exit_code == 0, result.output
    assert result.stdout.strip() == (
        f"'{project}' now uses the newest translations: added hp-es.babelon.tsv."
    )
    # The operating-system user stays in the audit trail (#281).
    updated = _settings(client, project)["updated"]
    assert (updated["by"], updated["by_command_line"]) == (None, True)
    [label] = _labels(client, "project.translations_refresh")
    assert label.startswith("cli:")
    assert _search(client, key, "Hipotonía")["languages"] == ["en", "de", "es"]

    again = CliRunner().invoke(cli_app, [*command, project])
    assert again.exit_code == 1
    assert "TRANSLATIONS_CURRENT" in again.stderr


def test_a_slow_refresh_does_not_write_older_files_back(tmp_path: Path) -> None:
    """An upload and a second refresh during a capture (#285)."""
    client = _client(tmp_path)
    _add(client, DE)
    project, key = _project(client)
    _search(client, key, "Muskelhypotonie")
    rows = b"subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
    rows += b"HP:0001284\trdfs:label\tde\tAreflexie\n"
    newer = tmp_path / "v2" / "hp-de.babelon.tsv"
    newer.parent.mkdir()
    newer.write_bytes(rows)
    v2 = _add(client, newer)
    newest = tmp_path / "v3" / "hp-de.babelon.tsv"
    newest.parent.mkdir()
    newest.write_bytes(rows + b"HP:0001252\trdfs:label\tde\tHypotonie\n")
    registry = client.app.state.ontology_store.registry  # type: ignore[attr-defined]
    capture = registry.capture_current
    captured: list[set[str]] = []
    stored: list[str] = []

    def slow_capture(profile: Any) -> Any:
        result = capture(profile)
        captured.append({f.sha256 for c in result[0] for f in c.translations})
        if len(captured) == 1:
            # While the first refresh holds v2 unlocked, v3 arrives and
            # another refresh stores it.
            stored.append(_add(client, newest))
            assert _refresh(client, project).status_code == 200
        return result

    registry.capture_current = slow_capture

    response = _refresh(client, project)

    # The slow refresh captured again and found nothing newer than v3.
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "TRANSLATIONS_CURRENT"
    [v3] = stored
    assert captured == [{v2}, {v3}, {v3}]
    frozen = _settings(client, project)
    assert [f["sha256"] for f in frozen["files"]] == [v3]
    [details] = _audit(client, "project.translations_refresh")
    assert details["files_after"] == [{"filename": "hp-de.babelon.tsv", "sha256": v3}]
