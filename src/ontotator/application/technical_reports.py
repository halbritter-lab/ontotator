"""Technical problem reports: any user writes one, system administrators handle them.

A report pauses no task and belongs to no project (#259). The reporter only
describes what happened; the app adds the context (version, screen, browser,
window size, the last refused API request and a crash message). Nothing
leaves the server: an administrator copies a report into an issue by hand.

Every report and every status change is audited in the same transaction. The
audit entries carry the reference only, never the description, which may hold
clinical text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import Connection, RowMapping, func, insert, select, update

from ontotator.api.person_views import PersonRefView
from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.storage.database import Database
from ontotator.storage.report_tables import TechnicalReportRow
from ontotator.storage.tables import UserRow

TechnicalReportStatus = Literal["open", "done"]

MAX_DESCRIPTION_LENGTH = 4000
MAX_ROUTE_LENGTH = 300
MAX_USER_AGENT_LENGTH = 512
MAX_CRASH_MESSAGE_LENGTH = 2000
MAX_VERSION_LENGTH = 64
# At most this many reports per user in ``REPORT_WINDOW``: a stuck retry loop
# or a held-down key cannot fill the table.
MAX_REPORTS_PER_WINDOW = 20
REPORT_WINDOW = timedelta(hours=1)
REFERENCE_PREFIX = "TR-"

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]")
_LINE_CONTROL = re.compile(r"[\x00-\x1f\x7f\ud800-\udfff]")


def reference(report_id: int) -> str:
    """What users and administrators quote: ``TR-12``."""
    return f"{REFERENCE_PREFIX}{report_id}"


def _text(value: str, limit: int) -> str:
    """Multi-line text PostgreSQL can store: NUL and other controls replaced."""
    return _CONTROL.sub("\N{REPLACEMENT CHARACTER}", value)[:limit]


def _line(value: str | None, limit: int) -> str | None:
    """One trimmed line, or None when empty."""
    if value is None:
        return None
    cleaned = _LINE_CONTROL.sub("\N{REPLACEMENT CHARACTER}", value).strip()[:limit]
    return cleaned or None


def _route(value: str | None) -> str | None:
    """The screen's address without its query: filters may hold searched text."""
    if value is None:
        return None
    return _line(value.split("?", 1)[0], MAX_ROUTE_LENGTH)


@dataclass(frozen=True)
class ReportContext:
    """The context the client adds; every field is optional and bounded."""

    route: str | None = None
    viewport: str | None = None
    last_error_status: int | None = None
    last_error_code: str | None = None
    last_error_at: datetime | None = None
    crash_message: str | None = None


class TechnicalReportReceipt(BaseModel):
    """What the reporter sees after sending: the reference to quote."""

    id: int
    reference: str
    created_at: datetime


class TechnicalReportView(BaseModel):
    """One report as administrators read it."""

    id: int
    reference: str
    status: TechnicalReportStatus
    description: str
    created_at: datetime
    reporter: PersonRefView
    reporter_username: str
    app_version: str
    app_revision: str | None
    route: str | None
    user_agent: str | None
    viewport: str | None
    last_error_status: int | None
    last_error_code: str | None
    last_error_at: datetime | None
    crash_message: str | None
    closed_at: datetime | None
    closed_by: str | None


class TechnicalReportSummary(BaseModel):
    open: int


def _not_found() -> DomainError:
    return DomainError("TECHNICAL_REPORT_NOT_FOUND", "The report does not exist.")


