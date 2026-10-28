from __future__ import annotations

import io
from pathlib import Path

import pytest
from layered_fixtures import make_layered_package
from pg_harness import database_for, insert_proposal
from support.v2_exports import ExportService
from support.v2_reader import read_package
from support.v2_writer import PackageWriter

from ontotator.application.editing import (
    CheckLayerCommand,
    CreateAnnotationCommand,
    EditorService,
)
from ontotator.application.reviews import DecisionCommand, ReviewService
from ontotator.application.submissions import SubmissionService
from ontotator.application.workspaces import WorkspaceService
from ontotator.domain.annotations import AnnotationRef
from ontotator.domain.documents import Segment
from ontotator.domain.errors import DomainError
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontotator.ontology.registry import OntologyRegistry
from ontotator.storage.repository import Repository


@pytest.fixture
def test_registry(tmp_path: Path) -> OntologyRegistry:
    reg = OntologyRegistry()
    fixtures_dir = Path(__file__).parent / "fixtures"
    reg.register_path(fixtures_dir / "hp.json")
    reg.register_path(fixtures_dir / "mondo.json")
    return reg


def test_null_finding_can_be_submitted_per_layer(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("single")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-a",
        document_id="doc-alpha",
        annotator_id="dr-meier",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    # Check the single editable layer with 0 annotations (null finding)
    cmd = CheckLayerCommand(kind="check_layer", layer_id="hpo-layer", checked=True)
    env1 = MutationEnvelope(
        mutation_id="mut-check-1",
        expected_revision=0,
        payload=cmd.model_dump(),
    )
    draft1 = edit_svc.apply(ws_key, env1)
    assert draft1.checked_layer_ids == ["hpo-layer"]

    # Submit workspace
    env_sub = MutationEnvelope(
        mutation_id="mut-sub-1",
        expected_revision=1,
        payload={"document_checked": True, "command": "submit_workspace"},
    )
    sub = sub_svc.submit(ws_key, env_sub)
    assert sub.submission_id.startswith("sub-")
    assert sub.checked_layer_ids == ["hpo-layer"]
    assert len(sub.snapshots) == 0
    assert sub.scope.scope_id == ws_key.scope_id


def test_layer_checks_do_not_replace_document_confirmation(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("multi_editable")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-c",
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    # Only check layer-1
    cmd1 = CheckLayerCommand(kind="check_layer", layer_id="layer-1", checked=True)
    draft1 = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd1.model_dump()
        ),
    )
    assert draft1.checked_layer_ids == ["layer-1"]

    # Legacy layer checks alone cannot confirm the entire document
    env_sub1 = MutationEnvelope(
        mutation_id="sub1",
        expected_revision=1,
        payload={"command": "submit_workspace"},
    )
    with pytest.raises(DomainError) as exc_info:
        sub_svc.submit(ws_key, env_sub1)
    assert exc_info.value.code == "DOCUMENT_NOT_CHECKED"

    # Now check layer-2
    cmd2 = CheckLayerCommand(kind="check_layer", layer_id="layer-2", checked=True)
    draft2 = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2", expected_revision=1, payload=cmd2.model_dump()
        ),
    )
    assert set(draft2.checked_layer_ids) == {"layer-1", "layer-2"}

    # Submitting with both checked succeeds
    env_sub2 = MutationEnvelope(
        mutation_id="sub2",
        expected_revision=2,
        payload={"document_checked": True, "command": "submit_workspace"},
    )
    sub = sub_svc.submit(ws_key, env_sub2)
    assert set(sub.checked_layer_ids) == {"layer-1", "layer-2"}


def test_reference_layer_generates_no_checking_obligation(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("assisted")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-b",
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="review",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    # Check only target-layer (the single editable layer)
    cmd = CheckLayerCommand(kind="check_layer", layer_id="target-layer", checked=True)
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd.model_dump()
        ),
    )

    # Submitting succeeds without checking reference-layer
    env_sub = MutationEnvelope(
        mutation_id="sub1",
        expected_revision=1,
        payload={"document_checked": True, "command": "submit_workspace"},
    )
    sub = sub_svc.submit(ws_key, env_sub)
    assert sub.checked_layer_ids == ["target-layer"]


def test_review_mode_allows_any_number_of_source_and_target_annotations(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("assisted")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-b",
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="review",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    # Document has 2 reference annotations in reference-layer.
    # Add 1 target annotation in target-layer without any mapping to reference
    cmd = CreateAnnotationCommand(
        annotation_id="ann-new-1",
        layer_id="target-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        evidence_id="ev-new",
        segments=[Segment(start=36, end=50)],
    )
    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd.model_dump()
        ),
    )
    assert len(draft.annotations) == 1

    # Check target-layer and submit
    check_cmd = CheckLayerCommand(
        kind="check_layer", layer_id="target-layer", checked=True
    )
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2", expected_revision=1, payload=check_cmd.model_dump()
        ),
    )

    env_sub = MutationEnvelope(
        mutation_id="sub1",
        expected_revision=2,
        payload={"document_checked": True, "command": "submit_workspace"},
    )
    sub = sub_svc.submit(ws_key, env_sub)
    assert len(sub.snapshots) == 1
    assert sub.snapshots[0].annotation.term_id == "HP:0001252"


