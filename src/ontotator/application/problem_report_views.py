"""Per-viewer read model of problem reports; redaction happens here, at the source.

Leads see every task a report touches. The reporter sees only their own task:
other owners' labels, task IDs and lead reasons for other tasks never leave
this module for a non-lead viewer.
"""

from collections.abc import Iterable
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Connection, select

from ontotator.api.person_views import PersonRefView
from ontotator.application.people import person_refs
from ontotator.authz.policy import Task
from ontotator.domain.errors import DomainError
from ontotator.domain.problem_reports import EventFact, withdrawable
from ontotator.domain.submission_labels import round_ordinals
from ontotator.domain.work_rounds import WorkRoundView
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontotator.storage.workflow_tables import (
    ProblemReportEventRow,
    ProblemReportRow,
    ProblemReportStateRow,
    RoundSubmissionBindingRow,
    TaskHoldRow,
    TaskHoldStateRow,
    WorkRoundRow,
)

STATE_CHANGING = frozenset({"resolve", "restart", "withdraw", "reopen"})
REPORTER_HIDDEN_UNLESS_OWN = frozenset({"resume", "extend_hold"})


class AffectedTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignment_id: int
    owner_label: str
    case_id: str
    language: str
    task: Task


class ReportEventView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str
    action: str
    actor_label: str
    actor: PersonRefView | None = None
    created_at: datetime
    reason: str | None = None
    round_id: str | None = None
    round_ordinal: int | None = None
    abandoned_round_id: str | None = (
        None  # restart: predecessor of round_id (the round actually abandoned)
    )
    abandoned_round_ordinal: int | None = None
    abandoned_translation_draft: dict[str, Any] | None = None
    affected: list[AffectedTask] = Field(default_factory=list)  # leads only
    own_task: bool = False  # the event touched the reporter's task


class OtherActiveHold(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_id: str


class ReportHoldView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hold_id: str
    assignment_id: int
    owner_label: str
    owner: PersonRefView | None = None
    case_id: str
    language: str
    task: Task
    created_at: datetime
    created_by_label: str
    created_by: PersonRefView | None = None
    active: bool
    released_at: datetime | None = None
    released_by_label: str | None = None
    released_by: PersonRefView | None = None
    release_action: Literal["resume", "restart", "withdraw"] | None = None
    release_event_id: str | None = None
    other_active_holds: list[OtherActiveHold] = Field(
        default_factory=list
    )  # leads only


class ReportSubmissionRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    submission_id: str
    round_ordinal: int | None
    recorded_at: datetime


class PauseCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignment_id: int
    owner_label: str
    owner: PersonRefView | None = None
    case_id: str
    language: str
    task: Task
    same_text: bool
    paused_by_this_report: bool
    reporter_task: bool


class ProblemReportView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_id: str
    project_key: str
    assignment_id: int
    document_id: str
    reporter_id: int
    round_id: str | None
    submission_id: str | None
    reason: str
    state: Literal["open", "resolved", "withdrawn"]
    revision: int
    resolution: str | None
    held_assignment_ids: list[int] = Field(default_factory=list)
    events: list[ReportEventView] = Field(default_factory=list)
    new_round: WorkRoundView | None = None
    created_at: datetime | None = None
    reporter_label: str = ""
    reporter: PersonRefView | None = None
    case_id: str = ""
    language: str = ""
    task: Task | None = None
    round_ordinal: int | None = None  # the round the report was filed in
    current_round_id: str | None = None  # reporter's active round now
    current_round_ordinal: int | None = None
    submission: ReportSubmissionRef | None = None
    state_changed_at: datetime | None = None
    state_changed_by_label: str | None = None
    state_changed_by: PersonRefView | None = None
    withdrawable: bool = False
    viewer_label: str = ""
    viewer_is_lead: bool = False
    holds: list[ReportHoldView] = Field(default_factory=list)


def _people(
    conn: Connection,
    user_ids: Iterable[int | None],
    *,
    viewer_id: int,
    viewer_is_lead: bool,
) -> dict[int, PersonRefView]:
    """One ``person_refs`` call per view: names only as D1 allows."""
    return person_refs(
        conn,
        (uid for uid in user_ids if uid is not None),
        viewer_id=viewer_id,
        viewer_is_lead=viewer_is_lead,
    )


def _tasks(conn: Connection, project_id: int, ids: Iterable[int]) -> dict[int, Any]:
    """Owner, text identity and task kind of the given assignments."""
    wanted = set(ids)
    if not wanted:
        return {}
    return {
        r.id: r
        for r in conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.task,
                AssignmentRow.user_id,
                UserRow.pseudonym,
                DocumentRow.case_id,
                DocumentRow.language,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .join(
                DocumentRow,
                (DocumentRow.project_id == AssignmentRow.project_id)
                & (DocumentRow.document_id == AssignmentRow.document_id),
            )
            .where(AssignmentRow.project_id == project_id, AssignmentRow.id.in_(wanted))
        )
    }


