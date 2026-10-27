from pathlib import Path

import pytest
from layered_fixtures import make_layered_package
from pg_harness import database_for

from ontotator.application.editing import (
    CheckLayerCommand,
    CreateAnnotationCommand,
    EditingService,
    EditMentionCommand,
    SetAxesCommand,
)
from ontotator.application.workspaces import WorkspaceService
from ontotator.domain.documents import Segment
from ontotator.domain.errors import DomainError, RevisionConflict
from ontotator.domain.scopes import build_scope
from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontotator.ontology.registry import OntologyRegistry
from ontotator.storage.repository import Repository


def _setup_registry_for_package(pkg) -> OntologyRegistry:
    registry = OntologyRegistry()
    for ont in pkg.manifest.task_profile.ontologies:
        if ont.ontology_id == "hp":
            registry.register(Path("tests/fixtures/hp.json"), ont)
        elif ont.ontology_id in ("mondo", "ext"):
            registry.register(Path("tests/fixtures/mondo.json"), ont)
    return registry


def test_task_scope_construction() -> None:
    pkg_a = make_layered_package("single")
    scope_a = build_scope(pkg_a.manifest.task_profile, "independent")
    assert scope_a.mode == "independent"
    assert scope_a.editable_layer_ids == ["hpo-layer"]
    assert scope_a.reference_layer_ids == []
    assert scope_a.scope_id != ""

    pkg_b = make_layered_package("assisted")
    # In independent mode: reference layers are excluded
    scope_b_indep = build_scope(pkg_b.manifest.task_profile, "independent")
    assert scope_b_indep.editable_layer_ids == ["target-layer"]
    assert scope_b_indep.reference_layer_ids == []

    # In review mode: reference layers are populated
    scope_b_review = build_scope(pkg_b.manifest.task_profile, "review")
    assert scope_b_review.editable_layer_ids == ["target-layer"]
    assert scope_b_review.reference_layer_ids == ["reference-layer"]

    pkg_c = make_layered_package("multi_editable")
    scope_c = build_scope(pkg_c.manifest.task_profile, "independent")
    assert scope_c.editable_layer_ids == ["layer-1", "layer-2"]
    assert scope_c.reference_layer_ids == []


