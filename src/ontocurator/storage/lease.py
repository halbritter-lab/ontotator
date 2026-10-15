"""The runtime lease: running servers hold it, the offline recovery needs it alone.

Every server process holds a shared session-level advisory lock on a dedicated
connection for as long as it runs. A tool that must not run next to a server
(``ontocurator admin recover-admin``) takes the same lock exclusively without
waiting, which succeeds only while no server holds it.

A connection that cannot release its lock is invalidated, never returned to
the pool, since a pooled session would keep the lock.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Connection, Engine, text

RUNTIME_LEASE = 7_011_337_422


def _end(conn: Connection, statement: str) -> None:
    """Run the unlock ``statement`` and close ``conn``; drop it if that fails."""
    try:
        conn.execute(text(statement), {"k": RUNTIME_LEASE})
    except BaseException:
        conn.invalidate()  # closing the session releases its locks
        raise
    finally:
        conn.close()


class RuntimeLease:
    """The shared lease of one server process, on a connection of its own."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self._conn: Connection | None = None
        self._lock = threading.Lock()

    @property
    def held(self) -> bool:
        """Whether this process holds the lease."""
        return self._conn is not None

    def acquire(self) -> None:
        """Take the shared lease; waits while a recovery holds it exclusively."""
        with self._lock:
            if self._conn is not None:
                return
            conn = self.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
            try:
                conn.execute(
                    text("SELECT pg_advisory_lock_shared(:k)"), {"k": RUNTIME_LEASE}
                )
            except BaseException:
                conn.invalidate()
                conn.close()
                raise
            self._conn = conn

    def release(self) -> None:
        """Give the lease back and close its connection; safe if never acquired."""
        with self._lock:
            conn, self._conn = self._conn, None
            if conn is not None:
                _end(conn, "SELECT pg_advisory_unlock_shared(:k)")


@contextmanager
def exclusive_lease(engine: Engine) -> Iterator[bool]:
    """Yield True if no server holds the lease; then it is held until the exit."""
    conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    try:
        acquired = bool(
            conn.execute(
                text("SELECT pg_try_advisory_lock(:k)"), {"k": RUNTIME_LEASE}
            ).scalar()
        )
    except BaseException:
        conn.invalidate()
        conn.close()
        raise
    if not acquired:
        conn.close()
        yield False
        return
    try:
        yield True
    finally:
        _end(conn, "SELECT pg_advisory_unlock(:k)")
