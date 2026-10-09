"""A study's pinned search inputs survive uploads and archive roundtrips."""

import hashlib
import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from layered_fixtures import make_layered_package
from test_translation_api import (
    DE,
    HP,
    _client,
    _folder,
    _open_single,
    _search,
    _upload,
)

from ontocurator.application.exports import ExportService
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import InvalidPackage
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.packages.reader import PackageReader
from ontocurator.packages.writer import PackageWriter


def _export(client: Any, key: Any) -> bytes:
    response = client.get(
        f"/api/v1/packages/{key['package_id']}/export",
        params={"annotator_id": key["annotator_id"], "mode": key["mode"]},
    )
    assert response.status_code == 200, response.text
    return bytes(response.content)


def _manifest(data: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return json.loads(archive.read("manifest.json"))  # type: ignore[no-any-return]


def _alter(data: bytes, change: Any) -> io.BytesIO:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(files["manifest.json"])
    change(manifest, files)
    files["manifest.json"] = json.dumps(manifest).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    output.seek(0)
    return output


def test_global_upload_keeps_captured_package_english_only(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    before = _search(client, key, "Muskelhypotonie")
    assert _upload(client, DE.name, DE.read_bytes()).status_code == 200
    after = _search(client, key, "Muskelhypotonie")
    assert after["languages"] == before["languages"] == ["en"]
    assert after["ranked_ids"] == before["ranked_ids"]
    assert after["index_identity"] == before["index_identity"]

    package = make_layered_package("single")
    package.manifest.package_id = "new-after-upload"
    package.embedded_files = {"ontologies/hp.json": HP.read_bytes()}
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    response = client.post(
        "/api/v1/packages", files={"file": ("new.zip", stream.getvalue())}
    )
    assert response.status_code == 200, response.text
    new_key = dict(key, package_id="new-after-upload")
    assert _search(client, new_key, "Muskelhypotonie")["languages"] == ["en", "de"]


def test_roundtrip_uses_captured_bytes_without_ambient_translations(
    tmp_path: Path,
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    before = _search(client, key, "Muskelhypotonie")
    original = client.app.state.repo.get_manifest(key["package_id"]).model_dump()
    data = _export(client, key)
    manifest = _manifest(data)
    assert manifest["search_conditions"]
    assert manifest["origin_manifest_hash"] == canonical_hash(original)
    condition = manifest["search_conditions"][0]
    resource = condition["translations"][0]
    assert resource["sha256"] == hashlib.sha256(DE.read_bytes()).hexdigest()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.read(resource["resource_path"]) == DE.read_bytes()

    fresh = _client(tmp_path / "fresh")
    imported = fresh.post("/api/v1/packages", files={"file": ("study.zip", data)})
    assert imported.status_code == 200, imported.text
    new_key = dict(key, package_id=imported.json()["package_id"])
    after = _search(fresh, new_key, "Muskelhypotonie")
    assert after["ranked_ids"] == before["ranked_ids"]
    assert after["languages"] == ["en", "de"]
    assert after["search_condition_id"] == before["search_condition_id"]
    assert (
        _manifest(_export(fresh, new_key))["search_conditions"]
        == manifest["search_conditions"]
    )


@pytest.mark.parametrize("damage", ["hash", "path", "bytes", "ontology", "missing"])
def test_tampered_conditions_fail_archive_validation(
    tmp_path: Path, damage: str
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    _search(client, key, "Muskelhypotonie")
    data = _export(client, key)
    assert _manifest(data).get("search_conditions"), "capture metadata missing"

    def change(manifest: Any, files: Any) -> None:
        condition = manifest["search_conditions"][0]
        resource = condition["translations"][0]
        if damage == "hash":
            condition["condition_id"] = "f" * 64
        elif damage == "path":
            resource["resource_path"] = "search-resources/../hp-de.babelon.tsv"
        elif damage == "ontology":
            condition["ontology_sha256"] = "f" * 64
        elif damage == "missing":
            del files[resource["resource_path"]]
        else:
            files[resource["resource_path"]] = b"changed"
            manifest["file_hashes"][resource["resource_path"]] = hashlib.sha256(
                b"changed"
            ).hexdigest()
        if damage != "hash":
            condition["condition_id"] = canonical_hash(
                {k: v for k, v in condition.items() if k != "condition_id"}
            )

    with pytest.raises(InvalidPackage):
        PackageReader.read_from_stream(_alter(data, change))


def test_repository_export_includes_capture_without_changing_stored_manifest(
    tmp_path: Path,
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    repo = client.app.state.repo
    original = repo.get_manifest(key["package_id"]).model_dump()
    _search(client, key, "Muskelhypotonie")
    stream = io.BytesIO()
    PackageWriter.write_to_stream(repo.export_package(key["package_id"]), stream)
    assert _manifest(stream.getvalue())["search_conditions"]
    assert repo.get_manifest(key["package_id"]).model_dump() == original


def test_package_language_listing_uses_pins_after_global_upload(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    endpoint = f"/api/v1/packages/{key['package_id']}/ontologies"
    before = client.get(endpoint)
    assert before.status_code == 200, before.text
    assert before.json()[0]["translations"] == []
    assert _upload(client, DE.name, DE.read_bytes()).status_code == 200
    assert client.get(endpoint).json()[0]["translations"] == []
    assert client.get("/api/v1/ontologies").json()[0]["translations"]


def test_import_preserves_historical_runtime_and_records_current_execution(
    tmp_path: Path,
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    _search(client, key, "Muskelhypotonie")
    data = _export(client, key)
    assert _manifest(data).get("search_conditions"), "capture metadata missing"

    def change(manifest: Any, files: Any) -> None:
        condition = manifest["search_conditions"][0]
        condition["runtime"]["python"] = "historical-runtime"
        condition["condition_id"] = canonical_hash(
            {k: v for k, v in condition.items() if k != "condition_id"}
        )
        records = [
            json.loads(line) for line in files["search-events.jsonl"].splitlines()
        ]
        for record in records:
            record["search_condition_id"] = condition["condition_id"]
            record["execution"]["runtime"]["python"] = "historical-runtime"
        files["search-events.jsonl"] = (
            "\n".join(json.dumps(record) for record in records) + "\n"
        ).encode()
        manifest["file_hashes"]["search-events.jsonl"] = hashlib.sha256(
            files["search-events.jsonl"]
        ).hexdigest()

    altered = _alter(data, change).getvalue()
    fresh = _client(tmp_path / "fresh")
    imported = fresh.post(
        "/api/v1/packages", files={"file": ("historical.zip", altered)}
    )
    assert imported.status_code == 200, imported.text
    new_key = dict(key, package_id=imported.json()["package_id"])
    after = _search(fresh, new_key, "Muskelhypotonie")
    assert after["runtime_drift"] is True
    assert after["execution"]["runtime"]["python"] != "historical-runtime"
    outgoing = _export(fresh, new_key)
    assert (
        _manifest(outgoing)["search_conditions"]
        == _manifest(altered)["search_conditions"]
    )
    with zipfile.ZipFile(io.BytesIO(outgoing)) as archive:
        events = [
            json.loads(line)
            for line in archive.read("search-events.jsonl").splitlines()
        ]
    assert {event["execution"]["runtime"]["python"] for event in events} == {
        "historical-runtime",
        after["execution"]["runtime"]["python"],
    }


@pytest.mark.parametrize("alias", [False, True])
def test_capture_supports_unused_ontology_declarations_and_digest_aliases(
    tmp_path: Path, alias: bool
) -> None:
    from ontocurator.domain.profiles import OntologyDefinition

    package = make_layered_package("single")
    assert package.manifest.task_profile is not None
    if alias:
        unused = package.manifest.task_profile.ontologies[0].model_copy(
            update={"ontology_id": "hp-alias"}
        )
        resources = {"ontologies/hp.json": HP.read_bytes()}
    else:
        raw = (HP.parent / "mondo.json").read_bytes()
        unused = OntologyDefinition(
            ontology_id="unused-mondo",
            label="Unused",
            release="fixture",
            sha256=hashlib.sha256(raw).hexdigest(),
            resource_path="ontologies/mondo.json",
        )
        resources = {
            "ontologies/hp.json": HP.read_bytes(),
            "ontologies/mondo.json": raw,
        }
    package.manifest.task_profile.ontologies.append(unused)
    package.embedded_files = resources
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    client = _client(tmp_path)
    imported = client.post(
        "/api/v1/packages", files={"file": ("extra.zip", stream.getvalue())}
    )
    assert imported.status_code == 200, imported.text
    key = {
        "package_id": imported.json()["package_id"],
        "document_id": "doc-beta",
        "annotator_id": "rater",
        "mode": "independent",
        "target_set_id": "targets-0",
    }
    assert _search(client, key, "hypotonia")["search_condition_id"]
    conditions = client.app.state.repo.get_search_conditions(key["package_id"])
    assert len(conditions) == (1 if alias else 2)


def test_restart_uses_pinned_translations_after_global_file_disappears(
    tmp_path: Path,
) -> None:
    folder = _folder(tmp_path, DE)
    client = _client(tmp_path)
    key = _open_single(client, embedded=True)
    before = _search(client, key, "Muskelhypotonie")
    (folder / DE.name).unlink()
    restarted = _client(tmp_path)
    after = _search(restarted, key, "Muskelhypotonie")
    assert after["search_condition_id"] == before["search_condition_id"]
    assert after["ranked_ids"] == before["ranked_ids"]
    assert after["languages"] == ["en", "de"]


def test_concurrent_first_use_commits_one_immutable_capture(tmp_path: Path) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    repo = client.app.state.repo
    registry = client.app.state.ontology_registry
    assert repo.get_search_conditions(key["package_id"]) is None
    with ThreadPoolExecutor(max_workers=4) as pool:
        services = list(
            pool.map(
                lambda _: registry.for_package_layer(
                    repo, key["package_id"], "hpo-layer"
                ),
                range(8),
            )
        )
    assert len({svc.search_condition.condition_id for svc in services}) == 1
    assert len(repo.get_search_conditions(key["package_id"])) == 1
    assert all(svc.languages == ["de"] for svc in services)


def test_independent_exports_project_captured_resources_with_profile(
    tmp_path: Path,
) -> None:
    from test_translation_api import MONDO

    folder = _folder(tmp_path, DE)
    (folder / "mondo-de.babelon.tsv").write_text(
        "subject_id\ttranslation_value\nMONDO:0005027\tEpilepsie\n", encoding="utf-8"
    )
    client = _client(tmp_path, ontology_paths=[HP, MONDO])
    package = make_layered_package("assisted")
    package.embedded_files = {
        "ontologies/hp.json": HP.read_bytes(),
        "ontologies/mondo.json": MONDO.read_bytes(),
    }
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    imported = client.post(
        "/api/v1/packages", files={"file": ("layered.zip", stream.getvalue())}
    )
    assert imported.status_code == 200, imported.text
    key = {
        "package_id": imported.json()["package_id"],
        "document_id": "doc-beta",
        "annotator_id": "rater",
        "mode": "independent",
        "target_set_id": "targets-0",
    }
    _search(client, key, "Muskelhypotonie", layer_id="target-layer")
    assert len(client.app.state.repo.get_search_conditions(key["package_id"])) == 2
    data = _export(client, key)
    projected = PackageReader.read_from_stream(io.BytesIO(data))
    assert len(projected.manifest.search_conditions) == 1
    assert {ont.ontology_id for ont in projected.manifest.task_profile.ontologies} == {
        "hp"
    }
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert not any("mondo" in name for name in archive.namelist())


@pytest.mark.parametrize("damage", ["unknown-condition", "drift", "fitting-languages"])
def test_inconsistent_search_execution_metadata_is_rejected(
    tmp_path: Path, damage: str
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    _search(client, key, "Muskelhypotonie")
    data = _export(client, key)

    def change(manifest: Any, files: Any) -> None:
        event = json.loads(files["search-events.jsonl"].splitlines()[0])
        if damage == "unknown-condition":
            event["search_condition_id"] = "f" * 64
        elif damage == "drift":
            event["runtime_drift"] = not event["runtime_drift"]
        else:
            event["execution"]["fitting_languages"] = ["en", "xx"]
        files["search-events.jsonl"] = (json.dumps(event) + "\n").encode()
        manifest["file_hashes"]["search-events.jsonl"] = hashlib.sha256(
            files["search-events.jsonl"]
        ).hexdigest()

    with pytest.raises(InvalidPackage):
        PackageReader.read_from_stream(_alter(data, change))


@pytest.mark.parametrize("boundary", ["workspace", "package", "package-aggregate"])
def test_first_use_capture_during_export_includes_matching_resources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, boundary: str
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    repo = client.app.state.repo
    registry = client.app.state.ontology_registry
    original_manifest = repo.get_manifest(key["package_id"]).model_dump()
    assert repo.get_search_conditions(key["package_id"]) is None
    service = ExportService(repo)
    if boundary == "package-aggregate":
        original_workspace_export = service._export_workspace

        def capture_after_workspace(*args: Any, **kwargs: Any) -> Any:
            package = original_workspace_export(*args, **kwargs)
            registry.ensure_package_conditions(repo, key["package_id"])
            return package

        monkeypatch.setattr(service, "_export_workspace", capture_after_workspace)
    else:
        original_export = repo.export_package

        def capture_after_resource_read(*args: Any, **kwargs: Any) -> Any:
            package = original_export(*args, **kwargs)
            registry.ensure_package_conditions(repo, key["package_id"])
            return package

        monkeypatch.setattr(repo, "export_package", capture_after_resource_read)
    exported = (
        service.for_workspace(WorkspaceKey.model_validate(key))
        if boundary == "workspace"
        else service.for_package(key["package_id"], key["annotator_id"], "independent")
    )
    assert exported.manifest.origin_manifest_hash == canonical_hash(original_manifest)
    assert exported.manifest.search_conditions is not None
    resource = exported.manifest.search_conditions[0].translations[0]
    assert exported.embedded_files[resource.resource_path] == DE.read_bytes()
    stream = io.BytesIO()
    PackageWriter.write_to_stream(exported, stream)
    stream.seek(0)
    assert (
        PackageReader.read_from_stream(stream).manifest.search_conditions
        == exported.manifest.search_conditions
    )


def test_raw_export_ignores_capture_committed_after_condition_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    repo = client.app.state.repo
    registry = client.app.state.ontology_registry
    original_conditions = repo.get_search_conditions
    did_capture = False

    def capture_after_condition_read(package_id: str) -> Any:
        nonlocal did_capture
        conditions = original_conditions(package_id)
        if not did_capture:
            did_capture = True
            registry.ensure_package_conditions(repo, package_id)
        return conditions

    monkeypatch.setattr(repo, "get_search_conditions", capture_after_condition_read)
    exported = repo.export_package(key["package_id"])
    assert exported.manifest.search_conditions is None
    assert not any(
        path.startswith("search-resources/") for path in exported.embedded_files
    )
    stream = io.BytesIO()
    PackageWriter.write_to_stream(exported, stream)
    stream.seek(0)
    assert PackageReader.read_from_stream(stream).manifest.search_conditions is None
