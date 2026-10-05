"""First-run UX: workspace preferences and session-token error codes."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from test_api import app_client as _shared_app_client

app_client = _shared_app_client


# --------------------------------------------------------------------------- #
# Session token errors carry a machine-readable code
# --------------------------------------------------------------------------- #


def test_invalid_session_token_has_code(app_client):
    client, _ = app_client
    bad = TestClient(client.app, headers={"Authorization": "Bearer stale-token"})
    resp = bad.get("/api/v1/packages")
    assert resp.status_code == 403
    assert resp.json()["code"] == "SESSION_TOKEN_INVALID"


def test_missing_session_token_has_code(app_client):
    client, _ = app_client
    resp = TestClient(client.app).get("/api/v1/packages")
    assert resp.status_code == 403
    assert resp.json()["code"] == "SESSION_TOKEN_MISSING"


def test_host_rejection_is_not_a_session_error(app_client):
    client, _ = app_client
    resp = client.get("/api/v1/packages", headers={"Origin": "http://evil.example"})
    assert resp.status_code == 403
    assert resp.json().get("code") not in {
        "SESSION_TOKEN_INVALID",
        "SESSION_TOKEN_MISSING",
    }


# --------------------------------------------------------------------------- #
# Preferences stored in the workspace (not in the browser)
# --------------------------------------------------------------------------- #


def test_preferences_default_to_empty(app_client):
    client, config = app_client
    resp = client.get("/api/v1/preferences")
    assert resp.status_code == 200
    assert resp.json() == {"last_annotator_id": None, "mode_by_package": {}}
    assert not (config.workspace_dir / "preferences.json").exists()


def test_preferences_round_trip_and_persist_in_workspace(app_client):
    client, config = app_client
    resp = client.put(
        "/api/v1/preferences",
        json={"last_annotator_id": "  JPL  ", "mode_by_package": {"pkg-a": "review"}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-a": "review"},
    }
    stored = json.loads(
        (config.workspace_dir / "preferences.json").read_text(encoding="utf-8")
    )
    assert stored["last_annotator_id"] == "JPL"

    # Partial updates keep the other fields and merge modes per package.
    resp = client.put(
        "/api/v1/preferences", json={"mode_by_package": {"pkg-b": "independent"}}
    )
    assert resp.json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-a": "review", "pkg-b": "independent"},
    }
    assert client.get("/api/v1/preferences").json() == resp.json()
    # No temporary files are left behind (atomic replace).
    leftovers = [
        p.name
        for p in config.workspace_dir.iterdir()
        if p.name.startswith(".preferences")
    ]
    assert leftovers == []


@pytest.mark.parametrize(
    "bad",
    ["", "   ", "x" * 65, "dr\x00x", "dr\nx", "a​b"],
)
def test_preferences_reject_invalid_identity(app_client, bad):
    client, config = app_client
    resp = client.put("/api/v1/preferences", json={"last_annotator_id": bad})
    assert resp.status_code == 422
    assert not (config.workspace_dir / "preferences.json").exists()


def test_preferences_reject_unknown_mode(app_client):
    client, _ = app_client
    resp = client.put(
        "/api/v1/preferences", json={"mode_by_package": {"pkg": "telepathy"}}
    )
    assert resp.status_code == 422


def test_corrupt_preferences_file_falls_back_to_defaults(app_client):
    client, config = app_client
    (config.workspace_dir / "preferences.json").write_text(
        "{not json", encoding="utf-8"
    )
    resp = client.get("/api/v1/preferences")
    assert resp.status_code == 200
    assert resp.json() == {"last_annotator_id": None, "mode_by_package": {}}


def test_preferences_require_session_token(app_client):
    client, _ = app_client
    resp = TestClient(client.app).get("/api/v1/preferences")
    assert resp.status_code == 403
