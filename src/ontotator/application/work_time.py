"""Working time of annotation and translation review tasks (issue 298).

A project records working time only with ``record_working_time`` on. The
editor of an open task reports work intervals in batches: ``open`` when an
interval starts, ``heartbeat`` about every ``HEARTBEAT_SECONDS`` while it
runs, and ``close`` with the reason it ended (idle, hidden tab, manual pause,
task closed). Every item names the browser's interval id, so a retried batch
changes nothing.

Server times are authoritative: an interval starts when its ``open`` arrives
and ends when its ``close`` arrives. ``client_at`` only orders the items of a
batch. An interval never runs longer than ``MAX_SILENCE`` (heartbeat gap plus
idle threshold) past its last event; one that falls silent that long is
closed as ``lost`` at its last event. Nothing is stored while the setting is
off, and no new interval opens on a submitted or paused task.
"""

from __future__ import annotations

import statistics
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import ColumnElement, Connection, and_, exists, func, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.authz.visibility import qualifying_assignment
from ontotator.domain.errors import DomainError
from ontotator.storage.database import Database, advisory_lock_id
from ontotator.storage.tables import AssignmentRow, ProjectRow, UserRow
from ontotator.storage.work_time_tables import (
    WORK_TIME_TASKS,
    WorkIntervalRow,
    WorkTimeEventRow,
)

HEARTBEAT_SECONDS = 60
IDLE_SECONDS = 180
MAX_SILENCE = timedelta(seconds=HEARTBEAT_SECONDS + IDLE_SECONDS)
MAX_ITEMS = 50
Kind = Literal["open", "heartbeat", "close"]
EndReason = Literal["idle", "hidden", "manual_pause", "closed"]
Clock = Callable[[], datetime]


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class WorkTimeItem:
    interval_id: str
    kind: Kind
    client_at: datetime | None = None
    end_reason: EndReason | None = None


@dataclass(frozen=True)
class WorkTimeState:
    """What the editor needs: whether to run the timer, and the task's total.

    ``first_in_project``: the person has no working time in this project yet
    (the editor shows its one-time notice). ``closed``: interval ids of the
    batch that the server holds closed, so the editor starts a new one.
    """

    record: bool
    first_in_project: bool
    active_seconds: int
    closed: list[str] = field(default_factory=list)
    heartbeat_seconds: int = HEARTBEAT_SECONDS
    idle_seconds: int = IDLE_SECONDS


@dataclass(frozen=True)
class ModeTotal:
    """Sums of one mode for leads: no person, no interval."""

    mode: str
    texts: int
    total_seconds: int
    median_seconds_per_text: int


@dataclass(frozen=True)
class _Task:
    id: int
    project_id: int
    user_id: int
    document_id: str
    task: str
    mode: str
    project_records: bool
    open_allowed: bool


def _seconds(delta: timedelta) -> float:
    return max(delta.total_seconds(), 0.0)


def _duration() -> ColumnElement[Any]:
    return func.extract("epoch", WorkIntervalRow.ended_at - WorkIntervalRow.started_at)


def close_lost(
    conn: Connection,
    now: datetime,
    *,
    project_id: int | None = None,
    assignment_id: int | None = None,
) -> None:
    """Close every interval silent for longer than ``MAX_SILENCE`` as ``lost``.

    It ends at its last event. A close that arrives later finds it closed.
    """
    opened = WorkTimeEventRow.__table__.alias("opened")
    seen = WorkTimeEventRow.__table__.alias("seen")
    last_seen = (
        select(func.max(seen.c.at))
        .where(
            seen.c.assignment_id == opened.c.assignment_id,
            seen.c.interval_id == opened.c.interval_id,
        )
        .scalar_subquery()
    )
    conditions: list[ColumnElement[bool]] = [
        opened.c.kind == "open",
        ~exists().where(
            WorkIntervalRow.assignment_id == opened.c.assignment_id,
            WorkIntervalRow.interval_id == opened.c.interval_id,
        ),
        last_seen < now - MAX_SILENCE,
    ]
    if project_id is not None:
        conditions.append(opened.c.project_id == project_id)
    if assignment_id is not None:
        conditions.append(opened.c.assignment_id == assignment_id)
    rows = select(
        opened.c.project_id,
        opened.c.assignment_id,
        opened.c.user_id,
        opened.c.document_id,
        opened.c.task,
        opened.c.mode,
        opened.c.interval_id,
        opened.c.at,
        last_seen,
        literal("lost"),
    ).where(and_(*conditions))
    conn.execute(
        pg_insert(WorkIntervalRow)
        .from_select(
            [
                "project_id",
                "assignment_id",
                "user_id",
                "document_id",
                "task",
                "mode",
                "interval_id",
                "started_at",
                "ended_at",
                "end_reason",
            ],
            rows,
        )
        .on_conflict_do_nothing(index_elements=["assignment_id", "interval_id"])
    )


