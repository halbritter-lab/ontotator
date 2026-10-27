"""Documents visits per lead and project: the baseline of NEW (spec VD6).

A visit is a sequence of Documents openings with gaps under ``GAP``. Opening
Documents after a longer gap moves the baseline to the previous opening, so
NEW compares against the start of the previous visit.
"""

from datetime import datetime, timedelta

from sqlalchemy import Connection, Interval, case, literal, select
from sqlalchemy.dialects.postgresql import insert

from ontotator.storage.overview_tables import DocumentsVisitRow

GAP = timedelta(minutes=30)


def record_visit(
    conn: Connection, user_id: int, project_id: int, now: datetime
) -> datetime:
    """Record an opening of Documents at ``now``; returns the baseline.

    One upsert, so two concurrent first visits never race: the first visit
    inserts ``baseline_at = last_seen_at = now`` (nothing is NEW); a return
    after ``GAP`` or more moves the baseline to the previous opening; every
    opening sets ``last_seen_at``.
    """
    values = insert(DocumentsVisitRow).values(
        user_id=user_id, project_id=project_id, baseline_at=now, last_seen_at=now
    )
    table = DocumentsVisitRow.__table__.c
    excluded = values.excluded
    stmt = values.on_conflict_do_update(
        index_elements=[table.user_id, table.project_id],
        set_={
            "baseline_at": case(
                (
                    excluded.last_seen_at - table.last_seen_at
                    >= literal(GAP, Interval()),
                    table.last_seen_at,
                ),
                else_=table.baseline_at,
            ),
            "last_seen_at": excluded.last_seen_at,
        },
    ).returning(table.baseline_at)
    return conn.execute(stmt).scalar_one()  # type: ignore[no-any-return]


def baseline(conn: Connection, user_id: int, project_id: int) -> datetime | None:
    """The stored baseline; ``None`` before the first visit."""
    return conn.execute(
        select(DocumentsVisitRow.baseline_at).where(
            DocumentsVisitRow.user_id == user_id,
            DocumentsVisitRow.project_id == project_id,
        )
    ).scalar_one_or_none()
