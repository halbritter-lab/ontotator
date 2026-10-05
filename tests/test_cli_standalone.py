import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from ontocurator import config_store
from ontocurator.cli import (
    app,
    content_addressed_name,
    main,
    route_positional_args,
)
from ontocurator.config_store import (
    PersistentConfig,
    load_persistent_config,
    save_persistent_config,
)
from ontocurator.instance import (
    INFO_FILENAME,
    InstanceInfo,
    WorkspaceLock,
    read_instance_info,
    write_instance_info,
)

runner = CliRunner()
HP_FIXTURE = Path(__file__).parent / "fixtures" / "hp.json"


def _noop_run_server(api_app, sock, on_started=None, finished=None):
    return None


def _started_run_server(api_app, sock, on_started=None, finished=None):
    if on_started is not None:
        on_started()


# --------------------------------------------------------------------------- #
# Ontology discovery and persistent config
# --------------------------------------------------------------------------- #


def test_cli_serve_discovers_ontologies_and_loads_persistent_config(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "my_workspace"
    ont_dir = ws / "ontologies"
    ont_dir.mkdir(parents=True)
    valid_ont = ont_dir / "hp.json"
    valid_ont.write_text(
        '{"graphs": [{"id": "hp", "nodes": [{"id": "HP:1", "lbl": "Test", "type": "CLASS"}]}]}',
        encoding="utf-8",
    )

    fake_config = PersistentConfig(workspace_dir=ws)

    with (
        patch("ontocurator.cli.load_persistent_config", return_value=fake_config),
        patch("ontocurator.cli.run_server") as mock_run,
    ):
        result = runner.invoke(app, ["serve", "--no-browser", "--port", "0"])
        assert result.exit_code == 0, result.output
        mock_run.assert_called_once()
        api_app = mock_run.call_args[0][0]
        assert api_app.state.config.workspace_dir == ws.resolve()
        registry = api_app.state.ontology_registry
        assert len(registry._registered_paths) >= 1 or len(registry._services) >= 1
    assert "saved in" in result.output


def test_missing_saved_workspace_is_reported_not_silent(tmp_path: Path) -> None:
    gone = tmp_path / "gone"
    fake_config = PersistentConfig(workspace_dir=gone)
    with (
        patch("ontocurator.cli.load_persistent_config", return_value=fake_config),
        patch("ontocurator.cli.default_workspace_dir", return_value=tmp_path / "def"),
        patch("ontocurator.cli.run_server", side_effect=_noop_run_server),
    ):
        result = runner.invoke(app, ["serve", "--no-browser", "--port", "0"])
    assert result.exit_code == 0, result.output
    assert "does not exist anymore" in result.output
    assert str(tmp_path / "def") in result.output


def test_config_paths_inside_config_folder_are_stored_relative(tmp_path: Path) -> None:
    app_dir = tmp_path / "Ontocurator"
    (app_dir / "workspace" / "ontologies").mkdir(parents=True)
    ont = app_dir / "workspace" / "ontologies" / "hp.json"
    ont.write_text("{}", encoding="utf-8")
    cfg_file = app_dir / "config.json"

    save_persistent_config(
        PersistentConfig(workspace_dir=app_dir / "workspace", ontology_paths=[ont]),
        cfg_file,
    )
    raw = json.loads(cfg_file.read_text(encoding="utf-8"))
    assert raw["workspace_dir"] == "workspace"
    assert raw["ontology_paths"] == ["workspace/ontologies/hp.json"]

    # Move/re-extract the whole folder: paths follow it.
    moved = tmp_path / "Moved Copy"
    app_dir.rename(moved)
    loaded = load_persistent_config(moved / "config.json")
    assert loaded.workspace_dir == (moved / "workspace").resolve()
    assert loaded.ontology_paths == [(moved / "workspace/ontologies/hp.json").resolve()]
    assert "workspace_dir" in loaded.model_fields_set


def test_portable_root_requires_frozen_marker_and_writable(tmp_path: Path) -> None:
    exe_dir = tmp_path / "app"
    exe_dir.mkdir()
    assert config_store.detect_portable_root(exe_dir, frozen=False) is None
    assert config_store.detect_portable_root(exe_dir, frozen=True) is None
    (exe_dir / "portable.txt").write_text("", encoding="utf-8")
    assert config_store.detect_portable_root(exe_dir, frozen=True) == exe_dir

    other = tmp_path / "other"
    (other / "workspace").mkdir(parents=True)
    assert config_store.detect_portable_root(other, frozen=True) == other


def test_frozen_portable_defaults_live_next_to_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    exe_dir = tmp_path / "Ontocurator"
    (exe_dir / "workspace").mkdir(parents=True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "ontocurator.exe"))
    monkeypatch.delenv("ONTOCURATOR_CONFIG_PATH", raising=False)
    monkeypatch.chdir(tmp_path)  # CWD must not matter (macOS Finder uses $HOME)

    assert config_store.get_default_config_path() == exe_dir.resolve() / "config.json"
    assert config_store.default_workspace_dir() == exe_dir.resolve() / "workspace"


