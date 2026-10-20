"""Guideline readers for repository and export code.

They live in storage because ``storage/repository.py`` must not import the
guideline service in ``application`` (that import would be circular).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from sqlalchemy import Connection, func, select

from ontocurator.domain.guidelines import GuidelineKind
from ontocurator.storage.guideline_tables import (
    GuidelineVersionRow,
    GuidelineWithdrawalRow,
)


@dataclass(frozen=True)
class GuidelineFact:
    kind: GuidelineKind
    sha256: str
    withdrawn: bool


def current_guideline_version(conn: Connection, project_id: int) -> int | None:
    """The version in force: the highest one unless it is withdrawn (G25)."""
    latest = conn.execute(
        select(func.max(GuidelineVersionRow.version)).where(
            GuidelineVersionRow.project_id == project_id
        )
    ).scalar_one()
    if latest is None:
        return None
    withdrawn = conn.execute(
        select(GuidelineWithdrawalRow.version).where(
            GuidelineWithdrawalRow.project_id == project_id,
            GuidelineWithdrawalRow.version == latest,
        )
    ).first()
    return None if withdrawn is not None else int(latest)


def guideline_facts(conn: Connection, project_id: int) -> dict[int, GuidelineFact]:
    """Kind, hash and withdrawn flag of every version of the project."""
    withdrawn = (
        select(GuidelineWithdrawalRow.version)
        .where(
            GuidelineWithdrawalRow.project_id == GuidelineVersionRow.project_id,
            GuidelineWithdrawalRow.version == GuidelineVersionRow.version,
        )
        .exists()
    )
    rows = conn.execute(
        select(
            GuidelineVersionRow.version,
            GuidelineVersionRow.kind,
            GuidelineVersionRow.body_sha256,
            withdrawn.label("withdrawn"),
        ).where(GuidelineVersionRow.project_id == project_id)
    )
    return {
        row.version: GuidelineFact(
            kind=cast(GuidelineKind, row.kind),
            sha256=row.body_sha256,
            withdrawn=bool(row.withdrawn),
        )
        for row in rows
    }
