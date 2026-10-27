"""Row locks that keep an HTTP write's user authority current until commit."""

from sqlalchemy import Connection, RowMapping, select

from ontotator.domain.errors import NotAuthenticated
from ontotator.storage.tables import UserRow


def lock_user_authority(
    conn: Connection,
    actor_user_id: int,
    *,
    target_user_id: int | None = None,
) -> RowMapping:
    """Lock actor/target by ID and return the actor as read after any wait.

    The caller owns the transaction and takes any advisory/project locks first.
    Actor SHARE prevents role/activation changes until the write commits; target
    NO KEY UPDATE serializes account changes without blocking audit actor FKs.
    A self-target takes NO KEY UPDATE once, avoiding a SHARE-to-write upgrade.
    Sorting both IDs prevents reciprocal edits from taking opposite row orders.
    The caller evaluates its admin/project policy using the returned fresh row.
    """
    user_ids = {actor_user_id}
    if target_user_id is not None:
        user_ids.add(target_user_id)
    actor: RowMapping | None = None
    for user_id in sorted(user_ids):
        statement = select(UserRow).where(UserRow.id == user_id)
        if user_id == target_user_id:
            statement = statement.with_for_update(key_share=True)
        else:
            statement = statement.with_for_update(read=True)
        row = conn.execute(statement).mappings().one_or_none()
        if user_id == actor_user_id:
            if row is None:
                raise NotAuthenticated()
            actor = row
    assert actor is not None
    return actor
