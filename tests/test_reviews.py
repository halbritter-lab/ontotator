import hashlib
from pathlib import Path

import pytest
from pg_harness import database_for
from support.v2_exports import ExportService

from ontocurator.application.editing import CreateAnnotationCommand, EditorService
from ontocurator.application.reviews import DecisionCommand, ReviewService
from ontocurator.application.submissions import SubmissionService, SubmitCommand
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    OntologyRef,
    Segment,
)
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.review import ReviewOutcome, ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.ontology.service import OntologyService
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.storage.repository import Repository

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_service() -> OntologyService:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    ref = OntologyRef(release="2026-06-23", sha256=digest)
    return OntologyService.load(FIXTURE_PATH, ref)


def _setup_review_test_env(tmp_path: Path):
    db_path = tmp_path / "test.db"
    db = database_for(db_path)
    repo = Repository(db)
    ontology = _make_ontology_service()
    workspace_service = WorkspaceService(repo, ontology)
    editor_service = EditorService(repo, ontology)
    review_service = ReviewService(repo, ontology)
    submission_service = SubmissionService(repo)
    export_service = ExportService(repo)

    text = "The patient showed severe hypotonia and seizure activity."
    text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(
        document_id="doc-1",
        text=text,
        language="en",
        text_sha256=text_digest,
    )

    from ontocurator.domain.profiles import (
        AnnotationTypeDefinition,
        AxisDefinition,
        LayerDefinition,
        OntologyDefinition,
        TaskProfile,
        profile_hash,
    )

    hp_ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release="2026-06-23",
        sha256=ontology.ref.sha256,
        format="obo-graph-json",
    )
    pheno_type = AnnotationTypeDefinition(
        type_id="phenotype",
        label="Phenotype",
        axes=[
            AxisDefinition(
                id="assertion",
                label="Assertion",
                options=["present", "absent", "uncertain"],
                allow_empty=True,
            )
        ],
        evidence_policy="optional",
    )
    layer = LayerDefinition(
        layer_id="hpo-layer",
        label="Phenotypes",
        ontology_id="hp",
        access="editable",
        default_visible=True,
        default_type_id="phenotype",
        annotation_types=[pheno_type],
    )
    profile = TaskProfile(
        profile_id="hpo-context-example/v1",
        version="1.0.0",
        ontologies=[hp_ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )

    # 1. Proposal A (human): Hypotonia (HP:0001252)
    from ontocurator.domain.documents import EvidenceSnapshot

    ev_a = EvidenceSnapshot.create(
        EvidenceMention(
            evidence_id="ev-a",
            segments=[Segment(start=27, end=36)],
        ),
        doc,
    )
    ann_a = Annotation(
        annotation_id="prop-human",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-a", version=ev_a.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap_a = snapshot(ann_a, [ev_a], doc, profile)

    # 2. Proposal B (tool): Seizure (HP:0001250)
    ev_b = EvidenceSnapshot.create(
        EvidenceMention(
            evidence_id="ev-b",
            segments=[Segment(start=41, end=48)],
        ),
        doc,
    )
    ann_b = Annotation(
        annotation_id="prop-tool",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-b", version=ev_b.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="ner-v1", kind="tool"),
            method="spacy_ner",
        ),
    )
    snap_b = snapshot(ann_b, [ev_b], doc, profile)

    # 3. Proposal C (obsolete term): HP:0000123
    ann_c = Annotation(
        annotation_id="prop-obs",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0000123",
        axes_values={},
        evidence_refs=[],
        provenance=Provenance(
            actor=ActorRef(actor_id="tool-old", kind="tool"),
            method="old",
        ),
    )
    snap_c = snapshot(ann_c, [], doc, profile)

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            format_version="ontocurator-work-package/v2",
            package_id="pkg-rev-1",
            created_at="2026-10-01T00:00:00Z",
            document_order=["doc-1"],
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
        ),
        documents={"doc-1": doc},
        annotations={
            (snap_a.annotation.annotation_id, snap_a.version): snap_a,
            (snap_b.annotation.annotation_id, snap_b.version): snap_b,
            (snap_c.annotation.annotation_id, snap_c.version): snap_c,
        },
        evidence={
            (ev_a.mention.evidence_id, ev_a.version): ev_a,
            (ev_b.mention.evidence_id, ev_b.version): ev_b,
        },
    )
    repo.import_package(pkg)
    return {
        "repo": repo,
        "ontology": ontology,
        "ws_svc": workspace_service,
        "edit_svc": editor_service,
        "rev_svc": review_service,
        "sub_svc": submission_service,
        "exp_svc": export_service,
        "doc": doc,
        "snap_a": snap_a,
        "snap_b": snap_b,
        "snap_c": snap_c,
        "profile": profile,
    }


