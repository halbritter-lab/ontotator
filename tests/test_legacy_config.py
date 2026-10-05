"""Settings from an earlier (per-user) installation: detection, import, dismissal,
deletion, API and the ``ontocurator config`` command.

Nothing is ever imported silently; the file manager is never really opened.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from ontocurator.api.app import create_app
from ontocurator.application.legacy_config import (
    LegacyConfigInUse,
    LegacyConfigNotFound,
    LegacyConfigService,
    delete_legacy_config,
)
from ontocurator.application.preferences import PreferencesStore
from ontocurator.config import AppConfig
from ontocurator.config_store import (
    PersistentConfig,
    load_persistent_config,
    save_persistent_config,
)
from ontocurator.ontology.registry import OntologyRegistry

FIXTURE_HP = Path(__file__).parent / "fixtures" / "hp.json"
TOKEN = "legacy-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def env(tmp_path: Path) -> dict[str, Path]:
    """An active (portable) config, a legacy per-user config and a workspace."""
    ws = tmp_path / "app" / "workspace"
    ws.mkdir(parents=True)
    active = tmp_path / "app" / "config.json"
    save_persistent_config(PersistentConfig(workspace_dir=ws), active)
    legacy_dir = tmp_path / "appdata" / "ontocurator"
    legacy = legacy_dir / "config.json"
    old_hp = tmp_path / "old" / "hp.json"
    old_hp.parent.mkdir()
    old_hp.write_bytes(FIXTURE_HP.read_bytes())
    save_persistent_config(
        PersistentConfig(
            workspace_dir=tmp_path / "old-ws",
            ontology_paths=[old_hp, tmp_path / "old" / "deleted.json"],
            port=8123,
            auto_open_browser=False,
        ),
        legacy,
    )
    return {"ws": ws, "active": active, "legacy": legacy, "old_hp": old_hp}


def _service(
    env: dict[str, Path], *, preconfigured: bool = False, legacy: Path | None = None
) -> LegacyConfigService:
    return LegacyConfigService(
        legacy_path=legacy if legacy is not None else env["legacy"],
        active_config_path=env["active"],
        preconfigured=preconfigured,
        workspace_dir=env["ws"],
        preferences=PreferencesStore(env["ws"] / "preferences.json"),
        registry=OntologyRegistry(base_dir=env["ws"]),
    )


# --------------------------------------------------------------------------- #
# Detection
# --------------------------------------------------------------------------- #


def test_detects_legacy_settings_with_missing_files_marked(
    env: dict[str, Path],
) -> None:
    status = _service(env).status()
    assert status.found is True
    assert status.path == str(env["legacy"])
    assert status.folder == str(env["legacy"].parent)
    by_status = {Path(o.path).name: o.status for o in status.ontologies}
    assert by_status == {"hp.json": "found", "deleted.json": "missing"}
    assert status.port == 8123
    assert status.auto_open_browser is False


def test_no_notice_for_preconfigured_bundle(env: dict[str, Path]) -> None:
    status = _service(env, preconfigured=True).status()
    assert status.found is False
    assert status.path is None
    assert status.ontologies == []


def test_no_notice_without_legacy_file(env: dict[str, Path], tmp_path: Path) -> None:
    status = _service(env, legacy=tmp_path / "nowhere" / "config.json").status()
    assert status.found is False


def test_no_notice_when_legacy_file_is_the_active_config(
    env: dict[str, Path],
) -> None:
    status = _service(env, legacy=env["active"]).status()
    assert status.found is False


def test_no_notice_when_legacy_matches_current_settings(
    env: dict[str, Path],
) -> None:
    save_persistent_config(
        PersistentConfig(
            workspace_dir=env["ws"],
            ontology_paths=[env["old_hp"]],
            port=8123,
            auto_open_browser=False,
        ),
        env["active"],
    )
    assert _service(env).status().found is False


def test_dismissal_is_remembered_per_file_content(env: dict[str, Path]) -> None:
    service = _service(env)
    service.dismiss()
    assert service.status().found is False
    prefs = json.loads((env["ws"] / "preferences.json").read_text(encoding="utf-8"))
    assert prefs["legacy_config"]["action"] == "dismissed"
    assert len(prefs["legacy_config"]["sha256"]) == 64

    # A later change of the old settings file asks again.
    cfg = load_persistent_config(env["legacy"])
    cfg.port = 9001
    save_persistent_config(cfg, env["legacy"])
    again = service.status()
    assert again.found is True
    assert again.port == 9001


def test_dismiss_requires_a_legacy_file(env: dict[str, Path], tmp_path: Path) -> None:
    with pytest.raises(LegacyConfigNotFound):
        _service(env, legacy=tmp_path / "none.json").dismiss()


# --------------------------------------------------------------------------- #
# Import
# --------------------------------------------------------------------------- #


def test_import_copies_ontologies_into_workspace_and_saves_settings(
    env: dict[str, Path],
) -> None:
    service = _service(env)
    result = service.import_settings()

    assert len(result.imported_ontologies) == 1
    stored = Path(result.imported_ontologies[0])
    assert stored.parent == (env["ws"] / "ontologies").resolve()
    assert stored.is_file()
    assert [Path(s.path).name for s in result.skipped_ontologies] == ["deleted.json"]
    assert result.port == 8123
    assert result.auto_open_browser is False
    assert result.restart_required is True

    saved = load_persistent_config(env["active"])
    assert stored in [p.resolve() for p in saved.ontology_paths]
    assert env["old_hp"].resolve() not in [p.resolve() for p in saved.ontology_paths]
    assert saved.port == 8123
    assert saved.auto_open_browser is False
    # The workspace is never taken over.
    assert saved.workspace_dir.resolve() == env["ws"].resolve()
    # Registered right away for this session.
    assert any(sha for sha, _ in service.registry.services())

    # Handled: no notice any more, and the old file is untouched.
    assert service.status().found is False
    assert env["legacy"].is_file()


def test_import_without_legacy_file_is_refused(
    env: dict[str, Path], tmp_path: Path
) -> None:
    with pytest.raises(LegacyConfigNotFound):
        _service(env, legacy=tmp_path / "none.json").import_settings()
    with pytest.raises(LegacyConfigNotFound):
        _service(env, preconfigured=True).import_settings()


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #


def test_delete_removes_only_the_file_and_empty_folder(env: dict[str, Path]) -> None:
    removed = delete_legacy_config(env["legacy"], env["active"])
    assert removed == env["legacy"]
    assert not env["legacy"].exists()
    assert not env["legacy"].parent.exists()
    assert env["old_hp"].is_file()


def test_delete_keeps_folder_with_other_files(env: dict[str, Path]) -> None:
    other = env["legacy"].parent / "notes.txt"
    other.write_text("keep", encoding="utf-8")
    delete_legacy_config(env["legacy"], env["active"])
    assert not env["legacy"].exists()
    assert other.is_file()


def test_delete_refuses_the_active_config(env: dict[str, Path]) -> None:
    with pytest.raises(LegacyConfigInUse):
        delete_legacy_config(env["active"], env["active"])
    assert env["active"].is_file()


def test_delete_missing_file_is_not_found(tmp_path: Path) -> None:
    with pytest.raises(LegacyConfigNotFound):
        delete_legacy_config(tmp_path / "x" / "config.json", tmp_path / "a.json")


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


def _client(
    env: dict[str, Path], *, preconfigured: bool = False, legacy: Path | None = None
) -> TestClient:
    app = create_app(
        AppConfig(
            workspace_dir=env["ws"],
            session_token=TOKEN,
            config_path=env["active"],
            legacy_config_path=legacy if legacy is not None else env["legacy"],
            preconfigured=preconfigured,
        )
    )
    return TestClient(app)


def test_api_requires_token(env: dict[str, Path]) -> None:
    client = _client(env)
    assert client.get("/api/v1/legacy-config").status_code == 403
    assert client.delete("/api/v1/legacy-config").status_code == 403
    assert client.post("/api/v1/legacy-config/open-folder").status_code == 403
    assert env["legacy"].is_file()


def test_api_status_and_import(env: dict[str, Path]) -> None:
    client = _client(env)
    status = client.get("/api/v1/legacy-config", headers=AUTH).json()
    assert status["found"] is True
    assert status["port"] == 8123
    assert {o["status"] for o in status["ontologies"]} == {"found", "missing"}

    res = client.post("/api/v1/legacy-config/import", headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["imported_ontologies"]) == 1
    assert body["restart_required"] is True

    listed = client.get("/api/v1/ontologies", headers=AUTH).json()
    assert any(o["path"] == body["imported_ontologies"][0] for o in listed)
    assert client.get("/api/v1/legacy-config", headers=AUTH).json()["found"] is False


def test_api_dismiss(env: dict[str, Path]) -> None:
    client = _client(env)
    res = client.post("/api/v1/legacy-config/dismiss", headers=AUTH)
    assert res.status_code == 200
    assert res.json()["found"] is False
    assert client.get("/api/v1/legacy-config", headers=AUTH).json()["found"] is False
    assert env["legacy"].is_file()


def test_api_preconfigured_bundle_ignores_legacy(env: dict[str, Path]) -> None:
    client = _client(env, preconfigured=True)
    assert client.get("/api/v1/legacy-config", headers=AUTH).json()["found"] is False
    res = client.post("/api/v1/legacy-config/import", headers=AUTH)
    assert res.status_code == 404
    assert res.json()["code"] == "LEGACY_CONFIG_NOT_FOUND"


def test_api_open_folder_opens_only_the_known_folder(
    env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator import file_manager

    opened: list[Path] = []
    monkeypatch.setattr(file_manager, "open_folder", opened.append)
    client = _client(env)
    res = client.post(
        "/api/v1/legacy-config/open-folder",
        headers=AUTH,
        json={"path": "C:/Windows"},  # ignored: never a client-supplied path
    )
    assert res.status_code == 200, res.text
    assert opened == [env["legacy"].parent]


def test_api_open_folder_without_legacy_is_not_found(
    env: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator import file_manager

    monkeypatch.setattr(
        file_manager, "open_folder", lambda p: pytest.fail("must not open")
    )
    client = _client(env, legacy=tmp_path / "none" / "config.json")
    res = client.post("/api/v1/legacy-config/open-folder", headers=AUTH)
    assert res.status_code == 404
    assert res.json()["code"] == "LEGACY_CONFIG_NOT_FOUND"


def test_api_delete(env: dict[str, Path]) -> None:
    client = _client(env)
    res = client.delete("/api/v1/legacy-config", headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["deleted"] == str(env["legacy"])
    assert not env["legacy"].exists()
    assert client.get("/api/v1/legacy-config", headers=AUTH).json()["found"] is False


def test_api_delete_refuses_active_config(env: dict[str, Path]) -> None:
    client = _client(env, legacy=env["active"])
    res = client.delete("/api/v1/legacy-config", headers=AUTH)
    assert res.status_code == 409
    assert res.json()["code"] == "LEGACY_CONFIG_IN_USE"
    assert env["active"].is_file()


def test_api_disabled_without_config_paths(tmp_path: Path) -> None:
    app = create_app(AppConfig(workspace_dir=tmp_path, session_token=TOKEN))
    client = TestClient(app)
    assert client.get("/api/v1/legacy-config", headers=AUTH).json()["found"] is False


# --------------------------------------------------------------------------- #
# Start-up: never import silently
# --------------------------------------------------------------------------- #


def _portable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    exe_dir = tmp_path / "Ontocurator"
    exe_dir.mkdir()
    (exe_dir / "portable.txt").write_text("", encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "ontocurator.exe"))
    monkeypatch.delenv("ONTOCURATOR_CONFIG_PATH", raising=False)
    return exe_dir


def test_first_portable_start_does_not_import_legacy_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, env: dict[str, Path]
) -> None:
    from unittest.mock import patch

    from ontocurator.cli import app

    exe_dir = _portable(tmp_path, monkeypatch)
    monkeypatch.setenv("ONTOCURATOR_LEGACY_CONFIG_PATH", str(env["legacy"]))
    with patch("ontocurator.cli.run_server", return_value=None) as run:
        result = CliRunner().invoke(app, ["serve", "--port", "0", "--no-browser"])
    assert result.exit_code == 0, result.output
    assert "Imported settings" not in result.output
    api_app = run.call_args[0][0]
    cfg = api_app.state.config
    assert env["old_hp"].resolve() not in cfg.ontology_paths
    assert cfg.legacy_config_path == env["legacy"]
    assert cfg.config_path == exe_dir.resolve() / "config.json"
    assert cfg.preconfigured is False
    saved = load_persistent_config(exe_dir / "config.json")
    assert saved.port == 8000
    assert saved.auto_open_browser is True


def test_bundle_with_settings_file_is_preconfigured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, env: dict[str, Path]
) -> None:
    from unittest.mock import patch

    from ontocurator.cli import app

    exe_dir = _portable(tmp_path, monkeypatch)
    (exe_dir / "ontocurator-settings.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("ONTOCURATOR_LEGACY_CONFIG_PATH", str(env["legacy"]))
    with patch("ontocurator.cli.run_server", return_value=None) as run:
        result = CliRunner().invoke(app, ["serve", "--port", "0", "--no-browser"])
    assert result.exit_code == 0, result.output
    assert run.call_args[0][0].state.config.preconfigured is True


def test_legacy_path_env_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator import config_store

    monkeypatch.setattr(config_store, "user_config_dir", lambda: tmp_path / "u")
    monkeypatch.delenv("ONTOCURATOR_LEGACY_CONFIG_PATH", raising=False)
    assert config_store.legacy_config_path() == tmp_path / "u" / "config.json"
    monkeypatch.setenv("ONTOCURATOR_LEGACY_CONFIG_PATH", str(tmp_path / "x.json"))
    assert config_store.legacy_config_path() == tmp_path / "x.json"


# --------------------------------------------------------------------------- #
# CLI: ontocurator config
# --------------------------------------------------------------------------- #


@pytest.fixture
def cli_env(env: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    monkeypatch.setenv("ONTOCURATOR_CONFIG_PATH", str(env["active"]))
    monkeypatch.setenv("ONTOCURATOR_LEGACY_CONFIG_PATH", str(env["legacy"]))
    return env


def test_config_path_prints_locations(cli_env: dict[str, Path]) -> None:
    from ontocurator.cli import app

    for args in (["config", "--path"], ["config"]):
        result = CliRunner().invoke(app, args)
        assert result.exit_code == 0, result.output
        out = result.output.replace("\n", "")
        assert str(cli_env["active"]) in out
        assert str(cli_env["legacy"]) in out
        assert str(cli_env["ws"].resolve()) in out


def test_config_path_without_legacy(
    cli_env: dict[str, Path], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from ontocurator.cli import app

    monkeypatch.setenv("ONTOCURATOR_LEGACY_CONFIG_PATH", str(tmp_path / "no.json"))
    result = CliRunner().invoke(app, ["config", "--path"])
    assert result.exit_code == 0, result.output
    assert "none found" in result.output


def test_config_open_opens_active_config_folder(
    cli_env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator import file_manager
    from ontocurator.cli import app

    opened: list[Path] = []
    monkeypatch.setattr(file_manager, "open_folder", opened.append)
    result = CliRunner().invoke(app, ["config", "--open"])
    assert result.exit_code == 0, result.output
    assert opened == [cli_env["active"].parent]


def test_config_delete_legacy_asks_and_can_be_cancelled(
    cli_env: dict[str, Path],
) -> None:
    from ontocurator.cli import app

    result = CliRunner().invoke(app, ["config", "--delete-legacy"], input="n\n")
    assert result.exit_code == 1, result.output
    assert str(cli_env["legacy"]) in result.output
    assert cli_env["legacy"].is_file()

    result = CliRunner().invoke(app, ["config", "--delete-legacy"], input="y\n")
    assert result.exit_code == 0, result.output
    assert not cli_env["legacy"].exists()


def test_config_delete_legacy_yes(cli_env: dict[str, Path]) -> None:
    from ontocurator.cli import app

    result = CliRunner().invoke(app, ["config", "--delete-legacy", "--yes"])
    assert result.exit_code == 0, result.output
    assert not cli_env["legacy"].exists()
    again = CliRunner().invoke(app, ["config", "--delete-legacy", "--yes"])
    assert again.exit_code == 0, again.output
    assert "No settings file from an earlier installation" in again.output


def test_config_delete_legacy_refuses_active_config(
    cli_env: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.cli import app

    monkeypatch.setenv("ONTOCURATOR_LEGACY_CONFIG_PATH", str(cli_env["active"]))
    result = CliRunner().invoke(app, ["config", "--delete-legacy", "--yes"])
    assert result.exit_code == 1
    assert cli_env["active"].is_file()


def test_main_routes_config_subcommand(
    cli_env: dict[str, Path], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from ontocurator import cli

    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()  # a folder of that name must not win
    called: list[list[str]] = []
    monkeypatch.setattr(cli, "app", lambda: called.append(sys.argv[1:]))
    monkeypatch.setattr(sys, "argv", ["ontocurator", "config", "--path"])
    cli.main()
    assert called == [["config", "--path"]]
