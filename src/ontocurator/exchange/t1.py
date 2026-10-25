"""Mapping between Ontocurator snapshots and ontospan (T1) units.

Pure functions without database access (T2d Task 1). Import turns the
annotation set of a unit into proposals; export turns a submission into an
``individual`` set.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict

import ontospan
from ontospan.models import Method
from ontospan.profiles.hpo import AXES as HPO_AXES

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
from ontocurator.domain.scopes import is_review_like
from ontocurator.domain.variants import VariantInfo
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
    part of the snapshot. ``defaulted_axes`` counts the axis values that arrived
    with ``basis: defaulted``; they stay defaulted (``Annotation.axes_defaulted``).
    """

    annotations: list[AnnotationSnapshot]
    evidence: list[EvidenceSnapshot]
    notes: dict[str, list[str]] = field(default_factory=dict)
    defaulted_axes: int = 0


@dataclass(frozen=True)
class ImportedDocument:
    """A unit's document and the hash of its source text, if the unit gave one."""

    document: Document
    source_text_sha256: str | None = None
    variant: VariantInfo | None = None


@dataclass(frozen=True)
class ImportedSet:
    """One non-empty annotation set of a unit, as delivered, with its proposals."""

    document_id: str
    bundle_id: str | None
    manifest_sha256: str | None
    annotation_set_id: str
    set_kind: str
    actors: list[dict[str, Any]]
    payload: dict[str, Any]
    proposals: ImportedProposals
    origin: Literal["import", "reanchor"] = "import"
    pending_items: list[dict[str, Any]] = field(default_factory=list)


class ImportCounts(TypedDict):
    documents_added: int
    documents_skipped: int
    documents_only: int
    sets_added: int
    sets_skipped: int
    proposals: int


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

# The set kinds an import accepts with annotations (user decision Q33), each
# with the rule its set must meet. A set without annotations creates its
# document only and is accepted whatever its kind. To accept another kind,
# add it here; nothing else decides.
IMPORTABLE_SET_KINDS: dict[str, Callable[[ontospan.AnnotationSet], bool]] = {
    # Proposals of tools: every actor of the set is a tool.
    "tool_output": lambda aset: all(actor.kind == "tool" for actor in aset.actors),
}


def importable_set(aset: ontospan.AnnotationSet) -> bool:
    """Whether a set may be imported (empty sets always may)."""
    if not aset.annotations:
        return True
    rule = IMPORTABLE_SET_KINDS.get(aset.set_kind)
    return rule is not None and rule(aset)


def _unnamed_tools(aset: ontospan.AnnotationSet) -> bool:
    """Whether a tool actor lacks ``name`` or ``version`` (T7 I3).

    An annotation's tool actor may instead name a set actor that has both.
    """

    def named(actor: ontospan.Actor) -> bool:
        return bool(actor.name and actor.version)

    set_tools = [actor for actor in aset.actors if actor.kind == "tool"]
    if not all(named(actor) for actor in set_tools):
        return True
    known = {actor.actor_id for actor in set_tools}
    return any(
        not named(actor) and actor.actor_id not in known
        for actor in (item.provenance.actor for item in aset.annotations)
        if actor.kind == "tool"
    )


def check_importable(units: Sequence[ontospan.AnnotatedDocument]) -> None:
    """Refuse the whole import if any unit cannot be imported (Q11, Q33, T7 I3).

    ``T1_SET_KIND`` lists the units whose non-empty set is of a kind (or with
    actors) the import does not take; ``T1_TOOL_PROVENANCE`` the units with a
    tool actor that lacks ``name`` or ``version``.
    """
    wrong_kind = [unit for unit in units if not importable_set(unit.annotation_set)]
    if wrong_kind:
        raise DomainError(
            "T1_SET_KIND",
            {
                "units": [unit.document.document_id for unit in wrong_kind],
                "set_kinds": sorted(
                    {unit.annotation_set.set_kind for unit in wrong_kind}
                ),
                "accepted": sorted(IMPORTABLE_SET_KINDS),
            },
        )
    unnamed = [
        unit.document.document_id
        for unit in units
        if _unnamed_tools(unit.annotation_set)
    ]
    if unnamed:
        raise DomainError("T1_TOOL_PROVENANCE", {"units": unnamed})


