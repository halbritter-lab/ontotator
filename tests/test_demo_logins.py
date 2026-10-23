"""Opt-in one-click demo logins (ONTOCURATOR_DEMO_LOGINS_FILE)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pytest
from auth_harness import ORIGIN, PASSWORD, ensure_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_api import FIXTURE_PATH

from ontocurator import settings
from ontocurator.api.app import create_app
from ontocurator.config import AppConfig

ENV = settings.DEMO_LOGINS_ENV
LOCAL = "http://127.0.0.1:18210"


def _file(tmp_path: Path, content: Any) -> str:
    path = tmp_path / "demo-logins.json"
    text = content if isinstance(content, str) else json.dumps(content)
    path.write_text(text, encoding="utf-8")
    return str(path)


def _app(tmp_path: Path, **config: Any) -> FastAPI:
    return create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "demo.db"),
            ontology_paths=[FIXTURE_PATH],
            **config,
        )
    )


def test_unset_means_no_demo_logins() -> None:
    assert settings.demo_logins({}, public_origin=LOCAL) == ()


def test_reads_the_accounts(tmp_path: Path) -> None:
    path = _file(
        tmp_path,
        [
            {"username": " demo-lead ", "password": "pw-1", "label": "Project lead"},
            {"username": "demo-annotator", "password": "pw-2"},
        ],
    )

    logins = settings.demo_logins({ENV: path}, public_origin=LOCAL, bind_host="::1")

    assert logins == (
        settings.DemoLogin("demo-lead", "pw-1", "Project lead"),
        settings.DemoLogin("demo-annotator", "pw-2", ""),
    )
    assert "pw-1" not in repr(logins)


@pytest.mark.parametrize(
    ("env", "origin", "bind", "message"),
    [
        ({"ONTOCURATOR_ENV": "production"}, LOCAL, None, "production"),
        ({}, "https://editor.example.org", None, "loopback public origin"),
        ({}, None, "0.0.0.0", "loopback address to bind"),
    ],
)
def test_refused_outside_a_loopback_development_stack(
    tmp_path: Path,
    env: dict[str, str],
    origin: str | None,
    bind: str | None,
    message: str,
) -> None:
    path = _file(tmp_path, [{"username": "demo-lead", "password": "pw"}])

    with pytest.raises(settings.SettingsError, match=message):
        settings.demo_logins({ENV: path, **env}, public_origin=origin, bind_host=bind)


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        [],
        {"username": "demo-lead", "password": "pw"},
        [{"username": "demo-lead"}],
        [{"username": "", "password": "pw"}],
        [{"username": "demo-lead", "password": "pw", "role": "lead"}],
        [{"username": "demo-lead", "password": "pw", "label": 3}],
    ],
)
def test_refuses_an_invalid_file(tmp_path: Path, content: Any) -> None:
    path = _file(tmp_path, content)

    with pytest.raises(settings.SettingsError, match=ENV):
        settings.demo_logins({ENV: path}, public_origin=LOCAL)


def test_refuses_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(settings.SettingsError, match="Unable to read"):
        settings.demo_logins({ENV: str(tmp_path / "missing.json")}, public_origin=None)


def test_off_by_default_exposes_nothing(tmp_path: Path) -> None:
    app = _app(tmp_path)
    client = TestClient(app)

    assert client.get("/api/v1/auth/demo-logins").status_code == 404
    assert "/api/v1/auth/demo-logins" not in client.get("/openapi.json").text


def test_on_lists_the_accounts_and_the_normal_login_accepts_them(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    logins = (settings.DemoLogin("demo-lead", PASSWORD, "Project lead"),)
    with caplog.at_level(logging.WARNING):
        app = _app(tmp_path, demo_logins=logins)
    ensure_user(app, "demo-lead")
    client = TestClient(app)

    listed = client.get("/api/v1/auth/demo-logins")

    assert listed.status_code == 200
    assert listed.headers["cache-control"] == "no-store"
    assert listed.json() == {
        "accounts": [
            {"username": "demo-lead", "password": PASSWORD, "label": "Project lead"}
        ]
    }
    assert "/api/v1/auth/demo-logins" not in client.get("/openapi.json").text
    assert "DEMO LOGINS ARE ON" in caplog.text
    account = listed.json()["accounts"][0]
    login = client.post(
        "/api/v1/auth/login",
        json={"username": account["username"], "password": account["password"]},
        headers=ORIGIN,
    )
    assert login.status_code == 200, login.text
    assert client.get("/api/v1/auth/me").json()["username"] == "demo-lead"