class WorkTimeService:
    def __init__(self, db: Database, clock: Clock = _now) -> None:
        self.db = db
        self.clock = clock

    def _task(self, conn: Connection, user_id: int, assignment_id: int) -> _Task:
        row = conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.project_id,
                AssignmentRow.document_id,
                AssignmentRow.task,
                AssignmentRow.status,
                AssignmentRow.held,
                AssignmentRow.annotation_mode,
                ProjectRow.record_working_time,
            )
            .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
            .where(AssignmentRow.id == assignment_id, qualifying_assignment(user_id))
        ).one_or_none()
        if row is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        timed = row.task in WORK_TIME_TASKS
        records = bool(row.record_working_time) and timed
        return _Task(
            id=row.id,
            project_id=row.project_id,
            user_id=user_id,
            document_id=row.document_id,
            task=row.task,
            mode=(
                "translation_review"
                if row.task == "translation_review"
                else row.annotation_mode or "scratch"
            ),
            project_records=records,
            open_allowed=records and row.status != "submitted" and not row.held,
        )

    def state(self, user_id: int, assignment_id: int) -> WorkTimeState:
        with self.db.transaction() as conn:
            task = self._task(conn, user_id, assignment_id)
            close_lost(conn, self.clock(), assignment_id=task.id)
            return self._state(conn, task, [])

    def report(
        self, user_id: int, assignment_id: int, items: Sequence[WorkTimeItem]
    ) -> WorkTimeState:
        with self.db.transaction() as conn:
            task = self._task(conn, user_id, assignment_id)
            if not task.project_records:
                # Setting off: nothing is stored, not even a close.
                return self._state(conn, task, [])
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(
                        advisory_lock_id("work_time", str(task.id))
                    )
                )
            )
            now = self.clock()
            close_lost(conn, now, assignment_id=task.id)
            closed: list[str] = []
            floor = datetime.min.replace(tzinfo=UTC)
            ordered = sorted(
                enumerate(items), key=lambda pair: (pair[1].client_at or floor, pair[0])
            )
            for _, item in ordered:
                if (
                    self._apply(conn, task, item, now)
                    and item.interval_id not in closed
                ):
                    closed.append(item.interval_id)
            return self._state(conn, task, closed)

    def _apply(
        self, conn: Connection, task: _Task, item: WorkTimeItem, now: datetime
    ) -> bool:
        """Apply one item; True when the interval is closed afterwards."""
        key = (
            WorkTimeEventRow.assignment_id == task.id,
            WorkTimeEventRow.interval_id == item.interval_id,
        )
        done = conn.execute(
            select(WorkIntervalRow.id).where(
                WorkIntervalRow.assignment_id == task.id,
                WorkIntervalRow.interval_id == item.interval_id,
            )
        ).first()
        if done is not None:
            return True
        span = conn.execute(
            select(
                func.min(WorkTimeEventRow.at).filter(WorkTimeEventRow.kind == "open"),
                func.max(WorkTimeEventRow.at),
            ).where(*key)
        ).one()
        started, last_seen = span[0], span[1]
        if started is None:
            if item.kind == "close":
                # The start never arrived: nothing to count.
                return True
            if not task.open_allowed:
                return True
            self._event(conn, task, item, "open", now)
            return False
        if item.kind == "open":
            return False
        if item.kind == "heartbeat":
            self._event(conn, task, item, "heartbeat", now)
            return False
        ended = min(now, last_seen + MAX_SILENCE)
        conn.execute(
            pg_insert(WorkIntervalRow)
            .values(
                project_id=task.project_id,
                assignment_id=task.id,
                user_id=task.user_id,
                document_id=task.document_id,
                task=task.task,
                mode=task.mode,
                interval_id=item.interval_id,
                started_at=started,
                ended_at=max(ended, started),
                end_reason=item.end_reason or "closed",
            )
            .on_conflict_do_nothing(index_elements=["assignment_id", "interval_id"])
        )
        return True

    @staticmethod
    def _event(
        conn: Connection,
        task: _Task,
        item: WorkTimeItem,
        kind: Literal["open", "heartbeat"],
        now: datetime,
    ) -> None:
        statement = pg_insert(WorkTimeEventRow).values(
            project_id=task.project_id,
            assignment_id=task.id,
            user_id=task.user_id,
            document_id=task.document_id,
            task=task.task,
            mode=task.mode,
            interval_id=item.interval_id,
            kind=kind,
            at=now,
            client_at=item.client_at,
        )
        if kind == "open":
            statement = statement.on_conflict_do_nothing(
                index_elements=["assignment_id", "interval_id"],
                index_where=WorkTimeEventRow.kind == "open",
            )
        conn.execute(statement)

    @staticmethod
    def _state(conn: Connection, task: _Task, closed: list[str]) -> WorkTimeState:
        total = conn.execute(
            select(func.coalesce(func.sum(_duration()), 0)).where(
                WorkIntervalRow.assignment_id == task.id,
                WorkIntervalRow.user_id == task.user_id,
            )
        ).scalar_one()
        earlier = conn.execute(
            select(WorkTimeEventRow.id)
            .where(
                WorkTimeEventRow.project_id == task.project_id,
                WorkTimeEventRow.user_id == task.user_id,
            )
            .limit(1)
        ).first()
        return WorkTimeState(
            record=task.open_allowed,
            first_in_project=task.open_allowed and earlier is None,
            active_seconds=round(float(total)),
            closed=closed,
        )


