"""Working time of annotation and translation review tasks (issue 298).

Recorded only in projects with ``projects.record_working_time``. The browser
reports the work intervals of an open task: an ``open`` event when one starts,
a ``heartbeat`` every minute while it runs, and a close with its reason. The
server stores each event at its own receipt time (``at``); ``client_at`` only
orders a batch. A closed interval is written once to ``work_intervals``;
an interval whose heartbeats stopped is closed there as ``lost``, at its last
event. Both tables are append-only (migration 0031).
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Identity,
    Index,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

WORK_TIME_TASKS = ("annotate", "translation_review")
WORK_TIME_MODES = ("proposals", "scratch", "translation_review")
END_REASONS = ("idle", "hidden", "manual_pause", "closed", "lost")
_TASKS = "('annotate', 'translation_review')"
_MODES = "('proposals', 'scratch', 'translation_review')"


class WorkTimeEventRow(Base):
    """An ``open`` or ``heartbeat`` of one work interval, at server time."""

    __tablename__ = "work_time_events"
    __table_args__ = (
        CheckConstraint("kind IN ('open', 'heartbeat')", name="kind"),
        CheckConstraint(f"task IN {_TASKS}", name="task"),
        CheckConstraint(f"mode IN {_MODES}", name="mode"),
        Index(
            "ix_work_time_events_assignment_id_interval_id",
            "assignment_id",
            "interval_id",
        ),
        # A retried open is stored once (idempotent by the client's id).
        Index(
            "uq_work_time_events_open",
            "assignment_id",
            "interval_id",
            unique=True,
            postgresql_where=text("kind = 'open'"),
        ),
        Index("ix_work_time_events_project_id_user_id", "project_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    # No foreign key: purged work keeps its working time (as edit_events).
    assignment_id: Mapped[int] = mapped_column(BigInteger)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.users.id"))
    document_id: Mapped[str]
    task: Mapped[str]
    mode: Mapped[str]
    interval_id: Mapped[str]
    kind: Mapped[str]
    at: Mapped[datetime] = mapped_column(server_default=func.now())
    client_at: Mapped[datetime | None]


class WorkIntervalRow(Base):
    """One closed work interval; ``ended_at`` is clamped by the server."""

    __tablename__ = "work_intervals"
    __table_args__ = (
        CheckConstraint(f"task IN {_TASKS}", name="task"),
        CheckConstraint(f"mode IN {_MODES}", name="mode"),
        CheckConstraint(
            "end_reason IN ('idle', 'hidden', 'manual_pause', 'closed', 'lost')",
            name="end_reason",
        ),
        CheckConstraint("ended_at >= started_at", name="ordered"),
        UniqueConstraint("assignment_id", "interval_id"),
        Index("ix_work_intervals_project_id_document_id", "project_id", "document_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    assignment_id: Mapped[int] = mapped_column(BigInteger)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.users.id"))
    document_id: Mapped[str]
    task: Mapped[str]
    mode: Mapped[str]
    interval_id: Mapped[str]
    started_at: Mapped[datetime]
    ended_at: Mapped[datetime]
    end_reason: Mapped[str]
    recorded_at: Mapped[datetime] = mapped_column(server_default=func.now())
