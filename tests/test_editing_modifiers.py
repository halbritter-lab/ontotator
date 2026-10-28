"""Modifier editing commands and their refusals (C3)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from modifier_fixtures import MOD_PATH, MOD_PIN, modifier_profile
from pg_harness import database_for
from sqlalchemy import insert, select
from t1_fixtures import OPERATOR

from ontotator.application.consolidation_resolve import review_decision
from ontotator.application.editing import EditorService
from ontotator.application.workspaces import WorkspaceService
from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Modifier,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import Document, OntologyRef
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import TaskProfile, profile_hash
from ontotator.domain.review import ConsolidationMark
from ontotator.domain.serialization import verify_snapshot
from ontotator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontotator.exchange.t1 import Pin
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService
from ontotator.ontology.store import OntologyStore
from ontotator.packages.models import PackageManifest, ValidatedPackage
from ontotator.storage.repository import Repository
from ontotator.storage.tables import ProjectOntologyRow, ProjectRow

TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
SCHWERE = (25, 32)
KRAMPF = (33, 46)
SEIZURE, SEVERE, MILD, FREQUENT = "HP:0001250", "HP:0012828", "HP:0012825", "HP:0040282"
RECURRENT, HYPOTONIA, OBSOLETE = "HP:0031796", "HP:0001252", "HP:0000123"
LAYER = "hpo"


def seg(span: tuple[int, int]) -> dict[str, int]:
    return {"start": span[0], "end": span[1]}


@dataclass
class Env:
    repo: Repository
    ontology: OntologyService
    editor: EditorService
    workspaces: WorkspaceService
    key: WorkspaceKey
    doc: Document
    profile: TaskProfile
    revision: int = 0

    def run(self, payload: dict[str, Any]) -> Draft:
        draft = self.editor.apply(
            self.key,
            MutationEnvelope(
                mutation_id=f"m-{self.revision}",
                expected_revision=self.revision,
                payload=payload,
            ),
        )
        self.revision = draft.revision
        return draft

    def refused(self, payload: dict[str, Any]) -> DomainError:
        with pytest.raises(DomainError) as caught:
            self.run(payload)
        return caught.value

    def seizure(self, annotation_id: str = "a1") -> Draft:
        return self.run(
            {
                "command": "create_annotation",
                "annotation_id": annotation_id,
                "term_id": SEIZURE,
                "segments": [seg(KRAMPF)],
            }
        )


def finding(draft: Draft, annotation_id: str = "a1") -> Annotation:
    return next(
        s.annotation
        for s in draft.annotations
        if s.annotation.annotation_id == annotation_id
    )


def modifiers(draft: Draft, annotation_id: str = "a1") -> list[dict[str, Any]]:
    return [m.model_dump() for m in finding(draft, annotation_id).modifiers]


def _env(tmp_path: Path, pin: Pin | None = MOD_PIN) -> Env:
    db = database_for(tmp_path / "mods.db")
    repo = Repository(db)
    ontology = OntologyService.load(
        MOD_PATH, OntologyRef(release="2026-06-23", sha256=MOD_PIN.sha256)
    )
    doc = Document(
        document_id="doc-1",
        text=TEXT,
        language="de",
        text_sha256=hashlib.sha256(TEXT.encode()).hexdigest(),
    )
    profile = modifier_profile()
    repo.import_package(
        ValidatedPackage(
            manifest=PackageManifest(
                package_id="mods",
                format_version="ontotator-work-package/v2",
                document_order=["doc-1"],
                task_profile=profile,
                task_profile_sha256=profile_hash(profile),
                created_at="2026-10-01T00:00:00Z",
            ),
            documents={"doc-1": doc},
        )
    )
    if pin is not None:
        OntologyStore(db, OntologyRegistry(), db.data_dir).add(
            OPERATOR, MOD_PATH.name, MOD_PATH.read_bytes()
        )
        with db.transaction() as conn:
            project_id = conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == "mods")
            ).scalar_one()
            conn.execute(
                insert(ProjectOntologyRow).values(
                    project_id=project_id,
                    ontology_id="hp",
                    sha256=pin.sha256,
                    allowed_roots=list(pin.allowed_roots),
                    t1_profile=pin.t1_profile,
                )
            )
    workspaces = WorkspaceService(repo, ontology)
    view = workspaces.open(
        WorkspaceKey(
            project_key="mods",
            document_id="doc-1",
            annotator_id="ana",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    return Env(
        repo,
        ontology,
        EditorService(repo, ontology),
        workspaces,
        view.key,
        doc,
        profile,
    )


@pytest.fixture
def env(tmp_path: Path) -> Env:
    return _env(tmp_path)


def test_add_without_and_with_segments(env: Env) -> None:
    env.seizure()
    env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": RECURRENT})
    draft = env.run(
        {
            "command": "add_modifier",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    assert draft.revision == 3
    assert modifiers(draft) == [
        {"term_id": SEVERE, "segments": [seg(SCHWERE)]},
        {"term_id": RECURRENT},
    ]


def test_edited_annotations_are_sorted_and_verify(env: Env) -> None:
    """Review note (M1a): the changed annotation is validated anew, so the
    hashed list is sorted and the stored snapshot verifies after a reload."""
    env.seizure()
    for term in (RECURRENT, SEVERE, MILD):
        env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": term})
    stored = env.repo.open_draft(env.key)
    snap = next(s for s in stored.annotations if s.annotation.annotation_id == "a1")
    assert [m.term_id for m in snap.annotation.modifiers] == [MILD, SEVERE, RECURRENT]
    verify_snapshot(snap)
    fresh = snapshot(
        Annotation.model_validate(snap.annotation.model_dump()),
        snap.evidence,
        env.doc,
        env.profile,
    )
    assert fresh.version == snap.version


def test_add_links_segments_of_a_spanless_existing_term(env: Env) -> None:
    env.seizure()
    env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE})
    draft = env.run(
        {
            "command": "add_modifier",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    assert modifiers(draft) == [{"term_id": SEVERE, "segments": [seg(SCHWERE)]}]


def test_duplicate_modifier(env: Env) -> None:
    env.seizure()
    linked = {
        "command": "add_modifier",
        "annotation_id": "a1",
        "term_id": SEVERE,
        "segments": [seg(SCHWERE)],
    }
    env.run(linked)
    refused = env.refused(linked)
    assert (refused.code, refused.details) == (
        "DUPLICATE_MODIFIER",
        {"term_id": SEVERE},
    )
    env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": RECURRENT})
    again = env.refused(
        {"command": "add_modifier", "annotation_id": "a1", "term_id": RECURRENT}
    )
    assert again.code == "DUPLICATE_MODIFIER"


@pytest.mark.parametrize(
    ("term", "code"),
    [
        (SEIZURE, "MODIFIER_NOT_ALLOWED"),
        ("HP:9999999", "UNKNOWN_TERM"),
        (OBSOLETE, "OBSOLETE_TERM"),
    ],
)
def test_refused_modifier_terms(env: Env, term: str, code: str) -> None:
    env.seizure()
    refused = env.refused(
        {"command": "add_modifier", "annotation_id": "a1", "term_id": term}
    )
    assert refused.code == code
    if code == "MODIFIER_NOT_ALLOWED":
        assert refused.details == {"term_id": SEIZURE}


def test_a_finding_outside_the_allowed_roots_is_refused(env: Env) -> None:
    """HP:0000118 pinned: "All" is no finding; a modifier on its own still is (#85)."""
    refused = env.refused(
        {
            "command": "create_annotation",
            "annotation_id": "a1",
            "term_id": "HP:0000001",
            "segments": [seg(KRAMPF)],
        }
    )
    assert refused.code == "TERM_OUTSIDE_ALLOWED_ROOTS"
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "a2",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    env.seizure()
    refused = env.refused(
        {"command": "set_term", "annotation_id": "a1", "term_id": "HP:0000001"}
    )
    assert refused.code == "TERM_OUTSIDE_ALLOWED_ROOTS"


def test_without_allowed_roots_every_term_is_a_finding(tmp_path: Path) -> None:
    env = _env(tmp_path, Pin(sha256=MOD_PIN.sha256, t1_profile="hpo-phenotype"))
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "a1",
            "term_id": "HP:0000001",
            "segments": [seg(KRAMPF)],
        }
    )