def mode_totals(conn: Connection, project_id: int, now: datetime) -> list[ModeTotal]:
    """Per mode: texts with working time, total and median per text (seconds)."""
    close_lost(conn, now, project_id=project_id)
    rows = conn.execute(
        select(
            WorkIntervalRow.mode,
            WorkIntervalRow.document_id,
            func.sum(_duration()).label("seconds"),
        )
        .where(WorkIntervalRow.project_id == project_id)
        .group_by(WorkIntervalRow.mode, WorkIntervalRow.document_id)
        .order_by(WorkIntervalRow.mode, WorkIntervalRow.document_id)
    ).all()
    per_mode: dict[str, list[float]] = {}
    for row in rows:
        per_mode.setdefault(row.mode, []).append(float(row.seconds))
    return [
        ModeTotal(
            mode=mode,
            texts=len(values),
            total_seconds=round(sum(values)),
            median_seconds_per_text=round(statistics.median(values)),
        )
        for mode, values in sorted(per_mode.items())
    ]


def _stamp(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def work_time_export(
    conn: Connection, project_id: int, now: datetime
) -> list[dict[str, Any]]:
    """Every closed interval of the project in id order, then one active total
    per task (annotator, text, task, mode). Pseudonymised like the edit log:
    the annotator is the person's pseudonym, no user, session or assignment id.
    """
    close_lost(conn, now, project_id=project_id)
    rows = conn.execute(
        select(
            WorkIntervalRow.id,
            UserRow.pseudonym,
            WorkIntervalRow.document_id,
            WorkIntervalRow.task,
            WorkIntervalRow.mode,
            WorkIntervalRow.started_at,
            WorkIntervalRow.ended_at,
            WorkIntervalRow.end_reason,
        )
        .join(UserRow, UserRow.id == WorkIntervalRow.user_id)
        .where(WorkIntervalRow.project_id == project_id)
        .order_by(WorkIntervalRow.id)
    ).all()
    lines: list[dict[str, Any]] = []
    totals: dict[tuple[str, str, str, str], list[float]] = {}
    for row in rows:
        seconds = _seconds(row.ended_at - row.started_at)
        lines.append(
            {
                "record": "interval",
                "interval": row.id,
                "annotator": row.pseudonym,
                "document_id": row.document_id,
                "task": row.task,
                "mode": row.mode,
                "started_at": _stamp(row.started_at),
                "ended_at": _stamp(row.ended_at),
                "active_seconds": round(seconds),
                "end_reason": row.end_reason,
            }
        )
        totals.setdefault(
            (row.pseudonym, row.document_id, row.task, row.mode), []
        ).append(seconds)
    for (annotator, document_id, task, mode), values in sorted(totals.items()):
        lines.append(
            {
                "record": "task_total",
                "annotator": annotator,
                "document_id": document_id,
                "task": task,
                "mode": mode,
                "intervals": len(values),
                "active_seconds": round(sum(values)),
            }
        )
    return lines