@pytest.mark.parametrize(
    "prop_key,outcome",
    [
        ("snap_a", "confirmed"),
        ("snap_a", "rejected"),
        ("snap_a", "uncertain"),
        ("snap_b", "confirmed"),
        ("snap_b", "rejected"),
        ("snap_b", "uncertain"),
    ],
)
def test_review_decisions_for_human_and_tool_proposals(
    tmp_path: Path, prop_key: str, outcome: ReviewOutcome
):
    ctx = _setup_review_test_env(tmp_path)
    target_snap = ctx[prop_key]
    target_ref = AnnotationRef(
        annotation_id=target_snap.annotation.annotation_id,
        version=target_snap.version,
    )
    target_set = ReviewTargetSet.create([target_ref])

    ws_key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="reviewer-1",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ctx["ws_svc"].open(ws_key, target_set)
    ws_key = view.key

    cmd = DecisionCommand(
        target=target_ref,
        outcome=outcome,
        replacement=None,
        note=f"Review decision: {outcome}",
    )
    draft = ctx["rev_svc"].decide(
        ws_key,
        MutationEnvelope(
            mutation_id="m-dec-1",
            expected_revision=0,
            payload=cmd.model_dump(),
        ),
    )
    assert len(draft.decisions) == 1
    dec = draft.decisions[0]
    assert dec.outcome == outcome
    assert dec.replacement is None


def test_review_decision_can_be_cleared_to_offen(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    target_snap = ctx["snap_a"]
    target_ref = AnnotationRef(
        annotation_id=target_snap.annotation.annotation_id,
        version=target_snap.version,
    )
    target_set = ReviewTargetSet.create([target_ref])

    ws_key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="reviewer-1",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ctx["ws_svc"].open(ws_key, target_set)
    ws_key = view.key

    # 1. Record decision
    cmd = DecisionCommand(
        target=target_ref,
        outcome="confirmed",
        replacement=None,
        note="Confirmed proposal",
    )
    draft1 = ctx["rev_svc"].decide(
        ws_key,
        MutationEnvelope(
            mutation_id="m-dec-1",
            expected_revision=0,
            payload=cmd.model_dump(),
        ),
    )
    assert len(draft1.decisions) == 1
    assert draft1.decisions[0].outcome == "confirmed"

    # 2. Mark layer checked
    from ontocurator.application.editing import CheckLayerCommand

    ctx["edit_svc"].apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m-chk",
            expected_revision=1,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=True
            ).model_dump(),
        ),
    )

    # 3. Clearing with replacement raises error
    with pytest.raises(DomainError, match="UNEXPECTED_REPLACEMENT"):
        ctx["rev_svc"].decide(
            ws_key,
            MutationEnvelope(
                mutation_id="m-dec-bad",
                expected_revision=2,
                payload=DecisionCommand(
                    target=target_ref,
                    outcome=None,
                    replacement=target_ref,
                ).model_dump(),
            ),
        )

    # 4. Clear decision by sending outcome=None, invalidates layer check
    cmd_clear = DecisionCommand(
        target=target_ref,
        outcome=None,
    )
    draft2 = ctx["rev_svc"].decide(
        ws_key,
        MutationEnvelope(
            mutation_id="m-dec-2",
            expected_revision=2,
            payload=cmd_clear.model_dump(),
        ),
    )
    assert len(draft2.decisions) == 0
    assert draft2.decisions == []
    assert "hpo-layer" not in draft2.checked_layer_ids


