"""Small, lossless result projection for scientific analysis outside the editor."""

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.errors import DomainError
from ontocurator.domain.results import latest_submissions
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import Submission, WorkspaceMode
from ontocurator.packages.models import ValidatedPackage


def _annotation_record(
    snap: AnnotationSnapshot, package: ValidatedPackage
) -> dict[str, Any]:
    document = package.documents[snap.document_id]
    refs = {(r.evidence_id, r.version) for r in snap.annotation.evidence_refs}
    return {
        **snap.annotation.model_dump(),
        "version": snap.version,
        "text_sha256": snap.text_sha256,
        "ontology_sha256": snap.ontology_sha256,
        "layer_config_sha256": snap.layer_config_sha256,
        "evidence": [
            {
                **ev.mention.model_dump(),
                "version": ev.version,
                "text_sha256": ev.text_sha256,
                "segment_texts": [
                    document.text[s.start : s.end] for s in ev.mention.segments
                ],
                "cue_segment_texts": [
                    document.text[s.start : s.end] for s in ev.mention.cue_segments
                ],
            }
            for ev in snap.evidence
            if (ev.mention.evidence_id, ev.version) in refs
        ],
    }


def analyze_package(
    package: ValidatedPackage,
    *,
    annotator_ids: Iterable[str] | None = None,
    mode: WorkspaceMode | None = None,
) -> dict[str, Any]:
    """Project validated results, never turning missing work into negative gold.

    One row per document, annotator, mode, editable layer, scope and review round.
    Revisions are comparable only inside a full origin workspace. Multiple
    origins for the same local row yield an ambiguous row without approved
    annotations. Multiple scopes/rounds stay separate and are flagged for an
    explicit downstream selection. Expected annotators must be supplied to
    identify people entirely absent from an export.
    """
    profile = package.manifest.task_profile
    if profile is None:
        raise DomainError("INVALID_ANALYSIS_PACKAGE", "A task profile is required")
    submissions = [
        s
        for s in package.submissions.values()
        if mode is None or s.origin_key.mode == mode
    ]
    current = latest_submissions(submissions)
    annotators = sorted(
        set(annotator_ids or ()) | {s.origin_key.annotator_id for s in submissions}
    )
    modes = (
        [mode]
        if mode
        else sorted({s.origin_key.mode for s in submissions} or {"independent"})
    )
    by_case: dict[tuple[str, str, str], list[Submission]] = defaultdict(list)
    for sub in current:
        by_case[
            (
                sub.origin_key.document_id,
                sub.origin_key.annotator_id,
                sub.origin_key.mode,
            )
        ].append(sub)
    rows: list[dict[str, Any]] = []
    ambiguities: list[dict[str, Any]] = []
    for document_id in package.manifest.document_order or list(package.documents):
        document = package.documents[document_id]
        for annotator in annotators:
            for selected_mode in modes:
                candidates = by_case.get((document_id, annotator, selected_mode), [])
                for layer in profile.layers:
                    if layer.access != "editable":
                        continue
                    groups: dict[tuple[str, str], list[Submission]] = defaultdict(list)
                    for sub in candidates:
                        scope = sub.scope or build_scope(profile, sub.origin_key.mode)
                        if layer.layer_id in scope.editable_layer_ids:
                            groups[
                                (sub.origin_key.scope_id, sub.origin_key.target_set_id)
                            ].append(sub)
                    identity = {
                        "document_id": document_id,
                        "text_sha256": document.text_sha256,
                        "language": document.language,
                        "annotator_id": annotator,
                        "mode": selected_mode,
                        "layer_id": layer.layer_id,
                    }
                    if len(groups) > 1:
                        ambiguities.append(
                            {
                                **identity,
                                "reason": "multiple_scopes_or_review_rounds",
                                "rounds": [
                                    {"scope_id": s, "round_id": t}
                                    for s, t in sorted(groups)
                                ],
                            }
                        )
                    if not groups:
                        groups[("", "")] = []
                    for (scope_id, target_set_id), origins in sorted(groups.items()):
                        row: dict[str, Any] = {
                            **identity,
                            "scope_id": scope_id or None,
                            "round_id": target_set_id or None,
                            "status": "missing",
                            "submission_id": None,
                            "draft_revision": None,
                            "created_at": None,
                            "origin_key": None,
                            "document_checked": False,
                            "layer_checked": False,
                            "annotations": [],
                            "review_targets": [],
                            "decisions": [],
                            "uncertain_target_count": 0,
                            "candidate_submission_ids": [],
                        }
                        if len(origins) > 1:
                            row["status"] = "ambiguous"
                            row["candidate_submission_ids"] = sorted(
                                s.submission_id for s in origins
                            )
                            ambiguities.append(
                                {
                                    **identity,
                                    "scope_id": scope_id,
                                    "round_id": target_set_id,
                                    "reason": "multiple_origin_workspaces",
                                    "submission_ids": row["candidate_submission_ids"],
                                    "origin_keys": [
                                        s.origin_key.model_dump() for s in origins
                                    ],
                                }
                            )
                        elif origins:
                            sub = origins[0]
                            annotations = [
                                s
                                for s in sub.snapshots
                                if s.annotation.layer_id == layer.layer_id
                            ]
                            decisions = [
                                d
                                for d in sub.decisions
                                if package.annotations[
                                    (d.target.annotation_id, d.target.version)
                                ].annotation.layer_id
                                == layer.layer_id
                            ]
                            uncertain = sum(d.outcome == "uncertain" for d in decisions)
                            review_targets = [
                                package.annotations[
                                    (target.annotation_id, target.version)
                                ]
                                for target in sub.targets.targets
                                if package.annotations[
                                    (target.annotation_id, target.version)
                                ].annotation.layer_id
                                == layer.layer_id
                            ]
                            checked = (
                                sub.document_checked
                                and layer.layer_id in sub.checked_layer_ids
                            )
                            status = (
                                "unverified"
                                if not checked
                                else "uncertain"
                                if uncertain
                                else "positive"
                                if annotations
                                else "checked_negative"
                            )
                            row.update(
                                {
                                    "status": status,
                                    "submission_id": sub.submission_id,
                                    "draft_revision": sub.draft_revision,
                                    "created_at": sub.created_at,
                                    "origin_key": sub.origin_key.model_dump(),
                                    "document_checked": sub.document_checked,
                                    "layer_checked": layer.layer_id
                                    in sub.checked_layer_ids,
                                    "annotations": [
                                        _annotation_record(s, package)
                                        for s in annotations
                                    ],
                                    "decisions": [d.model_dump() for d in decisions],
                                    "review_targets": [
                                        _annotation_record(target, package)
                                        for target in review_targets
                                    ],
                                    "uncertain_target_count": uncertain,
                                }
                            )
                        rows.append(row)
    # Keep the complete manifest so optional captured search conditions travel
    # with the result; absence on legacy packages is not filled with today's runtime.
    return {
        "format_version": "ontocurator-analysis/v1",
        "source_manifest": package.manifest.model_dump(),
        "expected_annotators": annotators,
        "rows": rows,
        "ambiguities": ambiguities,
        "warnings": (
            [
                "No annotators are known; supply expected annotator IDs to report missing work."
            ]
            if not annotators
            else []
        ),
    }
