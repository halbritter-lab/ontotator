from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from ontocurator.cli import app, main
from ontocurator.config_store import PersistentConfig

runner = CliRunner()


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
        patch("ontocurator.cli.uvicorn.run") as mock_run,
        patch("ontocurator.cli.webbrowser.open"),
    ):
        result = runner.invoke(app, ["serve", "--no-browser", "--port", "0"])
        assert result.exit_code == 0
        mock_run.assert_called_once()
        api_app = mock_run.call_args[0][0]
        # Verify discovered ontology was registered
        registry = api_app.state.ontology_registry
        assert len(registry._registered_paths) >= 1 or len(registry._services) >= 1


def test_main_with_no_args_defaults_to_serve() -> None:
    with patch("sys.argv", ["ontocurator"]), patch("ontocurator.cli.app") as mock_app:
        main()
        mock_app.assert_called_once()
        # Verify argv was routed to serve
        import sys

        assert sys.argv == ["ontocurator", "serve"]


def test_main_with_single_json_arg_routes_to_ontology_serve(tmp_path: Path) -> None:
    fake_json = tmp_path / "hp.json"
    fake_json.write_text("{}", encoding="utf-8")

    with (
        patch("sys.argv", ["ontocurator", str(fake_json)]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        import sys

        assert sys.argv == ["ontocurator", "serve", "--ontology", str(fake_json)]


def test_main_with_single_zip_arg_routes_to_package_serve(tmp_path: Path) -> None:
    fake_zip = tmp_path / "package.zip"
    fake_zip.write_text("{}", encoding="utf-8")

    with (
        patch("sys.argv", ["ontocurator", str(fake_zip)]),
        patch("ontocurator.cli.app") as mock_app,
    ):
        main()
        mock_app.assert_called_once()
        import sys

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
        import sys

        assert sys.argv == ["ontocurator", "serve", "--workspace", str(fake_dir)]