def test_required_axes_and_evidence_on_complete_enforced(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("multi_editable")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-c",
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    # Create spanless annotation on layer-2 with type-req (requires evidence on complete, and required axis 'severity')
    cmd = CreateAnnotationCommand(
        annotation_id="ann-req-1",
        note="Fixture justification; required text evidence is still missing.",
        layer_id="layer-2",
        type_id="type-req",
        term_id="MONDO:0000001",
        axes_values={"severity": "severe"},
    )
    # A new draft refuses to save it (#124) ...
    with pytest.raises(DomainError) as save_exc:
        edit_svc.apply(
            ws_key,
            MutationEnvelope(
                mutation_id="m0", expected_revision=0, payload=cmd.model_dump()
            ),
        )
    assert save_exc.value.code == "MISSING_EVIDENCE"
    # ... a legacy draft saves it, and its submission still enforces the profile.
    from sqlalchemy import update

    from ontotator.storage.tables import DraftRow

    with repo.db.transaction() as conn:
        conn.execute(update(DraftRow).values(spanless_policy_version=None))
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd.model_dump()
        ),
    )

    # Check both layers
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="layer-1", checked=True
            ).model_dump(),
        ),
    )
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m3",
            expected_revision=2,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="layer-2", checked=True
            ).model_dump(),
        ),
    )

    # Submission fails due to MISSING_EVIDENCE on type-req
    with pytest.raises(DomainError) as exc_info:
        sub_svc.submit(
            ws_key,
            MutationEnvelope(
                mutation_id="sub1",
                expected_revision=3,
                payload={"document_checked": True, "command": "submit_workspace"},
            ),
        )
    assert exc_info.value.code == "MISSING_EVIDENCE"


def test_review_replacement_must_match_target_layer_and_type(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("multi_editable")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    rev_svc = ReviewService(repo, registry=test_registry)

    # Populate a target on layer-1 (type: type-opt)
    from ontotator.domain.annotations import (
        ActorRef,
        Annotation,
        Provenance,
        snapshot,
    )

    ann_obj = Annotation(
        annotation_id="ann-target-1",
        document_id="doc-beta",
        layer_id="layer-1",
        type_id="type-opt",
        term_id="HP:0001252",
        axes_values={"certainty": "high"},
        evidence_refs=[],
        provenance=Provenance(
            actor=ActorRef(actor_id="source", kind="tool"), method="import"
        ),
    )
    snap = snapshot(ann_obj, [], pkg.documents["doc-beta"], pkg.manifest.task_profile)
    insert_proposal(repo, "pkg-scenario-c", snap)

    target = AnnotationRef(annotation_id="ann-target-1", version=snap.version)
    target_set = ReviewTargetSet.create([target])

    key = WorkspaceKey(
        project_key="pkg-scenario-c",
        document_id="doc-beta",
        annotator_id="reviewer",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ws_svc.open(key, target_set, pending_proposal_set_ids=[])
    ws_key = view.key

    # Create a draft annotation with layer-2 (type-req), trying to use it as replacement for layer-1 target
    cmd_rep = CreateAnnotationCommand(
        annotation_id="ann-rep-1",
        layer_id="layer-2",
        type_id="type-req",
        term_id="MONDO:0000001",
        axes_values={"severity": "severe"},
        evidence_id="ev-rep-1",
        segments=[Segment(start=0, end=3)],
    )
    draft1 = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd_rep.model_dump()
        ),
    )
    replacement = AnnotationRef(
        annotation_id=draft1.annotations[0].annotation.annotation_id,
        version=draft1.annotations[0].version,
    )

    # Deciding 'changed' with wrong layer/type replacement is rejected
    cmd_dec = DecisionCommand(
        target=target,
        outcome="changed",
        replacement=replacement,
    )
    with pytest.raises(DomainError) as exc_info:
        rev_svc.decide(
            ws_key,
            MutationEnvelope(
                mutation_id="dec1", expected_revision=1, payload=cmd_dec.model_dump()
            ),
        )
    assert exc_info.value.code == "REPLACEMENT_LAYER_TYPE_MISMATCH"


