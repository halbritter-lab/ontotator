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
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.storage.tables import AssignmentRow, UserRow

router = APIRouter(prefix="/api/v1", tags=["assignments"])


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
    reason: Literal["NO_READER", "TOO_FEW_READERS"]
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


def _views(request: Request, assignments: list[Assignment]) -> list[AssignmentView]:
    if not assignments:
        return []
    with request.app.state.repo.db.transaction() as conn:
        names = dict(
            conn.execute(
                select(UserRow.id, UserRow.display_name).where(
                    UserRow.id.in_({row.user_id for row in assignments})
                )
            ).all()
        )
    return [
        AssignmentView(**asdict(row), display_name=names[row.user_id])
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


@router.post("/assignments/{assignment_id}/open")
def open_assignment(
    assignment_id: int,
    request: Request,
    principal: PrincipalDep,
    ws_svc: WorkspaceSvcDep,
    body: AssignmentOpenRequest | None = None,
) -> AssignmentOpenResponse:
    with request.app.state.repo.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.user_id).where(
                AssignmentRow.id == assignment_id, AssignmentRow.revoked_at.is_(None)
            )
        ).one_or_none()
        if row is None or row.user_id != principal.user_id:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        assignment = AssignmentService._get(conn, assignment_id)
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
    return AssignmentOpenResponse(
        **response.model_dump(), assignment=_views(request, [assignment])[0]
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
