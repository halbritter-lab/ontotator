import hashlib
from pathlib import Path

import pytest
from pg_harness import database_for

from ontotator.application.editing import (
    AttachMentionCommand,
    CreateAnnotationCommand,
    EditMentionCommand,
    EditorService,
)
from ontotator.application.workspaces import WorkspaceService
from ontotator.domain.documents import (
    Document,
    OntologyRef,
    Segment,
)
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)
from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontotator.ontology.service import OntologyService
from ontotator.packages.models import PackageManifest, ValidatedPackage
from ontotator.storage.repository import Repository

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_service() -> OntologyService:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    ref = OntologyRef(release="2026-06-23", sha256=digest)
    return OntologyService.load(FIXTURE_PATH, ref)


def _setup_test_env(tmp_path: Path):
    db_path = tmp_path / "test.db"
    db = database_for(db_path)
    repo = Repository(db)
    ontology = _make_ontology_service()
    workspace_service = WorkspaceService(repo, ontology)
    editor_service = EditorService(repo, ontology)

    text = "The patient showed severe hypotonia and seizure activity."
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(document_id="doc-1", text=text, language="en", text_sha256=digest)

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
        profile_id="hpo-default/v1",
        version="1.0.0",
        ontologies=[hp_ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="pkg-1",
            format_version="ontotator-work-package/v2",
            document_order=["doc-1"],
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-01T00:00:00Z",
        ),
        documents={"doc-1": doc},
    )
    repo.import_package(pkg)
    return repo, ontology, workspace_service, editor_service, doc


@pytest.mark.parametrize("actor_kind", ["human", "tool"])
def test_create_annotation_and_provenance_equivalence(tmp_path: Path, actor_kind: str):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(ws_key)
    ws_key = view.key
    # A human annotation may only name the workspace's annotator; a tool any ID.
    actor_id = "annotator-1" if actor_kind == "human" else "agent-tool"

    cmd = CreateAnnotationCommand(
        annotation_id="ann-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",  # Hypotonia
        axes_values={"assertion": "present"},
        evidence_id="ev-1",
        segments=[Segment(start=27, end=36)],  # "hypotonia"
        actor_kind=actor_kind,
        actor_id=actor_id,
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
    assert snap.annotation.term_id == "HP:0001252"
    assert snap.annotation.provenance.actor.kind == actor_kind
    assert snap.annotation.provenance.actor.actor_id == actor_id


def test_a_human_annotation_cannot_name_another_annotator(tmp_path: Path) -> None:
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = ws_svc.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    cmd = CreateAnnotationCommand(
        annotation_id="ann-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        actor_kind="human",
        actor_id="annotator-2",
    )

    with pytest.raises(AccessDenied) as error:
        edit_svc.apply(
            ws_key,
            MutationEnvelope(
                mutation_id="mut-1", expected_revision=0, payload=cmd.model_dump()
            ),
        )

    assert error.value.code == "IDENTITY_MISMATCH"
    assert ws_svc.open(ws_key).draft.revision == 0


def test_create_annotation_attributes_workspace_annotator_by_default(tmp_path: Path):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = ws_svc.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key

    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="mut-1",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "ann-1",
                "term_id": "HP:0001252",
                "segments": [{"start": 27, "end": 36}],
            },
        ),
    )

    actor = draft.annotations[0].annotation.provenance.actor
    assert actor.actor_id == "annotator-1"
    assert actor.kind == "human"


def test_spanless_annotation_and_subsequent_evidence_addition(tmp_path: Path):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(ws_key)
    ws_key = view.key

    # 1. Create spanless annotation
    cmd1 = CreateAnnotationCommand(
        annotation_id="ann-spanless",
        note="Finding inferred from the complete document",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001250",  # Seizure
        axes_values={"assertion": "present"},
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
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(ws_key)
    ws_key = view.key

    # Create Ann1 with shared evidence
    edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=CreateAnnotationCommand(
                annotation_id="ann-1",
                layer_id="hpo-layer",
                type_id="phenotype",
                term_id="HP:0001252",
                axes_values={"assertion": "present"},
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
                layer_id="hpo-layer",
                type_id="phenotype",
                term_id="HP:0001250",
                axes_values={"assertion": "present"},
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
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(ws_key)
    ws_key = view.key

    # Obsolete term
    with pytest.raises(DomainError, match="OBSOLETE_TERM"):
        edit_svc.apply(
            ws_key,
            MutationEnvelope(
                mutation_id="m1",
                expected_revision=0,
                payload=CreateAnnotationCommand(
                    annotation_id="ann-bad",
                    layer_id="hpo-layer",
                    type_id="phenotype",
                    term_id="HP:0000123",  # Obsolete in fixture
                    axes_values={},
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
                    layer_id="hpo-layer",
                    type_id="phenotype",
                    term_id="HP:9999999",
                    axes_values={},
                ).model_dump(),
            ),
        )


def test_create_and_set_term_with_term_id(tmp_path: Path):
    from ontotator.application.editing import SetTermCommand

    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(ws_key)
    ws_key = view.key

    # 1. Create with term_id
    cmd = CreateAnnotationCommand(
        annotation_id="ann-term-1",
        note="Finding inferred from the complete document",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={},
    )
    assert cmd.term_id == "HP:0001252"

    draft = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="mut-t1",
            expected_revision=0,
            payload=cmd.model_dump(),
        ),
    )
    assert draft.annotations[0].annotation.term_id == "HP:0001252"

    # 2. Set term with term_id
    cmd_set = SetTermCommand(
        annotation_id="ann-term-1",
        term_id="HP:0001250",
    )
    assert cmd_set.term_id == "HP:0001250"

    draft2 = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="mut-t2",
            expected_revision=1,
            payload=cmd_set.model_dump(),
        ),
    )
    assert draft2.annotations[0].annotation.term_id == "HP:0001250"