def test_independent_view_contains_no_imported_annotations_or_term_statuses(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg_b = make_layered_package("assisted")
    repo.import_package(pkg_b)

    registry = _setup_registry_for_package(pkg_b)
    ws_service = WorkspaceService(repo, registry)

    scope = build_scope(pkg_b.manifest.task_profile, "independent")
    key = WorkspaceKey(
        project_key=pkg_b.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        scope_id=scope.scope_id,
        target_set_id="targets-0",
    )
    view = ws_service.open(key)
    assert view.available_inputs == []
    assert view.term_statuses == {}


def test_editing_rejects_foreign_scope(tmp_path: Path) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg = make_layered_package("single")
    repo.import_package(pkg)

    registry = _setup_registry_for_package(pkg)
    ws_service = WorkspaceService(repo, registry)

    key = WorkspaceKey(
        project_key=pkg.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        scope_id="foreign-fake-scope",
        target_set_id="targets-0",
    )
    with pytest.raises(DomainError) as exc_info:
        ws_service.open(key)
    assert exc_info.value.code == "INVALID_SCOPE"


def test_editing_rejects_mutation_on_reference_layer(tmp_path: Path) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg = make_layered_package("assisted")
    repo.import_package(pkg)

    registry = _setup_registry_for_package(pkg)
    editing_service = EditingService(repo, registry)

    scope = build_scope(pkg.manifest.task_profile, "review")
    key = WorkspaceKey(
        project_key=pkg.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="review",
        scope_id=scope.scope_id,
        target_set_id="targets-0",
    )
    repo.open_draft(key)

    cmd = CreateAnnotationCommand(
        annotation_id="ann-new",
        layer_id="reference-layer",  # Reference-only layer!
        type_id="disease",
        term_id="MONDO:0000001",
        axes_values={},
        segments=[],
    )
    envelope = MutationEnvelope(
        mutation_id="mut-1",
        expected_revision=0,
        payload=cmd.model_dump(),
    )
    with pytest.raises(DomainError) as exc_info:
        editing_service.apply_edit(key, envelope)
    assert exc_info.value.code in ("REFERENCE_LAYER_READ_ONLY", "INVALID_LAYER")


def test_editing_rejects_invalid_layer_or_type(tmp_path: Path) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg = make_layered_package("single")
    repo.import_package(pkg)

    registry = _setup_registry_for_package(pkg)
    editing_service = EditingService(repo, registry)

    scope = build_scope(pkg.manifest.task_profile, "independent")
    key = WorkspaceKey(
        project_key=pkg.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        scope_id=scope.scope_id,
        target_set_id="targets-0",
    )
    repo.open_draft(key)

    # 1. Unknown layer
    cmd_bad_layer = CreateAnnotationCommand(
        annotation_id="ann-new",
        layer_id="nonexistent-layer",
        type_id="phenotype",
        term_id="HP:0001252",
    )
    with pytest.raises(DomainError) as exc_info:
        editing_service.apply_edit(
            key,
            MutationEnvelope(
                mutation_id="m1",
                expected_revision=0,
                payload=cmd_bad_layer.model_dump(),
            ),
        )
    assert exc_info.value.code in ("UNKNOWN_LAYER", "INVALID_LAYER")

    # 2. Unknown type for valid layer
    cmd_bad_type = CreateAnnotationCommand(
        annotation_id="ann-new",
        layer_id="hpo-layer",
        type_id="nonexistent-type",
        term_id="HP:0001252",
    )
    with pytest.raises(DomainError) as exc_info:
        editing_service.apply_edit(
            key,
            MutationEnvelope(
                mutation_id="m2", expected_revision=0, payload=cmd_bad_type.model_dump()
            ),
        )
    assert exc_info.value.code in ("UNKNOWN_TYPE", "INVALID_TYPE", "INVALID_ANNOTATION")


def test_copy_on_write_evidence_leaves_source_intact(tmp_path: Path) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg = make_layered_package("single")
    repo.import_package(pkg)

    registry = _setup_registry_for_package(pkg)
    editing_service = EditingService(repo, registry)

    scope = build_scope(pkg.manifest.task_profile, "independent")
    key = WorkspaceKey(
        project_key=pkg.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        scope_id=scope.scope_id,
        target_set_id="targets-0",
    )
    repo.open_draft(key)

    # Create annotation 1 with evidence
    cmd1 = CreateAnnotationCommand(
        annotation_id="ann-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        evidence_id="ev-shared",
        segments=[Segment(start=24, end=33)],  # "Epilepsie"
    )
    draft1 = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd1.model_dump()
        ),
    )
    ev_initial = draft1.evidence[0]
    assert ev_initial.mention.segments[0].start == 24

    # Create annotation 2 sharing the same evidence
    cmd2 = CreateAnnotationCommand(
        annotation_id="ann-2",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        evidence_id="ev-shared",
        segments=[Segment(start=24, end=33)],
    )
    _ = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m2", expected_revision=1, payload=cmd2.model_dump()
        ),
    )

    # Now edit mention specifically for ann-1
    cmd_edit = EditMentionCommand(
        evidence_id="ev-shared",
        annotation_id="ann-1",
        segments=[Segment(start=24, end=38)],
    )
    draft3 = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m3", expected_revision=2, payload=cmd_edit.model_dump()
        ),
    )

    # Check that ann-2 still references the original evidence
    snap_ann2 = next(
        s for s in draft3.annotations if s.annotation.annotation_id == "ann-2"
    )
    snap_ann1 = next(
        s for s in draft3.annotations if s.annotation.annotation_id == "ann-1"
    )
    assert snap_ann2.annotation.evidence_refs[0].version == ev_initial.version
    assert snap_ann1.annotation.evidence_refs[0].version != ev_initial.version


