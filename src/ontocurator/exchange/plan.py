"""Pure upload readers and deterministic import previews; no storage access."""

from __future__ import annotations

import hashlib
import re
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import ontospan
from pydantic import BaseModel, Field

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.project_rules import (
    ProjectRules,
    RuleViolation,
    rule_violations,
)
from ontocurator.exchange.t1 import (
    ImportedProposals,
    Pin,
    check_importable,
    document_from_unit,
    pin_differences,
    unit_to_proposals,
)


class Issue(BaseModel):
    code: str
    unit: str
    annotation_id: str | None = None
    message: str
    severity: Literal["error", "warning"] = "error"


@dataclass(frozen=True)
class IncomingSet:
    annotation_set_id: str
    set_kind: str
    actors: list[dict[str, Any]]
    payload: dict[str, Any]
    proposals: ImportedProposals


@dataclass(frozen=True)
class IncomingUnit:
    label: str
    document: Document
    source_text_sha256: str | None = None
    normalised: bool = False
    bundle_id: str | None = None
    manifest_sha256: str | None = None
    set: IncomingSet | None = None


@dataclass(frozen=True)
class ProjectImportState:
    documents: Mapping[str, str] = field(default_factory=dict)
    texts: Mapping[str, list[str]] = field(default_factory=dict)
    sets: frozenset[tuple[str | None, str, str]] = frozenset()
    # Caller fingerprints fresh pins/roots/settings not already in profile/rules.
    context_sha256: str = ""


class PlannedDocument(BaseModel):
    document_id: str
    language: str
    text_sha256: str
    action: Literal["add", "unchanged"]
    normalised: bool
    label: str
    source_text_sha256: str | None = None


class Duplicate(BaseModel):
    document_id: str
    text_sha256: str
    same_text_as: list[str]


class Collision(BaseModel):
    document_id: str
    existing_sha256: str
    new_sha256: str


class PlannedSet(BaseModel):
    document_id: str
    annotation_set_id: str
    bundle_id: str | None
    manifest_sha256: str | None
    set_kind: str
    actors: list[dict[str, Any]]
    payload: dict[str, Any]
    proposals: ImportedProposals
    refused: list[RuleViolation]
    action: Literal["add", "already_imported"]


class ImportPlan(BaseModel):
    documents: list[PlannedDocument] = Field(default_factory=list)
    duplicates: list[Duplicate] = Field(default_factory=list)
    collisions: list[Collision] = Field(default_factory=list)
    proposal_sets: list[PlannedSet] = Field(default_factory=list)
    documents_only: list[str] = Field(default_factory=list)
    normalised_count: int = 0
    errors: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    state_sha256: str
    plan_sha256: str = ""
    committable: bool = True


def _report_issues(
    report: ontospan.ValidationReport,
    label: str,
    annotations: Sequence[ontospan.Annotation] = (),
) -> list[Issue]:
    result = []
    for issue in report.issues:
        match = re.search(r"annotation_set\.annotations\[(\d+)\]", issue.path)
        index = int(match[1]) if match else None
        annotation_id = (
            annotations[index].annotation_id
            if index is not None and index < len(annotations)
            else None
        )
        result.append(
            Issue(
                code=issue.code,
                unit=label,
                annotation_id=annotation_id,
                message=f"{issue.path}: {issue.message}",
                severity=issue.level,
            )
        )
    return result


