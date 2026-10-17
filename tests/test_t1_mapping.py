"""Mapping between Ontocurator snapshots and ontospan (T1) units (T2d Task 1)."""

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ontospan
import pytest

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    AnnotationSnapshot,
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
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
)
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.serialization import encode_snapshot, verify_snapshot
from ontocurator.domain.workspace import Submission, WorkspaceKey
from ontocurator.exchange.t1 import (
    Pin,
    check_t1_profile,
    document_from_unit,
    layers_for,
    submission_to_unit,
    unit_to_proposals,
)

FIXTURES = Path(__file__).parent / "fixtures"
HP_PATH = FIXTURES / "hp.json"
HP_SHA = hashlib.sha256(HP_PATH.read_bytes()).hexdigest()
TEXT = "Keine Krampfanfälle in der Neonatalzeit. Seit 2 Wochen schwere Krampfanfälle."
SET_ID = "set-ann-03"
BUNDLE_ID = "bundle-1"


def hpo_profile() -> TaskProfile:
    return TaskProfile(
        profile_id="hpo-t1/v1",
        version="1.0.0",
        ontologies=[
            OntologyDefinition(
                ontology_id="hp",
                label="Human Phenotype Ontology",
                release="2026-06-23",
                sha256=HP_SHA,
            )
        ],
        layers=[
            LayerDefinition(
                layer_id="hpo",
                label="Phenotypes",
                ontology_id="hp",
                access="editable",
                default_type_id="phenotype",
                annotation_types=[
                    AnnotationTypeDefinition(
                        type_id="phenotype",
                        label="Phenotype",
                        axes=[
                            AxisDefinition(
                                id="assertion",
                                label="Assertion",
                                options=["present", "absent", "uncertain"],
                            ),
                            AxisDefinition(
                                id="experiencer",
                                label="Experiencer",
                                options=[
                                    "patient",
                                    "family_member",
                                    "other",
                                    "unknown",
                                ],
                            ),
                            AxisDefinition(
                                id="temporality",
                                label="Temporality",
                                options=["current", "historical", "unknown"],
                            ),
                        ],
                    )
                ],
            )
        ],
        default_layer_id="hpo",
    )


PINS = {
    "hp": Pin(sha256=HP_SHA, allowed_roots=("HP:0000118",), t1_profile="hpo-phenotype")
}


def layers() -> list[ontospan.Layer]:
    return layers_for(hpo_profile(), PINS)


def seg(start: int, end: int) -> dict[str, Any]:
    return {"start": start, "end": end, "text": TEXT[start:end]}


def axes(**values: tuple[str, str]) -> dict[str, Any]:
    return {k: {"value": v, "basis": b} for k, (v, b) in values.items()}


def sketch_annotations(*, modifiers: bool = False) -> list[dict[str, Any]]:
    actor = {"actor_id": "ann-03", "kind": "human"}
    return [
        {
            "annotation_id": "a1",
            "layer_id": "hpo",
            "term_id": "HP:0001250",
            "axes": axes(
                assertion=("absent", "chosen"),
                experiencer=("patient", "defaulted"),
                temporality=("historical", "chosen"),
            ),
            "mentions": [{"segments": [seg(6, 19)], "cue_segments": [seg(0, 5)]}],
            "provenance": {
                "actor": actor,
                "method": "manual",
                "source_refs": [],
                "notes": ["negated in the neonatal period"],
            },
        },
        {
            "annotation_id": "a2",
            "layer_id": "hpo",
            "term_id": "HP:0001250",
            "axes": axes(
                assertion=("present", "defaulted"),
                experiencer=("patient", "defaulted"),
                temporality=("current", "chosen"),
            ),
            "mentions": [{"segments": [seg(63, 76)], "cue_segments": []}],
            "modifiers": (
                [{"term_id": "HP:0012828", "segments": [seg(55, 62)]}]
                if modifiers
                else []
            ),
            "provenance": {"actor": actor, "method": "manual", "source_refs": []},
        },
    ]


