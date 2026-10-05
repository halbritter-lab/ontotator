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
    assert "--axes-config" in result_serve.output


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


def test_cli_serve_auto_finds_next_port_when_default_occupied(tmp_path) -> None:
    import socket
    from unittest.mock import patch

    from ontocurator.cli import app

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 8000))

    try:
        runner = CliRunner()
        with (
            patch("uvicorn.run") as mock_run,
            patch("webbrowser.open"),
        ):
            # No --port flag provided; default 8000 is occupied by sock
            result = runner.invoke(
                app,
                ["serve", "--workspace", str(tmp_path), "--no-browser"],
            )
            assert result.exit_code == 0
            assert mock_run.called
            called_port = mock_run.call_args[1]["port"]
            assert called_port != 8000
            assert (
                "already in use" in result.output
                or "using available port" in result.output
            )
    finally:
        sock.close()
