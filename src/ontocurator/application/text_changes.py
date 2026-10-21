"""Work on an old text version after a correction (spec V5, VD13, I1 to I8).

A lead previews, moves, lets finish, withdraws, carries and hands over work
across a text change. Every write is one transaction under the exclusive
project lock: all or nothing. Move and carry are idempotent per ``request_id``
(command receipts); a text-change resolution is recorded once per assignment.
Nothing is deleted: old assignments are revoked, drafts and submissions stay.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, RowMapping, func, insert, select

from ontocurator.application.work_plans import _chains
from ontocurator.application.work_plans import _target as _row_target
from ontocurator.application.work_rounds import WorkRoundService, require_independent
from ontocurator.assignments.eligibility import (
    check_work_plan,
    load_variants,
    require_annotation_gate,
)
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.authority import lock_user_authority
from ontocurator.authz.policy import Access, Action, can
from ontocurator.authz.visibility import current_access
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.reanchor import NeedsReview, reanchor_annotation, text_map
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.variants import VariantInfo
from ontocurator.domain.work_plans import RowKey
from ontocurator.domain.work_rounds import DraftSnapshotPayload, WorkRoundView
from ontocurator.projects.assignments import revoke_assignments
from ontocurator.storage.database import Database
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.overview_tables import (
    DraftSnapshotRow,
    TextChangeResolutionRow,
)
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import WorkflowCommandReceiptRow

# Unplaced findings whose marked text the correction changed (preview).
_CHANGED_REASONS = frozenset({"changed_segment", "changed_cue"})
# ``revoke_assignments`` reasons of the text-change operations (audit details).
MOVED_REASON = "moved_to_version"
WITHDRAWN_REASON = "text_change_withdrawn"


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


def is_exact_ancestor(
    variants: Mapping[str, VariantInfo], target_id: str, source_id: str
) -> bool:
    """Whether ``source_id`` is ``target_id`` or an exact correction ancestor.

    The same walk as round creation (``WorkRoundService.create_in``): every
    step is a correction of the same case, external ID and language whose
    version is one higher than its parent's.
    """
    current = variants[target_id]
    seen: set[str] = set()
    while current.document_id != source_id:
        parent = current.derived_from
        if (
            current.document_id in seen
            or current.origin != "correction"
            or parent is None
            or parent not in variants
        ):
            return False
        seen.add(current.document_id)
        previous = variants[parent]
        if (
            previous.case_id,
            previous.external_id,
            previous.language,
            previous.version + 1,
        ) != (current.case_id, current.external_id, current.language, current.version):
            return False
        current = previous
    return True


class TextChangeService:
    def __init__(self, db: Database, repo: Repository) -> None:
        self.db = db
        self.repo = repo

    # --- shared checks -------------------------------------------------------- #

    def _begin(
        self, conn: Connection, access: Access, actor: Actor, project: str
    ) -> RowMapping:
        """Locks (members shared, project exclusive) and the lead check."""
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
        )
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", project))))
        lock_user_authority(conn, access.user_id)
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
    ) -> tuple[VariantInfo, VariantInfo]:
        """The source and target versions after the spec's checks (I2, I7).

        Raises:
            DomainError: ``TEXT_CHANGE_NOT_APPLICABLE`` (``already_on_target``,
                ``not_ancestor``, ``target_not_annotatable``),
                ``TEXT_CHANGE_CHANGED`` (``target_changed``),
                ``NOT_IN_WORK_PLAN`` (discarded version or Annotate off).
        """
        variants = {v.document_id: v for v in self.repo.list_variants(project)}
        source = variants.get(from_id)
        if source is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        chains = _chains(conn, pid, [source.case_id]).get(
            RowKey(source.case_id, source.language), []
        )
        chain = next(
            c for c in chains if any(v.document_id == from_id for v in c.versions)
        )
        target_id = _row_target(chain).document_id
        if from_id == target_id:
            raise _not_applicable("already_on_target")
        if target_document_id != target_id:
            raise DomainError("TEXT_CHANGE_CHANGED", {"reason": "target_changed"})
        if not is_exact_ancestor(variants, target_id, from_id):
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
            if error.code in {"TRANSLATION_NOT_ACCEPTED", "NOT_A_TRANSLATION"}:
                raise _not_applicable("target_not_annotatable") from None
            raise
        return source, target

    @staticmethod
    def _require_open_annotation(assignment: Mapping[Any, Any]) -> None:
        if assignment["task"] != "annotate":
            raise _not_applicable("not_annotation")
        if assignment["status"] == "submitted":
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
                    SubmissionRow.mode.in_(["independent", "assisted"]),
                    SubmissionRow.document_id.in_(documents),
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
        """Counts of a move or carry, computed without writing anything."""
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
                self._require_open_annotation(assignment)
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
                from_id = submission.origin_key.document_id
                author = submission.origin_key.annotator_id
                snapshots = list(submission.snapshots)
            source, target = self._check_target(
                conn, key, pid, from_id, target_document_id
            )
            old = self.repo.get_document(key, source.document_id)
            new = self.repo.get_document(key, target.document_id)
            assert old is not None and new is not None
            mapping = text_map(old.text, new.text)
            unplaced = [
                mapped
                for mapped in (
                    reanchor_annotation(s, s.evidence, old.text, new.text, mapping)
                    for s in snapshots
                )
                if isinstance(mapped, NeedsReview)
            ]
            return TextChangePreview(
                from_version=source.version,
                to_version=target.version,
                findings=len(snapshots),
                placed=len(snapshots) - len(unplaced),
                unplaced=len(unplaced),
                in_changed_passages=sum(
                    1 for item in unplaced if item.reason in _CHANGED_REASONS
                ),
                persons=self._persons(conn, pid, source, author),
            )

    def _current_draft(
        self, conn: Connection, key: str, pid: int, assignment: Mapping[Any, Any]
    ) -> list[AnnotationSnapshot]:
        """The findings of the assignment's active round draft (none if unstarted)."""
        round_id = assignment["active_round_id"]
        if round_id is None:
            return []
        workspace = self.repo.work_round_in(conn, key, pid, round_id).workspace_key
        if (
            workspace is None
            or self.repo._draft_row(conn, pid, _key_str(workspace)) is None
        ):
            return []
        return list(self.repo._open_draft(conn, workspace, None).annotations)

    def move_to_version(
        self,
        access: Access,
        actor: Actor,
        assignment_id: int,
        *,
        target_document_id: str,
        expected_workflow_revision: int,
        request_id: str,
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
            project_row = self._begin(conn, access, actor, key)
            pid = int(project_row["id"])
            stored = self._replay(conn, pid, actor_key, request_id, request_hash)
            if stored is not None:
                return MoveResult.model_validate(stored)
            self._require_undecided(conn, pid, assignment_id)
            old = AssignmentService._locked(conn, assignment_id)
            if old["workflow_revision"] != expected_workflow_revision:
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            self._require_open_annotation(old)
            from ontocurator.application.workflow_guards import require_task_writable

            require_task_writable(conn, assignment_id)
            source, target = self._check_target(
                conn, key, pid, old["document_id"], target_document_id
            )
            user_id = int(old["user_id"])
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
        """Store the active round's draft in ``draft_snapshots`` (immutable)."""
        round_id = assignment["active_round_id"]
        if round_id is None:
            return None
        round_view = self.repo.work_round_in(conn, key, pid, round_id)
        if round_view.state != "editable" or round_view.workspace_key is None:
            raise _not_applicable("not_open")
        workspace = round_view.workspace_key
        draft = self.repo._open_draft(conn, workspace, None)
        payload = DraftSnapshotPayload(
            origin_key=workspace,
            scope=build_scope(self.repo.get_task_profile(key), workspace.mode),
            document_version=source.version,
            text_sha256=source.text_sha256,
            snapshots=list(draft.annotations),
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
    ) -> None:
        """Record "Let X finish on v1" or withdraw (revoke, draft kept).

        Repeating the same decision is a no-op; another decision for an
        assignment already decided is refused (``already_resolved``).
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
            self._require_open_annotation(old)
            from ontocurator.application.workflow_guards import require_task_writable

            require_task_writable(conn, assignment_id)
            source, target = self._check_target(
                conn, key, pid, old["document_id"], target_document_id
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
            }
        )
        actor_key = str(access.user_id)
        with self.db.transaction() as conn:
            project_row = self._begin(conn, access, actor, key)
            pid = int(project_row["id"])
            stored = self._replay(conn, pid, actor_key, request_id, request_hash)
            if stored is not None:
                return CarryResult.model_validate(stored)
            submission = self.repo.get_submission(submission_id, key)
            if submission is None:
                raise DomainError("SUBMISSION_NOT_FOUND")
            if submission.origin_key.mode != "independent":
                raise _not_applicable("not_annotation")
            source_assignment = self._source_state(conn, key, pid, submission_id)
            if source_assignment is not None:
                from ontocurator.application.workflow_guards import (
                    require_task_writable,
                )

                require_task_writable(conn, source_assignment)
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
                    confirm_language=confirm_language,
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
        confirm_language: bool,
        now: datetime,
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
            existing = AssignmentService.active_for(
                conn, pid, target.document_id, user_id, "annotate"
            )
            if existing is not None and (
                existing.active_round_id is not None
                or existing.status != "open"
                or existing.lead_correction
            ):
                raise DomainError("ASSIGNMENT_EXISTS")
        else:
            if not username:
                raise DomainError("USER_NOT_FOUND")
            user_id = AssignmentService._target(conn, username)
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
            eligibility = assignments.check_assignable(
                conn,
                project_row,
                target.document_id,
                user_id,
                "annotate",
                confirm_language,
                variants=load_variants(conn, pid, target.document_id),
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
