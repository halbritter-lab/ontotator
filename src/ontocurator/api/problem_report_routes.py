"""Owner reports and lead hold handling, scoped to exact assignments."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.application.problem_reports import (
    ProblemReportService,
    ProblemReportView,
    ReportAction,
)
from ontocurator.auth.audit import Actor

router = APIRouter(prefix="/api/v1", tags=["problem-reports"])


class ProblemReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    expected_workflow_revision: int = Field(ge=0)
    round_id: str | None = None
    submission_id: str | None = None
    reason: str = Field(min_length=1)


class ProblemActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)
    action: ReportAction
    reason: str = Field(min_length=1)
    assignment_ids: list[int] = Field(default_factory=list)


@router.post("/assignments/{assignment_id}/problem-reports")
def report(
    assignment_id: int,
    body: ProblemReportRequest,
    request: Request,
    principal: PrincipalDep,
) -> ProblemReportView:
    return ProblemReportService(request.app.state.repo.db).report(
        get_access(request),
        Actor.user(principal.user_id, principal.username),
        assignment_id,
        **body.model_dump(),
    )


@router.get("/projects/{key}/problem-reports")
def reports(
    key: str, request: Request, principal: PrincipalDep, document_id: str | None = None
) -> list[ProblemReportView]:
    return ProblemReportService(request.app.state.repo.db).list(
        get_access(request), key, document_id
    )


@router.post("/problem-reports/{report_id}/actions")
def action(
    report_id: str,
    body: ProblemActionRequest,
    request: Request,
    principal: PrincipalDep,
) -> ProblemReportView:
    return ProblemReportService(request.app.state.repo.db).act(
        get_access(request),
        Actor.user(principal.user_id, principal.username),
        report_id,
        **body.model_dump(),
    )
