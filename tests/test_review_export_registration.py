"""Registration and CLI parser checks, without database fixtures or jobs."""

from typer.testing import CliRunner

from ontotator.api.project_routes import router
from ontotator.cli import app
from ontotator.exchange.jobs import HANDLERS


def test_review_export_handler_and_http_route_are_registered():
    assert "translation_review_export" in HANDLERS
    assert any(
        route.path == "/api/v1/projects/{key}/exports/translation-reviews"
        and "POST" in route.methods
        for route in router.routes
    )


def test_review_export_cli_has_real_no_wait_option():
    result = CliRunner().invoke(app, ["admin", "export-translation-reviews", "--help"])
    assert result.exit_code == 0, result.output
    assert "--no-wait" in result.output