class TechnicalReportService:
    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    def create(
        self,
        actor: Actor,
        *,
        request_id: str,
        description: str,
        app_version: str,
        app_revision: str | None,
        user_agent: str | None,
        context: ReportContext,
    ) -> TechnicalReportReceipt:
        """Store a report of ``actor``; a repeated ``request_id`` returns the first.

        Raises:
            DomainError: ``TECHNICAL_REPORT_EMPTY`` without a description,
                ``TECHNICAL_REPORT_LIMIT`` after too many reports in the window.
        """
        assert actor.user_id is not None
        text = _text(description, MAX_DESCRIPTION_LENGTH).strip()
        if not text:
            raise DomainError(
                "TECHNICAL_REPORT_EMPTY", "Describe what happened before sending."
            )
        now = self._now()
        with self.db.transaction() as conn:
            lock_user_authority(conn, actor.user_id)
            existing = conn.execute(
                select(TechnicalReportRow.id, TechnicalReportRow.created_at).where(
                    TechnicalReportRow.reporter_id == actor.user_id,
                    TechnicalReportRow.request_id == request_id,
                )
            ).one_or_none()
            if existing is not None:
                return TechnicalReportReceipt(
                    id=existing.id,
                    reference=reference(existing.id),
                    created_at=existing.created_at,
                )
            recent = conn.execute(
                select(func.count()).where(
                    TechnicalReportRow.reporter_id == actor.user_id,
                    TechnicalReportRow.created_at > now - REPORT_WINDOW,
                )
            ).scalar_one()
            if recent >= MAX_REPORTS_PER_WINDOW:
                raise DomainError(
                    "TECHNICAL_REPORT_LIMIT",
                    {
                        "message": "You sent many reports in the last hour."
                        " Try again later.",
                        "max": MAX_REPORTS_PER_WINDOW,
                    },
                )
            error_status = context.last_error_status
            report_id = conn.execute(
                insert(TechnicalReportRow)
                .values(
                    reporter_id=actor.user_id,
                    request_id=request_id,
                    description=text,
                    status="open",
                    created_at=now,
                    app_version=_line(app_version, MAX_VERSION_LENGTH) or "unknown",
                    app_revision=_line(app_revision, MAX_VERSION_LENGTH),
                    route=_route(context.route),
                    user_agent=_line(user_agent, MAX_USER_AGENT_LENGTH),
                    viewport=_line(context.viewport, 32),
                    last_error_status=error_status,
                    last_error_code=_line(context.last_error_code, 64),
                    last_error_at=context.last_error_at,
                    crash_message=(
                        _text(context.crash_message, MAX_CRASH_MESSAGE_LENGTH).strip()
                        or None
                        if context.crash_message is not None
                        else None
                    ),
                )
                .returning(TechnicalReportRow.id)
            ).scalar_one()
            record_audit(
                conn,
                actor,
                "technical_report.create",
                target_type="technical_report",
                target_id=report_id,
                details={"reference": reference(report_id)},
                at=now,
            )
            return TechnicalReportReceipt(
                id=report_id, reference=reference(report_id), created_at=now
            )

    @staticmethod
    def _views(conn: Connection, rows: list[RowMapping]) -> list[TechnicalReportView]:
        user_ids = {row["reporter_id"] for row in rows} | {
            row["closed_by"] for row in rows if row["closed_by"] is not None
        }
        users = {
            user.id: user
            for user in conn.execute(
                select(
                    UserRow.id,
                    UserRow.username,
                    UserRow.display_name,
                    UserRow.pseudonym,
                ).where(UserRow.id.in_(user_ids))
            )
        }
        views = []
        for row in rows:
            reporter = users[row["reporter_id"]]
            closer = users.get(row["closed_by"]) if row["closed_by"] else None
            views.append(
                TechnicalReportView(
                    id=row["id"],
                    reference=reference(row["id"]),
                    status=row["status"],
                    description=row["description"],
                    created_at=row["created_at"],
                    reporter=PersonRefView(
                        pseudonym=reporter.pseudonym,
                        display_name=reporter.display_name,
                    ),
                    reporter_username=reporter.username,
                    app_version=row["app_version"],
                    app_revision=row["app_revision"],
                    route=row["route"],
                    user_agent=row["user_agent"],
                    viewport=row["viewport"],
                    last_error_status=row["last_error_status"],
                    last_error_code=row["last_error_code"],
                    last_error_at=row["last_error_at"],
                    crash_message=row["crash_message"],
                    closed_at=row["closed_at"],
                    closed_by=closer.username if closer else None,
                )
            )
        return views

    def list(
        self,
        status: TechnicalReportStatus | None = None,
        *,
        limit: int = 200,
        offset: int = 0,
    ) -> list[TechnicalReportView]:
        """Reports newest first; the caller checked the administrator role."""
        with self.db.transaction() as conn:
            statement = (
                select(TechnicalReportRow.__table__)
                .order_by(
                    TechnicalReportRow.created_at.desc(), TechnicalReportRow.id.desc()
                )
                .limit(limit)
                .offset(offset)
            )
            if status is not None:
                statement = statement.where(TechnicalReportRow.status == status)
            rows = list(conn.execute(statement).mappings())
            return self._views(conn, rows)

    def summary(self) -> TechnicalReportSummary:
        with self.db.transaction() as conn:
            count = conn.execute(
                select(func.count()).where(TechnicalReportRow.status == "open")
            ).scalar_one()
        return TechnicalReportSummary(open=count)

    def set_status(
        self, actor: Actor, report_id: int, status: TechnicalReportStatus
    ) -> TechnicalReportView:
        """Mark a report done or open it again; the same status changes nothing.

        The administrator role is checked against the locked account row, so a
        role removed meanwhile refuses the change.

        Raises:
            AccessDenied: ``ADMIN_REQUIRED``.
            DomainError: ``TECHNICAL_REPORT_NOT_FOUND``.
        """
        assert actor.user_id is not None
        now = self._now()
        with self.db.transaction() as conn:
            fresh = lock_user_authority(conn, actor.user_id)
            if not fresh["active"] or not fresh["is_system_admin"]:
                raise AccessDenied(
                    "ADMIN_REQUIRED", "Only a system administrator may do this."
                )
            row = (
                conn.execute(
                    select(TechnicalReportRow.__table__)
                    .where(TechnicalReportRow.id == report_id)
                    .with_for_update()
                )
                .mappings()
                .one_or_none()
            )
            if row is None:
                raise _not_found()
            if row["status"] != status:
                done = status == "done"
                conn.execute(
                    update(TechnicalReportRow)
                    .where(TechnicalReportRow.id == report_id)
                    .values(
                        status=status,
                        closed_at=now if done else None,
                        closed_by=actor.user_id if done else None,
                    )
                )
                record_audit(
                    conn,
                    actor,
                    "technical_report.close" if done else "technical_report.reopen",
                    target_type="technical_report",
                    target_id=report_id,
                    details={"reference": reference(report_id)},
                    at=now,
                )
                row = (
                    conn.execute(
                        select(TechnicalReportRow.__table__).where(
                            TechnicalReportRow.id == report_id
                        )
                    )
                    .mappings()
                    .one()
                )
            return self._views(conn, [row])[0]