def test_primary_id_is_stored(env: Env) -> None:
    env.seizure()
    draft = env.run(
        {"command": "add_modifier", "annotation_id": "a1", "term_id": "hp:0012828"}
    )
    assert modifiers(draft) == [{"term_id": SEVERE}]


def test_frequency_and_two_severities_are_accepted(env: Env) -> None:
    env.seizure()
    for term in (FREQUENT, MILD, SEVERE):
        env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": term})
    assert [m["term_id"] for m in modifiers(env.repo.open_draft(env.key))] == [
        MILD,
        SEVERE,
        FREQUENT,
    ]


def test_segment_out_of_bounds(env: Env) -> None:
    env.seizure()
    refused = env.refused(
        {
            "command": "add_modifier",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [{"start": 70, "end": 99}],
        }
    )
    assert refused.code == "INVALID_ANNOTATION"


def test_set_segments_and_remove(env: Env) -> None:
    env.seizure()
    env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE})
    draft = env.run(
        {
            "command": "set_modifier_segments",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    assert modifiers(draft) == [{"term_id": SEVERE, "segments": [seg(SCHWERE)]}]
    draft = env.run(
        {
            "command": "set_modifier_segments",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [],
        }
    )
    assert modifiers(draft) == [{"term_id": SEVERE}]
    draft = env.run(
        {"command": "remove_modifier", "annotation_id": "a1", "term_id": SEVERE}
    )
    assert modifiers(draft) == []
    for payload in (
        {"command": "remove_modifier", "annotation_id": "a1", "term_id": SEVERE},
        {
            "command": "set_modifier_segments",
            "annotation_id": "a1",
            "term_id": MILD,
            "segments": [],
        },
    ):
        refused = env.refused(payload)
        assert refused.code == "MODIFIER_NOT_FOUND"
        assert refused.details == {"term_id": payload["term_id"]}


@pytest.mark.parametrize(
    "pin", [Pin(sha256=MOD_PIN.sha256, t1_profile="generic"), None]
)
def test_layers_without_hpo_phenotype_refuse(tmp_path: Path, pin: Pin | None) -> None:
    env = _env(tmp_path, pin)
    env.seizure()
    refused = env.refused(
        {"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE}
    )
    assert (refused.code, refused.details) == (
        "MODIFIERS_NOT_SUPPORTED",
        {"layer_id": LAYER},
    )
    # Without modifier support a modifier term is an ordinary term.
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "a2",
            "term_id": SEVERE,
            "note": "Whole text",
        }
    )
    view = env.workspaces.open(env.key)
    assert view.modifier_layer_ids == []


def test_workspace_view_lists_modifier_layers(env: Env) -> None:
    assert env.workspaces.open(env.key).modifier_layer_ids == [LAYER]


def test_reference_layer_is_read_only(env: Env) -> None:
    draft = env.seizure()
    scope = env.workspaces.open(env.key).scope.model_copy(
        update={"editable_layer_ids": [], "reference_layer_ids": [LAYER]}
    )
    with pytest.raises(DomainError) as refused:
        env.editor._execute_edit(
            draft,
            env.editor.parse_command(
                {"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE}
            ),
            env.doc,
            env.profile,
            scope,
            {LAYER: env.ontology},
        )
    assert refused.value.code == "REFERENCE_LAYER_READ_ONLY"


def test_create_and_set_term_accept_modifier_terms(env: Env) -> None:
    """A modifier term may name a finding (Stillbirth): accepted, submit warns."""
    draft = env.run(
        {
            "command": "create_annotation",
            "annotation_id": "a0",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    assert finding(draft, "a0").term_id == SEVERE
    env.seizure()
    draft = env.run({"command": "set_term", "annotation_id": "a1", "term_id": FREQUENT})
    assert finding(draft).term_id == FREQUENT


def test_set_term_keeps_modifiers(env: Env) -> None:
    env.seizure()
    env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE})
    draft = env.run(
        {"command": "set_term", "annotation_id": "a1", "term_id": "HP:0007359"}
    )
    assert finding(draft).term_id == "HP:0007359"
    assert modifiers(draft) == [{"term_id": SEVERE}]


def _proposal(env: Env, term_id: str, mods: list[Modifier]) -> Any:
    annotation = Annotation(
        annotation_id="p1",
        document_id="doc-1",
        layer_id=LAYER,
        type_id="phenotype",
        term_id=term_id,
        modifiers=mods,
        provenance=Provenance(
            actor=ActorRef(actor_id="phentrieve", kind="tool"), method="tool"
        ),
    )
    return snapshot(annotation, [], env.doc, env.profile)


def test_adoption(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    proposal = _proposal(env, SEIZURE, [Modifier(term_id=SEVERE)])
    standalone = _proposal(env, SEVERE, [])
    sources = [proposal]
    monkeypatch.setattr(env.repo, "workspace_input_snapshots", lambda key: sources)
    draft = env.run(
        {
            "command": "create_annotation",
            "annotation_id": "own",
            "term_id": SEIZURE,
            "source_annotation_id": "p1",
            "note": "Whole text",
            "source_version": proposal.version,
        }
    )
    assert modifiers(draft, "own") == [{"term_id": SEVERE}]
    sources[:] = [standalone]
    draft = env.run(
        {
            "command": "create_annotation",
            "annotation_id": "own-2",
            "term_id": SEVERE,
            "source_annotation_id": "p1",
            "note": "Whole text",
            "source_version": standalone.version,
        }
    )
    assert finding(draft, "own-2").term_id == SEVERE


def test_delete_removes_the_modifiers(env: Env) -> None:
    env.seizure()
    env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE})
    draft = env.run({"command": "delete_draft_annotation", "annotation_id": "a1"})
    assert draft.annotations == []


@pytest.mark.parametrize(
    "payload",
    [
        {"command": "add_modifier", "annotation_id": "a1", "term_id": SEVERE},
        {
            "command": "set_modifier_segments",
            "annotation_id": "a1",
            "term_id": MILD,
            "segments": [seg(SCHWERE)],
        },
        {"command": "remove_modifier", "annotation_id": "a1", "term_id": MILD},
    ],
)
def test_commands_uncheck_the_layer_and_repoint_consolidation_decisions(
    env: Env, payload: dict[str, Any]
) -> None:
    env.seizure()
    draft = env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": MILD})
    before = next(s for s in draft.annotations)
    ref = AnnotationRef(annotation_id="a1", version=before.version)
    draft.checked_layer_ids = [LAYER]
    draft.decisions = [
        review_decision(
            env.key,
            ref,
            outcome="changed",
            replacement=ref,
            mark=ConsolidationMark(action="keep"),
        )
    ]
    scope = env.workspaces.open(env.key).scope
    result = env.editor._execute_edit(
        draft,
        env.editor.parse_command(payload),
        env.doc,
        env.profile,
        scope,
        {LAYER: env.ontology},
    )
    after = next(s for s in result.annotations)
    assert after.version != before.version
    assert result.checked_layer_ids == []
    assert result.decisions[0].replacement == AnnotationRef(
        annotation_id="a1", version=after.version
    )


def _old_standalone(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """A standalone Severe finding."""
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "old",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )


@pytest.mark.parametrize("link_span", [True, False])
def test_convert_to_modifier(
    env: Env, monkeypatch: pytest.MonkeyPatch, link_span: bool
) -> None:
    env.seizure()
    _old_standalone(env, monkeypatch)
    revision = env.revision
    draft = env.run(
        {
            "command": "convert_to_modifier",
            "annotation_id": "old",
            "target_annotation_id": "a1",
            "link_span": link_span,
        }
    )
    assert draft.revision == revision + 1
    assert [s.annotation.annotation_id for s in draft.annotations] == ["a1"]
    assert {e.mention.evidence_id for e in draft.evidence} == {"ev-a1"}
    expected = (
        {"term_id": SEVERE, "segments": [seg(SCHWERE)]}
        if link_span
        else {"term_id": SEVERE}
    )
    assert modifiers(draft) == [expected]


def test_convert_to_modifier_refusals(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.seizure()
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "a2",
            "note": "Whole text",
            "term_id": HYPOTONIA,
        }
    )
    _old_standalone(env, monkeypatch)
    missing = env.refused(
        {
            "command": "convert_to_modifier",
            "annotation_id": "nope",
            "target_annotation_id": "a1",
        }
    )
    assert missing.code == "ANNOTATION_NOT_FOUND"
    not_modifier = env.refused(
        {
            "command": "convert_to_modifier",
            "annotation_id": "a2",
            "target_annotation_id": "a1",
        }
    )
    assert (not_modifier.code, not_modifier.details) == (
        "MODIFIER_NOT_ALLOWED",
        {"term_id": HYPOTONIA},
    )
    env.run(
        {
            "command": "add_modifier",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [{"start": 13, "end": 24}],
        }
    )
    duplicate = env.refused(
        {
            "command": "convert_to_modifier",
            "annotation_id": "old",
            "target_annotation_id": "a1",
        }
    )
    assert (duplicate.code, duplicate.details) == (
        "DUPLICATE_MODIFIER",
        {"term_id": SEVERE},
    )


