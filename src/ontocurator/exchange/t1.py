"""Mapping between Ontocurator snapshots and ontospan (T1) units.

Pure functions without database access (T2d Task 1). Import turns the
annotation set of a unit into proposals; export turns a submission into an
``individual`` set.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, TypedDict

import ontospan
from ontospan.models import Method

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
    snapshot_evidence,
    validate_segments,
)
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import (
    LayerDefinition,
    TaskProfile,
    resolve_ontology,
    resolve_type,
)
from ontocurator.domain.review import ReviewDecision
from ontocurator.domain.workspace import Submission

T1Profile = Literal["generic", "hpo-phenotype"]
HPO_PROFILE: T1Profile = "hpo-phenotype"
# Methods of the closed T1 list that keep their name on export.
KEPT_METHODS = frozenset({"manual", "adopted", "edited", "merged"})


@dataclass(frozen=True)
class Pin:
    """A project's pin of one ontology: file, allowed roots and T1 profile."""

    sha256: str
    allowed_roots: tuple[str, ...] = ()
    t1_profile: T1Profile = "generic"


@dataclass(frozen=True)
class ImportedProposals:
    """The proposals of one unit.

    ``notes`` maps every annotation id to its T1 provenance notes; they are not
    part of the snapshot. ``dropped_basis`` counts the axis values that arrived
    with ``basis: defaulted``: the value is stored, the basis is not.
    """

    annotations: list[AnnotationSnapshot]
    evidence: list[EvidenceSnapshot]
    notes: dict[str, list[str]] = field(default_factory=dict)
    dropped_basis: int = 0


class ExportCounts(TypedDict):
    rejected: int
    uncertain: int
    defaulted_axes: int


def document_from_unit(unit: ontospan.AnnotatedDocument) -> Document:
    """The unit's canonical text as a document.

    ``unit.document.source_text_sha256`` is not part of ``Document``; the
    importer stores it from the unit.
    """
    doc = unit.document
    return Document(
        document_id=doc.document_id,
        text=doc.text,
        language=doc.language,
        text_sha256=doc.text_sha256,
    )


def layers_for(profile: TaskProfile, pins: Mapping[str, Pin]) -> list[ontospan.Layer]:
    """One T1 layer per profile layer, described by the pin of its ontology."""
    result = []
    for layer in profile.layers:
        ontology = resolve_ontology(profile, layer.ontology_id)
        pin = pins.get(layer.ontology_id)
        if pin is None:
            raise DomainError(
                "PIN_MISSING",
                {"ontology_id": layer.ontology_id, "layer_id": layer.layer_id},
            )
        result.append(
            ontospan.Layer(
                layer_id=layer.layer_id,
                profile=pin.t1_profile,
                ontology=ontospan.OntologyResource(
                    id=layer.ontology_id, version=ontology.release, sha256=pin.sha256
                ),
                allowed_roots=pin.allowed_roots,
            )
        )
    return result


# --- import -----------------------------------------------------------------


def _layer_map(profile: TaskProfile) -> dict[str, LayerDefinition]:
    return {layer.layer_id: layer for layer in profile.layers}


def _refuse_unrepresentable(
    annotations: Sequence[ontospan.Annotation], profile: TaskProfile
) -> None:
    """Refuse the whole unit, listing every affected annotation (Q11)."""
    with_modifiers = [a.annotation_id for a in annotations if a.modifiers]
    if with_modifiers:
        raise DomainError("T1_UNSUPPORTED", {"annotations": with_modifiers})
    layers = _layer_map(profile)
    unknown_layers = [a for a in annotations if a.layer_id not in layers]
    if unknown_layers:
        raise DomainError(
            "T1_UNKNOWN_LAYER",
            {
                "annotations": [a.annotation_id for a in unknown_layers],
                "layers": sorted({a.layer_id for a in unknown_layers}),
            },
        )
    unknown_axes: dict[str, list[str]] = {}
    bad_values: dict[str, dict[str, str]] = {}
    for annotation in annotations:
        layer = layers[annotation.layer_id]
        options = {
            axis.id: axis.options
            for axis in resolve_type(
                profile, layer.layer_id, layer.default_type_id
            ).axes
        }
        for axis, value in annotation.axes.items():
            if axis not in options:
                unknown_axes.setdefault(annotation.annotation_id, []).append(axis)
            elif value.value not in options[axis]:
                bad_values.setdefault(annotation.annotation_id, {})[axis] = value.value
    if unknown_axes:
        raise DomainError(
            "T1_UNKNOWN_AXIS",
            {
                "annotations": list(unknown_axes),
                "axes": sorted({a for axes in unknown_axes.values() for a in axes}),
            },
        )
    if bad_values:
        raise DomainError(
            "T1_UNKNOWN_AXIS_VALUE",
            {"annotations": list(bad_values), "values": bad_values},
        )


