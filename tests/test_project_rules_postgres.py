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
                "note": "Document-level finding",
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
                "note": "Document-level finding",
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


@pytest.mark.parametrize("required_reason", [True, False])
def test_real_adopt_edit_confirm_submit_export_preserves_basis_and_blocks_bypass(
    tmp_path,
    required_reason,
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
    set_rules(
        repo,
        "basis-project",
        require_chosen_axes=True,
        require_spanless_note=required_reason,
    )
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
        pending_proposal_set_ids=[],
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
        note="Reviewer finding inferred from the complete document"
        if required_reason
        else None,
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


def test_new_draft_spanless_writes_are_transactional_and_setting_applies(tmp_path):
    from sqlalchemy import select

    from ontocurator.storage.tables import DraftRow

    repo, _, ws, editor, _ = _setup_test_env(tmp_path)
    key = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    assert ws.open(key).enforce_spanless_rules is True
    payload = {
        "command": "create_annotation",
        "annotation_id": "a",
        "term_id": "HP:0001252",
    }
    before = {
        table: count_rows(repo, table)
        for table in ("annotation_snapshots", "mutation_receipts", "edit_events")
    }
    for note in (None, "   "):
        with pytest.raises(DomainError) as exc:
            editor.apply(
                key,
                MutationEnvelope(
                    mutation_id="bad",
                    expected_revision=0,
                    payload={**payload, "note": note},
                ),
            )
        assert exc.value.code == "PROJECT_RULE_VIOLATION"
        assert exc.value.details["violations"][0]["rule"] == "spanless_note_required"
        assert ws.open(key).draft.revision == 0
        assert {table: count_rows(repo, table) for table in before} == before
    good = MutationEnvelope(
        mutation_id="good", expected_revision=0, payload={**payload, "note": "Reason"}
    )
    editor.apply(key, good)
    set_rules(repo, "pkg-1", allow_spanless_findings=False)
    assert editor.apply(key, good).revision == 1
    with pytest.raises(DomainError) as exc:
        editor.apply(
            key,
            MutationEnvelope(
                mutation_id="disabled",
                expected_revision=1,
                payload={
                    "command": "set_annotation_note",
                    "annotation_id": "a",
                    "note": "Another",
                },
            ),
        )
    assert exc.value.details["violations"][0]["rule"] == "spanless_disallowed"
    with repo.db.transaction() as conn:
        assert conn.execute(select(DraftRow.spanless_policy_version)).scalar_one() == 1


def test_legacy_draft_keeps_edit_marker_but_submits_under_current_spanless_policy(
    tmp_path,
):
    from ontocurator.storage.tables import DraftRow

    repo, _, ws, editor, _ = _setup_test_env(tmp_path)
    key = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    with repo.db.transaction() as conn:
        conn.execute(update(DraftRow).values(spanless_policy_version=None))
    assert ws.open(key).enforce_spanless_rules is False
    set_rules(repo, "pkg-1", allow_spanless_findings=False)
    result = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="legacy",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
            },
        ),
    )
    assert result.annotations[0].annotation.note is None
    assert result.spanless_policy_version is None
    assert ws.open(key).draft.spanless_policy_version is None
    original = result.annotations[0]
    with pytest.raises(DomainError) as exc:
        SubmissionService(repo).submit(
            key,
            MutationEnvelope(
                mutation_id="legacy-submit-prohibited",
                expected_revision=1,
                payload={"document_checked": True},
            ),
        )
    assert exc.value.code == "PROJECT_RULE_VIOLATION"
    assert exc.value.details["violations"] == [
        {"annotation_id": "a", "rule": "spanless_disallowed", "detail": {}}
    ]
    unchanged = ws.open(key).draft
    assert unchanged.revision == 1
    assert unchanged.spanless_policy_version is None
    assert unchanged.annotations == [original]
    assert repo.get_submissions_for_workspace(key) == []

    set_rules(repo, "pkg-1", allow_spanless_findings=True, require_spanless_note=False)
    submitted = SubmissionService(repo).submit(
        key,
        MutationEnvelope(
            mutation_id="legacy-submit-optional",
            expected_revision=1,
            payload={"document_checked": True},
        ),
    )
    assert submitted.snapshots == [original]
    assert submitted.snapshots[0].annotation.note is None
    assert ws.open(key).draft.spanless_policy_version is None


