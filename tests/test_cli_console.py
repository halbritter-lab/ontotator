"""First-run UX: plain startup banner and a quiet console by default."""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from ontocurator.cli import app

runner = CliRunner()


# --------------------------------------------------------------------------- #
# Console: plain banner, no access log by default
# --------------------------------------------------------------------------- #


def test_banner_is_plain_and_hides_token_by_default(tmp_path: Path) -> None:
    with (
        patch("ontocurator.cli.run_server") as mock_run,
        patch("ontocurator.cli._open_browser"),
    ):
        result = runner.invoke(app, ["serve", "-w", str(tmp_path), "--port", "0"])
    assert result.exit_code == 0, result.output
    out = result.output
    assert "Ontocurator is running" in out
    assert "Keep this window open" in out
    assert "Ctrl+C" in out
    assert f"Data folder: {tmp_path.resolve()}" in out
    assert "If the browser did not open" in out
    assert "token=" not in out
    assert re.search(r"http://127\.0\.0\.1:\d+/", out)
    assert mock_run.call_args.kwargs.get("verbose") is False


def test_no_browser_prints_full_url(tmp_path: Path) -> None:
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(
            app, ["serve", "-w", str(tmp_path), "--no-browser", "--port", "0"]
        )
    assert result.exit_code == 0, result.output
    token = mock_run.call_args[0][0].state.config.session_token
    assert f"#token={token}" in result.output


def test_print_url_prints_full_url(tmp_path: Path) -> None:
    with (
        patch("ontocurator.cli.run_server") as mock_run,
        patch("ontocurator.cli._open_browser"),
    ):
        result = runner.invoke(
            app, ["serve", "-w", str(tmp_path), "--port", "0", "--print-url"]
        )
    assert result.exit_code == 0, result.output
    token = mock_run.call_args[0][0].state.config.session_token
    assert f"#token={token}" in result.output


def test_verbose_enables_access_log_and_details(tmp_path: Path) -> None:
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(
            app,
            ["serve", "-w", str(tmp_path), "--no-browser", "--port", "0", "--verbose"],
        )
    assert result.exit_code == 0, result.output
    assert mock_run.call_args.kwargs.get("verbose") is True
    assert "Settings:" in result.output


def test_run_server_disables_access_log_unless_verbose() -> None:
    from ontocurator import cli

    seen: list[tuple[bool, str]] = []

    class FakeServer:
        def __init__(self, config):
            seen.append((config.access_log, config.log_level))
            self.started = True
            self.should_exit = False

        def run(self, sockets=None):
            return None

    with patch.object(cli.uvicorn, "Server", FakeServer):
        cli.run_server(object(), None)  # type: ignore[arg-type]
        cli.run_server(object(), None, verbose=True)  # type: ignore[arg-type]
    assert seen[0][0] is False
    assert seen[1][0] is True