def test_check_layer_command_and_invalidation(tmp_path: Path) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg = make_layered_package("multi_editable")
    repo.import_package(pkg)

    registry = _setup_registry_for_package(pkg)
    editing_service = EditingService(repo, registry)

    scope = build_scope(pkg.manifest.task_profile, "independent")
    key = WorkspaceKey(
        project_key=pkg.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        scope_id=scope.scope_id,
        target_set_id="targets-0",
    )
    repo.open_draft(key)

    # 1. Create an annotation in layer-1
    cmd_create = CreateAnnotationCommand(
        note="Finding inferred from the complete document",
        annotation_id="ann-hp-1",
        layer_id="layer-1",
        type_id="type-opt",
        term_id="HP:0001252",
        axes_values={"certainty": "high"},
    )
    draft = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m1", expected_revision=0, payload=cmd_create.model_dump()
        ),
    )
    assert draft.checked_layer_ids == []

    # 2. Check layer-1
    cmd_chk1 = CheckLayerCommand(layer_id="layer-1", checked=True)
    draft = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m2", expected_revision=1, payload=cmd_chk1.model_dump()
        ),
    )
    assert draft.checked_layer_ids == ["layer-1"]

    # 3. Check layer-2
    cmd_chk2 = CheckLayerCommand(layer_id="layer-2", checked=True)
    draft = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m3", expected_revision=2, payload=cmd_chk2.model_dump()
        ),
    )
    assert set(draft.checked_layer_ids) == {"layer-1", "layer-2"}

    # 4. Invalidate only layer-1 by editing an annotation in layer-1
    cmd_set_axes = SetAxesCommand(
        annotation_id="ann-hp-1",
        axes_values={"certainty": "low"},
    )
    draft = editing_service.apply_edit(
        key,
        MutationEnvelope(
            mutation_id="m4", expected_revision=3, payload=cmd_set_axes.model_dump()
        ),
    )
    # layer-1 check removed, layer-2 check PRESERVED!
    assert draft.checked_layer_ids == ["layer-2"]


def test_retry_with_lost_response_and_competing_browser_revisions(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "test.db")
    repo = Repository(db)
    pkg = make_layered_package("single")
    repo.import_package(pkg)

    registry = _setup_registry_for_package(pkg)
    editing_service = EditingService(repo, registry)

    scope = build_scope(pkg.manifest.task_profile, "independent")
    key = WorkspaceKey(
        project_key=pkg.manifest.package_id,
        document_id="doc-beta",
        annotator_id="dr-meier",
        mode="independent",
        scope_id=scope.scope_id,
        target_set_id="targets-0",
    )
    repo.open_draft(key)

    # 1. Client A executes mutation 1 with expected_revision=0
    cmd_1 = CreateAnnotationCommand(
        note="Finding inferred from the complete document",
        annotation_id="ann-a",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
    )
    env_1 = MutationEnvelope(
        mutation_id="mut-client-a",
        expected_revision=0,
        payload=cmd_1.model_dump(),
    )
    draft_a = editing_service.apply_edit(key, env_1)
    assert draft_a.revision == 1

    # 2. Lost response retry: Client A retries exact same mutation envelope
    draft_retry = editing_service.apply_edit(key, env_1)
    assert draft_retry.revision == 1
    assert [a.annotation.annotation_id for a in draft_retry.annotations] == ["ann-a"]

    # 3. Competing Client B with stale revision=0 tries to submit mutation
    cmd_b = CreateAnnotationCommand(
        note="Finding inferred from the complete document",
        annotation_id="ann-b",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
    )
    env_b_stale = MutationEnvelope(
        mutation_id="mut-client-b",
        expected_revision=0,  # Stale!
        payload=cmd_b.model_dump(),
    )
    with pytest.raises(RevisionConflict):
        editing_service.apply_edit(key, env_b_stale)

    # 4. Client B updates expected_revision to 1 and retries
    env_b_updated = MutationEnvelope(
        mutation_id="mut-client-b",
        expected_revision=1,
        payload=cmd_b.model_dump(),
    )
    draft_b = editing_service.apply_edit(key, env_b_updated)
    assert draft_b.revision == 2
    assert len(draft_b.annotations) == 2
