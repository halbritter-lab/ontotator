"""Preconfigured standalone distribution: settings, provisioning, mode enforcement."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from ontocurator.api.app import create_app
from ontocurator.cli import app
from ontocurator.config import AppConfig
from ontocurator.config_store import (
    PersistentConfig,
    load_persistent_config,
    save_persistent_config,
)
from ontocurator.distribution_settings import (
    SETTINGS_FILENAME,
    DistributionSettings,
    load_settings_file,
    parse_settings,
)
from ontocurator.packages.reader import PackageReader
from ontocurator.packages.writer import PackageWriter

runner = CliRunner()
FIXTURES = Path(__file__).parent / "fixtures"
HP_FIXTURE = FIXTURES / "hp.json"
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
# API: effective settings, provisioning status, server-side mode enforcement
# --------------------------------------------------------------------------- #


def _client(tmp_path: Path, distribution: DistributionSettings | None = None):
    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=tmp_path / "editor.db",
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
    assert client.get("/api/v1/provisioning").json() == {"notices": []}


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


# --------------------------------------------------------------------------- #
# Startup provisioning from ontologies/ and packages/
# --------------------------------------------------------------------------- #


def _modified_demo_package(target: Path) -> Path:
    pkg = PackageReader.read(DEMO_PACKAGE)
    pkg.manifest.created_at = "2030-01-01T00:00:00Z"
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf, embedded_files=pkg.embedded_files)
    target.write_bytes(buf.getvalue())
    return target


def _provision_dir(tmp_path: Path) -> Path:
    root = tmp_path / "Ontocurator"
    (root / "ontologies").mkdir(parents=True)
    (root / "packages").mkdir()
    (root / "ontologies" / "README.txt").write_text("readme", encoding="utf-8")
    (root / "packages" / "README.txt").write_text("readme", encoding="utf-8")
    (root / "ontologies" / "hp.json").write_bytes(HP_FIXTURE.read_bytes())
    (root / "packages" / "demo.zip").write_bytes(DEMO_PACKAGE.read_bytes())
    return root


def _serve(ws: Path, root: Path | None, *extra: str):
    args = ["serve", "-w", str(ws), "--no-browser", "--port", "0", *extra]
    if root is not None:
        args += ["--provision-dir", str(root)]
    with patch("ontocurator.cli.run_server") as mock_run:
        result = runner.invoke(app, args)
    assert result.exit_code == 0, result.output
    mock_run.assert_called_once()
    return result, mock_run.call_args[0][0]


def _api(api_app) -> TestClient:  # type: ignore[no-untyped-def]
    token = api_app.state.config.session_token
    return TestClient(api_app, headers={"Authorization": f"Bearer {token}"})


def test_provisioning_registers_ontologies_and_imports_packages(tmp_path: Path) -> None:
    root = _provision_dir(tmp_path)
    ws = tmp_path / "ws"
    result, api_app = _serve(ws, root)

    digest = hashlib.sha256(HP_FIXTURE.read_bytes()).hexdigest()
    stored = ws / "ontologies" / f"hp-{digest[:12]}.json"
    assert stored.is_file()
    assert stored.resolve() in load_persistent_config().ontology_paths
    assert stored.resolve() in api_app.state.config.ontology_paths

    client = _api(api_app)
    assert [p["package_id"] for p in client.get("/api/v1/packages").json()] == [DEMO_ID]
    assert client.get("/api/v1/provisioning").json() == {"notices": []}
    assert "demo.zip" in result.output
    ledger = json.loads((ws / "provisioning.json").read_text(encoding="utf-8"))
    assert ledger["ontologies"]["hp.json"]["sha256"] == digest
    assert ledger["packages"]["demo.zip"]["package_id"] == DEMO_ID

    # Second start: idempotent and silent.
    result2, api_app2 = _serve(ws, root)
    assert "imported" not in result2.output.lower()
    assert "warning" not in result2.output.lower()
    client2 = _api(api_app2)
    assert len(client2.get("/api/v1/packages").json()) == 1
    assert client2.get("/api/v1/provisioning").json() == {"notices": []}


def test_changed_package_with_same_id_is_not_imported_and_warns(tmp_path: Path) -> None:
    root = _provision_dir(tmp_path)
    ws = tmp_path / "ws"
    _, api_app = _serve(ws, root)
    before = _api(api_app).get("/api/v1/packages").json()

    _modified_demo_package(root / "packages" / "demo.zip")
    result, api_app2 = _serve(ws, root)
    output = " ".join(result.output.split())
    assert "differs from the already imported version" in output
    client = _api(api_app2)
    assert client.get("/api/v1/packages").json() == before
    notices = client.get("/api/v1/provisioning").json()["notices"]
    assert len(notices) == 1
    assert notices[0]["level"] == "warning"
    assert notices[0]["code"] == "PACKAGE_CHANGED"
    assert notices[0]["file"] == "demo.zip"
    assert f"Package '{DEMO_ID}'" in notices[0]["message"]
    assert "was NOT imported" in notices[0]["message"]
    assert "new package ID" in notices[0]["message"]

    # The warning persists until the folder content is fixed.
    _, api_app3 = _serve(ws, root)
    assert len(_api(api_app3).get("/api/v1/provisioning").json()["notices"]) == 1


def test_new_ontology_version_is_registered_alongside_old(tmp_path: Path) -> None:
    root = _provision_dir(tmp_path)
    ws = tmp_path / "ws"
    _serve(ws, root)
    old_digest = hashlib.sha256(HP_FIXTURE.read_bytes()).hexdigest()

    new_bytes = HP_FIXTURE.read_bytes() + b"\n"
    (root / "ontologies" / "hp.json").write_bytes(new_bytes)
    new_digest = hashlib.sha256(new_bytes).hexdigest()
    result, api_app = _serve(ws, root)

    paths = api_app.state.config.ontology_paths
    assert (ws / "ontologies" / f"hp-{old_digest[:12]}.json").resolve() in paths
    assert (ws / "ontologies" / f"hp-{new_digest[:12]}.json").resolve() in paths
    notices = _api(api_app).get("/api/v1/provisioning").json()["notices"]
    assert [n["code"] for n in notices] == ["ONTOLOGY_NEW_VERSION"]
    assert notices[0]["level"] == "info"
    assert "A new version of hp.json was registered" in notices[0]["message"]
    assert "new version of hp.json" in result.output

    # Shown once: the next start is quiet again.
    _, api_app2 = _serve(ws, root)
    assert _api(api_app2).get("/api/v1/provisioning").json() == {"notices": []}


def test_invalid_provisioning_files_are_skipped_without_blocking(
    tmp_path: Path,
) -> None:
    root = _provision_dir(tmp_path)
    (root / "ontologies" / "notes.json").write_text('{"x": 1}', encoding="utf-8")
    (root / "packages" / "broken.zip").write_bytes(b"not a zip")
    ws = tmp_path / "ws"
    result, api_app = _serve(ws, root)
    output = " ".join(result.output.split())
    assert "notes.json" in output and "broken.zip" in output
    client = _api(api_app)
    assert [p["package_id"] for p in client.get("/api/v1/packages").json()] == [DEMO_ID]
    codes = [n["code"] for n in client.get("/api/v1/provisioning").json()["notices"]]
    assert codes == ["PACKAGE_INVALID"]


def test_settings_file_is_applied_and_open_package_in_url(tmp_path: Path) -> None:
    root = _provision_dir(tmp_path)
    (root / SETTINGS_FILENAME).write_text(
        json.dumps(
            {
                "allowed_modes": ["independent"],
                "annotator_id": "JPL",
                "open_package": DEMO_ID,
                "surprise": 1,
            }
        ),
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    result, api_app = _serve(ws, root)
    output = " ".join(result.output.split())
    assert f"package_id={DEMO_ID}" in output
    assert "surprise" in output
    body = _api(api_app).get("/api/v1/settings").json()
    assert body["allowed_modes"] == ["independent"]
    assert body["annotator_id"] == "JPL"


def test_invalid_settings_file_warns_and_uses_defaults(tmp_path: Path) -> None:
    root = _provision_dir(tmp_path)
    (root / SETTINGS_FILENAME).write_text("{oops", encoding="utf-8")
    result, api_app = _serve(tmp_path / "ws", root)
    assert SETTINGS_FILENAME in result.output
    body = _api(api_app).get("/api/v1/settings").json()
    assert body["allowed_modes"] == ["independent", "review", "assisted"]


def test_browser_precedence_cli_over_settings_over_config(tmp_path: Path) -> None:
    root = _provision_dir(tmp_path)
    save_persistent_config(PersistentConfig(auto_open_browser=False))
    (root / SETTINGS_FILENAME).write_text(
        json.dumps({"auto_open_browser": True}), encoding="utf-8"
    )

    def started(api_app, sock, on_started=None, finished=None, **_kwargs):  # type: ignore[no-untyped-def]
        if on_started is not None:
            on_started()

    base = ["serve", "-w", str(tmp_path / "ws"), "--port", "0"]
    base += ["--provision-dir", str(root)]
    with (
        patch("ontocurator.cli.run_server", side_effect=started),
        patch("ontocurator.cli._open_browser") as opened,
    ):
        assert runner.invoke(app, base).exit_code == 0
    opened.assert_called_once()

    with (
        patch("ontocurator.cli.run_server", side_effect=started),
        patch("ontocurator.cli._open_browser") as opened,
    ):
        assert runner.invoke(app, [*base, "--no-browser"]).exit_code == 0
    opened.assert_not_called()


def test_missing_provision_dir_is_an_error(tmp_path: Path) -> None:
    result = runner.invoke(
        app,
        [
            "serve",
            "-w",
            str(tmp_path / "ws"),
            "--no-browser",
            "--provision-dir",
            str(tmp_path / "nope"),
        ],
    )
    assert result.exit_code == 1


def test_frozen_app_dir_is_used_for_provisioning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _provision_dir(tmp_path)
    monkeypatch.setattr("ontocurator.cli.default_provision_dir", lambda: root)
    _, api_app = _serve(tmp_path / "ws", None)
    assert len(_api(api_app).get("/api/v1/packages").json()) == 1


def test_no_provisioning_from_source_without_flag(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _provision_dir(tmp_path)
    monkeypatch.chdir(root)
    _, api_app = _serve(tmp_path / "ws", None)
    assert _api(api_app).get("/api/v1/packages").json() == []
