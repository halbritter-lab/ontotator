"""Installation presets (ontocurator-settings.json) and mode enforcement."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.distribution_settings import (
    SETTINGS_FILENAME,
    DistributionSettings,
    load_settings_file,
    parse_settings,
)

FIXTURES = Path(__file__).parent / "fixtures"
DEMO_PACKAGE = FIXTURES / "demo_package.zip"
DEMO_ID = "demo-klinik-pakete-01"


# --------------------------------------------------------------------------- #
# Settings file
# --------------------------------------------------------------------------- #


def test_settings_defaults_allow_every_mode() -> None:
    settings = DistributionSettings()
    assert settings.effective_allowed_modes() == ["independent", "review", "assisted"]
    assert settings.effective_default_mode() == "independent"


def test_settings_parse_valid_and_report_unknown_keys() -> None:
    settings, warnings = parse_settings(
        {
            "default_mode": "independent",
            "allowed_modes": ["independent"],
            "annotator_id": "  JPL ",
            "open_package": "study-xy-round1",
            "auto_open_browser": False,
            "colour": "blue",
        }
    )
    assert settings.allowed_modes == ["independent"]
    assert settings.annotator_id == "JPL"
    assert settings.open_package == "study-xy-round1"
    assert settings.auto_open_browser is False
    assert len(warnings) == 1 and "colour" in warnings[0]


def test_settings_default_mode_falls_back_to_first_allowed() -> None:
    settings, _ = parse_settings({"allowed_modes": ["review"]})
    assert settings.effective_default_mode() == "review"


@pytest.mark.parametrize(
    "data",
    [
        {"allowed_modes": ["independent", "telepathy"]},
        {"allowed_modes": []},
        {"default_mode": "review", "allowed_modes": ["independent"]},
        {"annotator_id": "   "},
        {"annotator_id": "a​b"},
        {"auto_open_browser": "maybe"},
        ["not", "an", "object"],
    ],
)
def test_settings_invalid_values_raise(data: object) -> None:
    with pytest.raises(ValueError):
        parse_settings(data)


def test_settings_file_missing_invalid_and_valid(tmp_path: Path) -> None:
    path = tmp_path / SETTINGS_FILENAME
    settings, warnings = load_settings_file(path)
    assert settings == DistributionSettings() and warnings == []

    path.write_text("{not json", encoding="utf-8")
    settings, warnings = load_settings_file(path)
    assert settings == DistributionSettings()
    assert len(warnings) == 1 and "defaults" in warnings[0]

    path.write_text(json.dumps({"allowed_modes": ["nope"]}), encoding="utf-8")
    settings, warnings = load_settings_file(path)
    assert settings == DistributionSettings()
    assert "defaults" in warnings[0]

    path.write_text(json.dumps({"allowed_modes": ["independent"]}), encoding="utf-8")
    settings, warnings = load_settings_file(path)
    assert settings.allowed_modes == ["independent"] and warnings == []


# --------------------------------------------------------------------------- #
# API: effective settings, server-side mode enforcement
# --------------------------------------------------------------------------- #


def _client(tmp_path: Path, distribution: DistributionSettings | None = None):
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=database_url_for(tmp_path / "editor.db"),
        session_token="tok",
        distribution=distribution or DistributionSettings(),
    )
    client = TestClient(create_app(config), headers={"Authorization": "Bearer tok"})
    resp = client.post(
        "/api/v1/packages",
        files={"file": ("demo.zip", DEMO_PACKAGE.read_bytes(), "application/zip")},
    )
    assert resp.status_code == 200, resp.text
    return client


def _first_doc(client: TestClient) -> str:
    docs = client.get(f"/api/v1/packages/{DEMO_ID}/documents").json()
    return str(docs[0]["document_id"])


def test_settings_endpoint_defaults(tmp_path: Path) -> None:
    client = _client(tmp_path)
    body = client.get("/api/v1/settings").json()
    assert body == {
        "allowed_modes": ["independent", "review", "assisted"],
        "default_mode": "independent",
        "annotator_id": None,
        "open_package": None,
    }


def test_settings_endpoint_reflects_distribution(tmp_path: Path) -> None:
    client = _client(
        tmp_path,
        DistributionSettings(
            allowed_modes=["independent"], annotator_id="AB", open_package=DEMO_ID
        ),
    )
    body = client.get("/api/v1/settings").json()
    assert body["allowed_modes"] == ["independent"]
    assert body["default_mode"] == "independent"
    assert body["annotator_id"] == "AB"
    assert body["open_package"] == DEMO_ID


def test_document_list_does_not_reveal_proposals_when_review_is_disallowed(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path, DistributionSettings(allowed_modes=["independent"]))
    resp = client.get(
        f"/api/v1/packages/{DEMO_ID}/documents",
        params={"annotator_id": "AB", "mode": "review"},
    )
    assert resp.status_code == 200, resp.text
    assert all(d["has_review_inputs"] is None for d in resp.json())


def test_disallowed_review_mode_is_rejected_server_side(tmp_path: Path) -> None:
    client = _client(tmp_path, DistributionSettings(allowed_modes=["independent"]))
    doc = _first_doc(client)

    resp = client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "package_id": DEMO_ID,
            "document_id": doc,
            "annotator_id": "AB",
            "mode": "review",
        },
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "MODE_NOT_ALLOWED"

    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": DEMO_ID,
            "document_id": doc,
            "annotator_id": "AB",
            "mode": "review",
            "targets": {"target_set_id": "", "targets": []},
        },
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "MODE_NOT_ALLOWED"

    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": DEMO_ID,
            "document_id": doc,
            "annotator_id": "AB",
            "mode": "independent",
        },
    )
    assert resp.status_code == 200, resp.text


def test_review_mode_allowed_by_default(tmp_path: Path) -> None:
    client = _client(tmp_path)
    resp = client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "package_id": DEMO_ID,
            "document_id": _first_doc(client),
            "annotator_id": "AB",
            "mode": "review",
        },
    )
    assert resp.status_code == 200, resp.text