def test_command_conflicting_term_id_and_hpo_id_rejected():
    from pydantic import ValidationError

    from ontotator.application.editing import SetTermCommand

    with pytest.raises((ValueError, ValidationError), match="Conflicting"):
        CreateAnnotationCommand.model_validate(
            {
                "annotation_id": "a1",
                "term_id": "HP:0001250",
                "hpo_id": "HP:0001252",
            }
        )

    with pytest.raises((ValueError, ValidationError), match="Conflicting"):
        SetTermCommand.model_validate(
            {
                "annotation_id": "a1",
                "term_id": "HP:0001250",
                "hpo_id": "HP:0001252",
            }
        )


def test_discontinuous_segments_and_repeated_evidence_mentions(tmp_path: Path):
    _, _, ws_svc, edit_svc, _ = _setup_test_env(tmp_path)
    ws_key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="annotator-1",
        mode="independent",
        target_set_id="targets-0",
    )
    view = ws_svc.open(ws_key)
    ws_key = view.key

    # 1. Create annotation with discontinuous segments in a single mention
    cmd1 = CreateAnnotationCommand(
        annotation_id="ann-multi-ev",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        evidence_id="ev-discontinuous",
        segments=[Segment(start=27, end=36), Segment(start=41, end=48)],
    )
    draft1 = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m1",
            expected_revision=0,
            payload=cmd1.model_dump(),
        ),
    )
    assert len(draft1.annotations) == 1
    assert len(draft1.evidence) == 1
    ev_disc = draft1.evidence[0]
    assert len(ev_disc.mention.segments) == 2
    assert ev_disc.mention.segments[0].start == 27
    assert ev_disc.mention.segments[1].start == 41

    # 2. Attach a second distinct evidence mention to the same annotation
    cmd2 = AttachMentionCommand(
        annotation_id="ann-multi-ev",
        evidence_id="ev-second",
        segments=[Segment(start=0, end=11)],
    )
    draft2 = edit_svc.apply(
        ws_key,
        MutationEnvelope(
            mutation_id="m2",
            expected_revision=1,
            payload=cmd2.model_dump(),
        ),
    )
    assert len(draft2.annotations) == 1
    ann = draft2.annotations[0].annotation
    assert len(ann.evidence_refs) == 2
    assert {ref.evidence_id for ref in ann.evidence_refs} == {
        "ev-discontinuous",
        "ev-second",
    }
    assert len(draft2.evidence) == 2


def test_annotation_note_mutations_trim_new_input_and_preserve_receipts(tmp_path):
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
            mutation_id="note-create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "note": "  µ reason  ",
            },
        ),
    )
    assert created.annotations[0].annotation.note == "µ reason"
    assert ws.open(key).allow_spanless_findings is True
    old_version = created.annotations[0].version
    envelope = MutationEnvelope(
        mutation_id="note-edit",
        expected_revision=1,
        payload={
            "command": "set_annotation_note",
            "annotation_id": "a",
            "note": "  another reason  ",
        },
    )
    edited = editor.apply(key, envelope)
    assert edited.revision == 2
    assert edited.annotations[0].annotation.note == "another reason"
    assert edited.annotations[0].version != old_version
    assert editor.apply(key, envelope) == edited
    editor.apply(
        key,
        MutationEnvelope(
            mutation_id="note-attach",
            expected_revision=2,
            payload={
                "command": "attach_mention",
                "annotation_id": "a",
                "evidence_id": "note-ev",
                "segments": [{"start": 27, "end": 36}],
            },
        ),
    )
    cleared = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="note-clear",
            expected_revision=3,
            payload={
                "command": "set_annotation_note",
                "annotation_id": "a",
                "note": "   ",
            },
        ),
    )
    assert cleared.annotations[0].annotation.note is None
