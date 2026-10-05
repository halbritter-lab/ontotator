"""Regression tests for the follow-up findings on the standalone launcher."""

from __future__ import annotations

from pathlib import Path

import pytest

# --- Finding 4: per-user default workspace is local, cloud sync warned ------ #


def test_frozen_per_user_default_workspace_is_local_app_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    from ontocurator import config_store

    exe_dir = tmp_path / "Ontocurator.app" / "Contents" / "MacOS"
    exe_dir.mkdir(parents=True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "ontocurator"))
    calls: list[tuple[object, ...]] = []

    def user_data_dir(*args: object, **kwargs: object) -> str:
        calls.append((*args, kwargs.get("appauthor"), kwargs.get("roaming", False)))
        return str(tmp_path / "local")

    monkeypatch.setattr(config_store.platformdirs, "user_data_dir", user_data_dir)
    monkeypatch.setattr(
        config_store.platformdirs,
        "user_documents_dir",
        lambda: pytest.fail("Documents may be cloud-synced"),
    )
    assert config_store.default_workspace_dir() == tmp_path / "local" / "workspace"
    assert calls == [("Ontocurator", False, False)]


@pytest.mark.parametrize(
    ("path", "provider"),
    [
        (r"C:\Users\x\OneDrive - Example\Documents\Ontocurator\workspace", "OneDrive"),
        ("/Users/x/Library/Mobile Documents/com~apple~CloudDocs/ws", "iCloud Drive"),
        ("/Users/x/Dropbox/ws", "Dropbox"),
        ("/Users/x/Google Drive/ws", "Google Drive"),
        (r"C:\Users\x\iCloudDrive\ws", "iCloud Drive"),
        (r"C:\Users\x\AppData\Local\Ontocurator\workspace", None),
        ("/home/x/.local/share/Ontocurator/workspace", None),
    ],
)
def test_cloud_sync_folder_detection(path: str, provider: str | None) -> None:
    from pathlib import PurePosixPath, PureWindowsPath

    from ontocurator.config_store import cloud_sync_provider

    pure = PureWindowsPath(path) if "\\" in path else PurePosixPath(path)
    assert cloud_sync_provider(pure) == provider


def test_serve_warns_when_workspace_is_cloud_synced(tmp_path: Path) -> None:
    from unittest.mock import patch

    from typer.testing import CliRunner

    from ontocurator.cli import app

    ws = tmp_path / "OneDrive - Example" / "workspace"
    with patch("ontocurator.cli.run_server", return_value=None):
        result = CliRunner().invoke(
            app, ["serve", "-w", str(ws), "--no-browser", "--port", "0"]
        )
    assert result.exit_code == 0, result.output
    assert "OneDrive" in result.output
    assert "Warning" in result.output
    assert str(ws.resolve()) in result.output


# --- Finding 5: portable config imports legacy per-user settings ----------- #


def test_portable_config_imports_legacy_settings_except_workspace(
    tmp_path: Path,
) -> None:
    from ontocurator.config_store import (
        PersistentConfig,
        save_persistent_config,
        seed_from_legacy_config,
    )

    legacy_file = tmp_path / "appdata" / "config.json"
    kept = tmp_path / "hp.json"
    kept.write_text("{}", encoding="utf-8")
    save_persistent_config(
        PersistentConfig(
            workspace_dir=tmp_path / "old-ws",
            ontology_paths=[kept, tmp_path / "deleted.json"],
            port=8123,
            auto_open_browser=False,
        ),
        legacy_file,
    )
    cfg, notes = seed_from_legacy_config(legacy_file)
    assert cfg.ontology_paths == [kept.resolve()]
    assert cfg.port == 8123
    assert cfg.auto_open_browser is False
    assert "workspace_dir" not in cfg.model_fields_set
    assert any("8123" in n for n in notes)
    assert any(str(kept.resolve()) in n for n in notes)

    missing, none = seed_from_legacy_config(tmp_path / "nope.json")
    assert none == []
    assert missing == PersistentConfig()


def test_first_portable_start_imports_legacy_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys
    from unittest.mock import patch

    from typer.testing import CliRunner

    from ontocurator import config_store
    from ontocurator.cli import app
    from ontocurator.config_store import (
        PersistentConfig,
        load_persistent_config,
        save_persistent_config,
    )

    exe_dir = tmp_path / "Ontocurator"
    exe_dir.mkdir()
    (exe_dir / "portable.txt").write_text("", encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "ontocurator.exe"))
    monkeypatch.delenv("ONTOCURATOR_CONFIG_PATH", raising=False)
    user_cfg = tmp_path / "appdata"
    monkeypatch.setattr(config_store, "user_config_dir", lambda: user_cfg)
    monkeypatch.setattr("ontocurator.cli.user_config_dir", lambda: user_cfg)
    hp = tmp_path / "hp.json"
    hp.write_bytes((Path(__file__).parent / "fixtures" / "hp.json").read_bytes())
    save_persistent_config(
        PersistentConfig(
            workspace_dir=tmp_path / "old-ws",
            ontology_paths=[hp],
            port=8123,
            auto_open_browser=False,
        ),
        user_cfg / "config.json",
    )
    with patch("ontocurator.cli.run_server", return_value=None) as run:
        result = CliRunner().invoke(app, ["serve", "--port", "0"])
    assert result.exit_code == 0, result.output
    assert "Imported settings" in result.output
    api_app = run.call_args[0][0]
    assert api_app.state.config.workspace_dir == exe_dir.resolve() / "workspace"
    assert hp.resolve() in api_app.state.config.ontology_paths
    saved = load_persistent_config(exe_dir / "config.json")
    assert saved.port == 8123
    assert saved.auto_open_browser is False
    assert saved.workspace_dir == (exe_dir / "workspace").resolve()

    # Only the first creation imports.
    with patch("ontocurator.cli.run_server", return_value=None):
        again = CliRunner().invoke(app, ["serve", "--port", "0", "--no-browser"])
    assert again.exit_code == 0, again.output
    assert "Imported settings" not in again.output