def test_client_cannot_override_new_draft_policy(tmp_path):
    from pydantic import ValidationError

    _, _, ws, editor, _ = _setup_test_env(tmp_path)
    key = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    with pytest.raises(ValidationError):
        editor.apply(
            key,
            MutationEnvelope(
                mutation_id="override",
                expected_revision=0,
                payload={
                    "command": "create_annotation",
                    "annotation_id": "a",
                    "term_id": "HP:0001252",
                    "spanless_policy_version": None,
                },
            ),
        )
    assert ws.open(key).enforce_spanless_rules is True


def test_remove_last_mention_and_clear_spanless_note_are_rejected_without_revision(
    tmp_path,
):
    _, _, ws, editor, _ = _setup_test_env(tmp_path)
    key = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    created = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "evidence_id": "ev",
                "segments": [{"start": 27, "end": 36}],
            },
        ),
    )
    with pytest.raises(DomainError):
        editor.apply(
            key,
            MutationEnvelope(
                mutation_id="detach",
                expected_revision=1,
                payload={
                    "command": "detach_mention",
                    "annotation_id": "a",
                    "evidence_id": "ev",
                },
            ),
        )
    assert ws.open(key).draft.annotations == created.annotations
    editor.apply(
        key,
        MutationEnvelope(
            mutation_id="note",
            expected_revision=1,
            payload={
                "command": "set_annotation_note",
                "annotation_id": "a",
                "note": "Reason",
            },
        ),
    )
    detached = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="detach-good",
            expected_revision=2,
            payload={
                "command": "detach_mention",
                "annotation_id": "a",
                "evidence_id": "ev",
            },
        ),
    )
    assert detached.annotations[0].annotation.evidence_refs == []
    with pytest.raises(DomainError):
        editor.apply(
            key,
            MutationEnvelope(
                mutation_id="clear",
                expected_revision=3,
                payload={
                    "command": "set_annotation_note",
                    "annotation_id": "a",
                    "note": "  ",
                },
            ),
        )
    assert ws.open(key).draft.revision == 3
    assert ws.open(key).draft.annotations == detached.annotations


def test_new_draft_restores_historical_snapshot_without_rewriting_then_requires_note(
    tmp_path,
):
    from ontocurator.domain.scopes import build_scope
    from ontocurator.domain.serialization import encode_snapshot
    from ontocurator.domain.workspace import Submission
    from ontocurator.storage.repository import _key_str

    repo, _, ws, editor, doc = _setup_test_env(tmp_path)
    profile = repo.get_task_profile("pkg-1")
    key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        scope_id=build_scope(profile, "independent").scope_id,
        target_set_id="targets-0",
    )
    historical = snapshot(
        Annotation(
            annotation_id="old",
            document_id="doc-1",
            term_id="HP:0001252",
            provenance=Provenance(
                actor=ActorRef(actor_id="annotator-1", kind="human"), method="manual"
            ),
        ),
        [],
        doc,
        profile,
    )
    raw = encode_snapshot(historical)
    submission = Submission(
        submission_id="historical",
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=4,
        snapshots=[historical],
        decisions=[],
        created_at="2026-10-01T00:00:00Z",
    )
    with repo.db.transaction() as conn:
        project_id = repo._require_project(conn, "pkg-1")
        repo._insert_submission(
            conn, project_id, submission, local_key=_key_str(key), imported=True
        )
    restored = ws.open(key)
    assert restored.draft.spanless_policy_version == 1
    assert encode_snapshot(restored.draft.annotations[0]) == raw
    with pytest.raises(DomainError) as exc:
        SubmissionService(repo).submit(
            key,
            MutationEnvelope(
                mutation_id="invalid-submit",
                expected_revision=4,
                payload={"document_checked": True},
            ),
        )
    assert exc.value.details["violations"][0]["rule"] == "spanless_note_required"
    corrected = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="justify",
            expected_revision=4,
            payload={
                "command": "set_annotation_note",
                "annotation_id": "old",
                "note": "Reason",
            },
        ),
    )
    assert corrected.annotations[0].version != historical.version
    assert (
        repo.get_submissions_for_workspace(key)[0].snapshots[0].version
        == historical.version
    )
    SubmissionService(repo).submit(
        key,
        MutationEnvelope(
            mutation_id="valid-submit",
            expected_revision=5,
            payload={"document_checked": True},
        ),
    )