def read_t1_upload(
    path: Path,
    pins: Mapping[str, Pin],
    profile: TaskProfile,
    *,
    filename: str | None = None,
    ontologies: Mapping[str, ontospan.OntologyView] | None = None,
) -> tuple[list[IncomingUnit], list[Issue]]:
    """Read original T1 bytes with the pinned format reader and mapping.

    Blob paths need their original ``filename``. Pass loaded pinned ontologies
    to also validate terms/roots; integration must do so before committing.
    """
    label = filename or path.name
    report = ontospan.ValidationReport()
    bundle_id = manifest_sha256 = None
    labels = [label]
    try:
        if label.lower().endswith(".json"):
            delivered = [
                ontospan.load_annotated_document(path.read_bytes(), report=report)
            ]
        else:
            manifest, delivered = ontospan.read_bundle(path, report=report)
            labels = [f"{label}/{entry.path}" for entry in manifest.files]
            bundle_id = manifest.bundle_id
            if path.is_dir():
                manifest_bytes = (path / "manifest.json").read_bytes()
            else:
                with zipfile.ZipFile(path) as archive:
                    manifest_bytes = archive.read("manifest.json")
            manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
    except ontospan.FormatError:
        return [], _report_issues(report, label)
    if ontologies is not None:
        # The first pass checks format only; the complete check below replaces
        # its explicitly unchecked-hierarchy warning.
        report.issues = [i for i in report.issues if i.code != "hierarchy_not_checked"]
    issues = _report_issues(report, label)
    result: list[IncomingUnit] = []
    for raw, source_label in zip(delivered, labels, strict=True):
        doc = document_from_unit(raw)
        unit_label = doc.document_id
        differences = pin_differences(raw.annotation_set.layers, profile, pins)
        if differences:
            issues.append(
                Issue(code="PIN_MISMATCH", unit=unit_label, message=str(differences))
            )
        # Both kind and provenance checks are authoritative in T2d, including
        # empty sets; retain all affected units instead of stopping at the first.
        try:
            check_importable([raw])
        except DomainError as exc:
            issues.append(Issue(code=exc.code, unit=unit_label, message=str(exc)))
        if ontologies is not None:
            issues.extend(
                _report_issues(
                    ontospan.validate(raw, ontologies),
                    unit_label,
                    raw.annotation_set.annotations,
                )
            )
        incoming_set = None
        aset = raw.annotation_set
        if aset.annotations:
            try:
                proposals = unit_to_proposals(raw, profile, doc, bundle_id=bundle_id)
            except DomainError as exc:
                issues.append(Issue(code=exc.code, unit=unit_label, message=str(exc)))
            else:
                incoming_set = IncomingSet(
                    aset.annotation_set_id,
                    aset.set_kind,
                    [a.model_dump(mode="json") for a in aset.actors],
                    aset.model_dump(mode="json"),
                    proposals,
                )
        result.append(
            IncomingUnit(
                source_label,
                doc,
                raw.document.source_text_sha256,
                False,
                bundle_id,
                manifest_sha256,
                incoming_set,
            )
        )
    return result, issues


def _state_hash(
    state: ProjectImportState, profile: TaskProfile, rules: ProjectRules
) -> str:
    return canonical_hash(
        {
            "documents": dict(state.documents),
            "texts": {sha: sorted(set(ids)) for sha, ids in state.texts.items()},
            "sets": sorted(
                state.sets,
                key=lambda item: (item[0] is not None, item[0] or "", item[1], item[2]),
            ),
            "profile": profile.model_dump(mode="json"),
            "rules": {
                "contiguous_mentions_only": rules.contiguous_mentions_only,
                "require_chosen_axes": rules.require_chosen_axes,
                "hidden_axis_values": {
                    layer: {axis: sorted(values) for axis, values in axes.items()}
                    for layer, axes in rules.hidden_axis_values.items()
                },
            },
            "context_sha256": state.context_sha256,
        }
    )


