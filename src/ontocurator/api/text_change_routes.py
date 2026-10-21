"""Text changes after annotation: preview, move, let finish or withdraw, carry.

Lead-only (spec "Backend and API: Text changes", operations 1 to 4); the
service authorizes every call and runs each write in one transaction.
"""

from typing import Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.api.assignment_routes import AssignmentView, _views
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access, get_repo
from ontocurator.application.round_reads import enrich_rounds
from ontocurator.application.text_changes import TextChangePreview, TextChangeService
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.domain.work_rounds import WorkRoundView
from ontocurator.storage.repository import Repository

router = APIRouter(prefix="/api/v1", tags=["text-changes"])


class TextChangePreviewRequest(BaseModel):
    """Exactly one of ``assignment_id`` (open work) or ``submission_id``."""

    model_config = ConfigDict(extra="forbid")
    assignment_id: int | None = None
    submission_id: str | None = None
    target_document_id: str = Field(min_length=1)

    @model_validator(mode="after")
    def one_source(self) -> Self:
        if (self.assignment_id is None) == (self.submission_id is None):
            raise ValueError("Name either an assignment or a submission")
        return self


class MoveToVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_document_id: str = Field(min_length=1)
    expected_workflow_revision: int = Field(ge=0)
    request_id: str = Field(min_length=1, max_length=128)


class MoveToVersionResponse(BaseModel):
    """The new assignment on the target; ``round`` is None when the moved
    assignment had not started (nothing to carry)."""

    assignment: AssignmentView
    round: WorkRoundView | None


class TextChangeResolutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolution: Literal["finish_then_carry", "withdrawn"]
    target_document_id: str = Field(min_length=1)


class CarryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_document_id: str = Field(min_length=1)
    mode: Literal["author", "other", "dismiss"]
    username: str | None = None
    confirm_language: bool = False
    request_id: str = Field(min_length=1, max_length=128)


class CarryResponse(BaseModel):
    resolution: Literal["carried", "handed_over", "dismissed"]
    assignment: AssignmentView | None
    round: WorkRoundView | None
    carried_findings: int


def _service(request: Request) -> TextChangeService:
    db = request.app.state.repo.db
    return TextChangeService(db, Repository(db))


def _actor(principal: PrincipalDep) -> Actor:
    return Actor.user(principal.user_id, principal.username)


def _assignment(request: Request, assignment_id: int) -> AssignmentView:
    with request.app.state.repo.db.transaction() as conn:
        row = AssignmentService._get(conn, assignment_id)
    return _views(request, [row])[0]


def _round(request: Request, view: WorkRoundView | None) -> WorkRoundView | None:
    """The round with its read facts, in one snapshot (as ``create_round``)."""
    if view is None:
        return None
    repo = get_repo(request)
    with repo.db.snapshot():
        stored = Repository(repo.db).get_work_round(view.project_key, view.round_id)
        [enriched] = enrich_rounds(repo, view.project_key, [stored])
    return enriched


@router.post("/projects/{key}/text-changes/preview")
def preview_text_change(
    key: str,
    body: TextChangePreviewRequest,
    request: Request,
    principal: PrincipalDep,
) -> TextChangePreview:
    return _service(request).preview(
        get_access(request),
        _actor(principal),
        key,
        assignment_id=body.assignment_id,
        submission_id=body.submission_id,
        target_document_id=body.target_document_id,
    )


@router.post("/assignments/{assignment_id}/move-to-version")
def move_to_version(
    assignment_id: int,
    body: MoveToVersionRequest,
    request: Request,
    principal: PrincipalDep,
) -> MoveToVersionResponse:
    result = _service(request).move_to_version(
        get_access(request), _actor(principal), assignment_id, **body.model_dump()
    )
    return MoveToVersionResponse(
        assignment=_assignment(request, result.assignment_id),
        round=_round(request, result.round),
    )


@router.post("/assignments/{assignment_id}/text-change-resolution")
def resolve_text_change(
    assignment_id: int,
    body: TextChangeResolutionRequest,
    request: Request,
    principal: PrincipalDep,
) -> AssignmentView:
    _service(request).resolve(
        get_access(request), _actor(principal), assignment_id, **body.model_dump()
    )
    return _assignment(request, assignment_id)


@router.post("/projects/{key}/submissions/{submission_id:path}/carry")
def carry_submission(
    key: str,
    submission_id: str,
    body: CarryRequest,
    request: Request,
    principal: PrincipalDep,
) -> CarryResponse:
    result = _service(request).carry(
        get_access(request),
        _actor(principal),
        key,
        submission_id,
        **body.model_dump(),
    )
    return CarryResponse(
        resolution=result.resolution,
        assignment=(
            _assignment(request, result.assignment_id)
            if result.assignment_id is not None
            else None
        ),
        round=_round(request, result.round),
        carried_findings=result.carried_findings,
    )
