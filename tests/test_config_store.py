from pathlib import Path

import pytest

from ontocurator.config_store import (
    PersistentConfig,
    get_default_config_path,
    load_persistent_config,
    save_persistent_config,
)


def test_default_config_values(tmp_path: Path) -> None:
    cfg = PersistentConfig()
    assert cfg.port == 8000
    assert cfg.host == "127.0.0.1"
    assert cfg.auto_open_browser is True
    assert cfg.workspace_dir == Path("./workspace")
    assert cfg.ontology_paths == []


def test_save_and_load_persistent_config(tmp_path: Path) -> None:
    config_file = tmp_path / "config.json"
    custom_ws = (tmp_path / "custom_ws").resolve()
    custom_ont = (tmp_path / "hp.json").resolve()

    cfg = PersistentConfig(
        workspace_dir=custom_ws,
        ontology_paths=[custom_ont],
        port=8080,
        host="127.0.0.1",
        auto_open_browser=False,
    )
    save_persistent_config(cfg, config_file)
    assert config_file.is_file()

    loaded = load_persistent_config(config_file)
    assert loaded.workspace_dir == custom_ws
    assert loaded.ontology_paths == [custom_ont]
    assert loaded.port == 8080
    assert loaded.auto_open_browser is False


def test_corrupted_config_falls_back_to_defaults(tmp_path: Path) -> None:
    config_file = tmp_path / "corrupt.json"
    config_file.write_text("{invalid json content...", encoding="utf-8")
    loaded = load_persistent_config(config_file)
    assert loaded.port == 8000
    assert loaded.host == "127.0.0.1"
    assert loaded.workspace_dir == Path("./workspace")


def test_get_default_config_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ONTOCURATOR_CONFIG_PATH", raising=False)
    p = get_default_config_path()
    assert isinstance(p, Path)
    assert p.name == "config.json"
    assert "ontocurator" in str(p)


def test_get_default_config_path_env_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom = tmp_path / "custom_config.json"
    monkeypatch.setenv("ONTOCURATOR_CONFIG_PATH", str(custom))
    assert get_default_config_path() == custom
