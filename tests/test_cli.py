from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from ontocurator.cli import app

runner = CliRunner()
HP_FIXTURE = Path(__file__).parent / "fixtures" / "hp.json"


def test_version_comes_from_package_metadata() -> None:
    from importlib.metadata import version

    from ontocurator.cli import get_version

    assert get_version() == version("ontocurator")
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.output.strip() == version("ontocurator")


def test_help_lists_the_commands() -> None:
    result = runner.invoke(app, ["--help"])

    assert result.exit_code == 0, result.output
    for command in ("serve", "db", "analyze", "version"):
        assert command in result.output
    assert "config" not in result.output

    serve_help = runner.invoke(app, ["serve", "--help"])
    assert serve_help.exit_code == 0, serve_help.output
    for option in (
        "--data-dir",
        "--database-url",
        "--ontology",
        "--translations-dir",
        "--host",
        "--port",
        "--web-dir",
        "--verbose",
    ):
        assert option in serve_help.output
    assert "--workspace" not in serve_help.output


def test_serve_refuses_a_missing_ontology(tmp_path: Path) -> None:
    with patch("ontocurator.cli.uvicorn.run") as run:
        result = runner.invoke(
            app,
            [
                "serve",
                "--data-dir",
                str(tmp_path / "data"),
                "--ontology",
                str(tmp_path / "missing.json"),
            ],
        )

    assert result.exit_code == 1
    assert "Ontology file not found" in result.output
    run.assert_not_called()


def test_serve_starts_the_app_on_the_given_address(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"

    with patch("ontocurator.cli.uvicorn.run") as run:
        result = runner.invoke(
            app,
            [
                "serve",
                "--data-dir",
                str(data_dir),
                "--host",
                "127.0.0.1",
                "--port",
                "8123",
                "-o",
                str(HP_FIXTURE),
            ],
        )

    assert result.exit_code == 0, result.output
    run.assert_called_once()
    api_app = run.call_args.args[0]
    assert run.call_args.kwargs["host"] == "127.0.0.1"
    assert run.call_args.kwargs["port"] == 8123
    config = api_app.state.config
    assert config.workspace_dir == data_dir.resolve()
    assert config.port == 8123
    assert f"http://127.0.0.1:8123/#token={config.session_token}" in result.output

    client = TestClient(
        api_app, headers={"Authorization": f"Bearer {config.session_token}"}
    )
    listed = client.get("/api/v1/ontologies").json()
    assert [item["ontology_id"] for item in listed] == ["hp"]
