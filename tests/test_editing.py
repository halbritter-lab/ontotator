import hashlib
from pathlib import Path

import pytest

from ontocurator.application.editing import (
    AttachMentionCommand,
    CreateAnnotationCommand,
    EditMentionCommand,
    EditorService,
)
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.domain.axes import Axes
from ontocurator.domain.documents import (
    Document,
    OntologyRef,
    Segment,
)
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.ontology.service import OntologyService
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_service() -> OntologyService:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    ref = OntologyRef(release="2026-06-23", sha256=digest)
    return OntologyService.load(FIXTURE_PATH, ref)


def _setup_test_env(tmp_path: Path):
    db_path = tmp_path / "test.db"
    db = Database(db_path)
    db.run_migrations()
    repo = Repository(db)
    ontology = _make_ontology_service()
    workspace_service = WorkspaceService(repo, ontology)
    editor_service = EditorService(repo, ontology)

    text = "The patient showed severe hypotonia and seizure activity."
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(document_id="doc-1", text=text, language="en", text_sha256=digest)

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="pkg-1",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology.ref,
        ),
        documents={"doc-1": doc},
    )
    repo.import_package(pkg)
    return repo, ontology, workspace_service, editor_service, doc


@pytest.mark.parametrize("actor_kind", ["human", "tool"])
def test_create_annotation_and_provenance_equivalence(tmp_path: Path, actor_kind: str):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    ws_svc.open(ws_key)

    cmd = CreateAnnotationCommand(
        annotation_id="ann-1",
        hpo_id="HP:0001252",  # Hypotonia
        axes=Axes(assertion="present"),
        evidence_id="ev-1",
        segments=[Segment(start=27, end=36)],  # "hypotonia"
        actor_kind=actor_kind,
        actor_id=f"agent-{actor_kind}",
    )
    envelope = MutationEnvelope(
        mutation_id="mut-1",
        expected_revision=0,
        payload=cmd.model_dump(),
    )
    draft = edit_svc.apply(ws_key, envelope)

    assert draft.revision == 1
    assert len(draft.annotations) == 1
    assert len(draft.evidence) == 1
    snap = draft.annotations[0]
    assert snap.annotation.annotation_id == "ann-1"
    assert snap.annotation.hpo_id == "HP:0001252"
    assert snap.annotation.provenance.actor.kind == actor_kind
    assert snap.annotation.provenance.actor.actor_id == f"agent-{actor_kind}"


def test_spanless_annotation_and_subsequent_evidence_addition(tmp_path: Path):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    ws_svc.open(ws_key)

    # 1. Create spanless annotation
    cmd1 = CreateAnnotationCommand(
        annotation_id="ann-spanless",
        hpo_id="HP:0001250",  # Seizure
        axes=Axes(assertion="present"),
        evidence_id=None,
        segments=[],
    )
    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=cmd1.model_dump(),
        ),
    )
    assert len(draft.annotations) == 1
    assert len(draft.evidence) == 0
    assert draft.annotations[0].annotation.evidence_refs == []

    # 2. Attach evidence to the existing annotation
    cmd2 = AttachMentionCommand(
        annotation_id="ann-spanless",
        evidence_id="ev-seizure",
        segments=[Segment(start=41, end=48)],  # "seizure"
    )
    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=cmd2.model_dump(),
        ),
    )
    assert len(draft.annotations) == 1
    assert len(draft.evidence) == 1
    ann = draft.annotations[0].annotation
    assert ann.annotation_id == "ann-spanless"
    assert len(ann.evidence_refs) == 1
    assert ann.evidence_refs[0].evidence_id == "ev-seizure"


def test_shared_evidence_copy_on_write(tmp_path: Path):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    ws_svc.open(ws_key)

    # Create Ann1 with shared evidence
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=CreateAnnotationCommand(
                annotation_id="ann-1",
                hpo_id="HP:0001252",
                axes=Axes(assertion="present"),
                evidence_id="shared-ev",
                segments=[Segment(start=27, end=36)],
            ).model_dump(),
        ),
    )

    # Create Ann2 sharing same evidence
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=CreateAnnotationCommand(
                annotation_id="ann-2",
                hpo_id="HP:0001250",
                axes=Axes(assertion="present"),
                evidence_id="shared-ev",
                segments=[Segment(start=27, end=36)],
            ).model_dump(),
        ),
    )

    # Edit mention for Ann1 only using copy-on-write
    cmd3 = EditMentionCommand(
        evidence_id="shared-ev",
        annotation_id="ann-1",  # target annotation for COW
        segments=[Segment(start=20, end=36)],  # "severe hypotonia"
    )
    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m3",
            expected_revision=2,
            payload=cmd3.model_dump(),
        ),
    )

    # Ann1 has a new evidence mention copy
    # Ann2 keeps the original shared-ev mention unmodified
    ann1 = next(a for a in draft.annotations if a.annotation.annotation_id == "ann-1")
    ann2 = next(a for a in draft.annotations if a.annotation.annotation_id == "ann-2")

    ev1_ref = ann1.annotation.evidence_refs[0]
    ev2_ref = ann2.annotation.evidence_refs[0]

    assert (
        ev1_ref.evidence_id != ev2_ref.evidence_id or ev1_ref.version != ev2_ref.version
    )
    ev1 = next(
        e for e in draft.evidence if e.mention.evidence_id == ev1_ref.evidence_id
    )
    ev2 = next(
        e for e in draft.evidence if e.mention.evidence_id == ev2_ref.evidence_id
    )
    assert ev1.mention.segments == [Segment(start=20, end=36)]
    assert ev2.mention.segments == [Segment(start=27, end=36)]


def test_reject_obsolete_or_unknown_term_creation(tmp_path: Path):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    ws_svc.open(ws_key)

    # Obsolete term
    with pytest.raises(DomainError, match="OBSOLETE_TERM"):
        edit_svc.apply(
            ws_key,
            MutationEnvelope(
                mutation_id="m1",
                expected_revision=0,
                payload=CreateAnnotationCommand(
                    annotation_id="ann-bad",
                    hpo_id="HP:0000123",  # Obsolete in fixture
                    axes=Axes(),
                ).model_dump(),
            ),
        )

    # Unknown term
    with pytest.raises(DomainError, match="UNKNOWN_TERM"):
        edit_svc.apply(
            ws_key,
            MutationEnvelope(
                mutation_id="m2",
                expected_revision=0,
                payload=CreateAnnotationCommand(
                    annotation_id="ann-bad2",
                    hpo_id="HP:9999999",
                    axes=Axes(),
                ).model_dump(),
            ),
        )
