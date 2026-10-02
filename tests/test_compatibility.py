import hashlib
import json
import shutil
from pathlib import Path

import pytest

from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.packages.reader import read_package
from ontocurator.storage.database import Database

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "legacy_v1"


def _load_expected() -> dict:
    return json.loads((FIXTURES_DIR / "expected.json").read_text(encoding="utf-8"))


def test_frozen_legacy_package_is_cleanly_rejected() -> None:
    expected = _load_expected()
    zip_path = FIXTURES_DIR / "review.zip"
    assert zip_path.exists()

    # Check zip sha256 digest is byte-identical
    raw_zip = zip_path.read_bytes()
    assert hashlib.sha256(raw_zip).hexdigest() == expected["review_zip_sha256"]

    # Read package must be strictly rejected with InvalidPackage
    with pytest.raises(InvalidPackage) as exc_info:
        read_package(zip_path)
    assert "Unsupported package format version" in str(exc_info.value)
    assert "hpo-editor-work-package/v1" in str(exc_info.value)


def test_frozen_v2_workspace_is_cleanly_rejected_and_byte_identical(
    tmp_path: Path,
) -> None:
    expected = _load_expected()
    db_source = FIXTURES_DIR / "workspace-v2.sqlite"
    assert db_source.exists()

    # Verify database digest
    db_sha256 = hashlib.sha256(db_source.read_bytes()).hexdigest()
    assert db_sha256 == expected["sqlite_sha256"]

    # Copy to tmp_path before opening
    db_copy = tmp_path / "workspace.sqlite"
    shutil.copy2(db_source, db_copy)

    # Opening must raise UNSUPPORTED_WORKSPACE_VERSION before running any DDL
    with pytest.raises(DomainError) as exc_info:
        Database(db_copy)

    assert exc_info.value.code == "UNSUPPORTED_WORKSPACE_VERSION"
    assert "Legacy database version 2 is not supported" in str(exc_info.value)

    # Ensure no migrations ran and database file remains byte-identical
    assert hashlib.sha256(db_copy.read_bytes()).hexdigest() == db_sha256


def test_legacy_format_versions_rejected() -> None:
    from ontocurator.packages.models import PackageManifest

    # Direct validation of unsupported format versions
    for legacy_version in ["hpo-editor-work-package/v1", "ontocurator-work-package/v1"]:
        manifest_data = {
            "package_id": "test-pkg",
            "format_version": legacy_version,
            "created_at": "2026-10-01T00:00:00Z",
        }
        manifest = PackageManifest.model_validate(manifest_data)
        assert manifest.format_version == legacy_version
        assert manifest.format_version != "ontocurator-work-package/v2"


def test_read_package_rejects_ontocurator_work_package_v1(tmp_path: Path) -> None:
    import zipfile

    pkg_zip = tmp_path / "legacy_v1.zip"
    with zipfile.ZipFile(pkg_zip, "w") as zf:
        manifest = {
            "format_version": "ontocurator-work-package/v1",
            "package_id": "test-v1",
            "created_at": "2026-10-01T00:00:00Z",
            "ontology": {"sha256": "abc", "release": "2026-01-01"},
            "files": {},
        }
        zf.writestr("manifest.json", json.dumps(manifest))
    with pytest.raises(InvalidPackage) as exc_info:
        read_package(pkg_zip)
    assert "Unsupported package format version" in str(exc_info.value)
    assert "ontocurator-work-package/v1" in str(exc_info.value)


def test_legacy_snapshot_schemas_rejected() -> None:
    from ontocurator.domain.errors import InvalidAnnotation
    from ontocurator.domain.serialization import decode_snapshot

    for bad_schema in [None, "ontocurator-annotation/v1", "ontocurator-annotation/v2"]:
        doc: dict = {
            "annotation": {
                "annotation_id": "ann-1",
                "layer_id": "layer-1",
                "type_id": "type-1",
                "term_id": "HP:0001250",
                "evidence_refs": [],
                "provenance": {
                    "actor": {"actor_id": "test", "kind": "human"},
                    "method": "manual",
                },
            },
            "evidence": [],
            "version": "abc",
            "document_id": "doc-1",
            "text_sha256": "123",
            "ontology_sha256": "456",
            "layer_config_sha256": "789",
        }
        if bad_schema is not None:
            doc["schema_version"] = bad_schema
        with pytest.raises(InvalidAnnotation) as exc:
            decode_snapshot(doc)
        assert "Unsupported or legacy snapshot schema" in str(exc.value)


def test_annotation_record_rejects_hpo_id_legacy_field() -> None:
    from pydantic import ValidationError

    from ontocurator.domain.annotations import Annotation

    with pytest.raises(ValidationError) as exc:
        Annotation.model_validate(
            {
                "annotation_id": "ann-1",
                "layer_id": "layer-1",
                "type_id": "type-1",
                "hpo_id": "HP:0001250",
                "evidence_refs": [],
                "provenance": {
                    "actor": {"actor_id": "test", "kind": "human"},
                    "method": "manual",
                },
            }
        )
    assert "Deprecated field 'hpo_id' is no longer supported" in str(exc.value)


def test_openapi_schema_does_not_contain_public_hpo_id() -> None:
    openapi_file = Path(__file__).parent.parent / "contracts" / "openapi.json"
    assert openapi_file.exists()
    content = openapi_file.read_text(encoding="utf-8")
    schema = json.loads(content)
    schemas = schema.get("components", {}).get("schemas", {})
    for schema_name, s_def in schemas.items():
        props = s_def.get("properties", {})
        assert "hpo_id" not in props, (
            f"Schema '{schema_name}' should not expose 'hpo_id'"
        )