def test_frozen_non_portable_defaults_use_per_user_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    exe_dir = tmp_path / "Ontocurator.app" / "Contents" / "MacOS"
    exe_dir.mkdir(parents=True)
    local = tmp_path / "LocalAppData" / "Ontocurator"
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "ontocurator"))
    monkeypatch.delenv("ONTOCURATOR_CONFIG_PATH", raising=False)
    monkeypatch.setattr(
        config_store.platformdirs, "user_data_dir", lambda *a, **k: str(local)
    )
    monkeypatch.setattr(
        config_store, "user_config_dir", lambda: tmp_path / "userconfig"
    )

    assert config_store.default_workspace_dir() == local / "workspace"
    assert config_store.get_default_config_path() == (
        tmp_path / "userconfig" / "config.json"
    )


# --------------------------------------------------------------------------- #
# Token, browser and instance file
# --------------------------------------------------------------------------- #


def test_token_rotates_per_start_and_is_not_persisted(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    tokens: list[str] = []
    info_seen: list[InstanceInfo | None] = []

    def capture(api_app, sock, on_started=None, finished=None):
        tokens.append(api_app.state.config.session_token)
        info_seen.append(read_instance_info(ws))

    (ws).mkdir()
    (ws / ".session_token").write_text("old-forever-token", encoding="utf-8")
    with patch("ontocurator.cli.run_server", side_effect=capture):
        for _ in range(2):
            result = runner.invoke(
                app, ["serve", "-w", str(ws), "--no-browser", "--port", "0"]
            )
            assert result.exit_code == 0, result.output

    assert len(set(tokens)) == 2
    assert "old-forever-token" not in tokens
    assert not (ws / ".session_token").exists()
    # While running, the instance file holds the current token; removed on exit.
    assert info_seen[0] is not None and info_seen[0].token == tokens[0]
    assert not (ws / INFO_FILENAME).exists()


def test_explicit_token_is_used(tmp_path: Path) -> None:
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(
            app,
            ["serve", "-w", str(tmp_path), "--no-browser", "--port", "0", "-t", "abc"],
        )
    assert result.exit_code == 0, result.output
    assert mock_run.call_args[0][0].state.config.session_token == "abc"


def test_browser_opens_only_after_server_started(tmp_path: Path) -> None:
    with (
        patch("ontocurator.cli.run_server", side_effect=_noop_run_server),
        patch("ontocurator.cli._open_browser") as mock_open,
    ):
        result = runner.invoke(app, ["serve", "-w", str(tmp_path), "--port", "0"])
    assert result.exit_code == 0, result.output
    mock_open.assert_not_called()

    with (
        patch("ontocurator.cli.run_server", side_effect=_started_run_server),
        patch("ontocurator.cli._open_browser") as mock_open,
    ):
        result = runner.invoke(app, ["serve", "-w", str(tmp_path), "--port", "0"])
    assert result.exit_code == 0, result.output
    mock_open.assert_called_once()
    assert re.match(r"http://127\.0\.0\.1:\d+/#token=", mock_open.call_args[0][0])


def test_auto_open_browser_setting_is_honored(tmp_path: Path) -> None:
    cfg = PersistentConfig(workspace_dir=tmp_path, auto_open_browser=False)
    with (
        patch("ontocurator.cli.load_persistent_config", return_value=cfg),
        patch("ontocurator.cli.run_server", side_effect=_started_run_server),
        patch("ontocurator.cli._open_browser") as mock_open,
    ):
        result = runner.invoke(app, ["serve", "--port", "0"])
    assert result.exit_code == 0, result.output
    mock_open.assert_not_called()


def test_startup_banner_explains_how_to_quit(tmp_path: Path) -> None:
    with patch("ontocurator.cli.run_server", side_effect=_noop_run_server):
        result = runner.invoke(
            app, ["serve", "-w", str(tmp_path), "--no-browser", "--port", "0"]
        )
    assert "Ctrl+C" in result.output
    assert "Do not close" in result.output
    assert f"Workspace: {tmp_path.resolve()}" in result.output


def test_database_closed_after_server_stops(tmp_path: Path) -> None:
    captured = {}

    def capture(api_app, sock, on_started=None, finished=None):
        captured["db"] = api_app.state.repo.db

    with patch("ontocurator.cli.run_server", side_effect=capture):
        result = runner.invoke(
            app, ["serve", "-w", str(tmp_path), "--no-browser", "--port", "0"]
        )
    assert result.exit_code == 0, result.output
    assert captured["db"]._connections == []


# --------------------------------------------------------------------------- #
# Single instance
# --------------------------------------------------------------------------- #


def test_workspace_lock_is_exclusive(tmp_path: Path) -> None:
    first, second = WorkspaceLock(tmp_path), WorkspaceLock(tmp_path)
    assert first.acquire()
    try:
        assert not second.acquire()
    finally:
        first.release()
    assert second.acquire()
    second.release()


def test_second_launch_opens_running_instance_and_exits(tmp_path: Path) -> None:
    running = InstanceInfo(pid=1, host="127.0.0.1", port=45678, token="tok")
    lock = WorkspaceLock(tmp_path)
    assert lock.acquire()
    try:
        with (
            patch("ontocurator.cli.wait_for_running_instance", return_value=running),
            patch("ontocurator.cli.run_server") as mock_run,
            patch("ontocurator.cli._open_browser") as mock_open,
        ):
            result = runner.invoke(app, ["serve", "-w", str(tmp_path)])
    finally:
        lock.release()
    assert result.exit_code == 0, result.output
    mock_run.assert_not_called()
    mock_open.assert_called_once_with("http://127.0.0.1:45678/#token=tok")
    assert "already running" in result.output


def test_second_launch_with_unresponsive_owner_fails(tmp_path: Path) -> None:
    lock = WorkspaceLock(tmp_path)
    assert lock.acquire()
    try:
        with (
            patch("ontocurator.cli.wait_for_running_instance", return_value=None),
            patch("ontocurator.cli.run_server") as mock_run,
        ):
            result = runner.invoke(app, ["serve", "-w", str(tmp_path), "--no-browser"])
    finally:
        lock.release()
    assert result.exit_code == 1
    mock_run.assert_not_called()


def test_stale_instance_file_is_taken_over(tmp_path: Path) -> None:
    write_instance_info(
        tmp_path, InstanceInfo(pid=999999, host="127.0.0.1", port=1, token="stale")
    )
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(
            app, ["serve", "-w", str(tmp_path), "--no-browser", "--port", "0"]
        )
    assert result.exit_code == 0, result.output
    mock_run.assert_called_once()
    assert mock_run.call_args[0][0].state.config.session_token != "stale"


# --------------------------------------------------------------------------- #
# Drag & drop / argument routing
# --------------------------------------------------------------------------- #


def test_dropped_ontology_is_copied_content_addressed_and_persisted(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "ws"
    src = tmp_path / "Downloads" / "hp.json"
    src.parent.mkdir()
    src.write_bytes(HP_FIXTURE.read_bytes())
    digest = hashlib.sha256(src.read_bytes()).hexdigest()
    expected = ws / "ontologies" / f"hp-{digest[:12]}.json"

    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(
            app,
            [
                "serve",
                "-w",
                str(ws),
                "--import-ontology",
                str(src),
                "--no-browser",
                "--port",
                "0",
            ],
        )
    assert result.exit_code == 0, result.output
    assert expected.is_file()
    assert expected.read_bytes() == src.read_bytes()
    assert expected.resolve() in load_persistent_config().ontology_paths
    assert expected.resolve() in mock_run.call_args[0][0].state.config.ontology_paths

    # Original can disappear: the workspace copy is used on the next start.
    src.unlink()
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(app, ["serve", "--no-browser", "--port", "0"])
    assert result.exit_code == 0, result.output
    assert expected.resolve() in mock_run.call_args[0][0].state.config.ontology_paths


def test_dropped_invalid_json_is_ignored_with_warning(tmp_path: Path) -> None:
    bad = tmp_path / "notes.json"
    bad.write_text('{"hello": 1}', encoding="utf-8")
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(
            app,
            [
                "serve",
                "-w",
                str(tmp_path / "ws"),
                "--import-ontology",
                str(bad),
                "--no-browser",
                "--port",
                "0",
            ],
        )
    assert result.exit_code == 0, result.output
    mock_run.assert_called_once()
    assert "Ignoring ontology" in result.output
    assert list((tmp_path / "ws" / "ontologies").iterdir()) == []


def test_content_addressed_name_is_idempotent() -> None:
    digest = "a" * 64
    assert content_addressed_name(Path("hp.json"), digest) == "hp-aaaaaaaaaaaa.json"
    assert (
        content_addressed_name(Path("hp-aaaaaaaaaaaa.json"), digest)
        == "hp-aaaaaaaaaaaa.json"
    )


def test_main_with_no_args_defaults_to_serve() -> None:
    with patch("sys.argv", ["ontocurator"]), patch("ontocurator.cli.app") as mock_app:
        main()
        mock_app.assert_called_once()
        assert sys.argv == ["ontocurator", "serve"]


def test_main_strips_macos_process_serial_number() -> None:
    with (
        patch("sys.argv", ["ontocurator", "-psn_0_12345"]),
        patch("ontocurator.cli.app"),
    ):
        main()
        assert sys.argv == ["ontocurator", "serve"]


def test_main_with_single_json_arg_routes_to_import_ontology(tmp_path: Path) -> None:
    fake_json = tmp_path / "hp.json"
    fake_json.write_text("{}", encoding="utf-8")

    with (
        patch("sys.argv", ["ontocurator", str(fake_json)]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        assert sys.argv == ["ontocurator", "serve", "--import-ontology", str(fake_json)]


def test_main_with_single_zip_arg_routes_to_package_serve(tmp_path: Path) -> None:
    fake_zip = tmp_path / "package.zip"
    fake_zip.write_text("{}", encoding="utf-8")

    with (
        patch("sys.argv", ["ontocurator", str(fake_zip)]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        assert sys.argv == ["ontocurator", "serve", "--package", str(fake_zip)]


def test_main_with_single_dir_arg_routes_to_workspace_serve(tmp_path: Path) -> None:
    fake_dir = tmp_path / "my_ws"
    fake_dir.mkdir()

    with (
        patch("sys.argv", ["ontocurator", str(fake_dir)]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        assert sys.argv == ["ontocurator", "serve", "--workspace", str(fake_dir)]


def test_main_with_zip_and_extra_flags_routes_to_package_serve(
    tmp_path: Path,
) -> None:
    fake_zip = tmp_path / "package.zip"
    fake_zip.write_text("{}", encoding="utf-8")

    with (
        patch("sys.argv", ["ontocurator", str(fake_zip), "--port", "8765"]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        assert sys.argv == [
            "ontocurator",
            "serve",
            "--package",
            str(fake_zip),
            "--port",
            "8765",
        ]


def test_main_with_direct_flag_routes_to_serve() -> None:
    with (
        patch("sys.argv", ["ontocurator", "--port", "8765", "--no-browser"]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        assert sys.argv == ["ontocurator", "serve", "--port", "8765", "--no-browser"]


def test_main_reports_ignored_arguments(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    txt = tmp_path / "notes.txt"
    txt.write_text("x", encoding="utf-8")
    typo = str(tmp_path / "pakage.zip")
    with (
        patch("sys.argv", ["ontocurator", "serv", typo, str(txt)]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        assert sys.argv == ["ontocurator", "serve"]
    err = capsys.readouterr().err
    assert "Ignored argument(s)" in err
    assert "serv" in err
    assert typo in err
    assert "unsupported file type" in err


def test_route_positional_args_multiple_files(tmp_path: Path) -> None:
    a, b = tmp_path / "a.json", tmp_path / "b.JSON"
    z1, z2 = tmp_path / "1.zip", tmp_path / "2.zip"
    for p in (a, b, z1, z2):
        p.write_text("{}", encoding="utf-8")
    routed, ignored = route_positional_args([str(a), str(z1), str(b), str(z2)])
    assert routed == [
        "--import-ontology",
        str(a),
        "--package",
        str(z1),
        "--import-ontology",
        str(b),
    ]
    assert len(ignored) == 1 and str(z2) in ignored[0]


# --------------------------------------------------------------------------- #
# Real process: start, second instance hand-off, graceful stop
# --------------------------------------------------------------------------- #


def _start_server_process(ws: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    kwargs: dict[str, object] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "ontocurator",
            "serve",
            "--workspace",
            str(ws),
            "--no-browser",
            "--port",
            "0",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        **kwargs,  # type: ignore[arg-type]
    )


def _stop_gracefully(proc: subprocess.Popen[str]) -> None:
    if sys.platform == "win32":
        proc.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        proc.send_signal(signal.SIGINT)


def test_real_server_single_instance_and_graceful_shutdown(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    proc = _start_server_process(ws, env)
    try:
        deadline = time.monotonic() + 90
        info = None
        while time.monotonic() < deadline and proc.poll() is None:
            info = read_instance_info(ws)
            if info is not None:
                try:
                    with urllib.request.urlopen(f"{info.base_url}/", timeout=2) as r:
                        if r.status == 200:
                            break
                except OSError:
                    pass
            time.sleep(0.3)
        assert info is not None, "server did not publish instance info"

        second = subprocess.run(
            [
                sys.executable,
                "-m",
                "ontocurator",
                "serve",
                "--workspace",
                str(ws),
                "--no-browser",
                "--package",
                str(Path(__file__).parent / "fixtures" / "demo_package.zip"),
            ],
            capture_output=True,
            text=True,
            env=env,
            timeout=90,
        )
        assert second.returncode == 0, second.stdout + second.stderr
        assert "already running" in second.stdout
        assert "Sent work package" in second.stdout
        assert f"#token={info.token}&package_id=demo-klinik-pakete-01" in second.stdout
    finally:
        if proc.poll() is None:
            _stop_gracefully(proc)
        try:
            out, _ = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
    assert "Ontocurator stopped" in out, out
    assert not (ws / INFO_FILENAME).exists()
