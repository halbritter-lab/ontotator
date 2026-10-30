"""Work on an old text version after a correction (spec V5, VD13, I1 to I8).

A lead previews, moves, lets finish, withdraws, carries and hands over work
across a text change. Every write is one transaction under the exclusive
project lock: all or nothing. Move and carry are idempotent per ``request_id``
(command receipts); a text-change resolution is recorded once per assignment.
Nothing is deleted: old assignments are revoked, drafts and submissions stay.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, RowMapping, func, insert, select

from ontotator.application.work_plans import _chains
from ontotator.application.work_plans import _target as _row_target
from ontotator.application.work_rounds import WorkRoundService, require_independent
from ontotator.application.workflow_guards import require_task_writable
from ontotator.assignments.eligibility import (
    check_work_plan,
    load_variants,
    require_annotation_gate,
)
from ontotator.assignments.service import AssignmentService
from ontotator.auth.accounts import normalize_username
from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.authz.policy import Access, Action, can
from ontotator.authz.visibility import current_access
from ontotator.domain import document_rows as rules
from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.reanchor import NeedsReview, reanchor_annotation, text_map
from ontotator.domain.scopes import build_scope
from ontotator.domain.serialization import decode_snapshot
from ontotator.domain.variants import VariantInfo
from ontotator.domain.work_plans import RowKey
from ontotator.domain.work_rounds import (
    CARRY_ROUND_KINDS,
    DraftSnapshotPayload,
    WorkRoundView,
    is_exact_ancestor,
)
from ontotator.domain.workspace import Draft, Submission
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage.database import Database
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.live_submissions import live_submission
from ontotator.storage.overview_tables import (
    DraftSnapshotRow,
    TextChangeResolutionRow,
)
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.repository import Repository, _key_str, _lock_id
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontotator.storage.workflow_tables import (
    RoundInputRow,
    WorkflowCommandReceiptRow,
)

logger = logging.getLogger(__name__)

# The actor of the automatic carry after "Let X finish on v1" (V8).
SYSTEM_ACTOR = Actor(user_id=None, label="system:text_change")

# Unplaced findings whose marked text the correction changed (preview).
_CHANGED_REASONS = frozenset(
    {"changed_segment", "changed_cue", "changed_modifier_segment"}
)
# ``revoke_assignments`` reasons of the text-change operations (audit details).
MOVED_REASON = "moved_to_version"
WITHDRAWN_REASON = "text_change_withdrawn"


def editable_findings(
    snapshots: Iterable[AnnotationSnapshot], profile: TaskProfile
) -> list[AnnotationSnapshot]:
    """The findings in the profile's editable layers (the ones a carry
    re-anchors; read-only layers are not carried)."""
    editable = {
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    }
    return [item for item in snapshots if item.annotation.layer_id in editable]


def unplaced_findings(
    snapshots: Sequence[AnnotationSnapshot], old_text: str, new_text: str
) -> list[NeedsReview]:
    """The findings a carry from ``old_text`` to ``new_text`` cannot place."""
    mapping = text_map(old_text, new_text)
    return [
        mapped
        for mapped in (
            reanchor_annotation(item, item.evidence, old_text, new_text, mapping)
            for item in snapshots
        )
        if isinstance(mapped, NeedsReview)
    ]


def findings_in_changed_passages(unplaced: Iterable[NeedsReview]) -> int:
    """Unplaced findings whose marked text the correction changed (the
    preview's and the final-result panel's "in changed passages")."""
    return sum(1 for item in unplaced if item.reason in _CHANGED_REASONS)


class CarryPerson(BaseModel):
    """A member who may annotate the target; ``has_work`` mutes them (VD13)."""

    model_config = ConfigDict(extra="forbid")
    username: str
    display_name: str
    author: bool
    has_work: bool


class TextChangePreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_version: int
    to_version: int
    findings: int
    placed: int
    unplaced: int
    # Unplaced findings whose marked text was changed by the correction.
    in_changed_passages: int
    persons: list[CarryPerson]


class MoveResult(BaseModel):
    """The new assignment on the target and its ``text_change`` round.

    ``round`` is None when the moved assignment had not started a round: the
    person then starts on the target from scratch (nothing to carry).
    """

    model_config = ConfigDict(extra="forbid")
    assignment_id: int
    round: WorkRoundView | None


class CarryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolution: Literal["carried", "handed_over", "dismissed"]
    assignment_id: int | None
    round: WorkRoundView | None
    carried_findings: int


def _not_applicable(reason: str) -> DomainError:
    return DomainError("TEXT_CHANGE_NOT_APPLICABLE", {"reason": reason})


def _from_proposals(step: Literal["move", "carry"]) -> DomainError:
    """Work from proposals stays on its version (plan P4, A6): its decisions
    refer to the proposals of that version. ``step`` picks the message."""
    return DomainError(
        "TEXT_CHANGE_NOT_APPLICABLE", {"reason": "from_proposals", "step": step}
    )


def _require_carryable(submission: Submission) -> None:
    """Only annotation from scratch is carried to a new version."""
    if submission.origin_key.mode == "proposal_check":
        raise _from_proposals("carry")
    if submission.origin_key.mode != "independent":
        raise _not_applicable("not_annotation")


class TextChangeService:
    def __init__(self, db: Database, repo: Repository) -> None:
        self.db = db
        self.repo = repo

    # --- shared checks -------------------------------------------------------- #

    def _begin(
        self,
        conn: Connection,
        access: Access,
        actor: Actor,
        project: str,
        *,
        target_user_id: int | None = None,
    ) -> RowMapping:
        """Locks (members shared, project exclusive) and the lead check.

        ``target_user_id`` is the assignee the operation gives work to; their
        user row is locked like ``AssignmentService._prepare`` does, so a
        deactivation or language change waits for this write. The caller
        re-derives the assignee after the lock and refuses on a mismatch.
        """
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
        )
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", project))))
        lock_user_authority(conn, access.user_id, target_user_id=target_user_id)
        return self._lead_project(conn, access, actor, project)

    def _lead_project(
        self, conn: Connection, access: Access, actor: Actor, project: str
    ) -> RowMapping:
        pid = self.repo._require_project(conn, project)
        fresh = current_access(conn, access, pid, project)
        if not can(fresh, Action.VIEW_PROJECT, project):
            # A foreign project looks like a missing one (E3).
            raise DomainError("PROJECT_NOT_FOUND")
        if actor.user_id != fresh.user_id or not can(
            fresh, Action.MANAGE_ASSIGNMENTS, project
        ):
            raise AccessDenied("NOT_ALLOWED")
        return (
            conn.execute(select(ProjectRow).where(ProjectRow.id == pid))
            .mappings()
            .one()
        )

    def _check_target(
        self,
        conn: Connection,
        project: str,
        pid: int,
        from_id: str,
        target_document_id: str,
        *,
        withdrawing: bool = False,
    ) -> tuple[VariantInfo, VariantInfo]:
        """The source and target versions after the spec's checks (I2, I7).

        ``withdrawing``: work on a correction that does not count, later than
        the target (``Version.not_newer``), can only be withdrawn.

        Raises:
            DomainError: ``TEXT_CHANGE_NOT_APPLICABLE`` (``already_on_target``,
                ``not_ancestor``, ``target_not_annotatable``),
                ``TEXT_CHANGE_CHANGED`` (``target_changed``),
                ``NOT_IN_WORK_PLAN`` (discarded version or Annotate off).
        """
        variants = {v.document_id: v for v in self.repo.list_variants(project)}
        chain = self._chain(conn, pid, variants, from_id)
        source = variants[from_id]
        target_id = _row_target(chain).document_id
        if from_id == target_id:
            raise _not_applicable("already_on_target")
        if target_document_id != target_id:
            raise DomainError("TEXT_CHANGE_CHANGED", {"reason": "target_changed"})
        later = source.version > variants[target_id].version
        if not (withdrawing and later) and not is_exact_ancestor(
            variants, target_id, from_id
        ):
            raise _not_applicable("not_ancestor")
        discarded = conn.execute(
            select(DiscardedVariantRow.document_id).where(
                DiscardedVariantRow.project_id == pid,
                DiscardedVariantRow.document_id.in_(
                    [v.document_id for v in chain.versions]
                ),
            )
        ).first()
        if discarded is not None:
            raise DomainError("NOT_IN_WORK_PLAN")
        target = variants[target_id]
        check_work_plan(conn, pid, target, "annotate")
        try:
            require_annotation_gate(conn, pid, target_id)
        except DomainError as error:
            if error.code == "TASK_WAITING_FOR_TRANSLATION_REVIEW":
                raise _not_applicable("target_not_annotatable") from None
            raise
        return source, target

    @staticmethod
    def _chain(
        conn: Connection, pid: int, variants: Mapping[str, VariantInfo], from_id: str
    ) -> rules.Chain:
        """The version chain of ``from_id`` in its row."""
        source = variants.get(from_id)
        if source is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        chains = _chains(conn, pid, [source.case_id]).get(
            RowKey(source.case_id, source.language), []
        )
        chain = next(
            (c for c in chains if any(v.document_id == from_id for v in c.versions)),
            None,
        )
        if chain is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        return chain

    def current_target(
        self, conn: Connection, project: str, pid: int, from_id: str
    ) -> str:
        """The document ID of the newest counted version of ``from_id``'s root."""
        variants = {v.document_id: v for v in self.repo.list_variants(project)}
        return str(_row_target(self._chain(conn, pid, variants, from_id)).document_id)

    @staticmethod
    def _require_open_annotation(assignment: Mapping[Any, Any]) -> None:
        if assignment["task"] != "annotate":
            raise _not_applicable("not_annotation")
        if assignment["status"] == "submitted":
            raise _not_applicable("not_open")

    @staticmethod
    def _require_movable(assignment: Mapping[Any, Any]) -> None:
        """Open work a move can carry: a round, or nothing started yet.

        Started work without a round (legacy drafts before rounds) cannot be
        frozen into a snapshot; moving it would lose the draft (``not_open``).
        """
        TextChangeService._require_open_annotation(assignment)
        if assignment["annotation_mode"] == "proposals":
            raise _from_proposals("move")
        if assignment["active_round_id"] is None and assignment["status"] != "open":
            raise _not_applicable("not_open")

    @staticmethod
    def _require_undecided(conn: Connection, pid: int, assignment_id: int) -> None:
        """One text-change decision per assignment (``already_resolved``)."""
        if (
            conn.execute(
                select(TextChangeResolutionRow.id).where(
                    TextChangeResolutionRow.project_id == pid,
                    TextChangeResolutionRow.assignment_id == assignment_id,
                )
            ).first()
            is not None
        ):
            raise _not_applicable("already_resolved")

    @staticmethod
    def _replay(
        conn: Connection, pid: int, actor_key: str, request_id: str, request_hash: str
    ) -> dict[str, Any] | None:
        receipt = (
            conn.execute(
                select(WorkflowCommandReceiptRow).where(
                    WorkflowCommandReceiptRow.project_id == pid,
                    WorkflowCommandReceiptRow.actor_key == actor_key,
                    WorkflowCommandReceiptRow.request_id == request_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if receipt is None:
            return None
        if receipt["request_hash"] != request_hash:
            raise DomainError("WORKFLOW_REQUEST_CONFLICT")
        response: dict[str, Any] = receipt["response"]
        return response

    @staticmethod
    def _store_receipt(
        conn: Connection,
        pid: int,
        actor_key: str,
        request_id: str,
        request_hash: str,
        response: BaseModel,
        now: datetime,
    ) -> None:
        conn.execute(
            insert(WorkflowCommandReceiptRow).values(
                project_id=pid,
                actor_key=actor_key,
                request_id=request_id,
                request_hash=request_hash,
                response=response.model_dump(mode="json"),
                created_at=now,
            )
        )

    @staticmethod
    def _record(
        conn: Connection,
        pid: int,
        source: VariantInfo,
        target: VariantInfo,
        resolution: str,
        actor: Actor,
        now: datetime,
        *,
        assignment_id: int | None = None,
        submission_id: str | None = None,
        round_id: str | None = None,
    ) -> None:
        conn.execute(
            insert(TextChangeResolutionRow).values(
                project_id=pid,
                case_id=source.case_id,
                language=source.language,
                from_document_id=source.document_id,
                to_document_id=target.document_id,
                assignment_id=assignment_id,
                submission_id=submission_id,
                resolution=resolution,
                round_id=round_id,
                decided_by=actor.user_id,
                decided_at=now,
            )
        )

    @staticmethod
    def _work_on_row(
        conn: Connection, pid: int, case_id: str, language: str
    ) -> tuple[set[int], set[str]]:
        """Users with a live annotate assignment and pseudonyms with an
        annotation submission on any version of the row."""
        documents = select(DocumentRow.document_id).where(
            DocumentRow.project_id == pid,
            DocumentRow.case_id == case_id,
            DocumentRow.language == language,
        )
        assigned = set(
            conn.execute(
                select(AssignmentRow.user_id).where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.task == "annotate",
                    AssignmentRow.revoked_at.is_(None),
                    AssignmentRow.document_id.in_(documents),
                )
            ).scalars()
        )
        submitted = set(
            conn.execute(
                select(SubmissionRow.annotator_id).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.mode.in_(["independent", "proposal_check"]),
                    SubmissionRow.document_id.in_(documents),
                    live_submission(),
                )
            ).scalars()
        )
        return assigned, submitted

    def _persons(
        self, conn: Connection, pid: int, source: VariantInfo, author: str | None
    ) -> list[CarryPerson]:
        """Active annotators of the project, by display name."""
        assigned, submitted = self._work_on_row(
            conn, pid, source.case_id, source.language
        )
        rows = conn.execute(
            select(
                UserRow.id, UserRow.username, UserRow.display_name, UserRow.pseudonym
            )
            .join(ProjectMembershipRow, ProjectMembershipRow.user_id == UserRow.id)
            .where(
                ProjectMembershipRow.project_id == pid,
                ProjectMembershipRow.role == "annotator",
                UserRow.active.is_(True),
            )
            .order_by(UserRow.display_name, UserRow.username)
        ).all()
        return [
            CarryPerson(
                username=row.username,
                display_name=row.display_name,
                author=row.pseudonym == author,
                has_work=row.id in assigned or row.pseudonym in submitted,
            )
            for row in rows
        ]

    def _source_state(
        self, conn: Connection, project: str, pid: int, submission_id: str
    ) -> int | None:
        """Refuse a submission that is not its round's current result (rule 3b).

        Returns the ID of the assignment that produced it, if known.
        """
        bound = self.repo.round_for_submission_in(conn, project, pid, submission_id)
        if bound is not None:
            if bound.latest_submission_id != submission_id or not bound.active:
                raise _not_applicable("not_latest_in_round")
            if bound.state != "submitted":
                raise _not_applicable("not_submitted")
            revoked = conn.execute(
                select(AssignmentRow.revoked_at).where(
                    AssignmentRow.id == bound.assignment_id
                )
            ).scalar_one()
            if revoked is not None:
                raise _not_applicable("not_submitted")
            return bound.assignment_id
        found = conn.execute(
            select(AssignmentRow.id).where(
                AssignmentRow.project_id == pid,
                AssignmentRow.last_submission_id == submission_id,
                AssignmentRow.revoked_at.is_(None),
            )
        ).scalar_one_or_none()
        if found is None:
            raise _not_applicable("not_latest_in_round")
        return int(found)

    def _check_submission(
        self,
        conn: Connection,
        key: str,
        pid: int,
        submission_id: str,
        submission: Submission,
    ) -> None:
        """The carry checks of a submission that need no target (rule 3b).

        Shared by ``carry`` and ``preview``: an annotation submission that is
        its round's current result, on a task that is not held.
        """
        _require_carryable(submission)
        source_assignment = self._source_state(conn, key, pid, submission_id)
        if source_assignment is not None:
            require_task_writable(conn, source_assignment)

    # --- operations ------------------------------------------------------------- #

    def preview(
        self,
        access: Access,
        actor: Actor,
        key: str,
        *,
        assignment_id: int | None,
        submission_id: str | None,
        target_document_id: str,
    ) -> TextChangePreview:
        """Counts of a move or carry, computed without writing anything.

        Runs the source checks of the operation it previews: a move's open
        work, a carry's current annotation result on a task that is not held.
        """
        if (assignment_id is None) == (submission_id is None):
            # The route validates this; a caller naming neither or both is a bug.
            raise ValueError("Name either an assignment or a submission")
        with self.db.transaction() as conn:
            self._lead_project(conn, access, actor, key)
            pid = self.repo._require_project(conn, key)
            snapshots: list[AnnotationSnapshot]
            if assignment_id is not None:
                assignment = (
                    conn.execute(
                        select(AssignmentRow).where(
                            AssignmentRow.id == assignment_id,
                            AssignmentRow.project_id == pid,
                        )
                    )
                    .mappings()
                    .one_or_none()
                )
                if assignment is None:
                    raise DomainError("ASSIGNMENT_NOT_FOUND")
                self._require_movable(assignment)
                from_id = assignment["document_id"]
                author = conn.execute(
                    select(UserRow.pseudonym).where(UserRow.id == assignment["user_id"])
                ).scalar_one()
                snapshots = self._current_draft(conn, key, pid, assignment)
            else:
                assert submission_id is not None
                submission = self.repo.get_submission(submission_id, key)
                if submission is None:
                    raise DomainError("SUBMISSION_NOT_FOUND")
                self._check_submission(conn, key, pid, submission_id, submission)
                from_id = submission.origin_key.document_id
                author = submission.origin_key.annotator_id
                snapshots = list(submission.snapshots)
            source, target = self._check_target(
                conn, key, pid, from_id, target_document_id
            )
            old = self.repo.get_document(key, source.document_id)
            new = self.repo.get_document(key, target.document_id)
            assert old is not None and new is not None
            # Only editable layers are carried (as the final-result panel).
            snapshots = editable_findings(snapshots, self.repo.get_task_profile(key))
            unplaced = unplaced_findings(snapshots, old.text, new.text)
            return TextChangePreview(
                from_version=source.version,
                to_version=target.version,
                findings=len(snapshots),
                placed=len(snapshots) - len(unplaced),
                unplaced=len(unplaced),
                in_changed_passages=findings_in_changed_passages(unplaced),
                persons=self._persons(conn, pid, source, author),
            )

    @staticmethod
    def _findings(
        conn: Connection, pid: int, round_view: WorkRoundView, draft: Draft
    ) -> list[AnnotationSnapshot]:
        """A round's work: the draft's findings and its undecided unplaced inputs.

        An input of a carry round (``CARRY_ROUND_KINDS``) that could not be
        placed is not in the draft; until the person decides it, it belongs to
        the work. It is kept as its original snapshot, so a move offers it
        again on the new text (re-anchored, or again to be decided).
        """
        findings = list(draft.annotations)
        if round_view.kind not in CARRY_ROUND_KINDS:
            return findings
        decided = {r.input_id for r in draft.round_input_resolutions}
        for row in conn.execute(
            select(RoundInputRow.input_id, RoundInputRow.payload)
            .where(
                RoundInputRow.project_id == pid,
                RoundInputRow.round_id == round_view.round_id,
            )
            .order_by(RoundInputRow.position)
        ):
            if row.input_id in decided or row.payload["target_snapshot"] is not None:
                continue
            findings.append(decode_snapshot(row.payload["source_snapshot"]))
        return findings

    def _current_draft(
        self, conn: Connection, key: str, pid: int, assignment: Mapping[Any, Any]
    ) -> list[AnnotationSnapshot]:
        """The work of the assignment's active round (none if unstarted)."""
        round_id = assignment["active_round_id"]
        if round_id is None:
            return []
        round_view = self.repo.work_round_in(conn, key, pid, round_id)
        workspace = round_view.workspace_key
        if (
            workspace is None
            or self.repo._draft_row(conn, pid, _key_str(workspace)) is None
        ):
            return []
        return self._findings(
            conn, pid, round_view, self.repo._open_draft(conn, workspace, None)
        )

    def move_to_version(
        self,
        access: Access,
        actor: Actor,
        assignment_id: int,
        *,
        target_document_id: str,
        expected_workflow_revision: int,
        request_id: str,
        confirm_unreviewed_translation: bool = False,
    ) -> MoveResult:
        """Freeze the draft, continue on the target, revoke the old assignment."""
        request_hash = canonical_hash(
            {
                "operation": "text_change.move",
                "assignment_id": assignment_id,
                "target_document_id": target_document_id,
                "revision": expected_workflow_revision,
            }
        )
        actor_key = str(access.user_id)
        with self.db.transaction() as conn:
            key = AssignmentService._locate(conn, assignment_id)
            # The assignee, read before the locks; re-checked on the locked row.
            user_id = int(
                conn.execute(
                    select(AssignmentRow.user_id).where(
                        AssignmentRow.id == assignment_id
                    )
                ).scalar_one()
            )
            project_row = self._begin(conn, access, actor, key, target_user_id=user_id)
            pid = int(project_row["id"])
            stored = self._replay(conn, pid, actor_key, request_id, request_hash)
            if stored is not None:
                return MoveResult.model_validate(stored)
            self._require_undecided(conn, pid, assignment_id)
            old = AssignmentService._locked(conn, assignment_id)
            if (
                old["workflow_revision"] != expected_workflow_revision
                or old["user_id"] != user_id
            ):
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            self._require_movable(old)
            require_task_writable(conn, assignment_id)
            source, target = self._check_target(
                conn, key, pid, old["document_id"], target_document_id
            )
            if (
                AssignmentService.active_for(
                    conn, pid, target.document_id, user_id, "annotate"
                )
                is not None
            ):
                raise DomainError("ASSIGNMENT_EXISTS")
            owner = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == user_id)
            ).scalar_one()
            now = datetime.now(UTC)
            AssignmentService._require_annotation_slot(
                conn, project_row, target.document_id
            )
            snapshot_id = self._freeze_draft(conn, key, pid, old, source)
            assignments = AssignmentService(self.db, now=lambda: now)
            # The person already works on this row's language: a language
            # mismatch is confirmed by the lead's move (and audited).
            eligibility = assignments.check_assignable(
                conn,
                project_row,
                target.document_id,
                user_id,
                "annotate",
                True,
                variants=load_variants(conn, pid, target.document_id),
                confirm_unreviewed_translation=confirm_unreviewed_translation,
            )
            created = assignments._create(
                conn,
                actor,
                project_row,
                target.document_id,
                user_id,
                "annotate",
                eligibility,
                now,
            )
            round_view = None
            if snapshot_id is not None:
                round_view = WorkRoundService(self.db).create_in(
                    conn,
                    project=key,
                    pid=pid,
                    actor=actor,
                    assignment=AssignmentService._locked(conn, created.id),
                    kind="text_change",
                    sources=[],
                    draft_sources=[snapshot_id],
                    reason=None,
                    expected_workflow_revision=created.workflow_revision,
                    lead=True,
                    owner=owner,
                )
            revoke_assignments(conn, actor, pid, [dict(old)], now, reason=MOVED_REASON)
            self._record(
                conn,
                pid,
                source,
                target,
                "moved",
                actor,
                now,
                assignment_id=assignment_id,
                round_id=round_view.round_id if round_view else None,
            )
            record_audit(
                conn,
                actor,
                "text_change.move",
                target_type="assignment",
                target_id=assignment_id,
                project_id=pid,
                details={
                    "from_document_id": source.document_id,
                    "to_document_id": target.document_id,
                    "new_assignment_id": created.id,
                    "round_id": round_view.round_id if round_view else None,
                    "draft_snapshot_id": snapshot_id,
                },
                at=now,
            )
            result = MoveResult(assignment_id=created.id, round=round_view)
            self._store_receipt(
                conn, pid, actor_key, request_id, request_hash, result, now
            )
            return result

    def _freeze_draft(
        self,
        conn: Connection,
        key: str,
        pid: int,
        assignment: Mapping[Any, Any],
        source: VariantInfo,
    ) -> int | None:
        """Store the active round's work in ``draft_snapshots`` (immutable).

        None for an open assignment that has not started a round (nothing to
        carry); ``_require_movable`` refuses started work without a round.
        """
        round_id = assignment["active_round_id"]
        if round_id is None:
            return None
        round_view = self.repo.work_round_in(conn, key, pid, round_id)
        if round_view.state != "editable" or round_view.workspace_key is None:
            raise _not_applicable("not_open")
        workspace = round_view.workspace_key
        draft = self.repo._open_draft(conn, workspace, None)
        profile = self.repo.get_task_profile(key)
        payload = DraftSnapshotPayload(
            origin_key=workspace,
            scope=build_scope(profile, workspace.mode),
            document_version=source.version,
            text_sha256=source.text_sha256,
            # Only editable layers are carried (as the preview counts them).
            snapshots=editable_findings(
                self._findings(conn, pid, round_view, draft), profile
            ),
        )
        snapshot_id: int = conn.execute(
            insert(DraftSnapshotRow)
            .values(
                project_id=pid,
                assignment_id=int(assignment["id"]),
                document_id=source.document_id,
                workspace_key=_key_str(workspace),
                draft_revision=draft.revision,
                payload=payload.stored(),
            )
            .returning(DraftSnapshotRow.id)
        ).scalar_one()
        return snapshot_id

    def resolve(
        self,
        access: Access,
        actor: Actor,
        assignment_id: int,
        *,
        resolution: Literal["finish_then_carry", "withdrawn"],
        target_document_id: str,
        expected_workflow_revision: int,
    ) -> None:
        """Record "Let X finish on v1" or withdraw (revoke, draft kept).

        Repeating the same decision is a no-op; another decision for an
        assignment already decided is refused (``already_resolved``). A
        decision on a changed assignment (``expected_workflow_revision``) is
        refused with ``WORKFLOW_REVISION_CONFLICT``.
        """
        with self.db.transaction() as conn:
            key = AssignmentService._locate(conn, assignment_id)
            project_row = self._begin(conn, access, actor, key)
            pid = int(project_row["id"])
            recorded = conn.execute(
                select(
                    TextChangeResolutionRow.resolution,
                    TextChangeResolutionRow.to_document_id,
                ).where(
                    TextChangeResolutionRow.project_id == pid,
                    TextChangeResolutionRow.assignment_id == assignment_id,
                )
            ).one_or_none()
            if recorded is not None:
                if tuple(recorded) == (resolution, target_document_id):
                    return
                raise _not_applicable("already_resolved")
            old = AssignmentService._locked(conn, assignment_id)
            if old["workflow_revision"] != expected_workflow_revision:
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            self._require_open_annotation(old)
            if (
                resolution == "finish_then_carry"
                and old["annotation_mode"] == "proposals"
            ):
                # The finished work would be carried later: refused now.
                raise _from_proposals("carry")
            require_task_writable(conn, assignment_id)
            source, target = self._check_target(
                conn,
                key,
                pid,
                old["document_id"],
                target_document_id,
                withdrawing=resolution == "withdrawn",
            )
            now = datetime.now(UTC)
            if resolution == "withdrawn":
                revoke_assignments(
                    conn, actor, pid, [dict(old)], now, reason=WITHDRAWN_REASON
                )
            self._record(
                conn,
                pid,
                source,
                target,
                resolution,
                actor,
                now,
                assignment_id=assignment_id,
            )
            record_audit(
                conn,
                actor,
                "text_change.resolve",
                target_type="assignment",
                target_id=assignment_id,
                project_id=pid,
                details={
                    "resolution": resolution,
                    "from_document_id": source.document_id,
                    "to_document_id": target.document_id,
                },
                at=now,
            )

    def carry(
        self,
        access: Access,
        actor: Actor,
        key: str,
        submission_id: str,
        *,
        target_document_id: str,
        mode: Literal["author", "other", "dismiss"],
        username: str | None,
        confirm_language: bool,
        request_id: str,
        confirm_unreviewed_translation: bool = False,
    ) -> CarryResult:
        """Carry a submission on an old version to the target (rule 3b).

        ``author``: the author continues in a ``carry_forward`` round (on a
        new assignment, or on their open target assignment without a round);
        ``other``: a ``handover`` round for ``username``, who must have no own
        work on the row (I3); ``dismiss``: only the decision is recorded. A
        final on the old version is never touched (I6).
        """
        request_hash = canonical_hash(
            {
                "operation": "text_change.carry",
                "submission_id": submission_id,
                "target_document_id": target_document_id,
                "mode": mode,
                "username": username,
                "confirm_language": confirm_language,
                "confirm_unreviewed_translation": confirm_unreviewed_translation,
            }
        )
        actor_key = str(access.user_id)
        with self.db.transaction() as conn:
            # The person who gets the work, read before the locks (None when
            # there is none or it is unknown); ``_carry_round`` re-checks it.
            assignee = self._carry_assignee(conn, key, submission_id, mode, username)
            project_row = self._begin(conn, access, actor, key, target_user_id=assignee)
            pid = int(project_row["id"])
            stored = self._replay(conn, pid, actor_key, request_id, request_hash)
            if stored is not None:
                return CarryResult.model_validate(stored)
            submission = self.repo.get_submission(submission_id, key)
            if submission is None:
                raise DomainError("SUBMISSION_NOT_FOUND")
            self._check_submission(conn, key, pid, submission_id, submission)
            source, target = self._check_target(
                conn, key, pid, submission.origin_key.document_id, target_document_id
            )
            if (
                conn.execute(
                    select(TextChangeResolutionRow.id).where(
                        TextChangeResolutionRow.project_id == pid,
                        TextChangeResolutionRow.submission_id == submission_id,
                        TextChangeResolutionRow.to_document_id == target.document_id,
                    )
                ).first()
                is not None
            ):
                raise _not_applicable("already_resolved")
            final = conn.execute(
                select(FinalSelectionRow.submission_id).where(
                    FinalSelectionRow.project_id == pid,
                    FinalSelectionRow.case_id == source.case_id,
                    FinalSelectionRow.language == source.language,
                )
            ).scalar_one_or_none()
            if final is not None and final != submission_id:
                raise _not_applicable("final_exists")
            now = datetime.now(UTC)
            if mode == "dismiss":
                result = CarryResult(
                    resolution="dismissed",
                    assignment_id=None,
                    round=None,
                    carried_findings=0,
                )
            else:
                result = self._carry_round(
                    conn,
                    key,
                    project_row,
                    actor,
                    submission_id,
                    submission.origin_key.annotator_id,
                    target,
                    mode=mode,
                    username=username,
                    locked_user_id=assignee,
                    confirm_language=confirm_language,
                    confirm_unreviewed_translation=confirm_unreviewed_translation,
                    now=now,
                )
            self._record(
                conn,
                pid,
                source,
                target,
                result.resolution,
                actor,
                now,
                submission_id=submission_id,
                round_id=result.round.round_id if result.round else None,
            )
            record_audit(
                conn,
                actor,
                "text_change.carry",
                target_type="submission",
                target_id=submission_id,
                project_id=pid,
                details={
                    "mode": mode,
                    "resolution": result.resolution,
                    "from_document_id": source.document_id,
                    "to_document_id": target.document_id,
                    "assignment_id": result.assignment_id,
                    "round_id": result.round.round_id if result.round else None,
                    "username": username if mode == "other" else None,
                },
                at=now,
            )
            self._store_receipt(
                conn, pid, actor_key, request_id, request_hash, result, now
            )
            return result

    @staticmethod
    def _carry_assignee(
        conn: Connection,
        key: str,
        submission_id: str,
        mode: Literal["author", "other", "dismiss"],
        username: str | None,
    ) -> int | None:
        """The user a carry gives work to, if known (an unlocked read)."""
        if mode == "other":
            try:
                name = normalize_username(username or "")
            except DomainError:
                return None
            return conn.execute(
                select(UserRow.id).where(UserRow.username == name)
            ).scalar_one_or_none()
        if mode == "author":
            return conn.execute(
                select(UserRow.id)
                .join(SubmissionRow, SubmissionRow.annotator_id == UserRow.pseudonym)
                .join(ProjectRow, ProjectRow.id == SubmissionRow.project_id)
                .where(
                    ProjectRow.project_key == key,
                    SubmissionRow.submission_id == submission_id,
                )
            ).scalar_one_or_none()
        return None

    def _carry_round(
        self,
        conn: Connection,
        key: str,
        project_row: RowMapping,
        actor: Actor,
        submission_id: str,
        author: str,
        target: VariantInfo,
        *,
        mode: Literal["author", "other"],
        username: str | None,
        locked_user_id: int | None,
        confirm_language: bool,
        now: datetime,
        # Never set by the automatic carry (plan D2): it falls back to the
        # lead's manual carry, which asks.
        confirm_unreviewed_translation: bool = False,
    ) -> CarryResult:
        pid = int(project_row["id"])
        assignments = AssignmentService(self.db, now=lambda: now)
        if mode == "author":
            user_id = conn.execute(
                select(UserRow.id).where(UserRow.pseudonym == author)
            ).scalar_one_or_none()
            if user_id is None:
                raise DomainError("USER_NOT_FOUND")
            owner = author
        else:
            if not username:
                raise DomainError("USER_NOT_FOUND")
            user_id = AssignmentService._target(conn, username)
        if user_id != locked_user_id:
            # The person changed between the read and the user lock.
            raise DomainError("WORKFLOW_REVISION_CONFLICT")
        if mode == "author":
            existing = AssignmentService.active_for(
                conn, pid, target.document_id, user_id, "annotate"
            )
            if existing is not None:
                # Only an untouched waiting assignment takes the carried work.
                if (
                    existing.active_round_id is not None
                    or existing.status != "open"
                    or existing.lead_correction
                    or existing.last_submission_id is not None
                ):
                    raise DomainError("ASSIGNMENT_EXISTS")
                AssignmentService._require_target(
                    conn, project_row, user_id, "annotate"
                )
        else:
            owner = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == user_id)
            ).scalar_one()
            require_independent(
                conn,
                pid,
                case_id=target.case_id,
                language=target.language,
                user_id=user_id,
                pseudonym=owner,
                excluding=None,
            )
            existing = None
        if existing is None:
            AssignmentService._require_annotation_slot(
                conn, project_row, target.document_id
            )
            eligibility = assignments.check_assignable(
                conn,
                project_row,
                target.document_id,
                user_id,
                "annotate",
                confirm_language,
                variants=load_variants(conn, pid, target.document_id),
                confirm_unreviewed_translation=confirm_unreviewed_translation,
            )
            assignment_id = assignments._create(
                conn,
                actor,
                project_row,
                target.document_id,
                user_id,
                "annotate",
                eligibility,
                now,
            ).id
        else:
            assignment_id = existing.id
        locked = AssignmentService._locked(conn, assignment_id)
        round_view = WorkRoundService(self.db).create_in(
            conn,
            project=key,
            pid=pid,
            actor=actor,
            assignment=locked,
            kind="carry_forward" if mode == "author" else "handover",
            sources=[submission_id],
            draft_sources=[],
            reason=None,
            expected_workflow_revision=int(locked["workflow_revision"]),
            lead=True,
            owner=owner,
        )
        carried = len(self.repo.get_round_input_inventory(key, round_view.round_id))
        return CarryResult(
            resolution="carried" if mode == "author" else "handed_over",
            assignment_id=assignment_id,
            round=round_view,
            carried_findings=carried,
        )