def test_export_content_freezes_exact_proposal_notes_without_changing_imported_snapshot(
    tmp_path,
):
    from pg_harness import insert_proposal

    from ontocurator.storage.tables import ProposalAnnotationRow

    repo, _, ws, editor, _ = _setup_test_env(tmp_path)
    key = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    draft = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="source",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "source",
                "term_id": "HP:0001252",
                "note": "Reason",
            },
        ),
    )
    source = draft.annotations[0]
    insert_proposal(repo, "pkg-1", source)
    with repo.db.transaction() as conn:
        conn.execute(update(ProposalAnnotationRow).values(notes=["first", "second"]))
    frozen = repo.t1_export_content("pkg-1")
    assert frozen.proposal_notes[("source", source.version)] == ["first", "second"]
    with repo.db.transaction() as conn:
        conn.execute(update(ProposalAnnotationRow).values(notes=["later"]))
    assert frozen.proposal_notes[("source", source.version)] == ["first", "second"]
    assert frozen.proposals[("source", source.version)] == source


def test_historical_receipt_replay_cannot_downgrade_persisted_draft_policy(tmp_path):
    from datetime import UTC, datetime

    from sqlalchemy import insert

    from ontocurator.domain.canonical import canonical_hash
    from ontocurator.storage.repository import _key_str
    from ontocurator.storage.tables import MutationReceiptRow

    repo, _, ws, editor, _ = _setup_test_env(tmp_path)
    opened = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    key = opened.key
    envelope = MutationEnvelope(
        mutation_id="historical-replay",
        expected_revision=0,
        payload={
            "command": "create_annotation",
            "annotation_id": "a",
            "term_id": "HP:0001252",
        },
    )
    historical_response = opened.draft.model_dump(mode="json")
    historical_response.pop("spanless_policy_version")
    with repo.db.transaction() as conn:
        project_id = repo._require_project(conn, "pkg-1")
        conn.execute(
            insert(MutationReceiptRow).values(
                project_id=project_id,
                workspace_key=_key_str(key),
                mutation_id=envelope.mutation_id,
                request_hash=canonical_hash(envelope.model_dump()),
                response=historical_response,
                created_at=datetime.now(UTC),
            )
        )
    replayed = editor.apply(key, envelope)
    assert replayed.spanless_policy_version is None
    assert ws.open(key).draft.spanless_policy_version == 1
    with pytest.raises(DomainError) as exc:
        editor.apply(key, envelope.model_copy(update={"mutation_id": "fresh"}))
    assert exc.value.details["violations"][0]["rule"] == "spanless_note_required"


@pytest.mark.parametrize("initial_note", [None, "   ", "Optional reason"])
def test_optional_spanless_reason_create_edit_clear_detach_and_submit(
    tmp_path, initial_note
):
    from support.v2_exports import ExportService

    repo, _, ws, editor, _ = _setup_test_env(tmp_path)
    set_rules(repo, "pkg-1", require_spanless_note=False)
    view = ws.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="a",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    assert view.require_spanless_note is False
    assert view.enforce_spanless_rules is True

    def apply(revision, payload):
        return editor.apply(
            view.key,
            MutationEnvelope(
                mutation_id=f"optional-{revision}",
                expected_revision=revision,
                payload=payload,
            ),
        )

    created = apply(
        0,
        {
            "command": "create_annotation",
            "annotation_id": "a",
            "term_id": "HP:0001252",
            "note": initial_note,
        },
    )
    edited = apply(
        1,
        {
            "command": "set_annotation_note",
            "annotation_id": "a",
            "note": "Recorded optional reason",
        },
    )
    assert edited.annotations[0].annotation.note == "Recorded optional reason"
    assert edited.annotations[0].version != created.annotations[0].version
    cleared = apply(
        2, {"command": "set_annotation_note", "annotation_id": "a", "note": "   "}
    )
    assert not (cleared.annotations[0].annotation.note or "").strip()
    apply(
        3,
        {
            "command": "create_annotation",
            "annotation_id": "b",
            "term_id": "HP:0001252",
            "evidence_id": "ev",
            "segments": [{"start": 27, "end": 36}],
        },
    )
    detached = apply(
        4, {"command": "detach_mention", "annotation_id": "b", "evidence_id": "ev"}
    )
    assert all(not item.annotation.evidence_refs for item in detached.annotations)
    apply(
        5,
        {
            "command": "set_annotation_note",
            "annotation_id": "b",
            "note": "Preserved optional reason",
        },
    )
    submitted = SubmissionService(repo).submit(
        view.key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=6,
            payload={"document_checked": True},
        ),
    )
    notes = {
        item.annotation.annotation_id: item.annotation.note
        for item in submitted.snapshots
    }
    assert not (notes["a"] or "").strip()
    assert notes["b"] == "Preserved optional reason"
    exported = ExportService(repo).for_workspace(view.key)
    assert any(
        item.annotation.note == "Preserved optional reason"
        for item in exported.annotations.values()
    )
