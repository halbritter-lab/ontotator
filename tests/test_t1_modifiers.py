"""T1 import and export of finding modifiers and the Phenopacket check (modifiers M3).

Projects and units use the modifier fixture (``MOD_PIN``), never the shared pin.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import ontospan
import pytest
from modifier_fixtures import (
    MOD_PATH,
    MOD_PIN,
    create_modifier_project,
    modifier_profile,
)
from pg_harness import database_for
from t1_fixtures import OPERATOR, TEXT, annotation, bundle, run_import, unit

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Modifier,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import AxisDefinition
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, Submission, WorkspaceKey
from ontocurator.exchange.jobs import HANDLERS
from ontocurator.exchange.t1 import document_from_unit, layers_for, unit_to_proposals
from ontocurator.jobs.queue import Job, JobQueue
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository

PROJECT = "mods"
DOC = "EN100017"
SEVERE, MILD, RECURRENT = "HP:0012828", "HP:0012825", "HP:0031796"
FREQUENT, NEONATAL = "HP:0040282", "HP:0003623"
SCHWERE = (55, 62)  # "schwere" in TEXT


def mod_layers() -> list[dict[str, Any]]:
    return [
        layer.model_dump(mode="json")
        for layer in layers_for(modifier_profile(), {"hp": MOD_PIN})
    ]


def mod_unit(annotations: list[dict[str, Any]]) -> ontospan.AnnotatedDocument:
    return unit(DOC, annotations=annotations, layer_data=mod_layers())


def with_modifiers(item: dict[str, Any], *modifiers: dict[str, Any]) -> dict[str, Any]:
    item["modifiers"] = list(modifiers)
    return item


def mod(term_id: str, span: tuple[int, int] | None = None) -> dict[str, Any]:
    segments = [] if span is None else [ontospan.segment(TEXT, *span)]
    return {"term_id": term_id, "segments": [s.model_dump() for s in segments]}


@pytest.fixture
def db(tmp_path: Path) -> Database:
    db = database_for(tmp_path / "editor.db")
    create_modifier_project(db, PROJECT)
    return db


# --- import -------------------------------------------------------------------


def test_import_keeps_modifiers_and_reports_their_warnings(
    db: Database, tmp_path: Path
) -> None:
    seizure = with_modifiers(
        annotation("p1", (63, 76)),
        mod(SEVERE, SCHWERE),
        mod(MILD),
        mod(FREQUENT),
    )
    family = annotation("p2", (6, 19))
    family["axes"]["experiencer"] = {"value": "family_member", "basis": "chosen"}

    job = run_import(
        db, bundle(tmp_path / "b.zip", [mod_unit([seizure, family])]), PROJECT
    )

    assert job.status == "succeeded", job.error
    assert job.result is not None
    assert {"cohort_frequency", "exclusive_modifier_class"} <= set(
        job.result["warnings"]
    )
    proposals = {
        s.annotation.annotation_id.rsplit(":", 1)[-1]: s.annotation
        for s in Repository(db).list_annotations_for_document(PROJECT, DOC)
    }
    assert [m.model_dump() for m in proposals["p1"].modifiers] == [
        {"term_id": MILD},
        {"term_id": SEVERE, "segments": [{"start": 55, "end": 62}]},
        {"term_id": FREQUENT},
    ]
    assert proposals["p2"].axes_values["experiencer"] == "family_member"


def _standalone() -> dict[str, Any]:
    return annotation("p1", SCHWERE, term_id=SEVERE)


def _not_a_modifier() -> dict[str, Any]:
    return with_modifiers(annotation("p1", (63, 76)), mod("HP:0001250"))


def _duplicate() -> dict[str, Any]:
    return with_modifiers(annotation("p1", (63, 76)), mod(SEVERE, SCHWERE), mod(SEVERE))


@pytest.mark.parametrize(
    ("build", "code"),
    [
        (_standalone, "modifier_as_annotation"),
        (_not_a_modifier, "not_a_modifier"),
        (_duplicate, "duplicate_modifier"),
    ],
)
def test_invalid_modifiers_refuse_the_import(
    db: Database, tmp_path: Path, build: Any, code: str
) -> None:
    target = tmp_path / "unit.json"
    target.write_bytes(ontospan.dump_json(mod_unit([build()])))

    job = run_import(db, target, PROJECT)

    assert job.status == "failed"
    assert job.error is not None
    assert "T1_INVALID" in job.error and code in job.error
    assert Repository(db).list_annotations_for_document(PROJECT, DOC) == []


def test_family_member_is_refused_where_the_profile_hides_it() -> None:
    profile = modifier_profile()
    axes = profile.layers[0].annotation_types[0].axes
    axes[1] = AxisDefinition(
        id="experiencer", label="Experiencer", options=["patient", "other", "unknown"]
    )
    family = annotation("p1", (6, 19))
    family["axes"]["experiencer"] = {"value": "family_member", "basis": "chosen"}
    item = mod_unit([family])

    with pytest.raises(DomainError) as excinfo:
        unit_to_proposals(item, profile, document_from_unit(item), bundle_id=None)

    assert excinfo.value.code == "T1_UNKNOWN_AXIS_VALUE"


# --- export -------------------------------------------------------------------


def _finding(
    document: Document,
    annotation_id: str,
    span: tuple[int, int] | None,
    modifiers: list[Modifier],
    *,
    experiencer: str = "patient",
    provenance: Provenance | None = None,
) -> AnnotationSnapshot:
    evidence = []
    if span is not None:
        evidence.append(
            snapshot_evidence(
                EvidenceMention(
                    evidence_id=f"{annotation_id}-e",
                    segments=[Segment(start=span[0], end=span[1])],
                ),
                document,
            )
        )
    item = Annotation(
        annotation_id=annotation_id,
        document_id=DOC,
        layer_id="hpo",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values={
            "assertion": "present",
            "experiencer": experiencer,
            "temporality": "current",
        },
        evidence_refs=[
            EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
            for e in evidence
        ],
        modifiers=modifiers,
        provenance=provenance
        or Provenance(actor=ActorRef(actor_id="ann-c", kind="human"), method="manual"),
    )
    return snapshot(item, evidence, document, modifier_profile())


def _submit(db: Database, snapshots: list[AnnotationSnapshot]) -> None:
    repo = Repository(db)
    targets = ReviewTargetSet.create([])
    key = WorkspaceKey(
        project_key=PROJECT,
        document_id=DOC,
        annotator_id="ann-c",
        mode="independent",
        target_set_id=targets.target_set_id,
    )
    draft = repo.open_draft(key, None)
    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id="m-edit",
            expected_revision=draft.revision,
            payload={"command": "check_layer", "layer_id": "hpo", "checked": True},
        ),
        lambda current: current,
    )
    submission = Submission(
        submission_id="s-c",
        origin_key=key,
        targets=targets,
        draft_revision=draft.revision + 2,
        snapshots=snapshots,
        decisions=[],
        created_at="2026-10-25T09:30:00Z",
    )
    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id="s-c",
            expected_revision=draft.revision + 1,
            payload={"document_checked": True, "command": "submit_workspace"},
        ),
        lambda _current: submission,
    )


def _export(db: Database) -> Job:
    queue = JobQueue(db, HANDLERS)
    job_id = queue.enqueue("t1_export", {"project": PROJECT}, actor=OPERATOR)
    claimed = queue.claim(job_id, "test")
    assert claimed is not None
    return queue.run(claimed, "test")


def test_export_carries_modifiers_warnings_and_maps_to_a_phenopacket(
    db: Database, tmp_path: Path
) -> None:
    job = run_import(db, bundle(tmp_path / "in.zip", [mod_unit([])]), PROJECT)
    assert job.status == "succeeded", job.error
    document = Repository(db).get_document(PROJECT, DOC)
    assert document is not None
    sources = [
        ontospan.annotation_ref(f"{PROJECT}:{who}:independent:s-{who}", "a1")
        for who in ("ann-a", "ann-b")
    ]
    merged = Provenance(
        actor=ActorRef(actor_id="ann-c", kind="human"),
        method="merged",
        source_refs=sources,
    )
    # S23: Ana's Severe "schwere" and Ben's Recurrent, merged.
    s23 = _finding(
        document,
        "c1",
        (63, 76),
        [
            Modifier(term_id=RECURRENT),
            Modifier(term_id=SEVERE, segments=[Segment(start=55, end=62)]),
        ],
        provenance=merged,
    )
    many = _finding(
        document,
        "c2",
        (6, 19),
        [Modifier(term_id=t) for t in (MILD, SEVERE, NEONATAL, FREQUENT)],
    )
    family = _finding(
        document, "c3", None, [Modifier(term_id=SEVERE)], experiencer="family_member"
    )
    _submit(db, [s23, many, family])

    job = _export(db)

    assert job.status == "succeeded", job.error
    assert job.result is not None
    assert job.result["warning_counts"]["cohort_frequency"] == 1
    assert job.result["warning_counts"]["exclusive_modifier_class"] == 1
    assert {"cohort_frequency", "exclusive_modifier_class"} <= {
        w["code"] for w in job.result["warnings"]
    }
    ontology = ontospan.ObographOntology.load(MOD_PATH)
    _manifest, [exported] = ontospan.read_bundle(
        db.blobs.path(job.result["sha256"]), {"hp": ontology}
    )
    by_id = {a.annotation_id: a for a in exported.annotation_set.annotations}
    assert [m.model_dump(mode="json") for m in by_id["c1"].modifiers] == [
        {
            "term_id": SEVERE,
            "segments": [{"start": 55, "end": 62, "text": "schwere"}],
        },
        {"term_id": RECURRENT, "segments": []},
    ]
    assert by_id["c1"].provenance.method == "merged"
    assert by_id["c1"].provenance.source_refs == tuple(sorted(sources))

    # Round trip: the exported unit maps back to the same modifiers.
    back = unit_to_proposals(
        exported, modifier_profile(), document_from_unit(exported), bundle_id=None
    )
    restored = {
        s.annotation.annotation_id.rsplit(":", 1)[-1]: s.annotation.modifiers
        for s in back.annotations
    }
    assert restored["c1"] == s23.annotation.modifiers
    assert restored["c2"] == many.annotation.modifiers

    # Phenopacket (ontospan): the first severity by term id is ``severity``,
    # further ones and the cohort term go to ``modifiers``.
    packet, report = ontospan.to_phenopacket(exported, ontology)
    features = packet["phenotypicFeatures"]
    assert len(features) == 2
    first, second = sorted(features, key=lambda f: len(f.get("modifiers", [])))
    assert first["severity"]["id"] == SEVERE
    assert [m["id"] for m in first["modifiers"]] == [RECURRENT]
    assert second["severity"]["id"] == MILD
    assert second["onset"]["ontologyClass"]["id"] == NEONATAL
    assert sorted(m["id"] for m in second["modifiers"]) == [SEVERE, FREQUENT]
    assert report.frequency_modifiers == 1
    assert report.omitted_family == 1