def auto_carry_on_submit(
    conn: Connection,
    repo: Repository,
    *,
    project_id: int,
    project_key: str,
    assignment_id: int,
    submission: Submission,
) -> None:
    """Carry a submission on an old version for its author (V8).

    Runs inside the submit transaction, which holds the exclusive project
    lock. When the lead let the author finish on the old version
    (``finish_then_carry``), the author gets a ``carry_forward`` round on the
    root's newest version. Anything that prevents it (no resolution any more,
    target not annotatable, author no longer a member, own work on the
    target, any error) leaves the submission alone: the savepoint is rolled
    back, the reason logged, and rule 3b ("Carry to v2…") applies.
    """
    try:
        with repo.db.savepoint(conn):
            _auto_carry(
                conn,
                repo,
                pid=project_id,
                key=project_key,
                assignment_id=assignment_id,
                submission=submission,
            )
    except DomainError as error:
        logger.warning(
            "No automatic carry for assignment %s after a text change: %s",
            assignment_id,
            error.code,
        )
    except Exception:
        logger.exception(
            "Automatic carry for assignment %s after a text change failed",
            assignment_id,
        )


def _auto_carry(
    conn: Connection,
    repo: Repository,
    *,
    pid: int,
    key: str,
    assignment_id: int,
    submission: Submission,
) -> None:
    # Re-read under the lock: only a decision that still stands is carried.
    decided_by = conn.execute(
        select(TextChangeResolutionRow.decided_by).where(
            TextChangeResolutionRow.project_id == pid,
            TextChangeResolutionRow.assignment_id == assignment_id,
            TextChangeResolutionRow.resolution == "finish_then_carry",
        )
    ).one_or_none()
    if decided_by is None:
        return
    _require_carryable(submission)
    service = TextChangeService(repo.db, repo)
    from_id = submission.origin_key.document_id
    # The newest version now, also when the text changed again since.
    target_id = service.current_target(conn, key, pid, from_id)
    source, target = service._check_target(conn, key, pid, from_id, target_id)
    project_row = (
        conn.execute(select(ProjectRow).where(ProjectRow.id == pid)).mappings().one()
    )
    source_row = conn.execute(
        select(AssignmentRow.user_id, AssignmentRow.revoked_at, UserRow.pseudonym)
        .join(UserRow, UserRow.id == AssignmentRow.user_id)
        .where(AssignmentRow.id == assignment_id)
    ).one()
    # Only the author's own, still standing assignment carries their work.
    if (
        source_row.revoked_at is not None
        or source_row.pseudonym != submission.origin_key.annotator_id
    ):
        raise _not_applicable("not_annotation")
    user_id = source_row.user_id
    # Still a member who may annotate (raises otherwise).
    AssignmentService._require_target(conn, project_row, user_id, "annotate")
    now = datetime.now(UTC)
    result = service._carry_round(
        conn,
        key,
        project_row,
        SYSTEM_ACTOR,
        submission.submission_id,
        submission.origin_key.annotator_id,
        target,
        mode="author",
        username=None,
        locked_user_id=user_id,
        # The author works on this row's language already (as a move).
        confirm_language=True,
        now=now,
    )
    assert result.round is not None
    TextChangeService._record(
        conn,
        pid,
        source,
        target,
        "carried",
        SYSTEM_ACTOR,
        now,
        submission_id=submission.submission_id,
        round_id=result.round.round_id,
    )
    record_audit(
        conn,
        SYSTEM_ACTOR,
        "text_change.auto_carry",
        target_type="submission",
        target_id=submission.submission_id,
        project_id=pid,
        details={
            "from_assignment_id": assignment_id,
            "submission_id": submission.submission_id,
            "round_id": result.round.round_id,
            "finish_then_carry_decided_by": decided_by[0],
        },
        at=now,
    )