def pin_differences(
    layers: Sequence[ontospan.Layer], profile: TaskProfile, pins: Mapping[str, Pin]
) -> list[dict[str, Any]]:
    """How the layers of a bundle differ from the project's pins (T3 A1).

    Compared per layer: the ontology id (that of the profile layer), the
    version (the pinned release), the sha256 if the layer names one, the
    allowed roots and the T1 profile. A layer the project does not know is left
    to the mapping (``T1_UNKNOWN_LAYER``).
    """
    profile_layers = _layer_map(profile)
    differences: list[dict[str, Any]] = []

    def differ(layer_id: str, field_name: str, expected: Any, found: Any) -> None:
        differences.append(
            {
                "layer_id": layer_id,
                "field": field_name,
                "expected": expected,
                "found": found,
            }
        )

    seen: set[str] = set()
    for layer in layers:
        definition = profile_layers.get(layer.layer_id)
        if definition is None or layer.layer_id in seen:
            continue
        seen.add(layer.layer_id)
        ontology_id = definition.ontology_id
        if layer.ontology.id != ontology_id:
            differ(layer.layer_id, "ontology", ontology_id, layer.ontology.id)
            continue
        pin = pins.get(ontology_id)
        if pin is None:
            differ(layer.layer_id, "pin", ontology_id, None)
            continue
        release = resolve_ontology(profile, ontology_id).release
        if layer.ontology.version != release:
            differ(layer.layer_id, "version", release, layer.ontology.version)
        if layer.ontology.sha256 is not None and layer.ontology.sha256 != pin.sha256:
            differ(layer.layer_id, "sha256", pin.sha256, layer.ontology.sha256)
        if tuple(layer.allowed_roots) != tuple(pin.allowed_roots):
            differ(
                layer.layer_id,
                "allowed_roots",
                list(pin.allowed_roots),
                list(layer.allowed_roots),
            )
        if layer.profile != pin.t1_profile:
            differ(layer.layer_id, "profile", pin.t1_profile, layer.profile)
    return differences


def _layer_map(profile: TaskProfile) -> dict[str, LayerDefinition]:
    return {layer.layer_id: layer for layer in profile.layers}


def check_t1_profile(profile: TaskProfile, pins: Mapping[str, Pin]) -> None:
    """Refuse axis values a layer's T1 profile does not know (``PROFILE_NOT_T1``).

    Resolved 2026-10-15 (user): in a layer pinned with ``hpo-phenotype`` every
    axis must be one of T1's and its options a subset of T1's closed list. A
    profile may hide values (O4) but not add any. ``generic`` layers have no
    closed lists.
    """
    problems: list[dict[str, Any]] = []
    for layer in profile.layers:
        pin = pins.get(layer.ontology_id)
        if pin is None or pin.t1_profile != HPO_PROFILE:
            continue
        for annotation_type in layer.annotation_types:
            for axis in annotation_type.axes:
                allowed = HPO_AXES.get(axis.id)
                if allowed is None:
                    problems.append(
                        {"layer_id": layer.layer_id, "axis": axis.id, "values": None}
                    )
                    continue
                extra = [value for value in axis.options if value not in allowed]
                if extra:
                    problems.append(
                        {"layer_id": layer.layer_id, "axis": axis.id, "values": extra}
                    )
    if problems:
        raise DomainError("PROFILE_NOT_T1", {"problems": problems})


def axis_options(profile: TaskProfile, layer: LayerDefinition) -> dict[str, list[str]]:
    """The values an imported axis may take: the project profile's options.

    Project profiles of ``hpo-phenotype`` layers are subsets of T1's closed
    lists (``check_t1_profile``); a value the project hides is refused with
    ``T1_UNKNOWN_AXIS_VALUE``. This is the only place that decides which
    values an import accepts.
    """
    return {
        axis.id: list(axis.options)
        for axis in resolve_type(profile, layer.layer_id, layer.default_type_id).axes
    }


