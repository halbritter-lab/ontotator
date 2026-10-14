"""``ontocurator db upgrade`` brings a bootstrapped database to the current schema."""

from pathlib import Path

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine
from typer.testing import CliRunner

from ontocurator.cli import app
from ontocurator.storage.schema import current_revision, head_revision

runner = CliRunner()


def test_upgrade_migrates_once_and_then_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = unmigrated_database_url(tmp_path / "fresh.db")
    monkeypatch.setenv("ONTOCURATOR_MIGRATION_DATABASE_URL", url)

    first = runner.invoke(app, ["db", "upgrade"])
    second = runner.invoke(app, ["db", "upgrade"])

    assert first.exit_code == 0, first.output
    assert second.exit_code == 0, second.output
    assert f"Database schema is at revision {head_revision()}." in second.output
    engine = create_engine(url)
    with engine.connect() as conn:
        assert current_revision(conn) == head_revision()
    engine.dispose()


def test_upgrade_without_a_url_explains_what_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ONTOCURATOR_MIGRATION_DATABASE_URL", raising=False)

    result = runner.invoke(app, ["db", "upgrade"])

    assert result.exit_code == 1
    assert "ONTOCURATOR_MIGRATION_DATABASE_URL is not set" in result.output
