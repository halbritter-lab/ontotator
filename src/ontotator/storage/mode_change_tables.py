"""Annotation-mode changes after submissions and the submissions they discard.

Submissions are append-only. Changing a text's annotation mode after
submitted work marks that work ``discarded_submissions`` instead of deleting
it; restoring the change removes the marks again. Readers of submission rows
skip marked ones through ``ontotator.storage.live_submissions``.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

_MODES = "('proposals', 'scratch')"


class AnnotationModeChangeRow(Base):
    """One lead change of a text's annotation mode that discarded work.

    ``revoked_assignment_ids`` are the annotate and review assignments the
    change revoked (a restore reinstates them); ``previous_override`` is the
    text's plan override before the change (None = the project setting).
    """

    __tablename__ = "annotation_mode_changes"
    __table_args__ = (
        CheckConstraint(f"from_mode IN {_MODES}", name="from_mode"),
        CheckConstraint(f"to_mode IN {_MODES}", name="to_mode"),
        CheckConstraint(
            f"previous_override IS NULL OR previous_override IN {_MODES}",
            name="previous_override",
        ),
        Index(
            "ix_annotation_mode_changes_project_id_case_id_language",
            "project_id",
            "case_id",
            "language",
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    case_id: Mapped[str]
    language: Mapped[str]
    from_mode: Mapped[str]
    to_mode: Mapped[str]
    previous_override: Mapped[str | None]
    reason: Mapped[str]
    revoked_assignment_ids: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )
    changed_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    changed_at: Mapped[datetime] = mapped_column(server_default=func.now())
    restored_at: Mapped[datetime | None]
    restored_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )


class DiscardedSubmissionRow(Base):
    """The discard mark of one submission: who, when, why and by which change.

    The submission row itself is never changed; deleting the mark (restore)
    makes it count again.
    """

    __tablename__ = "discarded_submissions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
        Index("ix_discarded_submissions_change_id", "change_id"),
    )
    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    submission_id: Mapped[str] = mapped_column(primary_key=True)
    change_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.annotation_mode_changes.id")
    )
    reason: Mapped[str]
    discarded_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    discarded_at: Mapped[datetime] = mapped_column(server_default=func.now())