def sketch_unit(
    annotations: list[dict[str, Any]] | None = None,
) -> ontospan.AnnotatedDocument:
    document = ontospan.make_document("EN100017", "de", TEXT)
    return ontospan.AnnotatedDocument.model_validate(
        {
            "document": document.model_dump(mode="json"),
            "annotation_set": {
                "annotation_set_id": SET_ID,
                "set_kind": "individual",
                "stage": "annotation",
                "actors": [{"actor_id": "ann-03", "kind": "human"}],
                "created_at": "2026-10-14T12:00:00Z",
                "blind": True,
                "layers": [layer.model_dump(mode="json") for layer in layers()],
                "annotations": (
                    sketch_annotations() if annotations is None else annotations
                ),
            },
        }
    )


def hp_ontologies() -> dict[str, ontospan.OntologyView]:
    return {"hp": ontospan.ObographOntology.load(HP_PATH)}


def submission(
    snapshots: list[AnnotationSnapshot],
    *,
    mode: str = "independent",
    decisions: list[ReviewDecision] | None = None,
    targets: list[AnnotationRef] | None = None,
    created_at: str = "2026-10-15T09:30:00",
) -> Submission:
    target_set = ReviewTargetSet.create(targets or [])
    return Submission(
        submission_id="sub-1",
        origin_key=WorkspaceKey(
            project_key="proj",
            document_id="EN100017",
            annotator_id="ann-0007",
            mode=mode,  # type: ignore[arg-type]
            target_set_id=target_set.target_set_id,
        ),
        targets=target_set,
        draft_revision=3,
        snapshots=snapshots,
        decisions=decisions or [],
        created_at=created_at,
    )


def own_snapshot(
    document: Document,
    annotation_id: str,
    term_id: str,
    span: tuple[int, int] | None,
    axes_values: dict[str, str | None],
    *,
    method: str = "manual",
) -> AnnotationSnapshot:
    evidence = []
    refs = []
    if span is not None:
        ev = snapshot_evidence(
            EvidenceMention(
                evidence_id=f"{annotation_id}-e",
                segments=[Segment(start=span[0], end=span[1])],
            ),
            document,
        )
        evidence.append(ev)
        refs.append(EvidenceRef(evidence_id=f"{annotation_id}-e", version=ev.version))
    annotation = Annotation(
        annotation_id=annotation_id,
        document_id=document.document_id,
        layer_id="hpo",
        type_id="phenotype",
        term_id=term_id,
        axes_values=axes_values,
        evidence_refs=refs,
        provenance=Provenance(
            actor=ActorRef(actor_id="ann-0007", kind="human"), method=method
        ),
    )
    return snapshot(annotation, evidence, document, hpo_profile())


def test_a_unit_becomes_proposals_with_urn_ids_and_evidence() -> None:
    unit = sketch_unit()
    document = document_from_unit(unit)
    assert document.text == TEXT
    assert document.text_sha256 == unit.document.text_sha256

    imported = unit_to_proposals(unit, hpo_profile(), document, bundle_id=BUNDLE_ID)

    assert len(imported.annotations) == 2
    for snap in imported.annotations:
        assert snap.annotation.annotation_id.startswith("urn:ontospan:")
        assert snap.annotation.type_id == "phenotype"
        verify_snapshot(snap)
    first = imported.annotations[0]
    assert first.annotation.axes_values == {
        "assertion": "absent",
        "experiencer": "patient",
        "temporality": "historical",
    }
    [evidence] = first.evidence
    assert evidence.mention.evidence_id == f"{first.annotation.annotation_id}#m0"
    assert [(s.start, s.end) for s in evidence.mention.segments] == [(6, 19)]
    assert [(s.start, s.end) for s in evidence.mention.cue_segments] == [(0, 5)]
    assert {e.mention.evidence_id for e in imported.evidence} == {
        e.mention.evidence_id for s in imported.annotations for e in s.evidence
    }
    assert first.annotation.provenance.actor == ActorRef(
        actor_id="ann-03", kind="human"
    )
    assert first.annotation.provenance.method == "manual"
    # Three of the six axis values were defaulted; the basis is kept (user, Q-basis).
    assert imported.defaulted_axes == 3


