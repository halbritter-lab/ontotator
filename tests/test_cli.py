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
