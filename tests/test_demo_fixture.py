"""The shipped demo package must stay importable (format v2, self-contained)."""

import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig

DEMO = Path(__file__).parent / "fixtures" / "demo_package.zip"


def test_demo_fixture_is_current_format() -> None:
    with zipfile.ZipFile(DEMO) as z:
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["format_version"] == "ontocurator-work-package/v2"
        assert "ontologies/hp.json" in z.namelist()


def test_demo_fixture_imports_via_api_without_installed_ontology(
    tmp_path: Path,
) -> None:
    app = create_app(AppConfig(workspace_dir=tmp_path, session_token="t"))
    client = TestClient(app, headers={"Authorization": "Bearer t"})
    resp = client.post(
        "/api/v1/packages",
        files={"file": ("demo_package.zip", io.BytesIO(DEMO.read_bytes()))},
    )
    assert resp.status_code == 200, resp.text
    package_id = resp.json()["package_id"]
    assert package_id == "demo-klinik-pakete-01"
    docs = client.get(f"/api/v1/packages/{package_id}/documents")
    assert docs.status_code == 200, docs.text
    assert len(docs.json()) == 2