def test_imported_ids_keep_bundle_set_and_annotation_id() -> None:
    unit = sketch_unit()
    imported = unit_to_proposals(
        unit, hpo_profile(), document_from_unit(unit), bundle_id=BUNDLE_ID
    )
    refs = [
        ontospan.parse_annotation_ref(s.annotation.annotation_id)
        for s in imported.annotations
    ]
    assert refs == [
        ontospan.AnnotationRef(SET_ID, "a1", BUNDLE_ID),
        ontospan.AnnotationRef(SET_ID, "a2", BUNDLE_ID),
    ]
    first, second = (s.annotation.annotation_id for s in imported.annotations)
    assert imported.notes == {first: ["negated in the neonatal period"], second: []}

    single = unit_to_proposals(
        unit, hpo_profile(), document_from_unit(unit), bundle_id=None
    )
    assert ontospan.parse_annotation_ref(
        single.annotations[0].annotation.annotation_id
    ) == ontospan.AnnotationRef(SET_ID, "a1", None)


def test_a_document_level_annotation_has_no_evidence() -> None:
    annotations = sketch_annotations()[:1]
    annotations[0]["mentions"] = []
    annotations[0]["document_level"] = True
    unit = sketch_unit(annotations)
    imported = unit_to_proposals(
        unit, hpo_profile(), document_from_unit(unit), bundle_id=None
    )
    [snap] = imported.annotations
    assert snap.evidence == []
    assert snap.annotation.evidence_refs == []
    assert imported.evidence == []


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"layer_id": "mondo"}, "T1_UNKNOWN_LAYER"),
        (
            {"axes": axes(assertion=("absent", "chosen"), severity=("mild", "chosen"))},
            "T1_UNKNOWN_AXIS",
        ),
    ],
)
def test_unknown_layers_and_axes_are_refused(change: dict[str, Any], code: str) -> None:
    annotations = sketch_annotations()
    annotations[1].update(change)
    unit = sketch_unit(annotations)
    with pytest.raises(DomainError) as excinfo:
        unit_to_proposals(unit, hpo_profile(), document_from_unit(unit), bundle_id=None)
    assert excinfo.value.code == code
    assert isinstance(excinfo.value.details, dict)
    assert excinfo.value.details["annotations"] == ["a2"]


def test_an_axis_value_outside_the_profile_is_refused() -> None:
    annotations = sketch_annotations()
    annotations[0]["axes"]["temporality"] = {"value": "future", "basis": "chosen"}
    unit = sketch_unit(annotations)
    with pytest.raises(DomainError) as excinfo:
        unit_to_proposals(unit, hpo_profile(), document_from_unit(unit), bundle_id=None)
    assert excinfo.value.code == "T1_UNKNOWN_AXIS_VALUE"
    assert isinstance(excinfo.value.details, dict)
    assert excinfo.value.details["annotations"] == ["a1"]


def test_modifiers_refuse_the_whole_unit() -> None:
    unit = sketch_unit(sketch_annotations(modifiers=True))
    with pytest.raises(DomainError) as excinfo:
        unit_to_proposals(unit, hpo_profile(), document_from_unit(unit), bundle_id=None)
    assert excinfo.value.code == "T1_UNSUPPORTED"
    assert excinfo.value.details == {"annotations": ["a2"]}


def test_layers_carry_the_pin() -> None:
    [layer] = layers()
    assert layer.layer_id == "hpo"
    assert layer.profile == "hpo-phenotype"
    assert layer.ontology == ontospan.OntologyResource(
        id="hp", version="2026-06-23", sha256=HP_SHA
    )
    assert layer.allowed_roots == ("HP:0000118",)
    generic = layers_for(hpo_profile(), {"hp": Pin(sha256=HP_SHA)})
    assert generic[0].profile == "generic"
    assert generic[0].allowed_roots == ()


