"""The CLI fails fast when the database cannot be reached (F6).

Light: no database. The unreachable host is TEST-NET-1 (192.0.2.1), which is
never routed, so without a connect timeout a connection attempt would hang.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine as real_create_engine
from typer.testing import CliRunner

from ontocurator.cli import app
from ontocurator.storage import database as database_module
from ontocurator.storage import schema as schema_module
from ontocurator.storage.database import CONNECT_TIMEOUT_SECONDS, Database

UNREACHABLE = "postgresql://u:p@192.0.2.1:5432/x"


class _Spy:
    """Records the keyword arguments of ``create_engine`` and builds the engine."""

    def __init__(self, *, build: bool = True) -> None:
        self.kwargs: dict[str, Any] = {}
        self.build = build

    def __call__(self, url: Any, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        if not self.build:
            raise _Stop
        return real_create_engine(url, **kwargs)


class _Stop(Exception):
    pass


def test_database_sets_connect_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    spy = _Spy()
    monkeypatch.setattr(database_module, "create_engine", spy)

    db = Database(UNREACHABLE, data_dir=tmp_path)
    try:
        assert CONNECT_TIMEOUT_SECONDS == 10
        assert spy.kwargs["connect_args"] == {"connect_timeout": 10}
    finally:
        db.close()


def test_url_connect_timeout_wins(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    spy = _Spy()
    monkeypatch.setattr(database_module, "create_engine", spy)

    db = Database(f"{UNREACHABLE}?connect_timeout=3", data_dir=tmp_path)
    try:
        assert "connect_timeout" not in spy.kwargs.get("connect_args", {})
        _, params = db.engine.dialect.create_connect_args(db.engine.url)
        assert str(params["connect_timeout"]) == "3"
    finally:
        db.close()


def test_upgrade_sets_connect_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    spy = _Spy(build=False)
    monkeypatch.setattr(schema_module, "create_engine", spy)

    with pytest.raises(_Stop):
        schema_module.upgrade(UNREACHABLE)

    assert spy.kwargs["connect_args"] == {"connect_timeout": 10}


def test_upgrade_url_connect_timeout_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    spy = _Spy(build=False)
    monkeypatch.setattr(schema_module, "create_engine", spy)

    with pytest.raises(_Stop):
        schema_module.upgrade(f"{UNREACHABLE}?connect_timeout=3")

    assert "connect_timeout" not in spy.kwargs.get("connect_args", {})


def test_cli_unreachable_database_fails_fast(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(database_module, "CONNECT_TIMEOUT_SECONDS", 2)
    monkeypatch.setenv("ONTOCURATOR_DATA_DIR", str(tmp_path))
    for name in (
        "ONTOCURATOR_DATABASE_PASSWORD",
        "ONTOCURATOR_DATABASE_PASSWORD_FILE",
    ):
        monkeypatch.delenv(name, raising=False)

    started = time.monotonic()
    result = CliRunner().invoke(
        app,
        ["admin", "--database-url", UNREACHABLE, "users", "reset-code", "nobody"],
    )
    elapsed = time.monotonic() - started

    assert result.exit_code == 1, result.output
    assert "DATABASE_UNAVAILABLE" in result.output
    assert elapsed < 8