def test_review_decision_changed_requires_and_binds_replacement(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    snap_b = ctx["snap_b"]
    target_ref = AnnotationRef(
        annotation_id=snap_b.annotation.annotation_id,
        version=snap_b.version,
    )
    target_set = ReviewTargetSet.create([target_ref])

    ws_key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="reviewer-1",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ctx["ws_svc"].open(ws_key, target_set)
    ws_key = view.key

    # 1. Create a replacement / counter-proposal
    cmd_edit = CreateAnnotationCommand(
        annotation_id="replacement-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0002133",  # Status epilepticus
        axes_values={"assertion": "present"},
        evidence_id="ev-b",
        segments=[Segment(start=41, end=48)],
    )
    draft = ctx["edit_svc"].apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=cmd_edit.model_dump(),
        ),
    )
    rep_snap = draft.annotations[0]
    rep_ref = AnnotationRef(
        annotation_id=rep_snap.annotation.annotation_id,
        version=rep_snap.version,
    )

    # 2. Decide changed with replacement
    cmd_dec = DecisionCommand(
        target=target_ref,
        outcome="changed",
        replacement=rep_ref,
        note="Refined to status epilepticus",
    )
    draft2 = ctx["rev_svc"].decide(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=cmd_dec.model_dump(),
        ),
    )
    assert len(draft2.decisions) == 1
    assert draft2.decisions[0].outcome == "changed"
    assert draft2.decisions[0].replacement == rep_ref


def test_obsolete_term_cannot_be_confirmed(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    snap_c = ctx["snap_c"]
    target_ref = AnnotationRef(
        annotation_id=snap_c.annotation.annotation_id,
        version=snap_c.version,
    )
    target_set = ReviewTargetSet.create([target_ref])

    ws_key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="reviewer-1",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ctx["ws_svc"].open(ws_key, target_set)
    ws_key = view.key

    # Attempting to confirm obsolete term HP:0000123
    with pytest.raises(DomainError, match="CANNOT_CONFIRM_OBSOLETE_TERM"):
        ctx["rev_svc"].decide(
            ws_key,
            MutationEnvelope(
                mutation_id="m1",
                expected_revision=0,
                payload=DecisionCommand(
                    target=target_ref,
                    outcome="confirmed",
                ).model_dump(),
            ),
        )


def test_review_submission_completeness_and_export_scoping(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    snap_a = ctx["snap_a"]
    target_ref = AnnotationRef(
        annotation_id=snap_a.annotation.annotation_id,
        version=snap_a.version,
    )
    target_set = ReviewTargetSet.create([target_ref])

    ws_key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="reviewer-1",
        mode="review",
        target_set_id=target_set.target_set_id,
    )
    view = ctx["ws_svc"].open(ws_key, target_set)
    ws_key = view.key

    # 1. Submit before deciding -> raises IncompleteReview or DomainError
    with pytest.raises((IncompleteReview, DomainError)):
        ctx["sub_svc"].submit(
            ws_key,
            MutationEnvelope(
                mutation_id="sub-fail",
                expected_revision=0,
                payload=SubmitCommand(document_checked=True).model_dump(),
            ),
        )

    # 2. Decide confirm
    ctx["rev_svc"].decide(
        ws_key,
        MutationEnvelope(
            mutation_id="m-dec",
            expected_revision=0,
            payload=DecisionCommand(
                target=target_ref,
                outcome="confirmed",
            ).model_dump(),
        ),
    )

    # 3. Submit with document_checked=False -> rejected
    with pytest.raises(DomainError, match="DOCUMENT_NOT_CHECKED"):
        ctx["sub_svc"].submit(
            ws_key,
            MutationEnvelope(
                mutation_id="sub-not-checked",
                expected_revision=1,
                payload=SubmitCommand(document_checked=False).model_dump(),
            ),
        )

    from ontocurator.application.editing import CheckLayerCommand

    # 3b. Check layer before submitting
    ctx["edit_svc"].apply(
        ws_key,
        MutationEnvelope(
            mutation_id="chk-layer",
            expected_revision=1,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=True
            ).model_dump(),
        ),
    )

    # 4. Submit successfully
    sub = ctx["sub_svc"].submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub-ok",
            expected_revision=2,
            payload=SubmitCommand(document_checked=True).model_dump(),
        ),
    )
    assert sub.document_checked is True
    assert len(sub.decisions) == 1

    # 5. Export scoped package
    exported_pkg = ctx["exp_svc"].for_workspace(ws_key)
    # Review export has target proposal A, but NOT unreferenced proposals B and C!
    ann_keys = exported_pkg.annotations.keys()
    assert (snap_a.annotation.annotation_id, snap_a.version) in ann_keys
    b_key = (ctx["snap_b"].annotation.annotation_id, ctx["snap_b"].version)
    c_key = (ctx["snap_c"].annotation.annotation_id, ctx["snap_c"].version)
    assert b_key not in ann_keys
    assert c_key not in ann_keys