def test_a_submission_round_trips_through_t1() -> None:
    unit = sketch_unit()
    document = document_from_unit(unit)
    imported = unit_to_proposals(unit, hpo_profile(), document, bundle_id=BUNDLE_ID)

    exported, counts = submission_to_unit(
        submission(imported.annotations),
        document,
        hpo_profile(),
        layers(),
        {},
        set_id="proj:ann-0007:independent:sub-1",
        source_text_sha256=unit.document.source_text_sha256,
    )

    report = ontospan.validate(exported, hp_ontologies())
    assert report.ok, report.errors
    assert exported.document == unit.document
    aset = exported.annotation_set
    assert aset.annotation_set_id == "proj:ann-0007:independent:sub-1"
    assert aset.set_kind == "individual"
    assert aset.stage == "independent"
    assert aset.blind is True
    assert aset.guideline_ref is None
    assert aset.actors == (ontospan.Actor(actor_id="ann-0007", kind="human"),)
    assert aset.created_at == datetime(2026, 10, 15, 9, 30, tzinfo=UTC)
    # The three defaulted values of the sketch stay defaulted (user, 2026-10-15).
    assert counts == {"rejected": 0, "uncertain": 0, "defaulted_axes": 3}

    def essence(annotation: ontospan.Annotation) -> tuple[Any, ...]:
        return (
            annotation.term_id,
            annotation.axes,
            annotation.mentions,
            annotation.document_level,
        )

    assert [essence(a) for a in aset.annotations] == [
        essence(a) for a in unit.annotation_set.annotations
    ]
    assert all(a.provenance.method == "manual" for a in aset.annotations)


def test_review_decisions_map_to_methods_and_counts() -> None:
    unit = sketch_unit()
    document = document_from_unit(unit)
    proposals = unit_to_proposals(
        unit, hpo_profile(), document, bundle_id=BUNDLE_ID
    ).annotations
    confirmed, changed = proposals
    # A third proposal that the reviewer rejects and a fourth left uncertain.
    rejected = own_snapshot(
        document,
        "p-rejected",
        "HP:0001252",
        (6, 19),
        {"assertion": "present"},
        method="tool",
    )
    uncertain = own_snapshot(document, "p-uncertain", "HP:0001284", None, {})
    replacement = own_snapshot(
        document,
        "r-1",
        "HP:0002133",
        (63, 76),
        {"assertion": "present", "experiencer": "patient", "temporality": "current"},
    )
    new = own_snapshot(document, "n-1", "HP:0000365", None, {"assertion": "absent"})

    def ref(snap: AnnotationSnapshot) -> AnnotationRef:
        return AnnotationRef(
            annotation_id=snap.annotation.annotation_id, version=snap.version
        )

    decisions = [
        ReviewDecision(
            decision_id="d1",
            target=ref(confirmed),
            outcome="confirmed",
            reviewer_id="ann-0007",
        ),
        ReviewDecision(
            decision_id="d2",
            target=ref(changed),
            outcome="changed",
            replacement=ref(replacement),
            reviewer_id="ann-0007",
        ),
        ReviewDecision(
            decision_id="d3",
            target=ref(rejected),
            outcome="rejected",
            reviewer_id="ann-0007",
        ),
        ReviewDecision(
            decision_id="d4",
            target=ref(uncertain),
            outcome="uncertain",
            reviewer_id="ann-0007",
        ),
    ]
    all_proposals = {
        (s.annotation.annotation_id, s.version): s
        for s in [*proposals, rejected, uncertain]
    }
    sub = submission(
        [confirmed, replacement, new],
        mode="review",
        decisions=decisions,
        targets=[ref(s) for s in all_proposals.values()],
    )

    exported, counts = submission_to_unit(
        sub,
        document,
        hpo_profile(),
        layers(),
        all_proposals,
        set_id="proj:ann-0007:review:sub-1",
    )

    assert exported.annotation_set.blind is False
    assert exported.annotation_set.stage == "review"
    by_term = {
        (a.term_id, a.provenance.method): a for a in exported.annotation_set.annotations
    }
    assert set(by_term) == {
        ("HP:0001250", "adopted"),
        ("HP:0002133", "edited"),
        ("HP:0000365", "manual"),
    }
    adopted = by_term[("HP:0001250", "adopted")]
    assert adopted.provenance.source_refs == (confirmed.annotation.annotation_id,)
    assert adopted.provenance.actor == ontospan.Actor(actor_id="ann-0007", kind="human")
    edited = by_term[("HP:0002133", "edited")]
    assert edited.provenance.source_refs == (changed.annotation.annotation_id,)
    assert counts["rejected"] == 1
    assert counts["uncertain"] == 1
    # The new annotation has two empty HPO axes; the adopted proposal keeps
    # its defaulted experiencer (resolved 2026-10-15, user).
    assert adopted.axes["experiencer"].basis == "defaulted"
    assert adopted.axes["assertion"].basis == "chosen"
    assert counts["defaulted_axes"] == 3
    assert by_term[("HP:0000365", "manual")].document_level is True
    report = ontospan.validate(exported, hp_ontologies())
    assert report.ok, report.errors


