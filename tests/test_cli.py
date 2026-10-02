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
