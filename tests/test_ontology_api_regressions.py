"""Exercise ontology selection and portable packages through the real HTTP API."""

import hashlib
import io
import zipfile
from contextlib import contextmanager
from pathlib import Path

from auth_harness import AutoLoginClient, upload_package
from layered_fixtures import make_layered_package
from pg_harness import database_url_for
from support.v2_exports import workspace_export_zip
from support.v2_writer import PackageWriter

from ontotator.api.app import create_app
from ontotator.config import AppConfig

FIXTURES = Path(__file__).parent / "fixtures"


@contextmanager
def client_at(path, ontology_paths=()):
    app = create_app(
        AppConfig(
            workspace_dir=path,
            database_url=database_url_for(path / "editor.db"),
            ontology_paths=list(ontology_paths),
        )
    )
    try:
        with AutoLoginClient(app, raise_server_exceptions=False) as client:
            yield client
    finally:
        app.state.repo.db.close()


def archive(scenario, embedded=False):
    package = make_layered_package(scenario)
    resources = {}
    if embedded:
        for ont in package.manifest.task_profile.ontologies:
            resources[ont.resource_path] = (
                FIXTURES / Path(ont.resource_path).name
            ).read_bytes()
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream, embedded_files=resources)
    return stream.getvalue()


def upload(client, data):
    response = upload_package(
        client, files={"file": ("cases.zip", data, "application/zip")}
    )
    assert response.status_code == 200, response.text
    return response.json()["project_key"]


def open_case(client, project_key):
    response = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": project_key,
            "document_id": "doc-alpha",
            "annotator_id": "reviewer",
            "mode": "independent",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def search(client, workspace, layer_id, query):
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": workspace["view"]["key"],
            "annotation_id": "ann-new",
            "layer_id": layer_id,
            "query": query,
            "route": "id",
            "k": 5,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_second_ontology_is_used_for_editing_and_workspace_status(tmp_path):
    with client_at(tmp_path, [FIXTURES / "hp.json", FIXTURES / "mondo.json"]) as client:
        project_key = upload(client, archive("multi_editable"))
        workspace = open_case(client, project_key)
        response = client.post(
            f"/api/v1/workspaces/{workspace['workspace_id']}/commands",
            json={
                "mutation_id": "create-mondo",
                "expected_revision": 0,
                "payload": {
                    "command": "create_annotation",
                    "annotation_id": "ann-mondo",
                    "evidence_id": "current-finding",
                    "segments": [{"start": 21, "end": 30}],
                    "layer_id": "layer-2",
                    "type_id": "type-req",
                    "term_id": "MONDO:0000001",
                    "axes_values": {"severity": "mild"},
                },
            },
        )
        assert response.status_code == 200, response.text
        reopened = open_case(client, project_key)
        assert reopened["view"]["term_statuses"]["layer-2:MONDO:0000001"] == "valid"


def test_embedded_ontology_survives_restart_and_export_without_cli_files(tmp_path):
    with client_at(tmp_path) as client:
        project_key = upload(client, archive("single", embedded=True))
        workspace = open_case(client, project_key)
        assert (
            search(client, workspace, "hpo-layer", "HP:0001250")["candidates"][0][
                "term_id"
            ]
            == "HP:0001250"
        )

    with client_at(tmp_path) as client:
        workspace = open_case(client, project_key)
        assert (
            search(client, workspace, "hpo-layer", "HP:0001250")["candidates"][0][
                "term_id"
            ]
            == "HP:0001250"
        )
        exported = workspace_export_zip(client.app, workspace["workspace_id"])
        with zipfile.ZipFile(io.BytesIO(exported)) as zipped:
            assert (
                zipped.read("ontologies/hp.json") == (FIXTURES / "hp.json").read_bytes()
            )

    with client_at(tmp_path / "fresh") as client:
        project_key = upload(client, exported)
        workspace = open_case(client, project_key)
        assert (
            search(client, workspace, "hpo-layer", "HP:0001250")["candidates"][0][
                "term_id"
            ]
            == "HP:0001250"
        )


def test_invalid_embedded_ontology_does_not_publish_package_or_partial_registry(
    tmp_path,
):
    package = make_layered_package("single")
    profile = package.manifest.task_profile
    broken = b'{"graphs": []}'
    profile.ontologies.append(
        profile.ontologies[0].model_copy(
            update={
                "ontology_id": "broken",
                "sha256": hashlib.sha256(broken).hexdigest(),
                "resource_path": "ontologies/broken.json",
            }
        )
    )
    buffer = io.BytesIO()
    PackageWriter.write_to_stream(
        package,
        buffer,
        embedded_files={
            "ontologies/hp.json": (FIXTURES / "hp.json").read_bytes(),
            "ontologies/broken.json": broken,
        },
    )
    with client_at(tmp_path) as client:
        response = upload_package(
            client,
            files={"file": ("broken.zip", buffer.getvalue(), "application/zip")},
        )
        assert response.status_code == 422, response.text
        assert client.get("/api/v1/projects").json() == []
        assert not client.app.state.ontology_registry.has_ontology(
            profile.ontologies[0].sha256
        )


def test_independent_export_does_not_embed_reference_ontology(tmp_path):
    with client_at(tmp_path) as client:
        project_key = upload(client, archive("assisted", embedded=True))
        workspace = open_case(client, project_key)
        exported = workspace_export_zip(client.app, workspace["workspace_id"])
        with zipfile.ZipFile(io.BytesIO(exported)) as zipped:
            assert "ontologies/hp.json" in zipped.namelist()
            assert "ontologies/mondo.json" not in zipped.namelist()