def test_a_proposal_without_an_urn_is_referenced_in_the_project() -> None:
    document = document_from_unit(sketch_unit())
    proposal = own_snapshot(
        document, "p-1", "HP:0001250", (6, 19), {"assertion": "absent"}
    )
    target = AnnotationRef(annotation_id="p-1", version=proposal.version)
    sub = submission(
        [proposal],
        mode="review",
        decisions=[
            ReviewDecision(
                decision_id="d1",
                target=target,
                outcome="confirmed",
                reviewer_id="ann-0007",
            )
        ],
        targets=[target],
    )
    exported, _ = submission_to_unit(
        sub,
        document,
        hpo_profile(),
        layers(),
        {("p-1", proposal.version): proposal},
        set_id="s",
    )
    [annotation] = exported.annotation_set.annotations
    assert annotation.provenance.source_refs == (
        ontospan.annotation_ref("proj:proposals", "p-1"),
    )


def test_methods_map_to_the_closed_t1_list() -> None:
    document = document_from_unit(sketch_unit())
    snaps = [
        own_snapshot(document, "m1", "HP:0001250", None, {}, method="manual"),
        own_snapshot(document, "m2", "HP:0001252", None, {}, method="search"),
        own_snapshot(document, "m3", "HP:0001284", None, {}, method="merged"),
    ]
    exported, _ = submission_to_unit(
        submission(snaps), document, hpo_profile(), layers(), {}, set_id="s"
    )
    assert [a.provenance.method for a in exported.annotation_set.annotations] == [
        "manual",
        "manual",
        "merged",
    ]


def test_empty_hpo_axes_are_defaulted() -> None:
    document = document_from_unit(sketch_unit())
    snap = own_snapshot(
        document,
        "x1",
        "HP:0001250",
        (6, 19),
        {"assertion": "absent", "experiencer": None},
    )
    exported, counts = submission_to_unit(
        submission([snap]), document, hpo_profile(), layers(), {}, set_id="s"
    )
    [annotation] = exported.annotation_set.annotations
    defaults = ontospan.default_axes()
    assert annotation.axes["assertion"] == ontospan.AxisValue(
        value="absent", basis="chosen"
    )
    for axis in ("experiencer", "temporality"):
        assert annotation.axes[axis].basis == "defaulted"
        assert annotation.axes[axis].value == defaults[axis].value
    assert counts["defaulted_axes"] == 2

    generic = layers_for(hpo_profile(), {"hp": Pin(sha256=HP_SHA)})
    exported, counts = submission_to_unit(
        submission([snap]), document, hpo_profile(), generic, {}, set_id="s"
    )
    [annotation] = exported.annotation_set.annotations
    assert set(annotation.axes) == {"assertion"}
    assert counts["defaulted_axes"] == 0


def test_defaulted_axis_values_keep_their_basis() -> None:
    """Resolved 2026-10-15 (user): the basis is stored and exported faithfully."""
    unit = sketch_unit()
    imported = unit_to_proposals(
        unit, hpo_profile(), document_from_unit(unit), bundle_id=BUNDLE_ID
    )
    first, second = sorted(
        imported.annotations, key=lambda s: s.annotation.annotation_id
    )

    assert first.annotation.axes_defaulted == ["experiencer"]
    assert second.annotation.axes_defaulted == ["assertion", "experiencer"]
    verify_snapshot(first)
    # Basis is content: the same values chosen are another version.
    chosen = first.annotation.model_copy(update={"axes_defaulted": []})
    assert (
        snapshot(
            chosen, first.evidence, document_from_unit(unit), hpo_profile()
        ).version
        != first.version
    )