def test_review_decision_invalidates_only_target_layer_check(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("multi_editable")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    rev_svc = ReviewService(repo, registry=test_registry)

    # We create a target on layer-1
    from ontotator.domain.annotations import (
        ActorRef,
        Annotation,
        Provenance,
        snapshot,
    )

    ann_obj = Annotation(
        annotation_id="ann-target-1",
        document_id="doc-beta",
        layer_id="layer-1",
        type_id="type-opt",
        term_id="HP:0001252",
        axes_values={"certainty": "high"},
        evidence_refs=[],
        provenance=Provenance(
            actor=ActorRef(actor_id="source", kind="tool"), method="import"
        ),
    )
    snap = snapshot(ann_obj, [], pkg.documents["doc-beta"], pkg.manifest.task_profile)
    insert_proposal(repo, "pkg-scenario-c", snap)

    target = AnnotationRef(annotation_id="ann-target-1", version=snap.version)
    target_set = ReviewTargetSet.create([target])

    key = WorkspaceKey(
        project_key="pkg-scenario-c",
        document_id="doc-beta",
        annotator_id="reviewer",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ws_svc.open(key, target_set, pending_proposal_set_ids=[])
    ws_key = view.key

    # Check both layer-1 and layer-2
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="layer-1", checked=True
            ).model_dump(),
        ),
    )
    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="layer-2", checked=True
            ).model_dump(),
        ),
    )
    assert set(draft.checked_layer_ids) == {"layer-1", "layer-2"}

    # Now make a review decision confirming target (which is in layer-1)
    rev_svc.decide(
        ws_key,
        MutationEnvelope(
            mutation_id="dec1",
            expected_revision=2,
            payload=DecisionCommand(
                target=AnnotationRef(
                    annotation_id="ann-target-1", version=snap.version
                ),
                outcome="confirmed",
            ).model_dump(),
        ),
    )
    current_draft = repo.open_draft(ws_key)
    # layer-1 must be invalidated, while layer-2 remains checked!
    assert "layer-1" not in current_draft.checked_layer_ids
    assert "layer-2" in current_draft.checked_layer_ids


def test_reopen_workspace_after_submission_creates_new_draft_preserving_submission(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("single")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-a",
        document_id="doc-alpha",
        annotator_id="dr-meier",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=True
            ).model_dump(),
        ),
    )
    sub = sub_svc.submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub1",
            expected_revision=1,
            payload={"document_checked": True, "command": "submit_workspace"},
        ),
    )
    assert sub.draft_revision == 2

    # Reopening the workspace draft yields an editable state, historical submission is preserved
    new_draft = repo.open_draft(ws_key)
    assert new_draft.revision == sub.draft_revision
    subs = repo.get_submissions_for_workspace(ws_key)
    assert len(subs) == 1
    assert subs[0].submission_id == sub.submission_id
    assert subs[0].draft_revision == 2

    # Further edits to the workspace draft mutate the draft but do not mutate the historical submission
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=sub.draft_revision,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=False
            ).model_dump(),
        ),
    )
    draft_after = repo.open_draft(ws_key)
    assert draft_after.revision == 3
    assert draft_after.checked_layer_ids == []
    # Historical submission remains intact
    subs_after = repo.get_submissions_for_workspace(ws_key)
    assert len(subs_after) == 1
    assert subs_after[0].submission_id == sub.submission_id
    assert subs_after[0].checked_layer_ids == ["hpo-layer"]


def test_independent_export_isolation_and_hash_stability(
    tmp_path: Path, test_registry: OntologyRegistry
):
    db = database_for(tmp_path / "editor.db")
    repo = Repository(db)
    pkg = make_layered_package("assisted")
    repo.import_package(pkg)

    ws_svc = WorkspaceService(repo, test_registry)
    edit_svc = EditorService(repo, test_registry)
    sub_svc = SubmissionService(repo)
    exp_svc = ExportService(repo)

    key = WorkspaceKey(
        project_key="pkg-scenario-b",
        document_id="doc-beta",
        annotator_id="independent-user",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(key)
    ws_key = view.key

    # Annotate independently on target-layer
    cmd = CreateAnnotationCommand(
        annotation_id="ann-indep-1",
        layer_id="target-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        evidence_id="ev-indep",
        segments=[Segment(start=0, end=10)],
    )
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd.model_dump()
        ),
    )
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="target-layer", checked=True
            ).model_dump(),
        ),
    )
    _ = sub_svc.submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub1",
            expected_revision=2,
            payload={"document_checked": True, "command": "submit_workspace"},
        ),
    )

    # Export independent workspace
    exported_pkg = exp_svc.for_workspace(ws_key)

    # Strict isolation: No reference layer annotations or evidence in independent export
    assert len(exported_pkg.annotations) == 1
    snap = next(iter(exported_pkg.annotations.values()))
    assert snap.annotation.layer_id == "target-layer"
    assert snap.annotation.term_id == "HP:0001252"
    for ev in exported_pkg.evidence.values():
        assert ev.mention.evidence_id == "ev-indep"

    # Export to bytes, read back, import into clean database
    buf = io.BytesIO()
    PackageWriter.write_to_stream(exported_pkg, buf)
    buf.seek(0)
    reloaded = read_package(buf, registry=test_registry)

    db_clean = database_for(tmp_path / "clean.db")
    repo_clean = Repository(db_clean)
    imported_id = repo_clean.import_package(reloaded)
    assert imported_id == exported_pkg.manifest.package_id

    # Verify snapshot hashes in clean database match original
    imported_snaps = repo_clean.list_annotations_for_document(imported_id, "doc-beta")
    assert len(imported_snaps) == 1
    assert imported_snaps[0].version == snap.version
