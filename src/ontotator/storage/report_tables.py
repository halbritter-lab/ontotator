"""Technical problem reports from users to the system administrators (#259).

A report names a technical problem (an error message, a page that does not
load, a crash) or general feedback. It belongs to no project and pauses no
task. The reporter writes ``description``; the app adds the context columns.
Administrators mark a report done and may reopen it.
"""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Identity, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

TECHNICAL_REPORT_STATES = ("open", "done")


class TechnicalReportRow(Base):
    """One technical report; quoted as ``TR-<id>``.

    ``user_agent`` is a personal trace like a session's browser: erasing the
    reporter's account clears it. The reporter link stays (the pseudonym).
    """

    __tablename__ = "technical_reports"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'done')", name="status"),
        CheckConstraint(
            "(status = 'done') = (closed_at IS NOT NULL)", name="closed_when_done"
        ),
        # A retried request (same id) returns the first report.
        Index(
            "ix_technical_reports_reporter_id_request_id",
            "reporter_id",
            "request_id",
            unique=True,
        ),
        # The admin list (by status, newest first) and the per-user bound.
        Index("ix_technical_reports_status_created_at", "status", "created_at"),
        Index(
            "ix_technical_reports_reporter_id_created_at", "reporter_id", "created_at"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    reporter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    request_id: Mapped[str]
    description: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="open")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # Context added by the app, never typed by the reporter.
    app_version: Mapped[str]
    app_revision: Mapped[str | None]
    route: Mapped[str | None]
    user_agent: Mapped[str | None]
    viewport: Mapped[str | None]
    last_error_status: Mapped[int | None]
    last_error_code: Mapped[str | None]
    last_error_at: Mapped[datetime | None]
    crash_message: Mapped[str | None]
    closed_at: Mapped[datetime | None]
    closed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
