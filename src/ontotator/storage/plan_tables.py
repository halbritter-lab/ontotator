"""Work plans per language version, translation acceptances and discards."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

_DOCUMENT_FK = (
    ["project_id", "document_id"],
    [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
)


class WorkPlanRow(Base):
    """The revision of one case's plan; a case without a row has revision 1."""

    __tablename__ = "work_plans"
    __table_args__ = (
        UniqueConstraint("project_id", "case_id"),
        CheckConstraint("revision >= 1", name="revision"),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    case_id: Mapped[str]
    revision: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class WorkPlanFlagsRow(Base):
    """The Review and Annotate flags of one language version."""

    __tablename__ = "work_plan_rows"
    __table_args__ = (
        UniqueConstraint("project_id", "case_id", "language"),
        CheckConstraint(
            "annotation_mode IN ('proposals', 'scratch')", name="annotation_mode"
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    case_id: Mapped[str]
    language: Mapped[str]
    review: Mapped[bool]
    annotate: Mapped[bool]
    # False only for system rows under "Nothing planned" (plan not decided yet).
    decided: Mapped[bool]
    annotation_mode: Mapped[str | None]
    restored_revision: Mapped[int | None] = mapped_column(BigInteger)
    updated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TranslationAcceptanceRow(Base):
    """Why a translation version counts as accepted (append-only)."""

    __tablename__ = "translation_acceptances"
    __table_args__ = (
        ForeignKeyConstraint(*_DOCUMENT_FK),
        CheckConstraint("source IN ('package', 'lead', 'override')", name="source"),
        CheckConstraint(
            "source = 'package' OR reason IS NOT NULL", name="reason_required"
        ),
        Index(
            "ix_translation_acceptances_project_document",
            "project_id",
            "document_id",
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    document_id: Mapped[str]
    source: Mapped[str]
    reason: Mapped[str | None]
    accepted_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    accepted_at: Mapped[datetime] = mapped_column(server_default=func.now())
    upload_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.uploads.id")
    )
    # ``metadata`` is reserved on declarative classes.
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", server_default=text("'{}'::jsonb")
    )


class DiscardedVariantRow(Base):
    """A discarded translation version (append-only; nothing is deleted)."""

    __tablename__ = "discarded_variants"
    __table_args__ = (
        ForeignKeyConstraint(*_DOCUMENT_FK),
        UniqueConstraint("project_id", "document_id"),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    document_id: Mapped[str]
    reason: Mapped[str]
    discarded_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    discarded_at: Mapped[datetime] = mapped_column(server_default=func.now())
