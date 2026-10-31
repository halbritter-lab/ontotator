"""Moving a project to another release of its ontologies (#81).

A lead first asks for a report (a dry run), then applies it. The report says,
per draft annotation, what the new release does to its terms:

* a term the new release retired with exactly one ``replaced_by``, or merged
  into another term as an ``alt_id``, is **rewritten** to that term (chains
  are followed while each step has exactly one successor);
* a term the new release marks obsolete without a single successor (only
  ``consider`` suggestions, or none), or does not know, is **flagged**: the
  draft keeps it and the submit check refuses it until the annotator changes
  it, as for any obsolete term;
* every other term stays.

Open drafts are the only thing rewritten. Each rewrite is a new revision of
the draft, logged in ``edit_events`` like an edit, with one ``project.repin``
audit entry for the whole move. Submissions and their annotation snapshots
are append-only records of the release they were made under: they are not
touched, only counted in the report, and neither is the draft of a submitted
round, which is what its read-only view shows. The pin remembers the digests
it replaced, so those submissions stay valid review targets.

Proposals a draft still has to answer are immutable too. One whose term the
new release retires is flagged, successor or not: the submit check refuses it
until the annotator rejects or replaces it.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ColumnElement, Connection, and_, select, tuple_

from ontotator.domain.annotations import (
    AnnotationRef,
    AnnotationSnapshot,
    Modifier,
    snapshot,
)
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import Document
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.serialization import decode_snapshot
from ontotator.domain.workspace import Draft
from ontotator.exchange.t1 import Pin
from ontotator.ontology.service import OntologyService
from ontotator.storage.tables import (
    AnnotationSnapshotRow,
    DraftAnnotationRow,
    DraftRow,
    ReviewDecisionRow,
    SubmissionRow,
)
from ontotator.storage.workflow_tables import (
    RoundWorkspaceBindingRow,
    WorkRoundStateRow,
)
from ontotator.vendor.hpo_span_annotator.hpo import Ontology

# Successor steps followed before a chain counts as having no single end.
_MAX_HOPS = 8

TermRole = Literal["finding", "modifier"]
RewriteReason = Literal["replaced_by", "alt_id"]


class PinChange(BaseModel):
    """One ontology whose pin moves to another release."""

    model_config = ConfigDict(extra="forbid")
    ontology_id: str
    from_sha256: str
    from_release: str
    to_sha256: str
    to_release: str


class DraftTerm(BaseModel):
    """Where a term sits: one annotation of one draft."""

    model_config = ConfigDict(extra="forbid")
    ontology_id: str
    layer_id: str
    document_id: str
    annotator_id: str
    mode: str
    annotation_id: str
    role: TermRole


class TermRewrite(DraftTerm):
    """A draft term the move rewrites."""

    old_term_id: str
    new_term_id: str
    new_label: str
    reason: RewriteReason


class TermFlag(DraftTerm):
    """A draft term the move leaves for the annotator to change."""

    term_id: str
    status: Literal["obsolete", "unknown"]
    replaced_by: list[str] = Field(default_factory=list)
    consider: list[str] = Field(default_factory=list)


class SubmittedTerms(BaseModel):
    """Submitted annotations of one ontology; reported, never changed."""

    model_config = ConfigDict(extra="forbid")
    ontology_id: str
    annotations: int
    rewritable: int
    obsolete: int
    unknown: int


class RepinReport(BaseModel):
    """What moving to the chosen releases does (the dry run)."""

    model_config = ConfigDict(extra="forbid")
    project_key: str
    locked: bool
    changes: list[PinChange]
    rewrites: list[TermRewrite]
    flagged: list[TermFlag]
    submitted: list[SubmittedTerms]
    # Digest of everything above; applying needs the same report.
    report_sha256: str


@dataclass(frozen=True)
class TermOutcome:
    """What the new release does to one term id."""

    kind: Literal["keep", "rewrite", "flag"]
    term_id: str
    reason: RewriteReason | None = None
    status: Literal["obsolete", "unknown"] | None = None
    replaced_by: tuple[str, ...] = ()
    consider: tuple[str, ...] = ()


def term_outcome(ontology: Ontology, term_id: str) -> TermOutcome:
    """Map ``term_id`` onto ``ontology`` (see the module docstring)."""
    current = term_id
    reason: RewriteReason | None = None
    seen: set[str] = set()
    for _ in range(_MAX_HOPS):
        term = ontology.terms.get(current)
        if term is None:
            merged = ontology.get(current)
            if merged is None:
                return TermOutcome("flag", term_id, status="unknown")
            if current not in merged.alt_ids:
                # A case variant: the release resolves it to a current term
                # already (as the submit check does); nothing to move.
                return TermOutcome("keep", term_id)
            reason = reason or "alt_id"
            seen.add(current)
            current = merged.hpo_id
            continue
        if not term.obsolete:
            if current == term_id:
                return TermOutcome("keep", term_id)
            return TermOutcome("rewrite", current, reason=reason)
        successors = term.replaced_by_all or (
            [term.replaced_by] if term.replaced_by else []
        )
        if len(successors) != 1 or successors[0] in seen:
            return TermOutcome(
                "flag",
                term_id,
                status="obsolete",
                replaced_by=tuple(successors),
                consider=tuple(term.consider),
            )
        reason = reason or "replaced_by"
        seen.add(current)
        current = successors[0]
    return TermOutcome("flag", term_id, status="obsolete")


@dataclass(frozen=True)
class _DraftAnnotation:
    draft_key: str
    document_id: str
    annotator_id: str
    mode: str
    snap: AnnotationSnapshot


def open_draft(project_id: int) -> ColumnElement[bool]:
    """Filter ``DraftRow`` to the drafts a move updates, not those of submitted work."""
    return DraftRow.draft_key.not_in(
        select(RoundWorkspaceBindingRow.workspace_key)
        .join(
            WorkRoundStateRow,
            WorkRoundStateRow.round_id == RoundWorkspaceBindingRow.round_id,
        )
        .where(
            RoundWorkspaceBindingRow.project_id == project_id,
            WorkRoundStateRow.state.in_(["submitted", "superseded"]),
        )
    )


def _draft_annotations(conn: Connection, project_id: int) -> list[_DraftAnnotation]:
    rows = conn.execute(
        select(
            DraftRow.draft_key,
            DraftRow.document_id,
            DraftRow.annotator_id,
            DraftRow.mode,
            AnnotationSnapshotRow.payload,
        )
        .join(DraftAnnotationRow, DraftAnnotationRow.draft_id == DraftRow.id)
        .join(
            AnnotationSnapshotRow,
            and_(
                AnnotationSnapshotRow.project_id == DraftRow.project_id,
                AnnotationSnapshotRow.annotation_id == DraftAnnotationRow.annotation_id,
                AnnotationSnapshotRow.version == DraftAnnotationRow.version,
            ),
        )
        .where(DraftRow.project_id == project_id, open_draft(project_id))
        .order_by(
            DraftRow.draft_key,
            DraftAnnotationRow.annotation_id,
            DraftAnnotationRow.version,
        )
    ).all()
    return [
        _DraftAnnotation(
            row.draft_key,
            row.document_id,
            row.annotator_id,
            row.mode,
            decode_snapshot(row.payload),
        )
        for row in rows
    ]


def _answerable_targets(conn: Connection, project_id: int) -> list[_DraftAnnotation]:
    """The proposals of open drafts that a submit would still carry along."""
    drafts = conn.execute(
        select(
            DraftRow.id,
            DraftRow.draft_key,
            DraftRow.document_id,
            DraftRow.annotator_id,
            DraftRow.mode,
            DraftRow.targets,
        )
        .where(
            DraftRow.project_id == project_id,
            DraftRow.mode != "independent",
            open_draft(project_id),
        )
        .order_by(DraftRow.draft_key)
    ).all()
    settled = {
        (row.draft_id, row.target_id, row.target_version)
        for row in conn.execute(
            select(
                ReviewDecisionRow.draft_id,
                ReviewDecisionRow.target_id,
                ReviewDecisionRow.target_version,
            )
            .join(DraftRow, DraftRow.id == ReviewDecisionRow.draft_id)
            .where(
                DraftRow.project_id == project_id,
                ReviewDecisionRow.outcome.in_(["rejected", "changed"]),
            )
        )
    }
    answerable = [
        (draft, target["annotation_id"], target["version"])
        for draft in drafts
        for target in draft.targets.get("targets") or []
        if (draft.id, target["annotation_id"], target["version"]) not in settled
    ]
    refs = sorted({(item[1], item[2]) for item in answerable})
    payloads: dict[tuple[str, str], Any] = {}
    for start in range(0, len(refs), 1000):
        for row in conn.execute(
            select(
                AnnotationSnapshotRow.annotation_id,
                AnnotationSnapshotRow.version,
                AnnotationSnapshotRow.payload,
            ).where(
                AnnotationSnapshotRow.project_id == project_id,
                tuple_(
                    AnnotationSnapshotRow.annotation_id, AnnotationSnapshotRow.version
                ).in_(refs[start : start + 1000]),
            )
        ):
            payloads[(row.annotation_id, row.version)] = row.payload
    return [
        _DraftAnnotation(
            draft.draft_key,
            draft.document_id,
            draft.annotator_id,
            draft.mode,
            decode_snapshot(payloads[(annotation_id, version)]),
        )
        for draft, annotation_id, version in answerable
        if (annotation_id, version) in payloads
    ]


def _terms(annotation: Mapping[str, Any]) -> Iterable[tuple[TermRole, str]]:
    yield "finding", str(annotation.get("term_id") or "")
    for modifier in annotation.get("modifiers") or []:
        yield "modifier", str(modifier.get("term_id") or "")


def _submitted(
    conn: Connection,
    project_id: int,
    ontology_of_layer: Mapping[str, str],
    services: Mapping[str, OntologyService],
) -> list[SubmittedTerms]:
    """Count the submitted annotations each move would affect."""
    seen: set[tuple[str, str]] = set()
    counts = {oid: {"a": 0, "r": 0, "o": 0, "u": 0} for oid in services}
    payloads = conn.execute(
        select(SubmissionRow.payload)
        .where(SubmissionRow.project_id == project_id)
        .order_by(SubmissionRow.submission_id)
    ).scalars()
    for payload in payloads:
        for snap in payload.get("snapshots") or []:
            annotation = snap.get("annotation") or {}
            identity = (str(annotation.get("annotation_id")), str(snap.get("version")))
            ontology_id = ontology_of_layer.get(str(annotation.get("layer_id")))
            if identity in seen or ontology_id is None or ontology_id not in services:
                continue
            seen.add(identity)
            count = counts[ontology_id]
            count["a"] += 1
            outcomes = [
                term_outcome(services[ontology_id].ontology, term_id)
                for _, term_id in _terms(annotation)
            ]
            if any(o.status == "unknown" for o in outcomes):
                count["u"] += 1
            elif any(o.kind == "flag" for o in outcomes):
                count["o"] += 1
            elif any(o.kind == "rewrite" for o in outcomes):
                count["r"] += 1
    return [
        SubmittedTerms(
            ontology_id=oid,
            annotations=c["a"],
            rewritable=c["r"],
            obsolete=c["o"],
            unknown=c["u"],
        )
        for oid, c in sorted(counts.items())
    ]


def build_report(
    conn: Connection,
    *,
    project_key: str,
    project_id: int,
    locked: bool,
    profile: TaskProfile,
    old_pins: Mapping[str, Pin],
    new_pins: Mapping[str, Pin],
    releases: Mapping[str, str],
    services: Mapping[str, OntologyService],
) -> RepinReport:
    """The dry run of moving ``old_pins`` to ``new_pins``.

    ``services`` holds the new release of every ontology whose digest
    changes; ``releases`` the release name of every digest involved.
    """
    changed = {
        oid: services[oid]
        for oid, pin in new_pins.items()
        if oid in services
        and (old := old_pins.get(oid)) is not None
        and old.sha256 != pin.sha256
    }
    ontology_of_layer = {layer.layer_id: layer.ontology_id for layer in profile.layers}
    rewrites: list[TermRewrite] = []
    flagged: list[TermFlag] = []
    for item in _draft_annotations(conn, project_id):
        annotation = item.snap.annotation
        ontology_id = ontology_of_layer.get(annotation.layer_id)
        if ontology_id is None or ontology_id not in changed:
            continue
        ontology = changed[ontology_id].ontology
        terms: list[tuple[TermRole, str]] = [("finding", annotation.term_id)]
        terms.extend(("modifier", m.term_id) for m in annotation.modifiers)
        for role, term_id in terms:
            where = DraftTerm(
                ontology_id=ontology_id,
                layer_id=annotation.layer_id,
                document_id=item.document_id,
                annotator_id=item.annotator_id,
                mode=item.mode,
                annotation_id=annotation.annotation_id,
                role=role,
            ).model_dump()
            outcome = term_outcome(ontology, term_id)
            if outcome.kind == "rewrite":
                rewrites.append(
                    TermRewrite(
                        **where,
                        old_term_id=term_id,
                        new_term_id=outcome.term_id,
                        new_label=ontology.label_of(outcome.term_id),
                        reason=outcome.reason or "replaced_by",
                    )
                )
            elif outcome.kind == "flag":
                flagged.append(
                    TermFlag(
                        **where,
                        term_id=term_id,
                        status=outcome.status or "obsolete",
                        replaced_by=list(outcome.replaced_by),
                        consider=list(outcome.consider),
                    )
                )
    for item in _answerable_targets(conn, project_id):
        annotation = item.snap.annotation
        ontology_id = ontology_of_layer.get(annotation.layer_id)
        if ontology_id is None or ontology_id not in changed:
            continue
        ontology = changed[ontology_id].ontology
        terms = [("finding", annotation.term_id)]
        terms.extend(("modifier", m.term_id) for m in annotation.modifiers)
        for role, term_id in terms:
            outcome = term_outcome(ontology, term_id)
            if outcome.kind == "keep":
                continue
            flagged.append(
                TermFlag(
                    ontology_id=ontology_id,
                    layer_id=annotation.layer_id,
                    document_id=item.document_id,
                    annotator_id=item.annotator_id,
                    mode=item.mode,
                    annotation_id=annotation.annotation_id,
                    role=role,
                    term_id=term_id,
                    status=outcome.status or "obsolete",
                    replaced_by=[outcome.term_id]
                    if outcome.kind == "rewrite"
                    else list(outcome.replaced_by),
                    consider=list(outcome.consider),
                )
            )
    changes = [
        PinChange(
            ontology_id=oid,
            from_sha256=old_pins[oid].sha256,
            from_release=releases.get(old_pins[oid].sha256, ""),
            to_sha256=new_pins[oid].sha256,
            to_release=releases.get(new_pins[oid].sha256, ""),
        )
        for oid in sorted(changed)
    ]
    body: dict[str, Any] = {
        "project_key": project_key,
        "locked": locked,
        "changes": changes,
        "rewrites": rewrites,
        "flagged": flagged,
        "submitted": _submitted(conn, project_id, ontology_of_layer, changed),
    }
    digest = canonical_hash(
        {
            name: [v.model_dump(mode="json") for v in value]
            if isinstance(value, list)
            else value
            for name, value in body.items()
        }
    )
    return RepinReport(**body, report_sha256=digest)


def _moved_to(
    ontology: Ontology,
    annotation_id: str,
    term_id: str,
    role: TermRole,
    changes: list[dict[str, str]],
) -> str:
    """The term ``term_id`` moves to; the move is appended to ``changes``."""
    outcome = term_outcome(ontology, term_id)
    if outcome.kind != "rewrite":
        return term_id
    changes.append(
        {
            "annotation_id": annotation_id,
            "role": role,
            "from": term_id,
            "to": outcome.term_id,
            "reason": outcome.reason or "replaced_by",
        }
    )
    return outcome.term_id


def rewrite_draft(
    draft: Draft,
    document: Document,
    profile: TaskProfile,
    ontology_of_layer: Mapping[str, str],
    services: Mapping[str, OntologyService],
) -> tuple[Draft | None, list[dict[str, str]]]:
    """``draft`` with its rewritable terms moved; ``None`` when none is.

    ``profile`` is the profile with the new pins, so every rewritten snapshot
    binds the new release. Review decisions and resolutions that pointed at
    a rewritten version follow it: the move changes the identifier, not the
    finding. The rewritten layers lose their "checked" mark, as after a term
    change, so the annotator looks at them again.
    """
    changes: list[dict[str, str]] = []
    moved: dict[tuple[str, str], AnnotationRef] = {}
    annotations: list[AnnotationSnapshot] = []
    layers: set[str] = set()
    for snap in draft.annotations:
        annotation = snap.annotation
        ontology_id = ontology_of_layer.get(annotation.layer_id)
        if ontology_id is None or ontology_id not in services:
            annotations.append(snap)
            continue
        ontology = services[ontology_id].ontology
        before = len(changes)
        term_id = _moved_to(
            ontology, annotation.annotation_id, annotation.term_id, "finding", changes
        )
        modifiers = [
            Modifier(
                term_id=_moved_to(
                    ontology, annotation.annotation_id, m.term_id, "modifier", changes
                ),
                segments=m.segments,
            )
            for m in annotation.modifiers
        ]
        if len(changes) == before:
            annotations.append(snap)
            continue
        updated = annotation.model_copy(
            update={"term_id": term_id, "modifiers": modifiers}
        )
        new_snap = snapshot(updated, snap.evidence, document, profile)
        moved[(annotation.annotation_id, snap.version)] = AnnotationRef(
            annotation_id=annotation.annotation_id, version=new_snap.version
        )
        layers.add(annotation.layer_id)
        annotations.append(new_snap)
    if not changes:
        return None, []

    def follow(ref: AnnotationRef | None) -> AnnotationRef | None:
        if ref is None:
            return None
        return moved.get((ref.annotation_id, ref.version), ref)

    draft.annotations = annotations
    draft.decisions = [
        d.model_copy(update={"replacement": follow(d.replacement)})
        for d in draft.decisions
    ]
    draft.reanchor_resolutions = [
        r.model_copy(update={"replacement": follow(r.replacement)})
        for r in draft.reanchor_resolutions
    ]
    draft.round_input_resolutions = [
        r.model_copy(update={"annotation_ref": follow(r.annotation_ref)})
        for r in draft.round_input_resolutions
    ]
    draft.checked_layer_ids = [
        lid for lid in draft.checked_layer_ids if lid not in layers
    ]
    return draft, changes
