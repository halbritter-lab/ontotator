"""Lead-only annotation-mode changes after submitted work, and restores (#109)."""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import MAX_CASE_ID_LENGTH, MAX_LANGUAGE_LENGTH
from ontotator.application.annotation_mode_changes import AnnotationModeChangeService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, can
from ontotator.domain.annotation_modes import AnnotationMode
from ontotator.domain.errors import AccessDenied, DomainError

router = APIRouter(
    prefix="/api/v1/projects/{key}/annotation-mode-changes",
    tags=["annotation-mode-changes"],
)


class ModeChangeTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: str = Field(min_length=1, max_length=MAX_CASE_ID_LENGTH)
    language: str = Field(min_length=1, max_length=MAX_LANGUAGE_LENGTH)
    mode: AnnotationMode


class ModeChangeRequest(ModeChangeTarget):
    reason: str = Field(min_length=1, max_length=2000)
    # The case's plan revision the lead saw (WORK_PLAN_CHANGED otherwise).
    expected_revision: int
    # Exactly the submissions the preview listed (MODE_CHANGE_STALE otherwise).
    expected_submission_ids: list[str] = Field(max_length=10000)


class ModeRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int


class DiscardedSubmissionView(BaseModel):
    submission_id: str
    document_id: str
    mode: str
    recorded_at: datetime
    author: PersonRefView


class RevokedAssignmentView(BaseModel):
    assignment_id: int
    document_id: str
    task: Literal["annotate", "review"]
    status: str
    person: PersonRefView


class ModeChangePreview(BaseModel):
    case_id: str
    language: str
    from_mode: AnnotationMode
    to_mode: AnnotationMode
    revision: int
    # Submitted work the change discards (kept, restorable).
    submissions: list[DiscardedSubmissionView]
    # Live annotate and review assignments the change revokes.
    assignments: list[RevokedAssignmentView]


class ModeChangeView(BaseModel):
    change_id: int
    case_id: str
    language: str
    from_mode: AnnotationMode
    to_mode: AnnotationMode
    reason: str
    changed_at: datetime
    changed_by: PersonRefView
    restored_at: datetime | None
    restored_by: PersonRefView | None
    revoked_assignment_ids: list[int]
    # The submissions still discarded by this change (empty once restored).
    submissions: list[DiscardedSubmissionView]
    restorable: bool
    # Why an unrestored change cannot be restored now (e.g. new work started).
    restore_blocked: str | None


class ModeChangeList(BaseModel):
    case_id: str
    language: str
    changes: list[ModeChangeView]


class ModeChangeResult(BaseModel):
    change: ModeChangeView
    revision: int


def _service(request: Request, key: str, principal: Any) -> AnnotationModeChangeService:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    return AnnotationModeChangeService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        access,
    )


@router.get("", response_model=ModeChangeList)
def list_mode_changes(
    key: str,
    principal: PrincipalDep,
    request: Request,
    case_id: str = Query(min_length=1, max_length=MAX_CASE_ID_LENGTH),
    language: str = Query(min_length=1, max_length=MAX_LANGUAGE_LENGTH),
) -> dict[str, Any]:
    return _service(request, key, principal).list_changes(key, case_id, language)


@router.post("/preview", response_model=ModeChangePreview)
def preview_mode_change(
    key: str, body: ModeChangeTarget, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).preview(
        key, body.case_id, body.language, body.mode
    )


@router.post("", response_model=ModeChangeResult)
def change_mode(
    key: str, body: ModeChangeRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).change(
        key,
        body.case_id,
        body.language,
        body.mode,
        reason=body.reason,
        expected_revision=body.expected_revision,
        expected_submission_ids=body.expected_submission_ids,
    )


@router.post("/{change_id}/restore", response_model=ModeChangeResult)
def restore_mode_change(
    key: str,
    change_id: int,
    body: ModeRestoreRequest,
    principal: PrincipalDep,
    request: Request,
) -> dict[str, Any]:
    return _service(request, key, principal).restore(
        key, change_id, body.expected_revision
    )
