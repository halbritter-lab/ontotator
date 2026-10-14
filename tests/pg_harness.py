"""PostgreSQL for the test suite (T2 P8): one server, one database per test.

The server is ``ONTOCURATOR_TEST_PG_URL`` (a superuser URL of a throwaway
server) or, by default, a testcontainer started on first use. The schema is
migrated once into a template database as the owner role. Every test database
is a copy of that template, used through the application role, so grants and
append-only triggers are exercised exactly as in production.
"""

from __future__ import annotations

import atexit
import itertools
import os
import threading
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL, make_url

from ontocurator.storage.database import Database
from ontocurator.storage.schema import upgrade
from ontocurator.storage.tables import APP_ROLE, OWNER_ROLE, SCHEMA

IMAGE = "postgres:16.15-alpine3.24"
PASSWORD = "test-only-password"
TEMPLATE = "ontocurator_template"

_lock = threading.RLock()
_server: URL | None = None
_admin: Engine | None = None
_container: Any = None
_numbers = itertools.count()
_by_path: dict[str, str] = {}
_owner_engines: list[Engine] = []


def _start_server() -> URL:
    global _container
    explicit = os.environ.get("ONTOCURATOR_TEST_PG_URL")
    if explicit:
        return make_url(explicit).set(drivername="postgresql+psycopg")
    try:
        try:
            from testcontainers.community.postgres import PostgresContainer
        except ImportError:  # testcontainers before the community package
            from testcontainers.postgres import PostgresContainer

        container = PostgresContainer(
            IMAGE,
            username="postgres",
            password=PASSWORD,
            dbname="postgres",
            driver="psycopg",
        )
        container.with_command(
            "postgres -c max_connections=500 -c fsync=off"
            " -c synchronous_commit=off -c full_page_writes=off"
        )
        e2e_run = os.environ.get("ONTOCURATOR_E2E_RUN")
        if e2e_run:
            # The Playwright run removes its own container by this label
            # (frontend/playwright.teardown.ts); Ryuk stays the fallback.
            container.with_kwargs(labels={"ontocurator.e2e-run": e2e_run})
        container.start()
    except Exception as exc:  # Docker not running, image not pullable, ...
        raise RuntimeError(
            "The tests need PostgreSQL: start Docker Desktop, or set "
            "ONTOCURATOR_TEST_PG_URL to a throwaway server's superuser URL. "
            f"({exc})"
        ) from exc
    atexit.register(container.stop)
    _container = container
    return make_url(container.get_connection_url())


def _prepare_template(server: URL, admin: Engine) -> None:
    with admin.connect() as conn:
        for role in (OWNER_ROLE, APP_ROLE):
            if not conn.execute(
                text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}
            ).scalar():
                conn.execute(text(f"CREATE ROLE {role} LOGIN"))
            conn.execute(text(f"ALTER ROLE {role} LOGIN PASSWORD '{PASSWORD}'"))
        conn.execute(text(f"DROP DATABASE IF EXISTS {TEMPLATE} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {TEMPLATE} OWNER {OWNER_ROLE}"))
    template = create_engine(
        server.set(database=TEMPLATE), isolation_level="AUTOCOMMIT"
    )
    with template.connect() as conn:
        # The same bootstrap as docker/postgres-init.sh (T2e).
        conn.execute(text("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
        conn.execute(text(f"CREATE SCHEMA {SCHEMA} AUTHORIZATION {OWNER_ROLE}"))
        conn.execute(text(f"GRANT USAGE ON SCHEMA {SCHEMA} TO {APP_ROLE}"))
    template.dispose()
    upgrade(server.set(username=OWNER_ROLE, password=PASSWORD, database=TEMPLATE))


def server() -> tuple[URL, Engine]:
    """The superuser URL and an autocommit engine; started and prepared once."""
    global _server, _admin
    with _lock:
        if _server is None or _admin is None:
            url = _start_server()
            admin = create_engine(
                url.set(database="postgres"), isolation_level="AUTOCOMMIT"
            )
            _prepare_template(url, admin)
            _server, _admin = url, admin
        return _server, _admin


def database_url_for(path: Path | str) -> str:
    """The application-role URL of the database that stands in for ``path``.

    Within one test the same path gives the same database (a reopened
    workspace); a new path gives a fresh copy of the migrated template.
    """
    url, admin = server()
    key = str(Path(path).absolute())
    with _lock:
        name = _by_path.get(key)
        if name is None:
            name = f"ontocurator_test_{os.getpid()}_{next(_numbers)}"
            with admin.connect() as conn:
                conn.execute(
                    text(
                        f"CREATE DATABASE {name} TEMPLATE {TEMPLATE} OWNER {OWNER_ROLE}"
                    )
                )
            _by_path[key] = name
    return url.set(
        username=APP_ROLE, password=PASSWORD, database=name
    ).render_as_string(hide_password=False)


def database_for(path: Path | str, *, data_dir: Path | None = None) -> Database:
    """A ``Database`` on the test database for ``path`` (see ``database_url_for``)."""
    return Database(
        database_url_for(path),
        data_dir=data_dir or Path(path).parent / "data",
        pool_size=2,
        max_overflow=8,
    )


def owner_engine(db: Database) -> Engine:
    """The same database as the schema owner, for tests that tamper with history."""
    engine = create_engine(db.url.set(username=OWNER_ROLE, password=PASSWORD))
    with _lock:
        _owner_engines.append(engine)
    return engine


def reset() -> None:
    """Drop the databases of the finished test (call after closing its engines)."""
    with _lock:
        engines, names = list(_owner_engines), list(_by_path.values())
        _owner_engines.clear()
        _by_path.clear()
    for engine in engines:
        engine.dispose()
    if names and _admin is not None:
        with _admin.connect() as conn:
            for name in names:
                conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))


