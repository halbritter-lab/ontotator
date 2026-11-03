"""Working time of a task (issue 298): the editor's reports and the lead's sums.

The owner of an annotation or translation review task reports its work
intervals and reads the task's own total. Leads read sums per mode only:
texts with working time, total and median per text, never a person's
intervals. The intervals themselves leave only through the pseudonymised
``work_time`` export.
"""

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from ontotator.api.identity import PrincipalDep
from ontotator.api.job_routes import authorized_project
from ontotator.application.work_time import (
    MAX_ITEMS,
    WorkTimeItem,
    WorkTimeService,
    WorkTimeState,
    mode_totals,
)
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action
from ontotator.storage.tables import ProjectRow

router = APIRouter(prefix="/api/v1", tags=["work-time"])


class WorkTimeItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # The browser's id of the interval; a retried item changes nothing.
    interval_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    kind: Literal["open", "heartbeat", "close"]
    # The browser's clock: orders the items of a batch, never stored as a time.
    client_at: datetime | None = None
    end_reason: Literal["idle", "hidden", "manual_pause", "closed"] | None = None


class WorkTimeReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[WorkTimeItemRequest] = Field(max_length=MAX_ITEMS)


class WorkTimeView(BaseModel):
    """``record``: run the timer. ``active_seconds``: the owner's closed time on
    this task. ``closed``: interval ids of the batch the server holds closed."""

    record: bool
    first_in_project: bool
    active_seconds: int
    closed: list[str]
    heartbeat_seconds: int
    idle_seconds: int


class ModeTotalView(BaseModel):
    mode: Literal["proposals", "scratch", "translation_review"]
    texts: int
    total_seconds: int
    median_seconds_per_text: int


class ProjectWorkTimeView(BaseModel):
    record: bool
    modes: list[ModeTotalView]


def _view(state: WorkTimeState) -> WorkTimeView:
    return WorkTimeView.model_validate(asdict(state))


def _service(request: Request) -> WorkTimeService:
    clock = getattr(request.app.state, "work_time_clock", None)
    db = request.app.state.repo.db
    return WorkTimeService(db, clock) if clock is not None else WorkTimeService(db)


@router.get("/assignments/{assignment_id}/work-time")
def work_time(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> WorkTimeView:
    return _view(_service(request).state(principal.user_id, assignment_id))


@router.post("/assignments/{assignment_id}/work-time")
def report_work_time(
    assignment_id: int, body: WorkTimeReport, request: Request, principal: PrincipalDep
) -> WorkTimeView:
    items = [
        WorkTimeItem(
            interval_id=item.interval_id,
            kind=item.kind,
            client_at=item.client_at,
            end_reason=item.end_reason,
        )
        for item in body.items
    ]
    return _view(_service(request).report(principal.user_id, assignment_id, items))


@router.get("/projects/{key}/work-time")
def project_work_time(
    key: str, request: Request, principal: PrincipalDep
) -> ProjectWorkTimeView:
    actor = Actor.user(principal.user_id, principal.username)
    clock = getattr(request.app.state, "work_time_clock", None)
    now = clock() if clock is not None else datetime.now(UTC)
    with request.app.state.repo.db.transaction() as conn:
        project_id = authorized_project(conn, key, actor, Action.VIEW_PROGRESS)
        record = conn.execute(
            select(ProjectRow.record_working_time).where(ProjectRow.id == project_id)
        ).scalar_one()
        totals = mode_totals(conn, project_id, now)
    return ProjectWorkTimeView(
        record=bool(record),
        modes=[ModeTotalView.model_validate(asdict(total)) for total in totals],
    )
