"""Project rule persistence/API checks; require the coordinator's PostgreSQL token."""

import pytest
from auth_harness import upload_package
from pg_harness import count_rows
from sqlalchemy import update
from test_api import _create_sample_package_bytes
from test_editing import _setup_test_env

from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontocurator.domain.errors import DomainError
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.packages.models import ValidatedPackage
from ontocurator.storage.tables import ProjectRow

pytest_plugins = ("test_api",)


def set_rules(repo, project, **values):
    with repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow).where(ProjectRow.project_key == project).values(**values)
        )


def test_submission_is_refused_with_annotation_ids_and_draft_stays_editable(app_client):
    client, _ = app_client
    uploaded = upload_package(
        client,
        files={
            "file": ("package.zip", _create_sample_package_bytes(), "application/zip")
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    repo = client.app.state.repo
    project = "pkg-scenario-a"
    set_rules(repo, project, require_chosen_axes=True)
    request = {
        "project_key": project,
        "document_id": "doc-beta",
        "annotator_id": "annotator-1",
        "mode": "independent",
    }
    opened = client.post("/api/v1/workspaces/open", json=request)
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    created = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "create",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "missing-axis",
                "term_id": "HP:0001252",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "axes_values": {},
            },
        },
    )
    assert created.status_code == 200, created.text
    before = {
        table: count_rows(repo, table)
        for table in ("submissions", "mutation_receipts", "edit_events")
    }
    refused = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 1,
            "payload": {"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
        },
    )
    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "PROJECT_RULE_VIOLATION"
    assert {v["annotation_id"] for v in refused.json()["details"]["violations"]} == {
        "missing-axis"
    }
    assert {table: count_rows(repo, table) for table in before} == before
    resumed = client.post("/api/v1/workspaces/open", json=request).json()["view"]
    assert resumed["draft"]["revision"] == 1
    assert resumed["draft"]["checked_layer_ids"] == []
    docs = client.get(
        f"/api/v1/projects/{project}/documents",
        params={"annotator_id": "annotator-1", "mode": "independent"},
    )
    assert docs.status_code == 200, docs.text
    assert (
        next(d for d in docs.json() if d["document_id"] == "doc-beta")["status"]
        == "in_progress"
    )
    edited = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "edit-after-refusal",
            "expected_revision": 1,
            "payload": {
                "command": "set_axes",
                "annotation_id": "missing-axis",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
            },
        },
    )
    assert edited.status_code == 200, edited.text


def test_workspace_filters_nested_and_legacy_options_but_retains_current_hidden_value(
    tmp_path,
):
    repo, ontology, workspaces, editor, _ = _setup_test_env(tmp_path)
    profile = repo.get_task_profile("pkg-1")
    key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="a",
        mode="independent",
        target_set_id="targets-0",
    )
    opened = workspaces.open(key)
    editor.apply(
        opened.key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "own",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "uncertain"},
            },
        ),
    )
    set_rules(
        repo, "pkg-1", hidden_axis_values={"hpo-layer": {"assertion": ["uncertain"]}}
    )
    view = WorkspaceService(repo, ontology).open(opened.key)
    assert "uncertain" not in view.layers[0].annotation_types[0].axes[0].options
    assert "uncertain" not in view.axes_config[0].options
    assert "uncertain" not in repo.get_axes_config("pkg-1").axes[0].options
    assert view.draft.annotations[0].annotation.axes_values == {
        "assertion": "uncertain"
    }
    assert repo.get_task_profile("pkg-1") == profile
    with pytest.raises(DomainError) as exc:
        SubmissionService(repo).submit(
            opened.key,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=1,
                payload={"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
            ),
        )
    assert exc.value.code == "PROJECT_RULE_VIOLATION"