def test_a_snapshot_without_defaulted_values_keeps_its_old_version() -> None:
    document = document_from_unit(sketch_unit())
    snap = own_snapshot(document, "a1", "HP:0001250", (6, 19), {"assertion": "present"})

    assert "axes_defaulted" not in encode_snapshot(snap)["annotation"]
    verify_snapshot(snap)


def test_setting_axes_makes_only_changed_values_chosen() -> None:
    document = document_from_unit(sketch_unit())
    annotation = own_snapshot(
        document,
        "a1",
        "HP:0001250",
        (6, 19),
        {"assertion": "present", "experiencer": "patient", "temporality": "current"},
    ).annotation.model_copy(update={"axes_defaulted": ["assertion", "experiencer"]})

    updated = annotation.with_axes(
        {"assertion": "absent", "experiencer": "patient", "temporality": "current"}
    )

    assert updated.axes_values["assertion"] == "absent"
    assert updated.axes_defaulted == ["experiencer"]
    assert annotation.with_axes({"assertion": "present"}).axes_defaulted == [
        "assertion"
    ]


def test_hpo_phenotype_profiles_use_only_t1_values() -> None:
    """Resolved 2026-10-15 (user): values may be hidden, never added."""
    check_t1_profile(hpo_profile(), PINS)
    hidden = hpo_profile()
    axes_list = hidden.layers[0].annotation_types[0].axes
    axes_list[1] = axes_list[1].model_copy(update={"options": ["patient", "other"]})
    check_t1_profile(hidden, PINS)

    added = hpo_profile()
    axes_list = added.layers[0].annotation_types[0].axes
    axes_list[2] = axes_list[2].model_copy(
        update={"options": ["current", "historical", "future"]}
    )
    axes_list.append(
        axes_list[0].model_copy(update={"id": "severity", "options": ["mild"]})
    )
    with pytest.raises(DomainError) as error:
        check_t1_profile(added, PINS)
    assert error.value.code == "PROFILE_NOT_T1"
    assert error.value.details == {
        "problems": [
            {"layer_id": "hpo", "axis": "temporality", "values": ["future"]},
            {"layer_id": "hpo", "axis": "severity", "values": None},
        ]
    }
    # A generic layer has no closed lists.
    check_t1_profile(added, {"hp": Pin(sha256=HP_SHA)})


def test_the_example_hpo_profile_fits_t1() -> None:
    raw = (
        Path(__file__).parent.parent
        / "src/ontocurator/profiles/hpo-context-example-v1.json"
    ).read_text(encoding="utf-8")
    profile = TaskProfile.model_validate_json(raw)

    check_t1_profile(profile, {"hp": Pin(sha256="0" * 64, t1_profile="hpo-phenotype")})


def test_annotation_note_preserves_legacy_hash_and_historical_whitespace():
    from ontocurator.domain.serialization import decode_snapshot

    doc = document_from_unit(sketch_unit())
    original = own_snapshot(doc, "own", "HP:0001250", None, {})
    raw = encode_snapshot(original)
    assert "note" not in raw["annotation"]
    assert (
        original.version
        == "da4e6537a48aae9ca2d18127a9b69f666f47f4237d2cd8637f22d68ecf0b9f80"
    )
    assert encode_snapshot(decode_snapshot(raw)) == raw
    annotated = snapshot(
        original.annotation.model_copy(update={"note": "  µ reason  "}),
        [],
        doc,
        hpo_profile(),
    )
    assert annotated.version != original.version
    assert decode_snapshot(encode_snapshot(annotated)).annotation.note == "  µ reason  "
    verify_snapshot(annotated)
    empty = snapshot(
        original.annotation.model_copy(update={"note": ""}), [], doc, hpo_profile()
    )
    assert empty.version == original.version
    assert "note" not in encode_snapshot(empty)["annotation"]


@pytest.mark.parametrize(
    "source_notes", [[], ["source"], ["source", "other", "source", "µ reason"]]
)
def test_export_annotation_justification_then_exact_source_notes(source_notes):
    doc = document_from_unit(sketch_unit())
    original = own_snapshot(doc, "own", "HP:0001250", None, {})
    noted = snapshot(
        original.annotation.model_copy(update={"note": "µ reason"}),
        [],
        doc,
        hpo_profile(),
    )
    unit, _ = submission_to_unit(
        submission([noted]),
        doc,
        hpo_profile(),
        layers(),
        {},
        set_id="out",
        proposal_notes={(noted.annotation.annotation_id, noted.version): source_notes},
    )
    assert list(unit.annotation_set.annotations[0].provenance.notes) == list(
        dict.fromkeys(["µ reason", *source_notes])
    )


