"""Technical problem reports: any user sends one, system administrators handle them."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from ontotator import __version__
from ontotator.api.about_routes import current_revision
from ontotator.api.identity import PrincipalDep, require_system_admin
from ontotator.application.technical_reports import (
    MAX_CRASH_MESSAGE_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_ROUTE_LENGTH,
    ReportContext,
    TechnicalReportReceipt,
    TechnicalReportService,
    TechnicalReportStatus,
    TechnicalReportSummary,
    TechnicalReportView,
)
from ontotator.auth.audit import Actor

router = APIRouter(prefix="/api/v1", tags=["technical-reports"])


class LastApiError(BaseModel):
    """The last refused API request this browser tab saw (in memory only)."""

    model_config = ConfigDict(extra="forbid")
    status: int = Field(ge=0, le=599)
    code: str | None = Field(default=None, max_length=64, pattern=r"^[A-Z0-9_]+$")
    at: datetime


class TechnicalReportContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route: str | None = Field(default=None, max_length=MAX_ROUTE_LENGTH)
    viewport: str | None = Field(
        default=None, max_length=32, pattern=r"^[0-9]{1,5}x[0-9]{1,5}$"
    )
    last_api_error: LastApiError | None = None
    # The crash screen's error message, filled in by the app.
    crash_message: str | None = Field(default=None, max_length=MAX_CRASH_MESSAGE_LENGTH)


class TechnicalReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=MAX_DESCRIPTION_LENGTH)
    context: TechnicalReportContext = Field(default_factory=TechnicalReportContext)


class TechnicalReportStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: TechnicalReportStatus


def _service(request: Request) -> TechnicalReportService:
    return TechnicalReportService(request.app.state.repo.db)


@router.post("/technical-reports")
def create_report(
    body: TechnicalReportRequest, request: Request, principal: PrincipalDep
) -> TechnicalReportReceipt:
    """Send a technical report to the administrators; no task is paused."""
    error = body.context.last_api_error
    return _service(request).create(
        Actor.user(principal.user_id, principal.username),
        request_id=body.request_id,
        description=body.description,
        app_version=__version__,
        app_revision=current_revision(),
        user_agent=request.headers.get("user-agent"),
        context=ReportContext(
            route=body.context.route,
            viewport=body.context.viewport,
            last_error_status=error.status if error else None,
            last_error_code=error.code if error else None,
            last_error_at=error.at if error else None,
            crash_message=body.context.crash_message,
        ),
    )


@router.get("/admin/technical-reports")
def list_reports(
    request: Request,
    principal: PrincipalDep,
    status: TechnicalReportStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TechnicalReportView]:
    """Reports newest first, optionally only open or done ones."""
    require_system_admin(principal)
    return _service(request).list(status, limit=limit, offset=offset)


@router.get("/admin/technical-reports/summary")
def report_summary(request: Request, principal: PrincipalDep) -> TechnicalReportSummary:
    """The number of open reports (the navigation badge)."""
    require_system_admin(principal)
    return _service(request).summary()


@router.post("/admin/technical-reports/{report_id}/status")
def set_report_status(
    report_id: int,
    body: TechnicalReportStatusRequest,
    request: Request,
    principal: PrincipalDep,
) -> TechnicalReportView:
    """Mark a report done, or open it again."""
    require_system_admin(principal)
    return _service(request).set_status(
        Actor.user(principal.user_id, principal.username), report_id, body.status
    )
