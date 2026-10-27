"""Versioned project guidelines (spec "Data model and migration").

``guideline_versions`` and ``guideline_withdrawals`` are append-only. The text
of a version lives in ``guideline_contents`` so a withdrawal can delete it;
``guideline_reads`` records per user when a version was notified or opened.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

_VERSION_FK = (
    ["project_id", "version"],
    [
        f"{SCHEMA}.guideline_versions.project_id",
        f"{SCHEMA}.guideline_versions.version",
    ],
)


class GuidelineVersionRow(Base):
    """One uploaded version: number, kind, size and hash; never changed."""

    __tablename__ = "guideline_versions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version"),
        CheckConstraint("kind IN ('markdown', 'text')", name="kind"),
        CheckConstraint("size_bytes <= 262144", name="size_bytes"),
    )
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str]
    body_sha256: Mapped[str]
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    created_by_label: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class GuidelineContentRow(Base):
    """The text, file name and change note of a version until it is withdrawn."""

    __tablename__ = "guideline_contents"
    __table_args__ = (
        ForeignKeyConstraint(*_VERSION_FK),
        CheckConstraint("char_length(change_note) <= 280", name="change_note"),
    )
    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str]
    body: Mapped[str]
    change_note: Mapped[str | None]


class GuidelineWithdrawalRow(Base):
    """The withdrawal of a version (G25); a version is withdrawn only once."""

    __tablename__ = "guideline_withdrawals"
    __table_args__ = (
        ForeignKeyConstraint(*_VERSION_FK),
        CheckConstraint("char_length(reason) <= 280", name="reason"),
    )
    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    reason: Mapped[str | None]
    withdrawn_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    withdrawn_by_label: Mapped[str]
    withdrawn_at: Mapped[datetime] = mapped_column(server_default=func.now())


class GuidelineReadRow(Base):
    """When a user was first notified of or first opened a version (G16)."""

    __tablename__ = "guideline_reads"
    __table_args__ = (ForeignKeyConstraint(*_VERSION_FK),)
    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id"), primary_key=True
    )
    notified_at: Mapped[datetime | None]
    opened_at: Mapped[datetime | None]