def _ids(details: dict[str, Any]) -> list[int]:
    return [i for i in details.get("assignment_ids") or [] if isinstance(i, int)]


def build_report_view(
    conn: Connection,
    report_id: str,
    *,
    viewer_id: int,
    viewer_is_lead: bool,
    new_round: WorkRoundView | None = None,
) -> ProblemReportView:
    row = (
        conn.execute(
            select(
                ProblemReportRow,
                ProblemReportStateRow.state,
                ProblemReportStateRow.revision,
                ProblemReportStateRow.resolution,
                ProjectRow.project_key,
                AssignmentRow.document_id,
                AssignmentRow.task,
                AssignmentRow.active_round_id,
                DocumentRow.case_id,
                DocumentRow.language,
            )
            .join(
                ProblemReportStateRow,
                ProblemReportStateRow.report_id == ProblemReportRow.report_id,
            )
            .join(ProjectRow, ProjectRow.id == ProblemReportRow.project_id)
            .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
            .join(
                DocumentRow,
                (DocumentRow.project_id == AssignmentRow.project_id)
                & (DocumentRow.document_id == AssignmentRow.document_id),
            )
            .where(ProblemReportRow.report_id == report_id)
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise DomainError("REPORT_NOT_FOUND")
    pid = row["project_id"]
    own = row["assignment_id"]
    reporter_id = row["reporter_id"]

    ordinals = round_ordinals(
        (r.round_id, r.predecessor_round_id)
        for r in conn.execute(
            select(WorkRoundRow.round_id, WorkRoundRow.predecessor_round_id).where(
                WorkRoundRow.assignment_id == own
            )
        )
    )

    event_rows = list(
        conn.execute(
            select(ProblemReportEventRow)
            .where(ProblemReportEventRow.report_id == report_id)
            .order_by(ProblemReportEventRow.created_at, ProblemReportEventRow.event_id)
        )
    )
    hold_rows = list(
        conn.execute(
            select(
                TaskHoldRow.hold_id,
                TaskHoldRow.assignment_id,
                TaskHoldRow.created_at,
                TaskHoldRow.created_by,
                TaskHoldStateRow.active,
                TaskHoldStateRow.released_at,
                TaskHoldStateRow.released_by,
                TaskHoldStateRow.release_action,
                TaskHoldStateRow.release_event_id,
            )
            .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
            .where(TaskHoldRow.report_id == report_id)
            .order_by(TaskHoldRow.created_at, TaskHoldRow.hold_id)
        )
    )
    if not viewer_is_lead:
        hold_rows = [h for h in hold_rows if h.assignment_id == own]

    restart_rounds = [
        r.details.get("round_id")
        for r in event_rows
        if r.action == "restart" and r.details.get("round_id")
    ]
    predecessors: dict[str, str | None] = (
        {
            r.round_id: r.predecessor_round_id
            for r in conn.execute(
                select(WorkRoundRow.round_id, WorkRoundRow.predecessor_round_id).where(
                    WorkRoundRow.round_id.in_(restart_rounds)
                )
            )
        }
        if restart_rounds
        else {}
    )

    task_ids = {own} | {h.assignment_id for h in hold_rows}
    if viewer_is_lead:
        for r in event_rows:
            task_ids.update(_ids(r.details))
    tasks = _tasks(conn, pid, task_ids)
    people = _people(
        conn,
        [reporter_id, viewer_id]
        + [r.actor_id for r in event_rows]
        + [h.created_by for h in hold_rows]
        + [h.released_by for h in hold_rows]
        + [tasks[h.assignment_id].user_id for h in hold_rows],
        viewer_id=viewer_id,
        viewer_is_lead=viewer_is_lead,
    )
    labels = {uid: ref.pseudonym for uid, ref in people.items()}

    events: list[ReportEventView] = []
    for r in event_rows:
        ids = _ids(r.details)
        own_task = own in ids
        if (
            not viewer_is_lead
            and r.action in REPORTER_HIDDEN_UNLESS_OWN
            and not own_task
        ):
            continue
        round_id: str | None = r.details.get("round_id")
        abandoned = (
            predecessors.get(round_id) if round_id and r.action == "restart" else None
        )
        events.append(
            ReportEventView(
                event_id=r.event_id,
                action=r.action,
                actor_label=labels.get(r.actor_id, ""),
                actor=people.get(r.actor_id),
                created_at=r.created_at,
                reason=r.details.get("reason"),
                round_id=round_id,
                round_ordinal=ordinals.get(round_id) if round_id else None,
                abandoned_round_id=abandoned,
                abandoned_round_ordinal=ordinals.get(abandoned) if abandoned else None,
                abandoned_translation_draft=r.details.get(
                    "abandoned_translation_draft"
                ),
                affected=[
                    AffectedTask(
                        assignment_id=aid,
                        owner_label=tasks[aid].pseudonym,
                        case_id=tasks[aid].case_id,
                        language=tasks[aid].language,
                        task=tasks[aid].task,
                    )
                    for aid in ids
                    if aid in tasks
                ]
                if viewer_is_lead
                else [],
                own_task=own_task,
            )
        )

    others: dict[int, list[OtherActiveHold]] = {}
    if viewer_is_lead and hold_rows:
        for other in conn.execute(
            select(TaskHoldRow.assignment_id, TaskHoldRow.report_id)
            .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
            .where(
                TaskHoldRow.assignment_id.in_({h.assignment_id for h in hold_rows}),
                TaskHoldRow.report_id != report_id,
                TaskHoldStateRow.active.is_(True),
            )
            .order_by(TaskHoldRow.created_at, TaskHoldRow.hold_id)
        ):
            listed = others.setdefault(other.assignment_id, [])
            if all(o.report_id != other.report_id for o in listed):
                listed.append(OtherActiveHold(report_id=other.report_id))

    holds = [
        ReportHoldView(
            hold_id=h.hold_id,
            assignment_id=h.assignment_id,
            owner_label=tasks[h.assignment_id].pseudonym,
            owner=people.get(tasks[h.assignment_id].user_id),
            case_id=tasks[h.assignment_id].case_id,
            language=tasks[h.assignment_id].language,
            task=tasks[h.assignment_id].task,
            created_at=h.created_at,
            created_by_label=labels.get(h.created_by, ""),
            created_by=people.get(h.created_by),
            active=h.active,
            released_at=h.released_at,
            released_by_label=labels.get(h.released_by)
            if h.released_by is not None
            else None,
            released_by=people.get(h.released_by)
            if h.released_by is not None
            else None,
            release_action=h.release_action,
            release_event_id=h.release_event_id,
            other_active_holds=others.get(h.assignment_id, []),
        )
        for h in hold_rows
    ]

    submission = None
    if row["submission_id"]:
        found = conn.execute(
            select(SubmissionRow.recorded_at, RoundSubmissionBindingRow.round_id)
            .outerjoin(
                RoundSubmissionBindingRow,
                (RoundSubmissionBindingRow.project_id == SubmissionRow.project_id)
                & (
                    RoundSubmissionBindingRow.submission_id
                    == SubmissionRow.submission_id
                ),
            )
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id == row["submission_id"],
            )
        ).first()
        if found is not None:
            submission = ReportSubmissionRef(
                submission_id=row["submission_id"],
                round_ordinal=ordinals.get(found.round_id) if found.round_id else None,
                recorded_at=found.recorded_at,
            )

    changed = next(
        (r for r in reversed(event_rows) if r.action in STATE_CHANGING), None
    )
    facts = [EventFact(r.actor_id, r.action) for r in event_rows]
    return ProblemReportView(
        report_id=report_id,
        project_key=row["project_key"],
        assignment_id=own,
        document_id=row["document_id"],
        reporter_id=reporter_id,
        round_id=row["round_id"],
        submission_id=row["submission_id"],
        reason=row["reason"],
        state=row["state"],
        revision=row["revision"],
        resolution=row["resolution"],
        held_assignment_ids=sorted({h.assignment_id for h in hold_rows if h.active}),
        events=events,
        new_round=new_round,
        created_at=row["created_at"],
        reporter_label=labels.get(reporter_id, ""),
        reporter=people.get(reporter_id),
        case_id=row["case_id"],
        language=row["language"],
        task=row["task"],
        round_ordinal=ordinals.get(row["round_id"]) if row["round_id"] else None,
        current_round_id=row["active_round_id"],
        current_round_ordinal=ordinals.get(row["active_round_id"])
        if row["active_round_id"]
        else None,
        submission=submission,
        state_changed_at=changed.created_at if changed else None,
        state_changed_by_label=labels.get(changed.actor_id) if changed else None,
        state_changed_by=people.get(changed.actor_id) if changed else None,
        withdrawable=viewer_id == reporter_id
        and withdrawable(row["state"], reporter_id, facts),
        viewer_label=labels.get(viewer_id, ""),
        viewer_is_lead=viewer_is_lead,
        holds=holds,
    )


def build_pause_candidates(
    conn: Connection, report_id: str, *, viewer_id: int, viewer_is_lead: bool
) -> list[PauseCandidate]:
    """Live tasks of active users in the report's project ("Pause other tasks").

    Only leads read this list, so owners carry display names (D1); ``is_me``
    marks the viewer's own tasks.
    """
    report = conn.execute(
        select(
            ProblemReportRow.project_id,
            ProblemReportRow.assignment_id,
            DocumentRow.case_id,
        )
        .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
        .join(
            DocumentRow,
            (DocumentRow.project_id == AssignmentRow.project_id)
            & (DocumentRow.document_id == AssignmentRow.document_id),
        )
        .where(ProblemReportRow.report_id == report_id)
    ).one_or_none()
    if report is None:
        raise DomainError("REPORT_NOT_FOUND")
    paused = set(
        conn.execute(
            select(TaskHoldRow.assignment_id)
            .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
            .where(
                TaskHoldRow.report_id == report_id, TaskHoldStateRow.active.is_(True)
            )
        ).scalars()
    )
    rows = conn.execute(
        select(
            AssignmentRow.id,
            AssignmentRow.task,
            AssignmentRow.user_id,
            UserRow.pseudonym,
            DocumentRow.case_id,
            DocumentRow.language,
        )
        .join(UserRow, UserRow.id == AssignmentRow.user_id)
        .join(
            DocumentRow,
            (DocumentRow.project_id == AssignmentRow.project_id)
            & (DocumentRow.document_id == AssignmentRow.document_id),
        )
        .where(
            AssignmentRow.project_id == report.project_id,
            AssignmentRow.revoked_at.is_(None),
            UserRow.active.is_(True),
        )
    ).all()
    people = _people(
        conn,
        (r.user_id for r in rows),
        viewer_id=viewer_id,
        viewer_is_lead=viewer_is_lead,
    )
    candidates = [
        PauseCandidate(
            assignment_id=r.id,
            owner_label=r.pseudonym,
            owner=people.get(r.user_id),
            case_id=r.case_id,
            language=r.language,
            task=r.task,
            same_text=r.case_id == report.case_id,
            paused_by_this_report=r.id in paused,
            reporter_task=r.id == report.assignment_id,
        )
        for r in rows
    ]
    return sorted(
        candidates,
        key=lambda c: (not c.same_text, c.case_id, c.language, c.assignment_id),
    )
