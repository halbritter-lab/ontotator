"""``/api/v1/about``: the running version for every logged-in user."""

from __future__ import annotations

from pathlib import Path

import pytest
from auth_harness import logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_api import FIXTURE_PATH

from ontotator import __version__
from ontotator.api.about_routes import REVISION_ENV, current_revision
from ontotator.api.app import create_app
from ontotator.config import AppConfig

COMMIT = "cc65cea5558f85384f92c6bfb07a15f5a3fabe2b"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "about.db"),
            ontology_paths=[FIXTURE_PATH],
        )
    )


def test_about_needs_a_session(app: FastAPI) -> None:
    response = TestClient(app).get("/api/v1/about")

    assert response.status_code == 401


def test_every_user_sees_version_and_commit(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(REVISION_ENV, COMMIT)

    response = logged_in(app, "alice").get("/api/v1/about")

    assert response.status_code == 200, response.text
    assert response.json() == {"version": __version__, "revision": COMMIT}
    assert app.version == __version__


@pytest.mark.parametrize("value", ["", "  ", "main", "not-a-commit", "abc12"])
def test_a_missing_or_odd_revision_is_null(
    value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(REVISION_ENV, value)

    assert current_revision() is None


def test_revision_is_normalised(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(REVISION_ENV, f" {COMMIT.upper()}\n")

    assert current_revision() == COMMIT