def test_real_adopt_edit_confirm_submit_export_preserves_basis_and_blocks_bypass(
    tmp_path,
):
    from support.v2_exports import ExportService

    repo, ontology, workspaces, editor, doc = _setup_test_env(tmp_path)
    profile = repo.get_task_profile("pkg-1")
    source = snapshot(
        Annotation(
            annotation_id="source",
            document_id=doc.document_id,
            layer_id="hpo-layer",
            type_id="phenotype",
            term_id="HP:0001252",
            axes_values={"assertion": "present"},
            axes_defaulted=["assertion"],
            provenance=Provenance(
                actor=ActorRef(actor_id="tool", kind="tool"), method="import"
            ),
        ),
        [],
        doc,
        profile,
    )
    package = ValidatedPackage(
        manifest=repo.get_manifest("pkg-1").model_copy(
            update={"package_id": "basis-project"}
        ),
        documents={doc.document_id: doc},
        annotations={("source", source.version): source},
    )
    repo.import_package(package)
    set_rules(repo, "basis-project", require_chosen_axes=True)
    target = AnnotationRef(annotation_id="source", version=source.version)
    targets = ReviewTargetSet.create([target])
    view = workspaces.open(
        WorkspaceKey(
            project_key="basis-project",
            document_id=doc.document_id,
            annotator_id="reviewer",
            mode="review",
            target_set_id=targets.target_set_id,
        ),
        targets,
    )

    def apply(revision, **payload):
        return editor.apply(
            view.key,
            MutationEnvelope(
                mutation_id=f"edit-{revision}",
                expected_revision=revision,
                payload=payload,
            ),
        )

    draft = apply(
        0,
        command="create_annotation",
        annotation_id="copy",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        source_annotation_id="source",
        source_version=source.version,
    )
    assert draft.annotations[0].annotation.axes_defaulted == ["assertion"]
    draft = apply(1, command="set_term", annotation_id="copy", term_id="HP:0001250")
    draft = apply(
        2,
        command="set_axes",
        annotation_id="copy",
        axes_values={"assertion": "present"},
    )
    assert draft.annotations[0].annotation.axes_defaulted == ["assertion"]
    draft = ReviewService(repo, ontology).decide(
        view.key,
        MutationEnvelope(
            mutation_id="changed",
            expected_revision=3,
            payload={
                "target": target.model_dump(),
                "outcome": "changed",
                "replacement": {
                    "annotation_id": "copy",
                    "version": draft.annotations[0].version,
                },
            },
        ),
    )
    service = SubmissionService(repo)
    with pytest.raises(DomainError) as exc:
        service.submit(
            view.key,
            MutationEnvelope(
                mutation_id="blocked",
                expected_revision=4,
                payload={"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
            ),
        )
    assert exc.value.code == "PROJECT_RULE_VIOLATION"
    assert repo.open_draft(view.key).revision == 4
    draft = apply(
        4,
        command="set_axes",
        annotation_id="copy",
        axes_values={"assertion": "present"},
        chosen_axis_ids=["assertion"],
    )
    assert draft.annotations[0].annotation.axes_defaulted == []
    # A content change invalidates the previous approval. The editor records
    # a fresh changed decision against the exact confirmed snapshot.
    assert draft.decisions == []
    draft = ReviewService(repo, ontology).decide(
        view.key,
        MutationEnvelope(
            mutation_id="confirmed-replacement",
            expected_revision=5,
            payload={
                "target": target.model_dump(),
                "outcome": "changed",
                "replacement": {
                    "annotation_id": "copy",
                    "version": draft.annotations[0].version,
                },
            },
        ),
    )
    assert draft.decisions[0].replacement.version == draft.annotations[0].version
    submitted = service.submit(
        view.key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=6,
            payload={"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
        ),
    )
    assert submitted.snapshots[0].annotation.axes_defaulted == []
    exported = ExportService(repo).for_workspace(view.key)
    assert exported.annotations[
        ("source", source.version)
    ].annotation.axes_defaulted == ["assertion"]
    assert (
        exported.annotations[
            ("copy", draft.annotations[0].version)
        ].annotation.axes_defaulted
        == []
    )
