"""Assignment administration and server-owned workspace opening."""

from dataclasses import asdict
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import (
    OpenWorkspaceRequest,
    OpenWorkspaceResponse,
    WorkspaceSvcDep,
    get_access,
    open_workspace,
)
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


class AssignmentOpenResponse(OpenWorkspaceResponse):
    assignment: AssignmentView


class AssignmentRowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    username: str


class AssignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[AssignmentRowRequest]
    task: Task
    confirm_language: bool = False
    seed: int | None = None


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


@router.post("/assignments/{assignment_id}/open")
def open_assignment(
    assignment_id: int,
    request: Request,
    principal: PrincipalDep,
    ws_svc: WorkspaceSvcDep,
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