def test_independent_mode_null_finding_and_hidden_proposals(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="indep-annotator",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ctx["ws_svc"].open(ws_key)
    ws_key = view.key

    # Independent mode: no available inputs exposed
    assert view.available_inputs == []
    assert view.targets.targets == []

    # Check layer first
    from ontocurator.application.editing import CheckLayerCommand

    ctx["edit_svc"].apply(
        ws_key,
        MutationEnvelope(
            mutation_id="chk-null",
            expected_revision=0,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=True
            ).model_dump(),
        ),
    )

    # Null finding completion (0 annotations, document_checked=True)
    sub = ctx["sub_svc"].submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub-null",
            expected_revision=1,
            payload=SubmitCommand(document_checked=True).model_dump(),
        ),
    )
    assert sub.document_checked is True
    assert sub.snapshots == []

    # Export independent package
    indep_pkg = ctx["exp_svc"].for_workspace(ws_key)
    # Zero hidden proposals leaked into independent export
    assert len(indep_pkg.annotations) == 0
    assert len(indep_pkg.evidence) == 0
    assert len(indep_pkg.submissions) == 1


def test_required_axes_enforced_on_confirmation_replacement_and_submission(
    tmp_path: Path,
):
    from ontocurator.application.editing import CheckLayerCommand
    from ontocurator.domain.profiles import (
        AnnotationTypeDefinition,
        AxisDefinition,
        LayerDefinition,
        OntologyDefinition,
        TaskProfile,
        profile_hash,
    )

    db_path = tmp_path / "test.db"
    db = database_for(db_path)
    repo = Repository(db)
    ontology = _make_ontology_service()
    ws_svc = WorkspaceService(repo, ontology)
    edit_svc = EditorService(repo, ontology)
    rev_svc = ReviewService(repo, ontology)
    sub_svc = SubmissionService(repo)

    text = "The patient showed severe hypotonia and seizure activity."
    text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(
        document_id="doc-1", text=text, language="en", text_sha256=text_digest
    )

    custom_type = AnnotationTypeDefinition(
        type_id="strict-type",
        label="Strict Type",
        axes=[
            AxisDefinition(
                id="severity",
                label="Severity",
                options=["mild", "severe"],
                allow_empty=False,
            )
        ],
        evidence_policy="optional",
    )
    custom_layer = LayerDefinition(
        layer_id="strict-layer",
        label="Strict Layer",
        ontology_id="hp",
        access="editable",
        default_visible=True,
        default_type_id="strict-type",
        annotation_types=[custom_type],
    )
    custom_profile = TaskProfile(
        profile_id="strict-profile/v1",
        version="1.0.0",
        ontologies=[
            OntologyDefinition(
                ontology_id="hp",
                label="Human Phenotype Ontology",
                release="2026-06-23",
                sha256=ontology.ref.sha256,
                format="obo-graph-json",
            )
        ],
        layers=[custom_layer],
        default_layer_id="strict-layer",
    )

    # Incomplete proposal (severity is empty/omitted)
    ann_incomplete = Annotation(
        annotation_id="prop-inc",
        document_id="doc-1",
        layer_id="strict-layer",
        type_id="strict-type",
        term_id="HP:0001252",
        axes_values={},
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap_inc = snapshot(ann_incomplete, [], doc, custom_profile)

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            format_version="ontocurator-work-package/v2",
            package_id="pkg-strict-1",
            created_at="2026-10-01T00:00:00Z",
            document_order=["doc-1"],
            task_profile=custom_profile,
            task_profile_sha256=profile_hash(custom_profile),
        ),
        documents={"doc-1": doc},
        annotations={(snap_inc.annotation.annotation_id, snap_inc.version): snap_inc},
    )
    repo.import_package(pkg)

    targets = ReviewTargetSet.create(
        [AnnotationRef(annotation_id="prop-inc", version=snap_inc.version)]
    )
    ws_key = WorkspaceKey(
        package_id="pkg-strict-1",
        document_id="doc-1",
        annotator_id="rev-1",
        mode="review",
        target_set_id=targets.target_set_id,
    )
    view = ws_svc.open(ws_key, targets)
    ws_key = view.key

    # 1. Confirming an incomplete annotation fails
    with pytest.raises(DomainError, match="INCOMPLETE_AXES"):
        rev_svc.decide(
            ws_key,
            MutationEnvelope(
                mutation_id="dec-confirm-bad",
                expected_revision=0,
                payload=DecisionCommand(
                    target=AnnotationRef(
                        annotation_id="prop-inc", version=snap_inc.version
                    ),
                    outcome="confirmed",
                ).model_dump(),
            ),
        )

    # 2. Rejecting does NOT require complete axes
    draft = rev_svc.decide(
        ws_key,
        MutationEnvelope(
            mutation_id="dec-reject-ok",
            expected_revision=0,
            payload=DecisionCommand(
                target=AnnotationRef(
                    annotation_id="prop-inc", version=snap_inc.version
                ),
                outcome="rejected",
            ).model_dump(),
        ),
    )
    assert len(draft.decisions) == 1
    assert draft.decisions[0].outcome == "rejected"

    # 3. Create incomplete replacement -> should fail when set as replacement
    edit_draft_bad = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="create-rep-bad",
            expected_revision=1,
            payload=CreateAnnotationCommand(
                annotation_id="rep-bad",
                layer_id="strict-layer",
                type_id="strict-type",
                term_id="HP:0001252",
                axes_values={},
            ).model_dump(),
        ),
    )
    with pytest.raises(DomainError, match="INCOMPLETE_AXES"):
        rev_svc.decide(
            ws_key,
            MutationEnvelope(
                mutation_id="dec-changed-bad",
                expected_revision=2,
                payload=DecisionCommand(
                    target=AnnotationRef(
                        annotation_id="prop-inc", version=snap_inc.version
                    ),
                    outcome="changed",
                    replacement=AnnotationRef(
                        annotation_id="rep-bad",
                        version=edit_draft_bad.annotations[0].version,
                    ),
                ).model_dump(),
            ),
        )

    # 4. Create complete replacement in draft and approve replacement
    edit_draft_good = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="create-rep-good",
            expected_revision=2,
            payload=CreateAnnotationCommand(
                annotation_id="rep-1",
                layer_id="strict-layer",
                type_id="strict-type",
                term_id="HP:0001252",
                axes_values={"severity": "severe"},
            ).model_dump(),
        ),
    )

    draft = rev_svc.decide(
        ws_key,
        MutationEnvelope(
            mutation_id="dec-changed-ok",
            expected_revision=3,
            payload=DecisionCommand(
                target=AnnotationRef(
                    annotation_id="prop-inc", version=snap_inc.version
                ),
                outcome="changed",
                replacement=AnnotationRef(
                    annotation_id="rep-1",
                    version=next(
                        a
                        for a in edit_draft_good.annotations
                        if a.annotation.annotation_id == "rep-1"
                    ).version,
                ),
            ).model_dump(),
        ),
    )
    assert len(draft.decisions) == 1
    assert draft.decisions[0].outcome == "changed"

    # Check layer
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="chk",
            expected_revision=4,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="strict-layer", checked=True
            ).model_dump(),
        ),
    )

    # 5. Submission fails because rep-bad is still in draft annotations
    # with incomplete axes
    with pytest.raises(DomainError, match="INCOMPLETE_AXES"):
        sub_svc.submit(
            ws_key,
            MutationEnvelope(
                mutation_id="sub-bad",
                expected_revision=5,
                payload=SubmitCommand(document_checked=True).model_dump(),
            ),
        )

    # 6. Delete rep-bad, then submission succeeds
    from ontocurator.application.editing import DeleteDraftAnnotationCommand

    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="del-rep-bad",
            expected_revision=5,
            payload=DeleteDraftAnnotationCommand(annotation_id="rep-bad").model_dump(),
        ),
    )

    # Re-check layer since deleting an annotation on strict-layer invalidates its checkmark!
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="chk-again",
            expected_revision=6,
            payload=CheckLayerCommand(
                kind="check_layer", layer_id="strict-layer", checked=True
            ).model_dump(),
        ),
    )

    sub = sub_svc.submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub-ok",
            expected_revision=7,
            payload=SubmitCommand(document_checked=True).model_dump(),
        ),
    )
    assert len(sub.snapshots) == 1