def test_convert_spanless_onto_spanned_same_term(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.seizure()
    env.run(
        {
            "command": "add_modifier",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    _old_standalone(env, monkeypatch)
    draft = env.run(
        {
            "command": "convert_to_modifier",
            "annotation_id": "old",
            "target_annotation_id": "a1",
            "link_span": False,
        }
    )
    assert [s.annotation.annotation_id for s in draft.annotations] == ["a1"]
    assert modifiers(draft) == [{"term_id": SEVERE, "segments": [seg(SCHWERE)]}]


def test_recreate_reanchor_keeps_modifiers(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontotator.application.editing import RecreateReanchorCommand
    from ontotator.domain.reanchor_resolution import PendingReanchorRef
    from ontotator.domain.scopes import build_scope

    env.seizure()
    env.run(
        {
            "command": "add_modifier",
            "annotation_id": "a1",
            "term_id": SEVERE,
            "segments": [seg(SCHWERE)],
        }
    )
    draft = env.run(
        {"command": "add_modifier", "annotation_id": "a1", "term_id": RECURRENT}
    )
    source = next(s for s in draft.annotations if s.annotation.annotation_id == "a1")
    # "schwere" was edited to "starke": the Severe span no longer exists.
    text = TEXT.replace("schwere", "starke")
    doc = env.doc.model_copy(
        update={
            "text": text,
            "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        }
    )
    item = PendingReanchorRef(
        proposal_set_id=1,
        source_ref=AnnotationRef(annotation_id="a1", version=source.version),
    )
    review = draft.model_copy(
        update={
            "key": draft.key.model_copy(update={"mode": "review"}),
            "annotations": [],
            "evidence": [],
            "reanchor_inputs": [item],
        }
    )
    monkeypatch.setattr(env.repo, "verified_reanchor_source", lambda *_: source)
    result = env.editor._execute_edit(
        review,
        RecreateReanchorCommand(
            item=item,
            annotation_id="carried",
            evidence_id="ev-carried",
            term_id=SEIZURE,
            layer_id=source.annotation.layer_id,
            type_id=source.annotation.type_id,
            segments=[{"start": 32, "end": 45}],
        ),
        doc,
        env.profile,
        build_scope(env.profile, "review"),
        {LAYER: env.ontology},
    )
    assert modifiers(result, "carried") == [
        {"term_id": SEVERE},
        {"term_id": RECURRENT},
    ]
