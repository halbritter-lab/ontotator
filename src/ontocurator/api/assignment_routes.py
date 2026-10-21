"""Assignment administration and server-owned workspace opening."""

from dataclasses import asdict
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import (
    OpenWorkspaceRequest,
    OpenWorkspaceResponse,
    WorkspaceSvcDep,
    get_access,
    open_workspace,
)
from ontocurator.application.guidelines import guideline_briefs, guideline_notice
from ontocurator.application.workspace_opening import WorkspaceOpeningService
from ontocurator.assignments.confirmations import (
    ConfirmationRow,
    DistributionConfirmationService,
)
from ontocurator.assignments.proposals import DistributionContext, DistributionService
from ontocurator.assignments.service import (
    MODE_FOR_TASK,
    Assignment,
    AssignmentService,
    TaskSummary,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action, Task, can
from ontocurator.authz.visibility import qualifying_assignment
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.guidelines import Notice
from ontocurator.storage.tables import AssignmentRow, ProjectRow, UserRow
from ontocurator.storage.workflow_tables import (
    ProblemReportRow,
    TaskHoldRow,
    TaskHoldStateRow,
)

router = APIRouter(prefix="/api/v1", tags=["assignments"])


class ActiveHoldView(BaseModel):
    """An active pause on the owner's task; other people's reports stay unnamed."""

    reason: str
    created_at: datetime
    own_report_id: str | None


class AssignmentGuidelineView(BaseModel):
    """The guideline version in force in the task's project."""

    version: int
    kind: Literal["markdown", "text"]
    created_at: datetime


class GuidelineNoticeChangeView(BaseModel):
    version: int
    change_note: str | None
    created_at: datetime
    withdrawn: bool


class GuidelineNoticeView(BaseModel):
    """Versions newer than the owner last saw, newest first (at most five)."""

    from_version: int | None
    to_version: int
    changes: list[GuidelineNoticeChangeView]
    more: int

    @classmethod
    def of(cls, notice: Notice) -> "GuidelineNoticeView":
        return cls(
            from_version=notice.from_version,
            to_version=notice.to_version,
            changes=[
                GuidelineNoticeChangeView(
                    version=change.version,
                    change_note=change.change_note,
                    created_at=change.created_at,
                    withdrawn=change.withdrawn,
                )
                for change in notice.changes
            ],
            more=notice.more,
        )


class AssignmentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_key: str
    document_id: str
    user_id: int
    username: str
    pseudonym: str
    task: Task
    status: Literal["open", "in_progress", "submitted", "reopened"]
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None
    last_submission_id: str | None
    display_name: str
    external_id: str | None = None
    active_round_id: str | None = None
    workflow_revision: int = 0
    held: bool = False
    hold_reason: str | None = None
    active_holds: list[ActiveHoldView] = Field(default_factory=list)
    # FD1: the lead's own translation review of a rejected or queried version.
    lead_correction: bool = False
    # The version in force; the notice only on the owner's editable rows (G27).
    guideline: AssignmentGuidelineView | None = None
    guideline_notice: GuidelineNoticeView | None = None


class AssignmentOpenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review_round_target_set_id: str | None = None


class AssignmentOpenResponse(OpenWorkspaceResponse):
    assignment: AssignmentView


class AssignmentRowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    username: str


class DistributionContextView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_ids: list[str] = Field(min_length=1)
    task: Task
    per_document: StrictInt = Field(ge=1)
    seed: StrictInt
    state_sha256: str = Field(pattern="^[a-f0-9]{64}$")

    def to_domain(self) -> DistributionContext:
        return DistributionContext(
            tuple(self.document_ids),
            self.task,
            self.per_document,
            self.seed,
            self.state_sha256,
        )


class ProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_ids: list[str] = Field(min_length=1)
    task: Task
    per_document: StrictInt = Field(default=1, ge=1)
    seed: StrictInt | None = None


class ProposalRow(BaseModel):
    document_id: str
    language: str
    username: str
    display_name: str
    load_before: int


class UnassignableDocument(BaseModel):
    document_id: str
    language: str
    reason: Literal[
        "NO_READER",
        "TOO_FEW_READERS",
        "translation_not_accepted",
        "not_a_translation",
        "translation_already_accepted",
        "variant_source_unknown",
        "NOT_IN_WORK_PLAN",
    ]
    eligible_count: int


class ProposalResponse(BaseModel):
    rows: list[ProposalRow]
    unassignable: list[UnassignableDocument]
    seed: int
    per_document: int
    context: DistributionContextView


class AssignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[AssignmentRowRequest]
    task: Task
    confirm_language: bool = False
    seed: int | None = None
    context: DistributionContextView | None = None
    # D25: a new review of a translation the lead or an import override accepted.
    # None (omitted) means False; None keeps the generated client field optional.
    review_accepted_translation: bool | None = None
    # VD14: a review of a translation whose source text changed; refused
    # (``SOURCE_REVIEW_NOT_NEEDED``) without an unresolved obligation.
    review_reason: Literal["source_changed"] | None = None


class RefusedAssignment(AssignmentRowRequest):
    code: str


class AssignResponse(BaseModel):
    created: list[AssignmentView]
    refused: list[RefusedAssignment]


class ReassignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    confirm_started: bool = False
    confirm_language: bool = False


class ReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str | None = None


def _service(request: Request) -> AssignmentService:
    return AssignmentService(request.app.state.repo.db)


def _views(
    request: Request, assignments: list[Assignment], owner_id: int | None = None
) -> list[AssignmentView]:
    """Assignment views; ``owner_id`` adds active pauses to that user's own rows.

    The guideline version is read once per call for all projects, the notice
    once per project for the owner's unsubmitted rows (holds and read-only
    rounds are filtered by the client).
    """
    if not assignments:
        return []
    owned = (
        {row.id for row in assignments if row.user_id == owner_id}
        if owner_id is not None
        else set()
    )
    holds: dict[int, list[ActiveHoldView]] = {}
    with request.app.state.repo.db.transaction() as conn:
        names = dict(
            conn.execute(
                select(UserRow.id, UserRow.display_name).where(
                    UserRow.id.in_({row.user_id for row in assignments})
                )
            ).all()
        )
        project_ids: dict[str, int] = dict(
            conn.execute(
                select(ProjectRow.project_key, ProjectRow.id).where(
                    ProjectRow.project_key.in_({row.project_key for row in assignments})
                )
            ).all()
        )
        briefs = guideline_briefs(conn, set(project_ids.values()))
        notices: dict[str, GuidelineNoticeView | None] = {}
        for key in sorted(
            {
                row.project_key
                for row in assignments
                if row.id in owned and row.status != "submitted"
            }
        ):
            notice = (
                guideline_notice(conn, project_id=project_ids[key], user_id=owner_id)
                if owner_id is not None
                else None
            )
            notices[key] = GuidelineNoticeView.of(notice) if notice else None
        if owned:
            rows = conn.execute(
                select(
                    TaskHoldRow.assignment_id,
                    TaskHoldRow.reason,
                    TaskHoldRow.created_at,
                    ProblemReportRow.report_id,
                    ProblemReportRow.reporter_id,
                )
                .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                .join(
                    ProblemReportRow,
                    ProblemReportRow.report_id == TaskHoldRow.report_id,
                )
                .where(
                    TaskHoldRow.assignment_id.in_(owned),
                    TaskHoldStateRow.active.is_(True),
                )
                .order_by(TaskHoldRow.created_at, TaskHoldRow.hold_id)
            ).all()
            for assignment_id, reason, created_at, report_id, reporter_id in rows:
                holds.setdefault(assignment_id, []).append(
                    ActiveHoldView(
                        reason=reason,
                        created_at=created_at,
                        own_report_id=report_id if reporter_id == owner_id else None,
                    )
                )

    def guideline(key: str) -> AssignmentGuidelineView | None:
        brief = briefs.get(project_ids[key])
        if brief is None:
            return None
        return AssignmentGuidelineView.model_validate(asdict(brief))

    return [
        AssignmentView(
            **asdict(row),
            display_name=names[row.user_id],
            active_holds=holds.get(row.id, []),
            guideline=guideline(row.project_key),
            guideline_notice=(
                notices.get(row.project_key)
                if row.id in owned and row.status != "submitted"
                else None
            ),
        )
        for row in assignments
    ]


def _guard(request: Request, key: str) -> None:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")


@router.get("/me/tasks")
def my_tasks(request: Request, principal: PrincipalDep) -> list[TaskSummary]:
    return _service(request).my_tasks(principal.user_id)


@router.get("/projects/{key}/assignments")
def list_assignments(
    key: str,
    request: Request,
    principal: PrincipalDep,
    document_id: str | None = None,
    username: str | None = None,
    include_revoked: bool = False,
) -> list[AssignmentView]:
    _guard(request, key)
    return _views(
        request,
        _service(request).list(
            key,
            document_ids=None if document_id is None else [document_id],
            user=username,
            include_revoked=include_revoked,
        ),
    )


@router.post("/projects/{key}/assignments")
def assign(
    key: str, body: AssignRequest, request: Request, principal: PrincipalDep
) -> AssignResponse:
    _guard(request, key)
    if body.context is not None:
        outcome = DistributionConfirmationService(request.app.state.repo.db).confirm(
            Actor.user(principal.user_id, principal.username),
            key,
            [ConfirmationRow(row.document_id, row.username) for row in body.rows],
            body.context.to_domain(),
            task=body.task,
            seed=body.seed,
            confirm_language=body.confirm_language,
        )
        return AssignResponse(
            created=_views(request, list(outcome.created)),
            refused=[RefusedAssignment(**asdict(row)) for row in outcome.refused],
        )
    created = []
    refused = []
    for row in body.rows:
        try:
            created.append(
                _service(request).assign(
                    Actor.user(principal.user_id, principal.username),
                    key,
                    row.document_id,
                    row.username,
                    body.task,
                    confirm_language=body.confirm_language,
                    review_accepted_translation=bool(body.review_accepted_translation),
                    review_reason=body.review_reason,
                )
            )
        except DomainError as exc:
            refused.append(RefusedAssignment(**row.model_dump(), code=exc.code))
    return AssignResponse(created=_views(request, created), refused=refused)


@router.post("/projects/{key}/assignments/proposal")
def propose_assignments(
    key: str, body: ProposalRequest, request: Request, principal: PrincipalDep
) -> ProposalResponse:
    _guard(request, key)
    prepared = DistributionService(request.app.state.repo.db).propose(
        Actor.user(principal.user_id, principal.username),
        key,
        body.document_ids,
        body.task,
        per_document=body.per_document,
        seed=body.seed,
    )
    documents = {d.document_id: d for d in prepared.snapshot.documents}
    members = {m.user_id: m for m in prepared.snapshot.members}
    return ProposalResponse(
        rows=[
            ProposalRow(
                document_id=document_id,
                language=documents[document_id].language,
                username=members[user_id].username,
                display_name=members[user_id].display_name,
                load_before=members[user_id].load,
            )
            for document_id, user_id in prepared.proposal.rows
        ],
        unassignable=[
            UnassignableDocument(
                **asdict(item), language=documents[item.document_id].language
            )
            for item in prepared.proposal.unassignable
        ],
        seed=prepared.context.seed,
        per_document=prepared.context.per_document,
        context=DistributionContextView(**asdict(prepared.context)),
    )


def _owned_assignment(request: Request, user_id: int, assignment_id: int) -> Assignment:
    with request.app.state.repo.db.transaction() as conn:
        valid = conn.execute(
            select(AssignmentRow.id).where(
                AssignmentRow.id == assignment_id, qualifying_assignment(user_id)
            )
        ).first()
        if valid is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        return AssignmentService._get(conn, assignment_id)


@router.get("/assignments/{assignment_id}")
def assignment_metadata(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> AssignmentView:
    return _views(
        request,
        [_owned_assignment(request, principal.user_id, assignment_id)],
        owner_id=principal.user_id,
    )[0]


@router.post("/assignments/{assignment_id}/open")
def open_assignment(
    assignment_id: int,
    request: Request,
    principal: PrincipalDep,
    ws_svc: WorkspaceSvcDep,
    body: AssignmentOpenRequest | None = None,
) -> AssignmentOpenResponse:
    assignment = _owned_assignment(request, principal.user_id, assignment_id)
    if assignment.task not in MODE_FOR_TASK:
        raise DomainError("TASK_INVALID")
    if assignment.active_round_id is not None and not (
        body and body.review_round_target_set_id
    ):
        from ontocurator.api.work_round_routes import open_round

        response = open_round(assignment.active_round_id, request, principal, ws_svc)
        return AssignmentOpenResponse(
            workspace_id=response.workspace_id,
            view=response.view,
            read_only=response.read_only,
            assignment=_views(request, [assignment], owner_id=principal.user_id)[0],
        )
    response = open_workspace(
        OpenWorkspaceRequest(
            project_key=assignment.project_key,
            document_id=assignment.document_id,
            mode=MODE_FOR_TASK[assignment.task],
            review_round_target_set_id=(
                body.review_round_target_set_id if body is not None else None
            ),
        ),
        request,
        ws_svc,
        principal,
    )
    assignment = WorkspaceOpeningService(ws_svc).bind_assignment_workspace(
        response.view.key, Actor.user(principal.user_id, principal.username)
    )
    return AssignmentOpenResponse(
        workspace_id=response.workspace_id,
        view=response.view,
        read_only=response.read_only,
        assignment=_views(request, [assignment], owner_id=principal.user_id)[0],
    )


@router.post("/assignments/{assignment_id}/reassign")
def reassign(
    assignment_id: int, body: ReassignRequest, request: Request, principal: PrincipalDep
) -> AssignmentView:
    row = _service(request).reassign(
        Actor.user(principal.user_id, principal.username),
        assignment_id,
        **body.model_dump(),
    )
    return _views(request, [row])[0]


@router.post("/assignments/{assignment_id}/reopen")
def reopen(
    assignment_id: int, body: ReasonRequest, request: Request, principal: PrincipalDep
) -> AssignmentView:
    return _views(
        request,
        [
            _service(request).reopen(
                Actor.user(principal.user_id, principal.username),
                assignment_id,
                body.reason,
            )
        ],
    )[0]


@router.post("/assignments/{assignment_id}/revoke")
def revoke(
    assignment_id: int, body: ReasonRequest, request: Request, principal: PrincipalDep
) -> AssignmentView:
    return _views(
        request,
        [
            _service(request).revoke(
                Actor.user(principal.user_id, principal.username),
                assignment_id,
                body.reason,
            )
        ],
    )[0]