@pytest.mark.parametrize("outcome", ["confirmed", "changed"])
def test_review_export_retains_source_notes_on_exact_target(outcome):
    doc = document_from_unit(sketch_unit())
    source = own_snapshot(doc, "source", "HP:0001250", None, {})
    replacement = own_snapshot(doc, "replacement", "HP:0001252", None, {})
    ref = AnnotationRef(annotation_id="source", version=source.version)
    result = source if outcome == "confirmed" else replacement
    decision = ReviewDecision(
        decision_id="d",
        target=ref,
        outcome=outcome,
        reviewer_id="ann-0007",
        replacement=AnnotationRef(
            annotation_id="replacement", version=replacement.version
        )
        if outcome == "changed"
        else None,
    )
    unit, _ = submission_to_unit(
        submission([result], mode="review", decisions=[decision], targets=[ref]),
        doc,
        hpo_profile(),
        layers(),
        {("source", source.version): source},
        set_id="out",
        proposal_notes={
            ("source", source.version): ["source note", "other"],
            ("source", "stale-version"): ["wrong"],
        },
    )
    assert list(unit.annotation_set.annotations[0].provenance.notes) == [
        "source note",
        "other",
    ]


def test_independent_adoption_export_preserves_exact_imported_source_notes():
    doc = document_from_unit(sketch_unit())
    source = own_snapshot(doc, "urn:source", "HP:0001250", None, {})
    copy = own_snapshot(doc, "copy", "HP:0001250", None, {})
    provenance = copy.annotation.provenance.model_copy(
        update={"source_refs": [f"urn:source:{source.version}"]}
    )
    copy = snapshot(
        copy.annotation.model_copy(update={"note": "Reason", "provenance": provenance}),
        [],
        doc,
        hpo_profile(),
    )
    unit, _ = submission_to_unit(
        submission([copy]),
        doc,
        hpo_profile(),
        layers(),
        {},
        set_id="out",
        proposal_notes={("urn:source", source.version): ["imported note"]},
    )
    assert list(unit.annotation_set.annotations[0].provenance.notes) == [
        "Reason",
        "imported note",
    ]


def test_shared_replacement_exports_notes_from_all_exact_changed_targets():
    doc = document_from_unit(sketch_unit())
    sources = [
        own_snapshot(doc, name, "HP:0001250", None, {}) for name in ("first", "second")
    ]
    original = own_snapshot(doc, "replacement", "HP:0001252", None, {})
    replacement = snapshot(
        original.annotation.model_copy(update={"note": "Reason"}),
        [],
        doc,
        hpo_profile(),
    )
    targets = [
        AnnotationRef(
            annotation_id=source.annotation.annotation_id, version=source.version
        )
        for source in sources
    ]
    replacement_ref = AnnotationRef(
        annotation_id="replacement", version=replacement.version
    )
    decisions = [
        ReviewDecision(
            decision_id=f"d-{index}",
            target=target,
            outcome="changed",
            reviewer_id="ann-0007",
            replacement=replacement_ref,
        )
        for index, target in enumerate(targets)
    ]
    unit, _ = submission_to_unit(
        submission([replacement], mode="review", decisions=decisions, targets=targets),
        doc,
        hpo_profile(),
        layers(),
        {
            (source.annotation.annotation_id, source.version): source
            for source in sources
        },
        set_id="out",
        proposal_notes={
            ("first", sources[0].version): ["first source note", "shared", "Reason"],
            ("second", sources[1].version): ["second source note", "shared", "Reason"],
            ("first", "wrong-version"): ["must not export"],
            ("second", "wrong-version"): ["also must not export"],
        },
    )
    assert len(unit.annotation_set.annotations) == 1
    assert list(unit.annotation_set.annotations[0].provenance.notes) == [
        "Reason",
        "first source note",
        "shared",
        "second source note",
    ]