def _segments(segments: Sequence[ontospan.Segment]) -> list[Segment]:
    return [Segment(start=s.start, end=s.end) for s in segments]


def unit_to_proposals(
    unit: ontospan.AnnotatedDocument,
    profile: TaskProfile,
    document: Document,
    *,
    bundle_id: str | None,
) -> ImportedProposals:
    """One proposal snapshot per T1 annotation of the unit.

    Ids are ``urn:ontospan:[<bundle>:]<set>:<annotation>``, so the producer's ids
    stay recoverable and sets never collide. A unit with anything Ontocurator
    cannot represent is refused as a whole.
    """
    aset = unit.annotation_set
    _refuse_unrepresentable(aset.annotations, profile)
    layers = _layer_map(profile)
    snapshots: list[AnnotationSnapshot] = []
    evidence: list[EvidenceSnapshot] = []
    notes: dict[str, list[str]] = {}
    dropped_basis = 0
    for item in aset.annotations:
        annotation_id = ontospan.annotation_ref(
            aset.annotation_set_id, item.annotation_id, bundle_id
        )
        own_evidence: list[EvidenceSnapshot] = []
        if not item.document_level:
            for index, mention in enumerate(item.mentions):
                evidence_mention = EvidenceMention(
                    evidence_id=f"{annotation_id}#m{index}",
                    segments=_segments(mention.segments),
                    cue_segments=_segments(mention.cue_segments),
                )
                validate_segments(document.text, [evidence_mention])
                own_evidence.append(snapshot_evidence(evidence_mention, document))
        dropped_basis += sum(
            1 for value in item.axes.values() if value.basis == "defaulted"
        )
        annotation = Annotation(
            annotation_id=annotation_id,
            document_id=document.document_id,
            layer_id=item.layer_id,
            type_id=layers[item.layer_id].default_type_id,
            term_id=item.term_id,
            axes_values={axis: value.value for axis, value in item.axes.items()},
            evidence_refs=[
                EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
                for e in own_evidence
            ],
            provenance=Provenance(
                actor=ActorRef(
                    actor_id=item.provenance.actor.actor_id,
                    kind=item.provenance.actor.kind,
                ),
                method=item.provenance.method,
                source_refs=list(item.provenance.source_refs),
            ),
        )
        snapshots.append(snapshot(annotation, own_evidence, document, profile))
        evidence.extend(own_evidence)
        notes[annotation_id] = list(item.provenance.notes)
    return ImportedProposals(snapshots, evidence, notes, dropped_basis)


# --- export -----------------------------------------------------------------


