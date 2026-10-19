"""Work-round definitions are immutable; active state has separate rows."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    ForeignKey,
    ForeignKeyConstraint,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontocurator.storage.tables import SCHEMA, Base


class WorkRoundRow(Base):
    __tablename__ = "work_rounds"
    __table_args__ = (
        UniqueConstraint("project_id", "round_id"),
        ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
        ),
    )
    round_id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.assignments.id")
    )
    document_id: Mapped[str]
    annotator_id: Mapped[str]
    kind: Mapped[str]
    mode: Mapped[str | None]
    predecessor_round_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.work_rounds.round_id")
    )
    input_manifest_sha256: Mapped[str]
    input_submission_ids: Mapped[list[Any]]
    workspace_key: Mapped[dict[str, Any] | None]
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    created_at: Mapped[datetime]


class WorkRoundStateRow(Base):
    __tablename__ = "work_round_state"
    round_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.work_rounds.round_id"), primary_key=True
    )
    state: Mapped[str]
    revision: Mapped[int] = mapped_column(BigInteger, server_default=text("1"))
    latest_submission_id: Mapped[str | None]


class RoundWorkspaceBindingRow(Base):
    __tablename__ = "round_workspace_bindings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "round_id"],
            [f"{SCHEMA}.work_rounds.project_id", f"{SCHEMA}.work_rounds.round_id"],
        ),
    )
    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workspace_key: Mapped[str] = mapped_column(primary_key=True)
    round_id: Mapped[str]


class RoundSubmissionBindingRow(Base):
    __tablename__ = "round_submission_bindings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "round_id"],
            [f"{SCHEMA}.work_rounds.project_id", f"{SCHEMA}.work_rounds.round_id"],
        ),
        ForeignKeyConstraint(
            ["project_id", "submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
    )
    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    submission_id: Mapped[str] = mapped_column(primary_key=True)
    round_id: Mapped[str]


class RoundInputRow(Base):
    __tablename__ = "round_inputs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "round_id"],
            [f"{SCHEMA}.work_rounds.project_id", f"{SCHEMA}.work_rounds.round_id"],
        ),
        ForeignKeyConstraint(
            ["project_id", "source_submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
    )
    input_id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger)
    round_id: Mapped[str]
    source_submission_id: Mapped[str]
    position: Mapped[int]
    payload: Mapped[dict[str, Any]]


class WorkflowCommandReceiptRow(Base):
    __tablename__ = "workflow_command_receipts"
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id"), primary_key=True
    )
    actor_key: Mapped[str] = mapped_column(primary_key=True)
    request_id: Mapped[str] = mapped_column(primary_key=True)
    request_hash: Mapped[str]
    response: Mapped[dict[str, Any]]
    created_at: Mapped[datetime]


class ReviewObligationResolutionRow(Base):
    __tablename__ = "review_obligation_resolutions"
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id"), primary_key=True
    )
    cause_id: Mapped[str] = mapped_column(primary_key=True)
    payload: Mapped[dict[str, Any]]
    resolved_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    created_at: Mapped[datetime]


class ProblemReportRow(Base):
    __tablename__ = "problem_reports"
    report_id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.assignments.id")
    )
    reporter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    round_id: Mapped[str | None]
    submission_id: Mapped[str | None]
    reason: Mapped[str]
    created_at: Mapped[datetime]


class ProblemReportStateRow(Base):
    __tablename__ = "problem_report_state"
    report_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.problem_reports.report_id"), primary_key=True
    )
    state: Mapped[str]
    revision: Mapped[int] = mapped_column(BigInteger)
    resolution: Mapped[str | None]


class TaskHoldRow(Base):
    __tablename__ = "task_holds"
    hold_id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.assignments.id")
    )
    report_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.problem_reports.report_id")
    )
    reason: Mapped[str]
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    created_at: Mapped[datetime]


class TaskHoldStateRow(Base):
    __tablename__ = "task_hold_state"
    hold_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.task_holds.hold_id"), primary_key=True
    )
    active: Mapped[bool]


class ProblemReportEventRow(Base):
    __tablename__ = "problem_report_events"
    event_id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    report_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.problem_reports.report_id")
    )
    actor_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.users.id"))
    action: Mapped[str]
    details: Mapped[dict[str, Any]]
    created_at: Mapped[datetime]
