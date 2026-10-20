"""Person references with the display-name rule of D1."""

from collections.abc import Iterable

from sqlalchemy import Connection, select

from ontocurator.api.person_views import PersonRefView
from ontocurator.storage.tables import UserRow


def person_refs(
    conn: Connection, user_ids: Iterable[int], *, viewer_id: int, viewer_is_lead: bool
) -> dict[int, PersonRefView]:
    """Display names only for lead viewers or for the viewer's own record."""
    ids = sorted(set(user_ids))
    if not ids:
        return {}
    return {
        row.id: PersonRefView(
            pseudonym=row.pseudonym,
            display_name=row.display_name
            if viewer_is_lead or row.id == viewer_id
            else None,
            is_me=row.id == viewer_id,
        )
        for row in conn.execute(
            select(UserRow.id, UserRow.pseudonym, UserRow.display_name).where(
                UserRow.id.in_(ids)
            )
        )
    }
