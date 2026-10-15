"""First-run UX: workspace preferences and session-token error codes."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from test_api import app_client as _shared_app_client

app_client = _shared_app_client

EMPTY_PREFERENCES = {
    "last_annotator_id": None,
    "mode_by_package": {},
    "search_languages_by_annotator": {},
}


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
    assert resp.json() == EMPTY_PREFERENCES
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
        "search_languages_by_annotator": {},
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
        "search_languages_by_annotator": {},
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
    assert resp.json() == EMPTY_PREFERENCES


def test_preferences_require_session_token(app_client):
    client, _ = app_client
    resp = TestClient(client.app).get("/api/v1/preferences")
    assert resp.status_code == 403


# --------------------------------------------------------------------------- #
# Search languages per annotator
# --------------------------------------------------------------------------- #


def test_search_languages_are_stored_per_annotator(app_client):
    client, config = app_client
    url = "/api/v1/preferences"

    resp = client.put(
        url, json={"search_languages_by_annotator": {"  JPL ": ["DE", "es", "de "]}}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["search_languages_by_annotator"] == {"JPL": ["de", "es"]}

    # Another annotator is added; an empty list is a choice (English only).
    resp = client.put(url, json={"search_languages_by_annotator": {"AB": []}})
    assert resp.json()["search_languages_by_annotator"] == {
        "JPL": ["de", "es"],
        "AB": [],
    }

    # One annotator's selection is replaced, the other one is kept.
    resp = client.put(url, json={"search_languages_by_annotator": {"JPL": ["fr"]}})
    assert resp.json()["search_languages_by_annotator"] == {"JPL": ["fr"], "AB": []}

    # Updating something else leaves the selections alone.
    resp = client.put(url, json={"last_annotator_id": "AB"})
    assert resp.json() == {
        "last_annotator_id": "AB",
        "mode_by_package": {},
        "search_languages_by_annotator": {"JPL": ["fr"], "AB": []},
    }
    assert client.get(url).json() == resp.json()
    stored = json.loads(
        (config.workspace_dir / "preferences.json").read_text(encoding="utf-8")
    )
    assert stored["search_languages_by_annotator"] == {"JPL": ["fr"], "AB": []}

    # A second store on the same file reads the same selections (restart).
    from ontocurator.application.preferences import PreferencesStore

    again = PreferencesStore(config.workspace_dir / "preferences.json").load()
    assert again.search_languages_by_annotator == {"JPL": ["fr"], "AB": []}


@pytest.mark.parametrize(
    "bad",
    [
        {"JPL": "de"},
        {"JPL": [1]},
        {"JPL": ["de-DE"]},
        {"JPL": ["x"]},
        {"JPL": ["de"] * 33},
        {"": ["de"]},
        {"dr\nx": ["de"]},
    ],
)
def test_search_languages_reject_invalid_selections(app_client, bad):
    client, config = app_client
    resp = client.put(
        "/api/v1/preferences", json={"search_languages_by_annotator": bad}
    )
    assert resp.status_code == 422
    assert not (config.workspace_dir / "preferences.json").exists()


def test_unreadable_search_language_entries_are_ignored(app_client):
    client, config = app_client
    (config.workspace_dir / "preferences.json").write_text(
        json.dumps(
            {
                "last_annotator_id": "JPL",
                "search_languages_by_annotator": {
                    "JPL": ["de"],
                    "AB": "everything",
                    "CD": [5],
                },
            }
        ),
        encoding="utf-8",
    )
    assert client.get("/api/v1/preferences").json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {},
        "search_languages_by_annotator": {"JPL": ["de"]},
    }


def test_a_key_of_an_earlier_version_is_ignored_and_dropped_on_the_next_save(
    app_client,
):
    """The tree pin is gone: a file that still has it loads, and loses it."""
    from ontocurator.application.preferences import PreferencesStore

    client, config = app_client
    path = config.workspace_dir / "preferences.json"
    old = {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-1": "review"},
        "tree_pinned_by_annotator": {"JPL": False, "AB": True},
        "search_languages_by_annotator": {"JPL": ["de"]},
    }
    path.write_text(json.dumps(old), encoding="utf-8")
    kept = {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-1": "review"},
        "search_languages_by_annotator": {"JPL": ["de"]},
    }

    # Loading: no error, everything else is there, the key is not answered.
    resp = client.get("/api/v1/preferences")
    assert resp.status_code == 200, resp.text
    assert resp.json() == kept
    assert PreferencesStore(path).load().model_dump() == kept
    # Reading alone does not rewrite the file.
    assert json.loads(path.read_text(encoding="utf-8")) == old

    # The next save, of something else, writes the file without the key.
    resp = client.put("/api/v1/preferences", json={"last_annotator_id": "AB"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {**kept, "last_annotator_id": "AB"}
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert "tree_pinned_by_annotator" not in stored
    assert stored == {**kept, "last_annotator_id": "AB"}


def test_the_tree_pin_is_no_longer_a_preference(app_client):
    """An update that still sends it is refused like any unknown field."""
    client, config = app_client

    resp = client.put(
        "/api/v1/preferences", json={"tree_pinned_by_annotator": {"JPL": True}}
    )

    assert resp.status_code == 422
    assert not (config.workspace_dir / "preferences.json").exists()
    assert client.get("/api/v1/preferences").json() == EMPTY_PREFERENCES
