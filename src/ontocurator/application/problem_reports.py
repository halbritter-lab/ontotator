"""Problem reports and deliberate whole-task hold transitions."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import Connection, RowMapping, func, insert, select, update

# The view models live in problem_report_views; re-exported for routes and callers.
from ontocurator.application.problem_report_views import (
    AffectedTask as AffectedTask,
)
from ontocurator.application.problem_report_views import (
    OtherActiveHold as OtherActiveHold,
)
from ontocurator.application.problem_report_views import (
    PauseCandidate as PauseCandidate,
)
from ontocurator.application.problem_report_views import (
    ProblemReportView as ProblemReportView,
)
from ontocurator.application.problem_report_views import (
    ReportEventView as ReportEventView,
)
from ontocurator.application.problem_report_views import (
    ReportHoldView as ReportHoldView,
)
from ontocurator.application.problem_report_views import (
    ReportSubmissionRef as ReportSubmissionRef,
)
from ontocurator.application.problem_report_views import (
    build_pause_candidates,
    build_report_view,
)
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.authority import lock_user_authority
from ontocurator.authz.policy import Access, Action, can, may_take
from ontocurator.authz.visibility import current_access, require_document
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.problem_reports import (
    EventFact,
    check_permission,
    check_state,
    next_resolution,
    next_state,
    withdrawable,
)
from ontocurator.domain.problem_reports import (
    ReportAction as ReportAction,  # re-exported for api/problem_report_routes
)
from ontocurator.domain.work_rounds import WorkRoundView
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    TranslationReviewDraftRow,
)
from ontocurator.storage.workflow_tables import (
    ProblemReportEventRow,
    ProblemReportRow,
    ProblemReportStateRow,
    TaskHoldRow,
    TaskHoldStateRow,
    WorkflowCommandReceiptRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


class ProblemReportService:
    def __init__(self, db: Database) -> None:
        self.db = db
        self.repo = Repository(db)

    def _prepare(
        self, conn: Connection, access: Access, actor: Actor, assignment_id: int
    ) -> tuple[str, int, Access, RowMapping]:
        project = AssignmentService._locate(conn, assignment_id)
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
        )
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", project))))
        lock_user_authority(conn, access.user_id)
        pid = self.repo._require_project(conn, project)
        fresh = current_access(conn, access, pid, project)
        assignment = (
            conn.execute(
                select(AssignmentRow)
                .where(AssignmentRow.id == assignment_id)
                .with_for_update(key_share=True)
            )
            .mappings()
            .one()
        )
        require_document(conn, fresh, pid, project, assignment["document_id"])
        if actor.user_id != fresh.user_id:
            raise AccessDenied("NOT_ALLOWED")
        return project, pid, fresh, assignment

    def _receipt(
        self,
        conn: Connection,
        pid: int,
        access: Access,
        request_id: str,
        request_hash: str,
    ) -> dict[str, Any] | None:
        """The stored response of a replayed command (the caller rebuilds the view)."""
        row = (
            conn.execute(
                select(WorkflowCommandReceiptRow).where(
                    WorkflowCommandReceiptRow.project_id == pid,
                    WorkflowCommandReceiptRow.actor_key == str(access.user_id),
                    WorkflowCommandReceiptRow.request_id == request_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if row:
            if row["request_hash"] != request_hash:
                raise DomainError("WORKFLOW_REQUEST_CONFLICT")
            return dict(row["response"])
        return None

    def _remember(
        self,
        conn: Connection,
        pid: int,
        access: Access,
        request_id: str,
        request_hash: str,
        result: ProblemReportView,
        now: datetime,
    ) -> None:
        conn.execute(
            insert(WorkflowCommandReceiptRow).values(
                project_id=pid,
                actor_key=str(access.user_id),
                request_id=request_id,
                request_hash=request_hash,
                response=result.model_dump(mode="json"),
                created_at=now,
            )
        )

    def _view(
        self,
        conn: Connection,
        report_id: str,
        access: Access,
        project: str,
        replayed: dict[str, Any] | None = None,
    ) -> ProblemReportView:
        """The report as ``access`` may see it (redacted for non-leads).

        A replayed command returns its stored response when that response was
        built by this read model for a viewer with no more rights than now (the
        receipt belongs to the same user). Older receipts (raw event details) or
        a viewer who lost the lead role get a freshly built, redacted view.
        """
        lead = can(access, Action.MANAGE_ASSIGNMENTS, project)
        if replayed is not None:
            try:
                stored = ProblemReportView.model_validate(replayed)
            except ValidationError:
                stored = None
            if (
                stored is not None
                and stored.viewer_label
                and (lead or not stored.viewer_is_lead)
            ):
                return stored
        new_round = (
            WorkRoundView.model_validate(replayed["new_round"])
            if replayed and replayed.get("new_round")
            else None
        )
        return build_report_view(
            conn,
            report_id,
            viewer_id=access.user_id,
            viewer_is_lead=lead,
            new_round=new_round,
        )

    def _hold(
        self,
        conn: Connection,
        pid: int,
        assignment_id: int,
        report_id: str,
        reason: str,
        actor: Actor,
        now: datetime,
        *,
        workflow_revision: int | None = None,
    ) -> None:
        hid = f"hold-{uuid4().hex}"
        conn.execute(
            insert(TaskHoldRow).values(
                hold_id=hid,
                project_id=pid,
                assignment_id=assignment_id,
                report_id=report_id,
                reason=reason,
                created_by=actor.user_id,
                created_at=now,
            )
        )
        conn.execute(insert(TaskHoldStateRow).values(hold_id=hid, active=True))
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(
                held=True,
                hold_reason=reason,
                workflow_revision=workflow_revision
                if workflow_revision is not None
                else AssignmentRow.workflow_revision + 1,
                updated_at=now,
            )
        )

    def _release(
        self,
        conn: Connection,
        report_id: str,
        assignment_ids: list[int],
        now: datetime,
        *,
        released_by: int,
        release_action: str,
        event_id: str,
    ) -> None:
        # Only active holds: an earlier release record is never overwritten.
        ids = list(
            conn.execute(
                select(TaskHoldRow.hold_id)
                .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                .where(
                    TaskHoldRow.report_id == report_id,
                    TaskHoldRow.assignment_id.in_(assignment_ids),
                    TaskHoldStateRow.active.is_(True),
                )
            ).scalars()
        )
        conn.execute(
            update(TaskHoldStateRow)
            .where(TaskHoldStateRow.hold_id.in_(ids))
            .values(
                active=False,
                released_at=now,
                released_by=released_by,
                release_action=release_action,
                release_event_id=event_id,
            )
        )
        for aid in assignment_ids:
            remaining = conn.execute(
                select(TaskHoldRow.reason)
                .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                .where(
                    TaskHoldRow.assignment_id == aid, TaskHoldStateRow.active.is_(True)
                )
                .order_by(TaskHoldRow.created_at, TaskHoldRow.hold_id)
                .limit(1)
            ).scalar_one_or_none()
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == aid)
                .values(
                    held=remaining is not None,
                    hold_reason=remaining,
                    workflow_revision=AssignmentRow.workflow_revision + 1,
                    updated_at=now,
                )
            )

    def report(
        self,
        access: Access,
        actor: Actor,
        assignment_id: int,
        *,
        request_id: str,
        expected_workflow_revision: int,
        reason: str,
        round_id: str | None = None,
        submission_id: str | None = None,
    ) -> ProblemReportView:
        if not reason.strip():
            raise DomainError("REPORT_REASON_REQUIRED")
        digest = canonical_hash(
            {
                "action": "report",
                "assignment_id": assignment_id,
                "revision": expected_workflow_revision,
                "reason": reason,
                "round_id": round_id,
                "submission_id": submission_id,
            }
        )
        with self.db.transaction() as conn:
            project, pid, fresh, assignment = self._prepare(
                conn, access, actor, assignment_id
            )
            if assignment["user_id"] != fresh.user_id or not may_take(
                fresh, project, assignment["task"]
            ):
                raise AccessDenied("NOT_ALLOWED")
            replay = self._receipt(conn, pid, access, request_id, digest)
            if replay:
                return self._view(conn, replay["report_id"], fresh, project, replay)
            if assignment["workflow_revision"] != expected_workflow_revision:
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            if round_id != assignment["active_round_id"]:
                raise DomainError("ROUND_KEY_MISMATCH")
            if round_id is None and assignment["task"] in {"annotate", "review"}:
                from ontocurator.application.work_rounds import WorkRoundService
                from ontocurator.assignments.service import MODE_FOR_TASK

                keys = self.repo.list_workspace_keys(
                    project,
                    fresh.pseudonym,
                    MODE_FOR_TASK[assignment["task"]],
                    assignment["document_id"],
                )
                if assignment["last_submission_id"]:
                    source = self.repo.get_submission(
                        assignment["last_submission_id"], project
                    )
                    keys = [
                        key
                        for key in keys
                        if source is not None and key == source.origin_key
                    ]
                if len(keys) > 1:
                    raise DomainError("AMBIGUOUS_REVIEW_ROUND")
                service = WorkRoundService(self.db)
                if keys:
                    current_round = service.bind_legacy(
                        fresh, actor, assignment_id, keys[0]
                    )
                else:
                    current_round = service.create(
                        fresh,
                        actor,
                        assignment_id,
                        request_id=f"{request_id}:initial-round",
                        expected_workflow_revision=assignment["workflow_revision"],
                    )
                round_id = current_round.round_id
            if (
                submission_id is not None
                and submission_id != assignment["last_submission_id"]
            ):
                raise DomainError("REPORT_SUBMISSION_INVALID")
            rid = f"report-{uuid4().hex}"
            now = datetime.now(UTC)
            conn.execute(
                insert(ProblemReportRow).values(
                    report_id=rid,
                    project_id=pid,
                    assignment_id=assignment_id,
                    reporter_id=fresh.user_id,
                    round_id=round_id,
                    submission_id=submission_id,
                    reason=reason,
                    created_at=now,
                )
            )
            conn.execute(
                insert(ProblemReportStateRow).values(
                    report_id=rid, state="open", revision=1
                )
            )
            # Initial binding and the personal hold are one externally visible
            # transition, including when the round was allocated lazily above.
            self._hold(
                conn,
                pid,
                assignment_id,
                rid,
                reason,
                actor,
                now,
                workflow_revision=expected_workflow_revision + 1,
            )
            record_audit(
                conn,
                actor,
                "problem.report",
                target_type="problem_report",
                target_id=rid,
                project_id=pid,
                details={"assignment_id": assignment_id},
                at=now,
            )
            result = self._view(conn, rid, fresh, project)
            self._remember(conn, pid, access, request_id, digest, result, now)
            return result

    def _restart_translation(
        self, conn: Connection, assignment_id: int, actor: Actor, now: datetime
    ) -> tuple[WorkRoundView, dict[str, Any]]:
        from ontocurator.application.workflow_guards import require_task_writable

        require_task_writable(conn, assignment_id)
        assignment = AssignmentService._get(conn, assignment_id)
        pid = self.repo._require_project(conn, assignment.project_key)
        draft = (
            conn.execute(
                select(TranslationReviewDraftRow).where(
                    TranslationReviewDraftRow.assignment_id == assignment_id
                )
            )
            .mappings()
            .one_or_none()
        )
        text = conn.execute(
            select(DocumentRow.text).where(
                DocumentRow.project_id == pid,
                DocumentRow.document_id == assignment.document_id,
            )
        ).scalar_one()
        archived: dict[str, Any] = (
            {
                "text": draft["text"],
                "form": draft["form"],
                "revision": draft["revision"],
            }
            if draft
            else {"text": text, "form": {}, "revision": 0}
        )
        prior = assignment.active_round_id
        if prior:
            conn.execute(
                update(WorkRoundStateRow)
                .where(WorkRoundStateRow.round_id == prior)
                .values(state="abandoned", revision=WorkRoundStateRow.revision + 1)
            )
        rid = f"round-{uuid4().hex}"
        conn.execute(
            insert(WorkRoundRow).values(
                round_id=rid,
                project_id=pid,
                assignment_id=assignment_id,
                document_id=assignment.document_id,
                annotator_id=assignment.pseudonym,
                kind="clean_restart",
                mode=None,
                predecessor_round_id=prior,
                input_manifest_sha256=canonical_hash([]),
                input_submission_ids=[],
                workspace_key=None,
                created_by=actor.user_id,
                created_at=now,
            )
        )
        conn.execute(
            insert(WorkRoundStateRow).values(round_id=rid, state="editable", revision=1)
        )
        values: dict[str, Any] = {
            "text": text,
            "form": {},
            "revision": archived["revision"] + 1,
            "updated_by": actor.user_id,
            "updated_at": now,
        }
        if draft:
            conn.execute(
                update(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment_id)
                .values(**values)
            )
        else:
            conn.execute(
                insert(TranslationReviewDraftRow).values(
                    assignment_id=assignment_id, **values
                )
            )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(
                active_round_id=rid,
                workflow_revision=assignment.workflow_revision + 1,
                status="open",
                last_submission_id=None,
                updated_at=now,
            )
        )
        return self.repo.get_work_round(assignment.project_key, rid), archived

    def act(
        self,
        access: Access,
        actor: Actor,
        report_id: str,
        *,
        request_id: str,
        expected_revision: int,
        action: ReportAction,
        reason: str,
        assignment_ids: list[int] | None = None,
    ) -> ProblemReportView:
        if not reason.strip():
            raise DomainError("REPORT_REASON_REQUIRED")
        selected = sorted(set(assignment_ids or []))
        digest = canonical_hash(
            {
                "action": action,
                "report_id": report_id,
                "revision": expected_revision,
                "reason": reason,
                "assignment_ids": selected,
            }
        )
        with self.db.transaction() as conn:
            # Unreadable reports do not exist, exactly like unknown IDs (no
            # existence oracle); lead/reporter permissions are checked below.
            self._readable(conn, access, report_id)
            raw = (
                conn.execute(
                    select(ProblemReportRow).where(
                        ProblemReportRow.report_id == report_id
                    )
                )
                .mappings()
                .one()
            )
            project, pid, fresh, _assignment = self._prepare(
                conn, access, actor, raw["assignment_id"]
            )
            lead = can(fresh, Action.MANAGE_ASSIGNMENTS, project)
            check_permission(
                action, lead=lead, reporter=raw["reporter_id"] == fresh.user_id
            )
            replay = self._receipt(conn, pid, access, request_id, digest)
            if replay:
                return self._view(conn, report_id, fresh, project, replay)
            state = (
                conn.execute(
                    select(ProblemReportStateRow)
                    .where(ProblemReportStateRow.report_id == report_id)
                    .with_for_update()
                )
                .mappings()
                .one()
            )
            if state["revision"] != expected_revision:
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            facts = [
                EventFact(r.actor_id, r.action)
                for r in conn.execute(
                    select(
                        ProblemReportEventRow.actor_id, ProblemReportEventRow.action
                    ).where(ProblemReportEventRow.report_id == report_id)
                )
            ]
            check_state(
                action,
                state["state"],
                withdrawable_now=withdrawable(
                    state["state"], raw["reporter_id"], facts
                ),
            )
            now = datetime.now(UTC)
            event_id = f"report-event-{uuid4().hex}"
            new_round = None
            abandoned_translation_draft = None
            if action == "extend_hold":
                if not selected:
                    raise DomainError("HOLD_TARGET_REQUIRED")
                for aid in selected:
                    target = AssignmentService._locked(conn, aid)
                    if target["project_id"] != pid:
                        raise DomainError("ASSIGNMENT_NOT_FOUND")
                    self._hold(conn, pid, aid, report_id, reason, actor, now)
            elif action in {"resume", "restart"}:
                selected = (
                    [raw["assignment_id"]]
                    if not lead
                    else (selected or [raw["assignment_id"]])
                )
                for aid in selected:
                    target = AssignmentService._locked(conn, aid)
                    if target["project_id"] != pid:
                        raise DomainError("ASSIGNMENT_NOT_FOUND")
                self._release(
                    conn,
                    report_id,
                    selected,
                    now,
                    released_by=fresh.user_id,
                    release_action=action,
                    event_id=event_id,
                )
                if action == "restart":
                    if selected != [raw["assignment_id"]]:
                        raise DomainError("ROUND_KIND_INVALID")
                    from ontocurator.application.work_rounds import WorkRoundService

                    current = AssignmentService._get(conn, raw["assignment_id"])
                    if current.task == "translation_review":
                        new_round, abandoned_translation_draft = (
                            self._restart_translation(conn, current.id, actor, now)
                        )
                    else:
                        new_round = WorkRoundService(self.db).create(
                            fresh,
                            actor,
                            current.id,
                            request_id=f"{request_id}:round",
                            expected_workflow_revision=current.workflow_revision,
                            kind="clean_restart",
                            reason=reason,
                        )
            elif action == "withdraw":
                own = raw["assignment_id"]
                active_own = conn.execute(
                    select(TaskHoldRow.hold_id)
                    .join(
                        TaskHoldStateRow,
                        TaskHoldStateRow.hold_id == TaskHoldRow.hold_id,
                    )
                    .where(
                        TaskHoldRow.report_id == report_id,
                        TaskHoldRow.assignment_id == own,
                        TaskHoldStateRow.active.is_(True),
                    )
                ).first()
                selected = [own] if active_own else []
                if selected:
                    AssignmentService._locked(conn, own)
                    self._release(
                        conn,
                        report_id,
                        selected,
                        now,
                        released_by=fresh.user_id,
                        release_action="withdraw",
                        event_id=event_id,
                    )
            elif action == "reopen":
                selected = []
            conn.execute(
                update(ProblemReportStateRow)
                .where(ProblemReportStateRow.report_id == report_id)
                .values(
                    state=next_state(action, state["state"]),
                    revision=expected_revision + 1,
                    resolution=next_resolution(action, state["resolution"], reason),
                )
            )
            conn.execute(
                insert(ProblemReportEventRow).values(
                    event_id=event_id,
                    project_id=pid,
                    report_id=report_id,
                    actor_id=fresh.user_id,
                    action=action,
                    details={
                        "reason": reason,
                        "assignment_ids": selected,
                        "round_id": new_round.round_id if new_round else None,
                        **(
                            {"abandoned_translation_draft": abandoned_translation_draft}
                            if abandoned_translation_draft is not None
                            else {}
                        ),
                    },
                    created_at=now,
                )
            )
            record_audit(
                conn,
                actor,
                f"problem.{action}",
                target_type="problem_report",
                target_id=report_id,
                project_id=pid,
                details={"assignment_ids": selected},
                at=now,
            )
            result = self._view(conn, report_id, fresh, project)
            result.new_round = new_round
            self._remember(conn, pid, access, request_id, digest, result, now)
            return result

    def _readable(
        self, conn: Connection, access: Access, report_id: str
    ) -> tuple[str, Access, bool]:
        """Project key, fresh access and lead flag; unreadable reports do not exist."""
        found = conn.execute(
            select(ProjectRow.project_key, ProblemReportRow.reporter_id)
            .join(ProjectRow, ProjectRow.id == ProblemReportRow.project_id)
            .where(ProblemReportRow.report_id == report_id)
        ).one_or_none()
        if found is None:
            raise DomainError("REPORT_NOT_FOUND")
        project = found.project_key
        pid = self.repo._require_project(conn, project)
        fresh = current_access(conn, access, pid, project)
        lead = can(fresh, Action.MANAGE_ASSIGNMENTS, project)
        if not can(fresh, Action.VIEW_PROJECT, project) or not (
            lead or found.reporter_id == fresh.user_id
        ):
            raise DomainError("REPORT_NOT_FOUND")
        return project, fresh, lead

    def get(self, access: Access, report_id: str) -> ProblemReportView:
        with self.db.transaction() as conn:
            project, fresh, _lead = self._readable(conn, access, report_id)
            return self._view(conn, report_id, fresh, project)

    def pause_candidates(self, access: Access, report_id: str) -> list[PauseCandidate]:
        """Tasks a lead may pause for this report; reporters get REPORT_NOT_FOUND."""
        with self.db.transaction() as conn:
            _project, _fresh, lead = self._readable(conn, access, report_id)
            if not lead:
                raise DomainError("REPORT_NOT_FOUND")
            return build_pause_candidates(conn, report_id)

    def list(
        self,
        access: Access,
        project: str,
        document_id: str | None = None,
        assignment_id: int | None = None,
    ) -> list[ProblemReportView]:
        """Reports the viewer may read, newest first (reporters: only their own)."""
        # TODO: N+1 - build_report_view runs ~8 queries per report; batch them
        # if report lists grow large.
        with self.db.transaction() as conn:
            pid = self.repo._require_project(conn, project)
            fresh = current_access(conn, access, pid, project)
            if not can(fresh, Action.VIEW_PROJECT, project):
                raise DomainError("PROJECT_NOT_FOUND")
            query = (
                select(ProblemReportRow.report_id)
                .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
                .where(ProblemReportRow.project_id == pid)
            )
            if not can(fresh, Action.MANAGE_ASSIGNMENTS, project):
                query = query.where(ProblemReportRow.reporter_id == fresh.user_id)
            if document_id is not None:
                query = query.where(AssignmentRow.document_id == document_id)
            if assignment_id is not None:
                query = query.where(ProblemReportRow.assignment_id == assignment_id)
            return [
                self._view(conn, rid, fresh, project)
                for rid in conn.execute(
                    query.order_by(
                        ProblemReportRow.created_at.desc(),
                        ProblemReportRow.report_id.desc(),
                    )
                ).scalars()
            ]