def plan_import(
    units: Sequence[IncomingUnit],
    state: ProjectImportState,
    profile: TaskProfile,
    rules: ProjectRules,
    reader_issues: Sequence[Issue],
) -> ImportPlan:
    """Plan all actions against one inventory without changing delivered units."""
    plan = ImportPlan(state_sha256=_state_hash(state, profile, rules))
    for issue in reader_issues:
        (plan.errors if issue.severity == "error" else plan.warnings).append(issue)
    documents = dict(state.documents)
    texts = {sha: set(ids) for sha, ids in state.texts.items()}
    for doc_id, sha in state.documents.items():
        texts.setdefault(sha, set()).add(doc_id)
    for unit in units:
        texts.setdefault(unit.document.text_sha256, set()).add(
            unit.document.document_id
        )
    sets = set(state.sets)
    for unit in sorted(
        units,
        key=lambda u: (
            u.document.document_id,
            u.bundle_id or "",
            u.set.annotation_set_id if u.set else "",
            u.label,
        ),
    ):
        doc = unit.document
        known = documents.get(doc.document_id)
        if known is not None and known != doc.text_sha256:
            plan.collisions.append(
                Collision(
                    document_id=doc.document_id,
                    existing_sha256=known,
                    new_sha256=doc.text_sha256,
                )
            )
            plan.errors.append(
                Issue(
                    code="DOCUMENT_CONFLICT",
                    unit=unit.label,
                    message=f"Document {doc.document_id} already has different text",
                )
            )
        plan.documents.append(
            PlannedDocument(
                document_id=doc.document_id,
                language=doc.language,
                text_sha256=doc.text_sha256,
                action="unchanged" if known is not None else "add",
                normalised=unit.normalised,
                label=unit.label,
                source_text_sha256=unit.source_text_sha256,
            )
        )
        documents.setdefault(doc.document_id, doc.text_sha256)
        others = sorted(texts[doc.text_sha256] - {doc.document_id})
        if others:
            plan.duplicates.append(
                Duplicate(
                    document_id=doc.document_id,
                    text_sha256=doc.text_sha256,
                    same_text_as=others,
                )
            )
            plan.warnings.append(
                Issue(
                    code="DUPLICATE_TEXT",
                    unit=unit.label,
                    message=f"Same text as {', '.join(others)}",
                    severity="warning",
                )
            )
        aset = unit.set
        if aset is None:
            plan.documents_only.append(doc.document_id)
            continue
        # Guard manually constructed IncomingUnits too. The same T2d predicate
        # remains the one authority for accepted kinds and actor provenance.
        delivered = ontospan.AnnotationSet.model_validate(aset.payload)
        try:
            raw = ontospan.AnnotatedDocument(
                document=ontospan.Document.model_validate(doc.model_dump()),
                annotation_set=delivered,
            )
            check_importable([raw])
        except DomainError as exc:
            if not any(
                i.code == exc.code and i.unit == doc.document_id for i in plan.errors
            ):
                plan.errors.append(
                    Issue(code=exc.code, unit=doc.document_id, message=str(exc))
                )
        proposals = aset.proposals
        refused = rule_violations(
            proposals.annotations,
            {(e.mention.evidence_id, e.version): e for e in proposals.evidence},
            profile,
            rules,
            at_submission=False,
        )
        refused_ids = {v.annotation_id for v in refused}
        accepted = [
            a
            for a in proposals.annotations
            if a.annotation.annotation_id not in refused_ids
        ]
        refs = {
            (r.evidence_id, r.version)
            for a in accepted
            for r in a.annotation.evidence_refs
        }
        filtered = ImportedProposals(
            accepted,
            [
                e
                for e in proposals.evidence
                if (e.mention.evidence_id, e.version) in refs
            ],
            {
                a.annotation.annotation_id: list(
                    proposals.notes.get(a.annotation.annotation_id, [])
                )
                for a in accepted
            },
            sum(len(a.annotation.axes_defaulted) for a in accepted),
        )
        key = (unit.bundle_id, aset.annotation_set_id, doc.document_id)
        plan.proposal_sets.append(
            PlannedSet(
                document_id=doc.document_id,
                annotation_set_id=aset.annotation_set_id,
                bundle_id=unit.bundle_id,
                manifest_sha256=unit.manifest_sha256,
                set_kind=aset.set_kind,
                actors=aset.actors,
                payload=aset.payload,
                proposals=filtered,
                refused=refused,
                action="already_imported" if key in sets else "add",
            )
        )
        sets.add(key)
    plan.documents_only = sorted(set(plan.documents_only))
    plan.normalised_count = sum(d.normalised for d in plan.documents)
    plan.errors.sort(key=lambda i: (i.unit, i.code, i.annotation_id or "", i.message))
    plan.warnings.sort(key=lambda i: (i.unit, i.code, i.annotation_id or "", i.message))
    plan.counts = {
        "documents_added": sum(d.action == "add" for d in plan.documents),
        "documents_skipped": sum(d.action == "unchanged" for d in plan.documents),
        "documents_only": len(plan.documents_only),
        "sets_added": sum(s.action == "add" for s in plan.proposal_sets),
        "sets_skipped": sum(s.action == "already_imported" for s in plan.proposal_sets),
        "proposals": sum(
            len(s.proposals.annotations)
            for s in plan.proposal_sets
            if s.action == "add"
        ),
        "defaulted_axes": sum(
            s.proposals.defaulted_axes for s in plan.proposal_sets if s.action == "add"
        ),
        "refused": sum(
            len({v.annotation_id for v in s.refused}) for s in plan.proposal_sets
        ),
    }
    plan.committable = not plan.errors
    plan.plan_sha256 = canonical_hash(
        plan.model_dump(mode="json", exclude={"plan_sha256"})
    )
    return plan
