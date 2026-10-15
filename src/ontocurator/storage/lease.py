"""The runtime lease: running servers hold it, the offline recovery needs it alone.

Every server process holds a shared session-level advisory lock on a dedicated
connection for as long as it runs. A tool that must not run next to a server
(``ontocurator admin recover-admin``) takes the same lock exclusively without
waiting, which succeeds only while no server holds it.

The lock lives as long as the database session. A server therefore checks its
lease connection regularly (``check``) and takes the lease again on a fresh
connection when the session was lost (a database restart, an idle timeout, a
dropped network path). A session-level lock needs a real session: no
transaction-mode pooler (PgBouncer) may sit between the app and PostgreSQL.

A connection that cannot release its lock is invalidated, never returned to
the pool, since a pooled session would keep the lock.
"""

from __future__ import annotations

import contextlib
import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Connection, Engine, text

RUNTIME_LEASE = 7_011_337_422
CHECK_INTERVAL = 60.0  # seconds between two checks of a server's lease

logger = logging.getLogger(__name__)


def _discard(conn: Connection) -> None:
    """Close ``conn`` without returning its session (and locks) to the pool."""
    with contextlib.suppress(Exception):
        conn.invalidate()
    with contextlib.suppress(Exception):
        conn.close()


def _end(conn: Connection, statement: str) -> None:
    """Run the unlock ``statement`` and close ``conn``; drop it if that fails."""
    try:
        conn.execute(text(statement), {"k": RUNTIME_LEASE})
    except BaseException:
        _discard(conn)  # closing the session releases its locks
        raise
    conn.close()


class RuntimeLease:
    """The shared lease of one server process, on a connection of its own."""

    def __init__(
        self, engine: Engine, *, check_interval: float = CHECK_INTERVAL
    ) -> None:
        self.engine = engine
        self.check_interval = check_interval
        self._conn: Connection | None = None
        # Set from ``acquire`` until ``release``: the lease must be held, and
        # every check takes it again until it is.
        self._required = False
        self._lock = threading.Lock()

    @property
    def held(self) -> bool:
        """Whether this process holds the lease."""
        return self._conn is not None

    def acquire(self) -> None:
        """Take the shared lease; waits while a recovery holds it exclusively."""
        with self._lock:
            self._required = True
            if self._conn is None:
                self._conn = self._lock_on_new_connection()

    def check(self) -> bool:
        """Whether the lease connection is alive; if not, take the lease again.

        Returns True when nothing had to be done (or the lease is not
        required), False after the lease was taken again on a fresh
        connection. While the lease is required but not held, a check never
        returns True.

        Raises:
            SQLAlchemyError: the lease cannot be taken again (database down);
                the next check tries again.
        """
        with self._lock:
            if not self._required:
                return True
            conn = self._conn
            if conn is not None:
                try:
                    conn.execute(text("SELECT 1"))
                    return True
                except Exception:
                    logger.error(
                        "The runtime lease was lost with its database session; "
                        "taking it again."
                    )
                    _discard(conn)
                    self._conn = None
            self._conn = self._lock_on_new_connection()
            return False

    def release(self) -> None:
        """Give the lease back and close its connection; safe if never acquired."""
        with self._lock:
            self._required = False
            conn, self._conn = self._conn, None
            if conn is not None:
                _end(conn, "SELECT pg_advisory_unlock_shared(:k)")

    def _lock_on_new_connection(self) -> Connection:
        conn = self.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        params = {"k": RUNTIME_LEASE}
        try:
            if not conn.execute(
                text("SELECT pg_try_advisory_lock_shared(:k)"), params
            ).scalar():
                logger.warning("Waiting for an offline admin recovery to finish...")
                conn.execute(text("SELECT pg_advisory_lock_shared(:k)"), params)
        except BaseException:
            _discard(conn)
            raise
        return conn


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
        _discard(conn)
        raise
    if not acquired:
        conn.close()
        yield False
        return
    try:
        yield True
    finally:
        _end(conn, "SELECT pg_advisory_unlock(:k)")
