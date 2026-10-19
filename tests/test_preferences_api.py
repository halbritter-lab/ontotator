"""Editor preferences: stored per user in the database."""

from __future__ import annotations

from pathlib import Path

import pytest
from auth_harness import logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig

URL = "/api/v1/preferences"
EMPTY_PREFERENCES = {
    "multilingual_search": None,
    "last_annotator_id": None,
    "mode_by_package": {},
    "search_languages_by_annotator": {},
}


def _config(tmp_path: Path) -> AppConfig:
    return AppConfig(
        workspace_dir=tmp_path, database_url=database_url_for(tmp_path / "prefs.db")
    )


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return create_app(_config(tmp_path))


def test_preferences_start_empty(app: FastAPI) -> None:
    response = logged_in(app, "alice").get(URL)

    assert response.status_code == 200
    assert response.json() == EMPTY_PREFERENCES


def test_updates_merge_per_package_and_survive(tmp_path: Path) -> None:
    client = logged_in(create_app(_config(tmp_path)), "alice")

    first = client.put(URL, json={"mode_by_package": {"pkg-a": "review"}})
    second = client.put(URL, json={"mode_by_package": {"pkg-b": "independent"}})

    assert first.status_code == second.status_code == 200, second.text
    merged = {
        **EMPTY_PREFERENCES,
        "mode_by_package": {"pkg-a": "review", "pkg-b": "independent"},
    }
    assert second.json() == merged
    # A restarted server reads the same preferences.
    restarted = logged_in(create_app(_config(tmp_path)), "alice")
    assert restarted.get(URL).json() == merged


def test_search_languages_merge_per_annotator(app: FastAPI) -> None:
    client = logged_in(app, "alice")

    first = client.put(
        URL, json={"search_languages_by_annotator": {"ann-1": ["de", "DE"]}}
    )
    second = client.put(URL, json={"search_languages_by_annotator": {"ann-2": []}})
    third = client.put(
        URL, json={"search_languages_by_annotator": {"ann-1": ["fr", " es "]}}
    )

    assert first.status_code == 200, first.text
    assert first.json()["search_languages_by_annotator"] == {"ann-1": ["de"]}
    assert second.json()["search_languages_by_annotator"] == {
        "ann-1": ["de"],
        "ann-2": [],
    }
    assert third.json()["search_languages_by_annotator"] == {
        "ann-1": ["fr", "es"],
        "ann-2": [],
    }
    assert client.get(URL).json() == third.json()


def test_each_user_has_their_own_preferences(app: FastAPI) -> None:
    alice = logged_in(app, "alice")
    bob = logged_in(app, "bob")

    alice.put(URL, json={"mode_by_package": {"pkg-a": "review"}})
    bob.put(URL, json={"mode_by_package": {"pkg-a": "assisted"}})

    assert alice.get(URL).json()["mode_by_package"] == {"pkg-a": "review"}
    assert bob.get(URL).json()["mode_by_package"] == {"pkg-a": "assisted"}


def test_invalid_values_are_refused(app: FastAPI) -> None:
    client = logged_in(app, "alice")

    unknown_mode = client.put(URL, json={"mode_by_package": {"pkg": "telepathy"}})
    bad_language = client.put(
        URL, json={"search_languages_by_annotator": {"ann-1": ["de-DE"]}}
    )

    assert unknown_mode.status_code == 422
    assert bad_language.status_code == 422
    assert client.get(URL).json() == EMPTY_PREFERENCES


def test_preferences_need_a_session(app: FastAPI) -> None:
    response = TestClient(app).get(URL)

    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


def test_search_preferences_keep_explicit_disabled_automation():
    from ontocurator.application.preferences import PreferencesUpdate
    from ontocurator.auth.preferences import _from_stored

    change = PreferencesUpdate.model_validate(
        {
            "multilingual_search": {
                "enabled": False,
                "preferred_languages": ["de"],
                "automatic_document_language": False,
            }
        }
    )
    stored = _from_stored(change.model_dump(exclude_unset=True))
    assert stored.multilingual_search.enabled is False
    assert stored.multilingual_search.automatic_document_language is False
    assert stored.multilingual_search.preferred_languages == ["de"]
