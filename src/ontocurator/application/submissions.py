"""Submission application service and submission commands."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import validate_axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.profiles import TaskProfile, resolve_type
from ontocurator.domain.project_rules import rule_violations
from ontocurator.domain.results import latest_submissions
from ontocurator.domain.scopes import TaskScope, build_scope
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.storage.repository import Repository


class SubmitCommand(BaseModel):
    """Command requesting completion and submission of a workspace."""

    model_config = ConfigDict(extra="forbid")

    command: str = "submit_workspace"
    document_checked: bool = True
    checked_layer_ids: list[str] | None = None


def validate_annotation_completion(
    snap: AnnotationSnapshot, profile: TaskProfile
) -> None:
    """Enforce the configured requirements for an approved annotation version."""
    type_def = resolve_type(profile, snap.annotation.layer_id, snap.annotation.type_id)
    if (
        type_def.evidence_policy == "required_on_complete"
        and not snap.annotation.evidence_refs
    ):
        raise DomainError(
            "MISSING_EVIDENCE",
            f"Annotation '{snap.annotation.annotation_id}' in layer '{snap.annotation.layer_id}' "
            "requires evidence before approval or submission",
        )
    for axis in type_def.axes:
        if not axis.allow_empty:
            val = snap.annotation.axes_values.get(axis.id)
            if val is None or val == "":
                raise DomainError(
                    "INCOMPLETE_AXES",
                    f"Required axis '{axis.id}' is empty on annotation '{snap.annotation.annotation_id}'",
                )
    try:
        validate_axes(snap.annotation.axes_values, type_def.axes, complete=True)
    except ValueError as exc:
        raise DomainError("INVALID_AXES", str(exc)) from exc


def validate_draft_terms(
    draft: Draft,
    profile: TaskProfile,
    ontology: OntologyService | OntologyRegistry,
    repo: Repository | None = None,
) -> None:
    """Every annotation authored in this draft must use a currently valid term.

    The design allows obsolete or unknown imported terms to stay visible, and an
    adopted copy may sit in a draft so the annotator can fix it, but such a term
    can never be submitted as a new valid annotation. Confirmed review targets
    are not part of the draft and were checked when they were confirmed.
    """
    for snap in draft.annotations:
        layer_id = snap.annotation.layer_id
        service = (
            ontology.for_package_layer(repo, draft.key.project_key, layer_id)
            if isinstance(ontology, OntologyRegistry) and repo is not None
            else ontology.for_layer(profile, layer_id)
            if isinstance(ontology, OntologyRegistry)
            else ontology
        )
        status = service.validate_term(snap.annotation.term_id)
        if status.status in {"obsolete", "unknown"}:
            hint = ""
            if status.replaced_by:
                hint = f"; replaced by '{status.replaced_by}'"
            elif status.consider:
                hint = f"; consider {', '.join(status.consider)}"
            raise DomainError(
                f"{status.status.upper()}_TERM",
                f"Annotation '{snap.annotation.annotation_id}' in layer '{layer_id}' "
                f"uses {status.status} term '{snap.annotation.term_id}'{hint}. "
                "Change the term or delete the annotation before submitting.",
            )


def validate_completion(
    draft: Draft,
    profile: TaskProfile,
    scope: TaskScope,
    repo: Repository | None = None,
    ontology: OntologyService | OntologyRegistry | None = None,
) -> None:
    """Validate that draft is completely ready for submission under task scope and profile."""
    # 1. All editable layers in scope must be marked as checked
    for layer_id in scope.editable_layer_ids:
        if layer_id not in draft.checked_layer_ids:
            raise DomainError(
                "LAYER_NOT_CHECKED",
                f"Editable layer '{layer_id}' has not been marked as checked",
            )

    # 2. Check draft annotations for required axes and evidence policies
    for snap in draft.annotations:
        validate_annotation_completion(snap, profile)

    # 2b. Re-check term status against the pinned ontology at submit time
    if ontology is not None:
        validate_draft_terms(draft, profile, ontology, repo)

    # 3. If in review mode, validate review completeness
    if scope.mode == "review":
        target_refs = {(t.annotation_id, t.version) for t in draft.targets.targets}
        decided_targets = {
            (d.target.annotation_id, d.target.version) for d in draft.decisions
        }
        missing = [
            t
            for t in draft.targets.targets
            if (t.annotation_id, t.version) not in decided_targets
        ]
        if missing:
            raise IncompleteReview(
                f"Review is incomplete: {len(missing)} targets lack a decision"
            )
        if (
            len(decided_targets) != len(draft.decisions)
            or decided_targets != target_refs
        ):
            raise IncompleteReview(
                "Decisions must match exactly the active review targets"
            )
        for snap in draft.annotations:
            linked_targets = [
                t
                for t in draft.targets.targets
                if f"{t.annotation_id}:{t.version}"
                in snap.annotation.provenance.source_refs
            ]
            if linked_targets and not any(
                d.outcome == "changed"
                and d.target in linked_targets
                and d.replacement is not None
                and d.replacement.annotation_id == snap.annotation.annotation_id
                and d.replacement.version == snap.version
                for d in draft.decisions
            ):
                raise DomainError(
                    "UNRESOLVED_ADOPTED_COPY",
                    "Adopted copies require an exact changed decision; decide or delete the copy",
                )


class SubmissionService:
    """Coordinates workspace completion, validation, and submission persistence."""

    def __init__(
        self,
        repo: Repository,
        ontology: OntologyService | OntologyRegistry | None = None,
    ) -> None:
        self.repo = repo
        self.ontology = ontology

    def parse_command(self, payload: dict[str, Any]) -> SubmitCommand:
        return SubmitCommand.model_validate(payload)

    def submit(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Submission:
        """Transactionally validate and commit a workspace submission."""
        cmd = self.parse_command(envelope.payload)
        if not cmd.document_checked:
            raise DomainError(
                "DOCUMENT_NOT_CHECKED",
                "The document must be marked as checked before submitting",
            )

        if isinstance(self.ontology, OntologyRegistry):
            self.ontology.ensure_package_conditions(self.repo, key.project_key)

        def operation(draft: Draft) -> Submission:
            return self._create_submission(draft, cmd, key)

        result = self.repo.run_mutation(key, envelope, operation)
        if not isinstance(result, Submission):
            raise ValueError(
                f"Expected Submission from run_mutation, got {type(result)}"
            )
        return result

    def read(self, key: WorkspaceKey, submission_id: str) -> Submission:
        """Read a historical submission scoped to its local workspace."""
        sub = next(
            (
                s
                for s in self.repo.get_submissions_for_workspace(key)
                if s.submission_id == submission_id
            ),
            None,
        )
        if sub is None:
            raise DomainError(
                "SUBMISSION_NOT_FOUND", "Submission not found in this workspace"
            )
        return sub

    def _create_submission(
        self, draft: Draft, cmd: SubmitCommand, key: WorkspaceKey
    ) -> Submission:
        if cmd.checked_layer_ids is not None:
            draft.checked_layer_ids = list(cmd.checked_layer_ids)

        task_profile = self.repo.get_task_profile(key.project_key)
        scope = build_scope(task_profile, key.mode)
        previous = latest_submissions(self.repo.get_submissions_for_workspace(key))
        if len(previous) > 1:
            raise DomainError(
                "AMBIGUOUS_SUBMISSION_ORIGIN",
                "Cannot continue multiple submission origins",
            )
        # Continuing an imported round keeps its logical immutable origin and
        # revision sequence; its local package binding is stored separately.
        origin_key = previous[0].origin_key if previous else key
        # A projected export changes the local profile hash, but continuation
        # retains its logical origin. Use current permission lists with that
        # original scope identity rather than attributing it to the projection.
        submission_scope = scope.model_copy(update={"scope_id": origin_key.scope_id})

        # Validate completion against profile and scope
        validate_completion(draft, task_profile, scope, self.repo, self.ontology)

        snapshots: list[AnnotationSnapshot] = []
        decisions = list(draft.decisions)

        if key.mode == "review":
            members = {
                (a.annotation.annotation_id, a.version): a
                for a in self.repo.list_annotations_for_document(
                    key.project_key, key.document_id
                )
            }
            current = {
                (a.annotation.annotation_id, a.version): a for a in draft.annotations
            }
            for dec in draft.decisions:
                target = members.get((dec.target.annotation_id, dec.target.version))
                if target is None:
                    raise DomainError(
                        "TARGET_NOT_FOUND", "Reviewed target is unavailable"
                    )
                if dec.outcome == "confirmed":
                    snapshots.append(target)
                elif dec.outcome == "changed":
                    rep = dec.replacement
                    rep_snap = (
                        current.get((rep.annotation_id, rep.version)) if rep else None
                    )
                    if rep_snap is None:
                        raise DomainError(
                            "REPLACEMENT_NOT_FOUND",
                            "Approved replacement version is no longer in the draft",
                        )
                    if (
                        rep_snap.annotation.layer_id != target.annotation.layer_id
                        or rep_snap.annotation.type_id != target.annotation.type_id
                    ):
                        raise DomainError(
                            "REPLACEMENT_LAYER_TYPE_MISMATCH",
                            "Replacement must match the target layer and type",
                        )
                    snapshots.append(rep_snap)

            # Include any other new draft annotations not linked as replacements
            rep_ids = {
                d.replacement.annotation_id for d in draft.decisions if d.replacement
            }
            for a in draft.annotations:
                if a.annotation.annotation_id not in rep_ids:
                    snapshots.append(a)
        else:
            snapshots = list(draft.annotations)
            decisions = []

        # Imported confirmed targets are assembled after draft validation.
        for snap in snapshots:
            validate_annotation_completion(snap, task_profile)

        # Deduplicate snapshots stably
        seen_snaps: set[tuple[str, str]] = set()
        deduped_snaps: list[AnnotationSnapshot] = []
        for s in snapshots:
            k = (s.annotation.annotation_id, s.version)
            if k not in seen_snaps:
                seen_snaps.add(k)
                deduped_snaps.append(s)

        evidence_by_id = {
            (e.mention.evidence_id, e.version): e
            for snap in deduped_snaps
            for e in snap.evidence
        }
        for snap in deduped_snaps:
            for ref in snap.annotation.evidence_refs:
                identity = (ref.evidence_id, ref.version)
                if identity not in evidence_by_id:
                    evidence = self.repo.get_evidence_snapshot(
                        ref.evidence_id, ref.version, key.project_key
                    )
                    if evidence is not None:
                        evidence_by_id[identity] = evidence
        violations = rule_violations(
            deduped_snaps,
            evidence_by_id,
            task_profile,
            self.repo.get_project_rules(key.project_key),
            at_submission=True,
        )
        if violations:
            raise DomainError(
                "PROJECT_RULE_VIOLATION",
                {"violations": [asdict(violation) for violation in violations]},
            )

        canonical_content = {
            "key": key.model_dump(),
            "scope": submission_scope.model_dump(),
            "targets": draft.targets.model_dump(),
            "draft_revision": draft.revision,
            "snapshots": [s.version for s in deduped_snaps],
            "decisions": [d.model_dump() for d in decisions],
        }
        sub_id = f"sub-{canonical_hash(canonical_content)[:16]}"

        return Submission(
            format_version="ontocurator-submission/v2",
            submission_id=sub_id,
            origin_key=origin_key,
            scope=submission_scope,
            targets=draft.targets,
            draft_revision=draft.revision + 1,
            snapshots=deduped_snaps,
            decisions=decisions,
            checked_layer_ids=list(draft.checked_layer_ids),
            document_checked=True,
            created_at=datetime.now(UTC).isoformat(),
        )
