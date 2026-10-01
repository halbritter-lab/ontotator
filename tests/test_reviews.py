import hashlib
from pathlib import Path

import pytest

from hpo_editor.application.editing import CreateAnnotationCommand, EditorService
from hpo_editor.application.exports import ExportService
from hpo_editor.application.reviews import DecisionCommand, ReviewService
from hpo_editor.application.submissions import SubmissionService, SubmitCommand
from hpo_editor.application.workspaces import WorkspaceService
from hpo_editor.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from hpo_editor.domain.axes import Axes
from hpo_editor.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    OntologyRef,
    Segment,
    snapshot_evidence,
)
from hpo_editor.domain.errors import DomainError, IncompleteReview
from hpo_editor.domain.review import ReviewOutcome, ReviewTargetSet
from hpo_editor.domain.workspace import MutationEnvelope, WorkspaceKey
from hpo_editor.ontology.service import OntologyService
from hpo_editor.packages.models import PackageManifest, ValidatedPackage
from hpo_editor.storage.database import Database
from hpo_editor.storage.repository import Repository

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_service() -> OntologyService:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    ref = OntologyRef(release="2026-06-23", sha256=digest)
    return OntologyService.load(FIXTURE_PATH, ref)


def _setup_review_test_env(tmp_path: Path):
    db_path = tmp_path / "test.db"
    db = Database(db_path)
    db.run_migrations()
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

    # 1. Proposal A (human): Hypotonia (HP:0001252)
    ev_a = snapshot_evidence(
        EvidenceMention(
            evidence_id="ev-a",
            segments=[Segment(start=27, end=36)],
        ),
        doc,
    )
    ann_a = Annotation(
        annotation_id="prop-human",
        document_id="doc-1",
        hpo_id="HP:0001252",
        axes=Axes(assertion="present"),
        evidence_refs=[EvidenceRef(evidence_id="ev-a", version=ev_a.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap_a = snapshot(ann_a, [ev_a], doc, ontology.ref)

    # 2. Proposal B (tool): Seizure (HP:0001250)
    ev_b = snapshot_evidence(
        EvidenceMention(
            evidence_id="ev-b",
            segments=[Segment(start=41, end=48)],
        ),
        doc,
    )
    ann_b = Annotation(
        annotation_id="prop-tool",
        document_id="doc-1",
        hpo_id="HP:0001250",
        axes=Axes(assertion="present"),
        evidence_refs=[EvidenceRef(evidence_id="ev-b", version=ev_b.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="ner-v1", kind="tool"),
            method="spacy_ner",
        ),
    )
    snap_b = snapshot(ann_b, [ev_b], doc, ontology.ref)

    # 3. Proposal C (obsolete term): HP:0000123
    ann_c = Annotation(
        annotation_id="prop-obs",
        document_id="doc-1",
        hpo_id="HP:0000123",
        axes=Axes(),
        evidence_refs=[],
        provenance=Provenance(
            actor=ActorRef(actor_id="tool-old", kind="tool"),
            method="old",
        ),
    )
    snap_c = snapshot(ann_c, [], doc, ontology.ref)

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="pkg-rev-1",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology.ref,
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
    ctx["ws_svc"].open(ws_key, target_set)

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
    assert dec.target == target_ref
    assert dec.outcome == outcome
    assert dec.replacement is None


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
    ctx["ws_svc"].open(ws_key, target_set)

    # 1. Create a replacement / counter-proposal
    cmd_edit = CreateAnnotationCommand(
        annotation_id="replacement-1",
        hpo_id="HP:0002133",  # Status epilepticus
        axes=Axes(assertion="present"),
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
    ctx["ws_svc"].open(ws_key, target_set)

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
    ctx["ws_svc"].open(ws_key, target_set)

    # 1. Submit before deciding -> raises IncompleteReview
    with pytest.raises(IncompleteReview):
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

    # 4. Submit successfully
    sub = ctx["sub_svc"].submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub-ok",
            expected_revision=1,
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

    # Independent mode: no available inputs exposed
    assert view.available_inputs == []
    assert view.targets.targets == []

    # Null finding completion (0 annotations, document_checked=True)
    sub = ctx["sub_svc"].submit(
        ws_key,
        MutationEnvelope(
            mutation_id="sub-null",
            expected_revision=0,
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
