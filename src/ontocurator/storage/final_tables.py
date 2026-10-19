"""Final result pointers and immutable export/audit records."""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Identity, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ontocurator.storage.tables import SCHEMA, Base


class FinalSelectionRow(Base):
    __tablename__ = "final_selections"
    __table_args__ = (UniqueConstraint("project_id", "case_id", "language"),)
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.projects.id"))
    case_id: Mapped[str]
    language: Mapped[str]
    document_id: Mapped[str]
    submission_id: Mapped[str]
    revision: Mapped[int] = mapped_column(BigInteger)
    actor_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"))
    acknowledged_cause_ids: Mapped[list[Any]]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class FinalSelectionEventRow(Base):
    __tablename__ = "final_selection_events"
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.projects.id"))
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ExportSelectionSnapshotRow(Base):
    __tablename__ = "export_selection_snapshots"
    __table_args__ = (UniqueConstraint("project_id", "requester_id", "request_id"),)
    snapshot_id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.projects.id"))
    requester_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"))
    request_id: Mapped[str]
    sha256: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