# --- Finding 6/7: instance file hardening and patient hand-off ------------- #


def test_instance_token_is_only_sent_to_loopback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ontocurator import instance

    sent: list[str] = []

    def fake_request(info, method, path, **kwargs):  # type: ignore[no-untyped-def]
        sent.append(info.host)
        return 200, b"[]"

    monkeypatch.setattr(instance, "_request", fake_request)
    for host in ("10.0.0.5", "example.org", "0.0.0.0", "::"):
        info = instance.InstanceInfo(pid=1, host=host, port=1, token="secret")
        assert instance.is_instance_alive(info) is False
    assert sent == []
    for host in ("127.0.0.1", "localhost", "::1"):
        info = instance.InstanceInfo(pid=1, host=host, port=1, token="secret")
        assert instance.is_instance_alive(info) is True
    assert sent == ["127.0.0.1", "localhost", "::1"]


def test_instance_file_acl_is_restricted_on_windows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator import instance

    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(cmd)
        raise OSError("icacls missing")  # failures are ignored

    monkeypatch.setattr(instance.sys, "platform", "win32")
    monkeypatch.setattr(instance.subprocess, "run", fake_run)
    monkeypatch.setattr(instance.getpass, "getuser", lambda: "alice")
    info = instance.InstanceInfo(pid=1, host="127.0.0.1", port=1, token="t")
    instance.write_instance_info(tmp_path, info)
    assert instance.read_instance_info(tmp_path) == info
    assert len(calls) == 1
    cmd = calls[0]
    assert cmd[0] == "icacls"
    assert "/inheritance:r" in cmd
    assert cmd[cmd.index("/grant:r") + 1] == "alice:F"


@pytest.mark.skipif(
    __import__("sys").platform != "win32", reason="Windows ACL behaviour"
)
def test_instance_file_has_no_inherited_aces_on_windows(tmp_path: Path) -> None:
    import subprocess

    from ontocurator import instance

    instance.write_instance_info(
        tmp_path, instance.InstanceInfo(pid=1, host="127.0.0.1", port=1, token="t")
    )
    out = subprocess.run(
        ["icacls", str(tmp_path / instance.INFO_FILENAME)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "(I)" not in out
    assert "Users" not in out.replace(str(tmp_path), "")
    assert instance.read_instance_info(tmp_path) is not None


def test_wait_for_running_instance_reports_progress_until_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import inspect

    from ontocurator import instance

    default = (
        inspect.signature(instance.wait_for_running_instance)
        .parameters["timeout"]
        .default
    )
    assert default >= 120
    clock = [0.0]
    monkeypatch.setattr(instance.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        instance.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + s)
    )
    progress: list[float] = []
    assert (
        instance.wait_for_running_instance(
            tmp_path, timeout=35, interval=0.5, on_progress=progress.append
        )
        is None
    )
    assert [round(p) for p in progress] == [10, 20, 30]


def test_failed_handoff_says_file_was_not_imported(tmp_path: Path) -> None:
    from unittest.mock import patch

    from typer.testing import CliRunner

    from ontocurator.cli import app
    from ontocurator.instance import WorkspaceLock

    package = tmp_path / "work.zip"
    package.write_bytes(b"zip")
    lock = WorkspaceLock(tmp_path)
    assert lock.acquire()
    try:
        with patch("ontocurator.cli.wait_for_running_instance", return_value=None):
            result = CliRunner().invoke(
                app,
                [
                    "serve",
                    "-w",
                    str(tmp_path),
                    "--no-browser",
                    "--package",
                    str(package),
                ],
            )
    finally:
        lock.release()
    assert result.exit_code == 1
    assert "NOT imported" in result.output
    assert str(package) in result.output
    assert "Import" in result.output


# --- Finding 9: one content-addressed naming helper ------------------------ #


def test_cli_and_upload_share_sanitizing_content_addressed_name() -> None:
    from ontocurator import cli
    from ontocurator.application import uploads

    digest = "b" * 64
    assert cli.content_addressed_name is uploads.content_addressed_name
    name = cli.content_addressed_name(Path("../my ontology (v2).json"), digest)
    assert name == "my_ontology__v2-bbbbbbbbbbbb.json"
    assert cli.content_addressed_name(Path("hp-bbbbbbbbbbbb.json"), digest) == (
        "hp-bbbbbbbbbbbb.json"
    )
    assert uploads.content_addressed_name(None, digest) == "ontology-bbbbbbbbbbbb.json"
    assert cli.content_addressed_name("...json", digest) == "ontology-bbbbbbbbbbbb.json"
