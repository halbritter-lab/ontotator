"""Alembic environment: migrations run on a connection ontocurator provides.

Use ``ontocurator db upgrade`` (``storage.schema.upgrade``), never the plain
``alembic`` command: the upgrade takes the advisory lock and runs as the
schema owner. Migrations are forward-only.
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import Connection

from ontocurator.storage.tables import SCHEMA, Base


def _only_our_schema(name: str | None, type_: str, _parents: object) -> bool:
    return type_ != "schema" or name == SCHEMA


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        version_table_schema=SCHEMA,
        include_schemas=True,
        include_name=_only_our_schema,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Offline migrations are not supported")
connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Run migrations with 'ontocurator db upgrade'")
_run(connection)
