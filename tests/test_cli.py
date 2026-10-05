import json
import socket
from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner


def test_import_ontocurator() -> None:
    import ontocurator

    assert ontocurator is not None


def test_ontocurator_cli_help() -> None:
    from ontocurator.cli import app

    runner = CliRunner()
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "ontocurator" in result.output.lower() or "serve" in result.output.lower()

    result_serve = runner.invoke(app, ["serve", "--help"])
    assert result_serve.exit_code == 0
    assert "--workspace" in result_serve.output
    assert "--ontology" in result_serve.output
    assert "--import-ontology" in result_serve.output
    assert "--axes-config" in result_serve.output


def test_version_comes_from_package_metadata() -> None:
    from importlib.metadata import version

    from ontocurator.cli import app, get_version

    assert get_version() == version("ontocurator")
    result = CliRunner().invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.output.strip() == version("ontocurator")


def test_cli_serve_nonexistent_axes_config_rejected(tmp_path) -> None:
    from ontocurator.cli import app

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["serve", "--axes-config", str(tmp_path / "nonexistent.json")],
    )
    assert result.exit_code == 1
    assert "not found" in result.output.lower() or "error" in result.output.lower()


def test_cli_serve_malformed_axes_config_json_rejected(tmp_path) -> None:
    from ontocurator.cli import app

    bad_json = tmp_path / "bad.json"
    bad_json.write_text("{invalid json", encoding="utf-8")

    runner = CliRunner()
    result = runner.invoke(app, ["serve", "--axes-config", str(bad_json)])
    assert result.exit_code == 1
    assert "error" in result.output.lower()


def test_cli_serve_invalid_axes_config_schema_rejected(tmp_path) -> None:
    from ontocurator.cli import app

    bad_schema = tmp_path / "bad_schema.json"
    bad_schema.write_text(
        '{"definition_name": "test", "axes": "not a list"}', encoding="utf-8"
    )

    runner = CliRunner()
    result = runner.invoke(app, ["serve", "--axes-config", str(bad_schema)])
    assert result.exit_code == 1
    assert "error" in result.output.lower()


def test_cli_serve_nonexistent_ontology_rejected(tmp_path) -> None:
    from ontocurator.cli import app

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["serve", "--ontology", str(tmp_path / "missing.json")],
    )
    assert result.exit_code == 1
    assert "not found" in result.output.lower() or "error" in result.output.lower()


@pytest.fixture
def occupied_port():
    """A listening socket on an ephemeral loopback port (never a fixed port)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    try:
        yield int(sock.getsockname()[1])
    finally:
        sock.close()


def test_bind_server_socket_skips_occupied_preferred_port(occupied_port: int) -> None:
    from ontocurator.cli import bind_server_socket

    sock, notice = bind_server_socket("127.0.0.1", None, occupied_port)
    try:
        assert sock.getsockname()[1] != occupied_port
        assert notice is not None and "already in use" in notice
    finally:
        sock.close()


def test_bind_server_socket_explicit_port_conflict_raises(occupied_port: int) -> None:
    from ontocurator.cli import bind_server_socket

    with pytest.raises(OSError):
        bind_server_socket("127.0.0.1", occupied_port, 8000)


def test_cli_serve_auto_finds_next_port_when_saved_port_occupied(
    tmp_path: Path, occupied_port: int
) -> None:
    from ontocurator.cli import app
    from ontocurator.config_store import get_default_config_path

    cfg = get_default_config_path()  # isolated per test by conftest
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(json.dumps({"port": occupied_port}), encoding="utf-8")

    seen: dict[str, int] = {}

    def fake_run_server(api_app, sock, on_started=None, finished=None):
        # The socket is already bound and listening before the server starts.
        seen["port"] = sock.getsockname()[1]
        assert api_app.state.config.port == seen["port"]

    with patch("ontocurator.cli.run_server", side_effect=fake_run_server):
        result = CliRunner().invoke(
            app, ["serve", "--workspace", str(tmp_path / "ws"), "--no-browser"]
        )
    assert result.exit_code == 0, result.output
    assert seen["port"] != occupied_port
    assert "already in use" in result.output