def _refuse_unrepresentable(aset: ontospan.AnnotationSet, profile: TaskProfile) -> None:
    """Refuse the whole unit, listing every affected annotation (Q11).

    Modifiers are kept on ``hpo-phenotype`` layers only (the unit's layer
    profiles match the project's pins: ``pin_differences``).
    """
    annotations = aset.annotations
    for item in annotations:
        if item.review_resolution is not None:
            raise DomainError(
                "UNSUPPORTED_REVIEW_RESOLUTION", {"annotation_id": item.annotation_id}
            )
    hpo_layers = {
        layer.layer_id for layer in aset.layers if layer.profile == HPO_PROFILE
    }
    with_modifiers = [
        a.annotation_id
        for a in annotations
        if a.modifiers and a.layer_id not in hpo_layers
    ]
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
        options = axis_options(profile, layers[annotation.layer_id])
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


def imported_axis_values(
    item: ontospan.Annotation,
) -> tuple[dict[str, str | None], list[str]]:
    """The axis values of an imported annotation and the axes that were defaulted.

    Resolved 2026-10-15 (user): the basis is kept, so a defaulted value is
    exported as defaulted again and never turns into a choice.
    """
    values: dict[str, str | None] = {
        axis: value.value for axis, value in item.axes.items()
    }
    defaulted = sorted(
        axis for axis, value in item.axes.items() if value.basis == "defaulted"
    )
    return values, defaulted


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
    _refuse_unrepresentable(aset, profile)
    layers = _layer_map(profile)
    snapshots: list[AnnotationSnapshot] = []
    evidence: list[EvidenceSnapshot] = []
    notes: dict[str, list[str]] = {}
    defaulted_axes = 0
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
        axes_values, defaulted = imported_axis_values(item)
        defaulted_axes += len(defaulted)
        annotation = Annotation(
            annotation_id=annotation_id,
            document_id=document.document_id,
            layer_id=item.layer_id,
            type_id=layers[item.layer_id].default_type_id,
            term_id=item.term_id,
            axes_values=axes_values,
            axes_defaulted=defaulted,
            modifiers=[
                Modifier(term_id=m.term_id, segments=_segments(m.segments))
                for m in item.modifiers
            ],
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
    return ImportedProposals(snapshots, evidence, notes, defaulted_axes)


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


def _export_source_ref(
    source_ref: str,
    project: str,
    proposals: Mapping[tuple[str, str], AnnotationSnapshot],
) -> str:
    """Normalize verified internal identities before accepting external URNs."""
    source_id, separator, version = source_ref.rpartition(":")
    if (
        separator
        and len(version) == 64
        and all(char in "0123456789abcdefABCDEF" for char in version)
        and (source_id, version) in proposals
    ):
        return _proposal_ref(source_id, project)
    # A hash-looking external annotation ID is valid without an inventory hit.
    ontospan.parse_annotation_ref(source_ref)
    return source_ref


def _method(provenance: Provenance) -> Method:
    method = provenance.method
    if method in KEPT_METHODS:
        return method  # type: ignore[return-value]
    return "tool" if provenance.actor.kind == "tool" else "manual"


def _axes(
    snap: AnnotationSnapshot, t1_profile: str
) -> tuple[dict[str, ontospan.AxisValue], int]:
    marked = set(snap.annotation.axes_defaulted)
    axes = {
        axis: ontospan.AxisValue(
            value=value, basis="defaulted" if axis in marked else "chosen"
        )
        for axis, value in snap.annotation.axes_values.items()
        if value
    }
    if t1_profile == HPO_PROFILE:
        for axis, default in ontospan.default_axes().items():
            if axis not in axes:
                axes[axis] = default
    defaulted = sum(1 for value in axes.values() if value.basis == "defaulted")
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


def reviewed_provenance(
    reviewer: ontospan.Actor, method: Method, source_refs: Sequence[str]
) -> ontospan.Provenance:
    """The provenance of an adopted or edited annotation in a review export.

    Confirmed 2026-10-15 (user): the reviewer is the actor and the proposal
    is named in ``source_refs``. This is the only place that decides it.
    """
    return ontospan.Provenance(
        actor=reviewer, method=method, source_refs=tuple(source_refs)
    )


def submission_to_unit(
    submission: Submission,
    document: Document,
    profile: TaskProfile,
    layers: Sequence[ontospan.Layer],
    proposals: Mapping[tuple[str, str], AnnotationSnapshot],
    *,
    set_id: str,
    proposal_notes: Mapping[tuple[str, str], Sequence[str]] | None = None,
    source_text_sha256: str | None = None,
    guideline_ref: str | None = None,
    variant: VariantInfo | None = None,
    source_variant_hashes: Mapping[str, str] | None = None,
    single_native_case: bool = True,
    source_ref_overrides: Mapping[str, str] | None = None,
) -> tuple[ontospan.AnnotatedDocument, ExportCounts]:
    """One ``individual`` set with the annotator's resulting annotations (Q12).

    In review mode confirmed proposals become ``adopted`` and changed ones
    ``edited`` (both with the proposal's URN in ``source_refs`` and the reviewer
    as actor). Rejected proposals are omitted; unresolved proposals preserve
    their source provenance and carry a separate reviewer resolution flag.
    """
    key = submission.origin_key
    # Frozen inputs disambiguate internal references that also parse as URNs.
    for frozen in submission.reanchor_inputs:
        ref = frozen.source_ref
        if (ref.annotation_id, ref.version) not in proposals:
            raise DomainError(
                "TARGET_NOT_FOUND",
                {"annotation_id": ref.annotation_id, "version": ref.version},
            )

    def proposal_ref(annotation_id: str) -> str:
        if source_ref_overrides and annotation_id in source_ref_overrides:
            ref = source_ref_overrides[annotation_id]
            ontospan.parse_annotation_ref(ref)
            return ref
        return _proposal_ref(annotation_id, key.project_key)

    def normalize_source_ref(raw: str) -> str:
        if source_ref_overrides and raw in source_ref_overrides:
            return proposal_ref(raw)
        source, separator, version = raw.rpartition(":")
        if (
            separator
            and (source, version) in proposals
            and source_ref_overrides
            and source in source_ref_overrides
        ):
            return proposal_ref(source)
        return _export_source_ref(raw, key.project_key, proposals)

    reviewer = ontospan.Actor(actor_id=key.annotator_id, kind="human")
    t1_profiles = {layer.layer_id: layer.profile for layer in layers}
    counts: ExportCounts = {"rejected": 0, "uncertain": 0, "defaulted_axes": 0}

    # (annotation id, version) -> (method, all exact source refs) for review results.
    reviewed: dict[tuple[str, str], tuple[Method, list[str]]] = {}
    note_sources: dict[tuple[str, str], list[tuple[str, str]]] = {}
    unresolved: dict[tuple[str, str], ReviewDecision] = {}
    snapshots = list(submission.snapshots)
    present = {(s.annotation.annotation_id, s.version) for s in snapshots}
    decision: ReviewDecision
    for decision in submission.decisions if is_review_like(key.mode) else []:
        target = (decision.target.annotation_id, decision.target.version)
        source = proposal_ref(decision.target.annotation_id)
        if decision.outcome == "confirmed":
            reviewed[target] = ("adopted", [source])
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
            reviewed.setdefault(replacement, ("edited", []))[1].append(source)
            note_sources.setdefault(replacement, []).append(target)
        elif decision.outcome == "rejected":
            counts["rejected"] += 1
        else:
            proposal = proposals.get(target)
            if proposal is None:
                raise DomainError(
                    "TARGET_NOT_FOUND",
                    {"annotation_id": target[0], "version": target[1]},
                )
            unresolved[target] = decision
            if target not in present:
                snapshots.append(proposal)
                present.add(target)
            else:
                snapshots = [
                    proposal if (s.annotation.annotation_id, s.version) == target else s
                    for s in snapshots
                ]

    annotations = []
    exported_refs: set[tuple[str, str]] = set()
    for snap in snapshots:
        identity = (snap.annotation.annotation_id, snap.version)
        if identity in exported_refs:
            continue
        exported_refs.add(identity)
        unresolved_decision = unresolved.get(identity)
        item = snap.annotation
        review = reviewed.get((item.annotation_id, snap.version))
        if review is not None:
            sources = set(review[1])
            if _method(item.provenance) == "merged":
                sources.update(
                    normalize_source_ref(ref) for ref in item.provenance.source_refs
                )
            source_refs = tuple(sorted(sources))
            method = (
                "merged"
                if len(source_refs) > 1 or _method(item.provenance) == "merged"
                else review[0]
            )
            provenance = reviewed_provenance(reviewer, method, source_refs)
        else:
            provenance = ontospan.Provenance(
                actor=ontospan.Actor(
                    actor_id=item.provenance.actor.actor_id,
                    kind=item.provenance.actor.kind,
                ),
                method=_method(item.provenance),
                source_refs=tuple(
                    dict.fromkeys(
                        [
                            *(
                                normalize_source_ref(ref)
                                for ref in item.provenance.source_refs
                            ),
                            *(
                                [proposal_ref(item.annotation_id)]
                                if unresolved_decision
                                else []
                            ),
                        ]
                    )
                ),
            )
        note_refs = [(item.annotation_id, snap.version)]
        note_refs.extend(note_sources.get((item.annotation_id, snap.version), []))
        # Adoption copies retain an exact source ref even outside review mode.
        for source_ref in item.provenance.source_refs:
            source_id, separator, source_version = source_ref.rpartition(":")
            if separator:
                note_refs.append((source_id, source_version))
        notes = list(
            dict.fromkeys(
                [
                    *([item.note] if item.note else []),
                    *(
                        original_snapshot.annotation.note
                        for ref in note_refs
                        if (original_snapshot := proposals.get(ref)) is not None
                        and original_snapshot.annotation.note
                    ),
                    *(
                        note
                        for ref in note_refs
                        for note in (proposal_notes or {}).get(ref, [])
                    ),
                ]
            )
        )
        provenance = provenance.model_copy(update={"notes": tuple(notes)})
        axes, defaulted = _axes(snap, t1_profiles.get(item.layer_id, "generic"))
        counts["defaulted_axes"] += defaulted
        mentions = _mentions(snap, document.text)
        if unresolved_decision is not None:
            counts["uncertain"] += 1
        annotations.append(
            ontospan.Annotation(
                annotation_id=item.annotation_id,
                layer_id=item.layer_id,
                term_id=item.term_id,
                axes=axes,
                mentions=mentions,
                document_level=not mentions,
                modifiers=tuple(
                    ontospan.Modifier(
                        term_id=m.term_id,
                        segments=tuple(
                            ontospan.segment(document.text, s.start, s.end)
                            for s in m.segments
                        ),
                    )
                    for m in item.modifiers
                ),
                provenance=provenance,
                review_resolution=ontospan.ReviewResolution(
                    outcome="uncertain",
                    reviewer=reviewer,
                    note=unresolved_decision.note,
                )
                if unresolved_decision
                else None,
            )
        )

    unit = ontospan.AnnotatedDocument(
        document=document_to_t1(
            document,
            variant,
            source_variant_hashes or {},
            source_text_sha256=source_text_sha256,
            single_native_case=single_native_case,
        ),
        annotation_set=ontospan.AnnotationSet(
            annotation_set_id=set_id,
            set_kind="individual",
            stage=key.mode,
            actors=(reviewer,),
            created_at=_created_at(submission.created_at),
            blind=key.mode == "independent",
            guideline_ref=guideline_ref,
            layers=tuple(layers),
            annotations=tuple(annotations),
        ),
    )
    return unit, counts


def document_to_t1(
    document: Document,
    variant: VariantInfo | None,
    source_variant_hashes: Mapping[str, str],
    *,
    source_text_sha256: str | None = None,
    single_native_case: bool = True,
) -> ontospan.Document:
    """Export external identity and ancestry from one coherent project snapshot."""
    extra: dict[str, Any] = {}
    plain_native = (
        variant is not None
        and single_native_case
        and variant.origin == "native"
        and variant.version == 1
    )
    if plain_native and variant is not None:
        if variant.case_id != variant.external_id:
            extra["case_id"] = variant.case_id
    elif variant is not None:
        if (
            variant.derived_from is not None
            and variant.derived_from not in source_variant_hashes
        ):
            raise DomainError(
                "VARIANT_SOURCE_UNKNOWN", "Export source variant is unavailable"
            )
        extra = {
            "case_id": variant.case_id,
            "variant": ontospan.Variant(
                version=variant.version,
                origin=variant.origin,
                derived_from=source_variant_hashes[variant.derived_from]
                if variant.derived_from
                else None,
            ),
            "translation": ontospan.Translation.model_validate(variant.translation)
            if variant.translation is not None
            else None,
        }
    return ontospan.Document(
        document_id=variant.external_id if variant else document.document_id,
        language=document.language,
        text=document.text,
        text_sha256=document.text_sha256,
        source_text_sha256=source_text_sha256,
        **extra,
    )
