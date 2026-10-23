"""Submission application service and submission commands."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import asdict, replace
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, select

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import validate_axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.profiles import TaskProfile, resolve_type
from ontocurator.domain.project_rules import rule_violations
from ontocurator.domain.results import latest_submissions
from ontocurator.domain.scopes import TaskScope, build_scope, is_review_like
from ontocurator.domain.work_rounds import CARRY_ROUND_KINDS
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.storage.repository import Repository


class _NeedsExclusive(Exception):
    """A finish-then-carry decision appeared after the unlocked pre-check."""


class AxisWarningAcknowledgement(BaseModel):
    """Conscious acceptance of one exact draft and project policy warning state."""

    model_config = ConfigDict(extra="forbid")
    draft_revision: int
    policy_revision: int
    warning_digest: str


class SubmitCommand(BaseModel):
    """Command requesting completion and submission of a workspace."""

    model_config = ConfigDict(extra="forbid")

    command: str = "submit_workspace"
    document_checked: bool = False
    checked_layer_ids: list[str] | None = None
    warning_acknowledgement: AxisWarningAcknowledgement | None = None


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
    # 2. Check draft annotations for required axes and evidence policies
    for snap in draft.annotations:
        validate_annotation_completion(snap, profile)

    # 2b. Re-check term status against the pinned ontology at submit time
    if ontology is not None:
        validate_draft_terms(draft, profile, ontology, repo)

    # 3. If in review mode, validate review completeness
    if is_review_like(scope.mode):
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
        for decision in draft.decisions:
            if decision.outcome == "uncertain" and not (
                decision.note and decision.note.strip()
            ):
                raise DomainError(
                    "REVIEW_NOTE_REQUIRED", {"target": decision.target.model_dump()}
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

        finishing = self._finish_then_carry(key)
        if finishing is None and not self.repo.db.in_transaction():
            # The read above ran before any lock: a lead may have let this
            # person finish on the old version since. Re-read it under the
            # shared lock and, if it is there now, start over with the
            # exclusive one (the rolled back attempt wrote nothing).
            def recheck(conn: Connection) -> None:
                if self._finish_then_carry(key, conn) is not None:
                    raise _NeedsExclusive

            try:
                result = self.repo.run_mutation(
                    key, envelope, operation, before_operation=recheck
                )
            except _NeedsExclusive:
                finishing = self._finish_then_carry(key)
                if finishing is None:
                    result = self.repo.run_mutation(key, envelope, operation)
                else:
                    result = self._submit_and_carry(key, envelope, operation, finishing)
        elif finishing is None:
            # Inside a caller's transaction a retry could not start over.
            result = self.repo.run_mutation(key, envelope, operation)
        else:
            result = self._submit_and_carry(key, envelope, operation, finishing)
        if not isinstance(result, Submission):
            raise ValueError(
                f"Expected Submission from run_mutation, got {type(result)}"
            )
        return result

    def _submit_and_carry(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        operation: Callable[[Draft], Submission],
        finishing: tuple[int, int],
    ) -> Draft | Submission:
        # V8: the lead let this person finish on an old version; the
        # submit carries the result to the newest one. Creating work
        # needs the exclusive project lock from the start.
        project_id, assignment_id = finishing
        from ontocurator.application.text_changes import auto_carry_on_submit

        # Unscoped: the carry reads the new version and creates work the
        # submitter's own view does not cover yet.
        plain = Repository(self.repo.db)

        def after_submit(conn: Connection, submission: Submission) -> None:
            auto_carry_on_submit(
                conn,
                plain,
                project_id=project_id,
                project_key=key.project_key,
                assignment_id=assignment_id,
                submission=submission,
            )

        return self.repo.run_mutation(
            key,
            envelope,
            operation,
            exclusive_project=True,
            after_submit=after_submit,
        )

    def _finish_then_carry(
        self, key: WorkspaceKey, conn: Connection | None = None
    ) -> tuple[int, int] | None:
        """``(project_id, assignment_id)`` when the lead let this annotation
        finish on an old version (a ``finish_then_carry`` resolution), else
        None. One read before the submit transaction; the hook re-reads it
        under the lock. With ``conn``, read in that transaction."""
        if key.mode != "independent":
            return None
        from ontocurator.storage.overview_tables import TextChangeResolutionRow
        from ontocurator.storage.tables import AssignmentRow, ProjectRow, UserRow

        with self.repo.db.transaction() if conn is None else nullcontext(conn) as c:
            found = c.execute(
                select(AssignmentRow.project_id, AssignmentRow.id)
                .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
                .join(UserRow, UserRow.id == AssignmentRow.user_id)
                .join(
                    TextChangeResolutionRow,
                    (TextChangeResolutionRow.project_id == AssignmentRow.project_id)
                    & (TextChangeResolutionRow.assignment_id == AssignmentRow.id),
                )
                .where(
                    ProjectRow.project_key == key.project_key,
                    AssignmentRow.document_id == key.document_id,
                    AssignmentRow.task == "annotate",
                    AssignmentRow.revoked_at.is_(None),
                    UserRow.pseudonym == key.annotator_id,
                    TextChangeResolutionRow.resolution == "finish_then_carry",
                )
            ).one_or_none()
        return None if found is None else (int(found[0]), int(found[1]))

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

    def _require_resolved_groups(self, key: WorkspaceKey, draft: Draft) -> None:
        """A consolidation submits once no group is open (T10); the rule of
        the consolidation read (``consolidation.is_open``)."""
        from ontocurator.application.consolidation import open_group_count

        assert key.round_id is not None
        # Joins the submit's transaction.
        with self.repo.db.transaction() as conn:
            pid = self.repo._require_project(conn, key.project_key)
            count = open_group_count(conn, pid, key.round_id, draft.decisions)
        if count:
            raise DomainError("CONSOLIDATION_GROUPS_OPEN", {"count": count})

    def _create_submission(
        self, draft: Draft, cmd: SubmitCommand, key: WorkspaceKey
    ) -> Submission:
        if cmd.checked_layer_ids is not None:
            draft.checked_layer_ids = list(cmd.checked_layer_ids)

        round_view = (
            self.repo.get_work_round(key.project_key, key.round_id)
            if key.round_id is not None
            else None
        )
        if round_view is not None and round_view.kind == "consolidation":
            self._require_resolved_groups(key, draft)

        from ontocurator.application.reanchor_resolutions import validate_resolution

        seen = set()
        for item in draft.reanchor_inputs:
            pending_identity = (
                item.proposal_set_id,
                item.source_ref.annotation_id,
                item.source_ref.version,
            )
            if pending_identity in seen or not is_review_like(draft.key.mode):
                raise DomainError("INVALID_REANCHOR_ITEM")
            seen.add(pending_identity)
            self.repo.reanchor_source_identity(key, item)
        resolved = set()
        for resolution in draft.reanchor_resolutions:
            pending_identity = (
                resolution.item.proposal_set_id,
                resolution.item.source_ref.annotation_id,
                resolution.item.source_ref.version,
            )
            if pending_identity in resolved:
                raise DomainError("INVALID_REANCHOR_ITEM")
            resolved.add(pending_identity)
            validate_resolution(self.repo, draft, resolution)

        missing_resolutions = seen - resolved
        if missing_resolutions:
            raise DomainError(
                "REANCHOR_ITEMS_UNRESOLVED", {"count": len(missing_resolutions)}
            )

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

        if is_review_like(key.mode):
            members = {
                (a.annotation.annotation_id, a.version): a
                for a in self.repo.workspace_input_snapshots(key)
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
                if dec.outcome in {"confirmed", "uncertain"}:
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

        if self.ontology is not None:
            validate_draft_terms(
                draft.model_copy(update={"annotations": snapshots}),
                task_profile,
                self.ontology,
                self.repo,
            )

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
        rules = self.repo.get_project_rules(key.project_key)
        violations = rule_violations(
            deduped_snaps,
            evidence_by_id,
            task_profile,
            rules,
            at_submission=True,
            enforce_spanless=True,
        )
        if violations:
            raise DomainError(
                "PROJECT_RULE_VIOLATION",
                {"violations": [asdict(violation) for violation in violations]},
            )

        if not rules.require_chosen_axes:
            warnings = [
                asdict(violation)
                for violation in rule_violations(
                    deduped_snaps,
                    evidence_by_id,
                    task_profile,
                    replace(rules, require_chosen_axes=True),
                    at_submission=True,
                )
                if violation.rule == "axis_not_chosen"
            ]
            if warnings:
                acknowledgement = AxisWarningAcknowledgement(
                    draft_revision=draft.revision,
                    policy_revision=rules.annotation_policy_revision,
                    warning_digest=canonical_hash(
                        {
                            "workspace": key.model_dump(),
                            "snapshots": sorted(s.version for s in deduped_snaps),
                            "warnings": warnings,
                        }
                    ),
                )
                if cmd.warning_acknowledgement != acknowledgement:
                    raise DomainError(
                        "AXIS_CONFIRMATION_WARNING",
                        {
                            "warnings": warnings,
                            "acknowledgement": acknowledgement.model_dump(),
                        },
                    )

        if round_view is not None and round_view.kind in CARRY_ROUND_KINDS:
            from ontocurator.application.work_rounds import (
                validate_round_input_resolutions,
            )

            validate_round_input_resolutions(self.repo, draft)
        canonical_content = {
            "key": key.model_dump(),
            "scope": submission_scope.model_dump(),
            "targets": draft.targets.model_dump(),
            "draft_revision": draft.revision,
            "snapshots": [s.version for s in deduped_snaps],
            "decisions": [d.model_dump() for d in decisions],
        }
        if draft.reanchor_inputs or draft.reanchor_resolutions:
            canonical_content["reanchor_inputs"] = [
                item.model_dump(mode="json") for item in draft.reanchor_inputs
            ]
            canonical_content["reanchor_resolutions"] = [
                resolution.model_dump(mode="json")
                for resolution in draft.reanchor_resolutions
            ]
        if round_view is not None:
            canonical_content["input_manifest_sha256"] = (
                round_view.input_manifest_sha256
            )
            canonical_content["round_input_resolutions"] = [
                r.model_dump(mode="json") for r in draft.round_input_resolutions
            ]
        sub_id = f"sub-{canonical_hash(canonical_content)[:16]}"

        return Submission(
            format_version="ontocurator-submission/v3"
            if round_view
            else "ontocurator-submission/v2",
            input_manifest_sha256=round_view.input_manifest_sha256
            if round_view
            else None,
            round_input_resolutions=list(draft.round_input_resolutions),
            submission_id=sub_id,
            origin_key=origin_key,
            scope=submission_scope,
            targets=draft.targets,
            draft_revision=draft.revision + 1,
            snapshots=deduped_snaps,
            decisions=decisions,
            reanchor_inputs=list(draft.reanchor_inputs),
            reanchor_resolutions=list(draft.reanchor_resolutions),
            checked_layer_ids=list(draft.checked_layer_ids),
            document_checked=True,
            created_at=datetime.now(UTC).isoformat(),
        )