def _created_at(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _proposal_ref(annotation_id: str, project: str) -> str:
    """The URN of a proposal; imported ones already are one."""
    try:
        ontospan.parse_annotation_ref(annotation_id)
    except ValueError:
        return ontospan.annotation_ref(f"{project}:proposals", annotation_id)
    return annotation_id


def _method(provenance: Provenance) -> Method:
    method = provenance.method
    if method in KEPT_METHODS:
        return method  # type: ignore[return-value]
    return "tool" if provenance.actor.kind == "tool" else "manual"


def _axes(
    snap: AnnotationSnapshot, t1_profile: str
) -> tuple[dict[str, ontospan.AxisValue], int]:
    axes = {
        axis: ontospan.AxisValue(value=value, basis="chosen")
        for axis, value in snap.annotation.axes_values.items()
        if value
    }
    defaulted = 0
    if t1_profile == HPO_PROFILE:
        for axis, default in ontospan.default_axes().items():
            if axis not in axes:
                axes[axis] = default
                defaulted += 1
    return axes, defaulted


def _mentions(snap: AnnotationSnapshot, text: str) -> tuple[ontospan.Mention, ...]:
    by_ref = {(e.mention.evidence_id, e.version): e for e in snap.evidence}
    mentions = []
    for ref in snap.annotation.evidence_refs:
        mention = by_ref[(ref.evidence_id, ref.version)].mention
        mentions.append(
            ontospan.Mention(
                segments=tuple(
                    ontospan.segment(text, s.start, s.end) for s in mention.segments
                ),
                cue_segments=tuple(
                    ontospan.segment(text, s.start, s.end) for s in mention.cue_segments
                ),
            )
        )
    return tuple(mentions)


def submission_to_unit(
    submission: Submission,
    document: Document,
    profile: TaskProfile,
    layers: Sequence[ontospan.Layer],
    proposals: Mapping[tuple[str, str], AnnotationSnapshot],
    *,
    set_id: str,
    source_text_sha256: str | None = None,
) -> tuple[ontospan.AnnotatedDocument, ExportCounts]:
    """One ``individual`` set with the annotator's resulting annotations (Q12).

    In review mode confirmed proposals become ``adopted`` and changed ones
    ``edited`` (both with the proposal's URN in ``source_refs`` and the reviewer
    as actor); rejected and uncertain decisions are left out and counted.
    """
    key = submission.origin_key
    reviewer = ontospan.Actor(actor_id=key.annotator_id, kind="human")
    t1_profiles = {layer.layer_id: layer.profile for layer in layers}
    counts: ExportCounts = {"rejected": 0, "uncertain": 0, "defaulted_axes": 0}

    # (annotation id, version) -> (method, source ref) for review results.
    reviewed: dict[tuple[str, str], tuple[Method, str]] = {}
    snapshots = list(submission.snapshots)
    present = {(s.annotation.annotation_id, s.version) for s in snapshots}
    decision: ReviewDecision
    for decision in submission.decisions if key.mode == "review" else []:
        target = (decision.target.annotation_id, decision.target.version)
        source = _proposal_ref(decision.target.annotation_id, key.package_id)
        if decision.outcome == "confirmed":
            reviewed[target] = ("adopted", source)
            if target not in present:
                proposal = proposals.get(target)
                if proposal is None:
                    raise DomainError(
                        "TARGET_NOT_FOUND",
                        {"annotation_id": target[0], "version": target[1]},
                    )
                snapshots.append(proposal)
                present.add(target)
        elif decision.outcome == "changed":
            assert decision.replacement is not None  # enforced by ReviewDecision
            replacement = (
                decision.replacement.annotation_id,
                decision.replacement.version,
            )
            reviewed[replacement] = ("edited", source)
        elif decision.outcome == "rejected":
            counts["rejected"] += 1
        else:
            counts["uncertain"] += 1

    annotations = []
    for snap in snapshots:
        item = snap.annotation
        review = reviewed.get((item.annotation_id, snap.version))
        if review is not None:
            provenance = ontospan.Provenance(
                actor=reviewer, method=review[0], source_refs=(review[1],)
            )
        else:
            provenance = ontospan.Provenance(
                actor=ontospan.Actor(
                    actor_id=item.provenance.actor.actor_id,
                    kind=item.provenance.actor.kind,
                ),
                method=_method(item.provenance),
                source_refs=tuple(item.provenance.source_refs),
            )
        axes, defaulted = _axes(snap, t1_profiles.get(item.layer_id, "generic"))
        counts["defaulted_axes"] += defaulted
        mentions = _mentions(snap, document.text)
        annotations.append(
            ontospan.Annotation(
                annotation_id=item.annotation_id,
                layer_id=item.layer_id,
                term_id=item.term_id,
                axes=axes,
                mentions=mentions,
                document_level=not mentions,
                provenance=provenance,
            )
        )

    unit = ontospan.AnnotatedDocument(
        document=ontospan.Document(
            document_id=document.document_id,
            language=document.language,
            text=document.text,
            text_sha256=document.text_sha256,
            source_text_sha256=source_text_sha256,
        ),
        annotation_set=ontospan.AnnotationSet(
            annotation_set_id=set_id,
            set_kind="individual",
            stage=key.mode,
            actors=(reviewer,),
            created_at=_created_at(submission.created_at),
            blind=key.mode == "independent",
            guideline_ref=None,
            layers=tuple(layers),
            annotations=tuple(annotations),
        ),
    )
    return unit, counts
