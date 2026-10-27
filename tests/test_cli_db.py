"""``ontotator db upgrade`` brings a bootstrapped database to the current schema."""

from pathlib import Path

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine
from typer.testing import CliRunner

from ontotator.cli import app
from ontotator.storage.schema import current_revision, head_revision

runner = CliRunner()


def test_upgrade_migrates_once_and_then_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = unmigrated_database_url(tmp_path / "fresh.db")
    monkeypatch.setenv("ONTOTATOR_MIGRATION_DATABASE_URL", url)

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
    monkeypatch.delenv("ONTOTATOR_MIGRATION_DATABASE_URL", raising=False)

    result = runner.invoke(app, ["db", "upgrade"])

    assert result.exit_code == 1
    assert "ONTOTATOR_MIGRATION_DATABASE_URL is not set" in result.output


def test_serve_on_an_unmigrated_database_points_to_db_upgrade(
    tmp_path: Path,
) -> None:
    from unittest.mock import patch

    url = unmigrated_database_url(tmp_path / "empty.db")

    with patch("ontotator.cli.uvicorn.run") as mock_run:
        result = runner.invoke(
            app,
            ["serve", "--data-dir", str(tmp_path), "--database-url", url],
        )

    assert result.exit_code == 1
    assert "ontotator db upgrade" in result.output
    assert url not in result.output
    mock_run.assert_not_called()


@pytest.mark.parametrize("target", ["base", "-1", "+1", "0001:0002", "unknown"])
def test_upgrade_rejects_non_revision_targets_before_connecting(target: str) -> None:
    from ontotator.storage.schema import upgrade

    with pytest.raises(ValueError, match="target"):
        upgrade("postgresql://unreachable.invalid/db", target=target)


def test_upgrade_to_specific_revision_is_forward_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = unmigrated_database_url(tmp_path / "target.db")
    monkeypatch.setenv("ONTOTATOR_MIGRATION_DATABASE_URL", url)
    monkeypatch.setenv("ONTOTATOR_MIGRATE_TARGET", "0001")
    first = runner.invoke(app, ["db", "upgrade"])
    assert first.exit_code == 0, first.output
    assert "revision 0001." in first.output
    second = runner.invoke(app, ["db", "upgrade", "--target", "0002"])
    assert second.exit_code == 0, second.output
    assert "revision 0002." in second.output
    backwards = runner.invoke(app, ["db", "upgrade", "--target", "0001"])
    assert backwards.exit_code == 1, backwards.output
    assert "forward" in backwards.output
    engine = create_engine(url)
    with engine.connect() as conn:
        assert current_revision(conn) == "0002"
    engine.dispose()