def unmigrated_database_url(path: Path | str) -> str:
    """Owner URL of a new database with the bootstrap but without the schema."""
    url, admin = server()
    name = f"ontocurator_empty_{os.getpid()}_{next(_numbers)}"
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name} OWNER {OWNER_ROLE}"))
    engine = create_engine(url.set(database=name), isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(text("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
        conn.execute(text(f"CREATE SCHEMA {SCHEMA} AUTHORIZATION {OWNER_ROLE}"))
        conn.execute(text(f"GRANT USAGE ON SCHEMA {SCHEMA} TO {APP_ROLE}"))
    engine.dispose()
    with _lock:
        _by_path[str(Path(path).absolute())] = name
    return url.set(
        username=OWNER_ROLE, password=PASSWORD, database=name
    ).render_as_string(hide_password=False)


def insert_proposal(repo: Any, package_id: str, snapshot: Any) -> None:
    """Add an annotation proposal (and its evidence) to a project, as an import does."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from ontocurator.storage.tables import ProposalAnnotationRow

    with repo.db.transaction() as conn:
        project_id = conn.execute(
            text(f"SELECT id FROM {SCHEMA}.projects WHERE project_key = :k"),
            {"k": package_id},
        ).scalar_one()
        repo._insert_snapshots(conn, project_id, [snapshot], snapshot.evidence)
        conn.execute(
            pg_insert(ProposalAnnotationRow)
            .values(
                project_id=project_id,
                annotation_id=snapshot.annotation.annotation_id,
                version=snapshot.version,
            )
            .on_conflict_do_nothing()
        )


def count_rows(repo: Any, table: str) -> int:
    """Rows of a schema table, for tests that check nothing was written."""
    with repo.db.transaction() as conn:
        return int(
            conn.execute(text(f"SELECT count(*) FROM {SCHEMA}.{table}")).scalar_one()
        )


def column_values(repo: Any, table: str, column: str) -> list[Any]:
    """Every value of one column of a schema table."""
    with repo.db.transaction() as conn:
        return list(
            conn.execute(text(f"SELECT {column} FROM {SCHEMA}.{table}")).scalars()
        )


def tamper(db: Database, table: str, statement: str, **params: object) -> None:
    """Change append-only history as the owner, bypassing its triggers (tests only)."""
    with owner_engine(db).begin() as conn:
        conn.execute(text(f"ALTER TABLE {SCHEMA}.{table} DISABLE TRIGGER USER"))
        conn.execute(text(statement), params)
        conn.execute(text(f"ALTER TABLE {SCHEMA}.{table} ENABLE TRIGGER USER"))
