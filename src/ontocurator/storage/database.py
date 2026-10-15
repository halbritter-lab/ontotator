"""PostgreSQL access: one engine per process and ambient transactions."""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import Connection, Engine, create_engine
from sqlalchemy.engine import URL, make_url

from ontocurator.storage.blobs import BlobStore

_numbers = itertools.count()


class TransactionRollbackOnly(RuntimeError):
    """A joined scope failed, so the transaction it joined cannot commit."""


class SnapshotUnavailable(RuntimeError):
    """A snapshot was requested inside a transaction that does not provide one."""


@dataclass
class _Ambient:
    """The open transaction of a context, and the first failure of a joined scope.

    ``snapshot`` is true for a read-only REPEATABLE READ transaction: all its
    statements see the committed state of its first one.
    """

    conn: Connection
    snapshot: bool = False
    failure: BaseException | None = None


class Database:
    """The engine, the file store and the transaction of the current context.

    ``transaction()`` joins a transaction that is already open in this context
    (thread or task). A repository call made inside an editing operation thus
    commits or rolls back together with it (T2 index decision D-b). An
    exception leaving a joined scope makes the whole transaction rollback-only:
    the writes of the failed call cannot be told apart from the others, so the
    outermost scope rolls back and raises ``TransactionRollbackOnly``, chained
    to the first such exception, even if the caller caught it. A snapshot has
    no writes, so a caught Python-level failure inside it does not doom it; a
    database error still aborts it, and later statements in it fail.

    ``snapshot()`` is a read-only REPEATABLE READ transaction for reads that
    must form one consistent view, such as an export.
    """

    def __init__(
        self,
        url: str | URL,
        *,
        data_dir: Path,
        pool_size: int = 5,
        max_overflow: int = 10,
    ) -> None:
        parsed = make_url(url) if isinstance(url, str) else url
        if parsed.drivername == "postgresql":
            parsed = parsed.set(drivername="postgresql+psycopg")
        self.url = parsed
        self.engine: Engine = create_engine(
            parsed,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_pre_ping=True,
        )
        self.data_dir = Path(data_dir)
        self.blobs = BlobStore(self.data_dir / "blobs")
        self._current: ContextVar[_Ambient | None] = ContextVar(
            f"ontocurator-transaction-{next(_numbers)}", default=None
        )

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """The open transaction of this context, or a new one committed at the end.

        Inside an open ``snapshot()`` this joins the snapshot, which is
        read-only: a write fails at the database.

        Raises:
            TransactionRollbackOnly: when the scope that opened the transaction
                ends after an exception left a joined scope, even one the
                caller caught; the transaction is rolled back instead.
        """
        current = self._current.get()
        if current is not None:
            with self._joined(current):
                yield current.conn
            return
        with self.engine.begin() as conn, self._ambient(conn, snapshot=False):
            yield conn

    @contextmanager
    def snapshot(self) -> Iterator[Connection]:
        """A read-only transaction whose statements all see one committed state.

        Joins the open transaction of this context only if that is a snapshot
        too. A READ COMMITTED transaction cannot become one: its isolation is
        fixed once it ran a statement, and the statements it ran saw other
        states. Opening a snapshot inside one is a programming error.
        """
        current = self._current.get()
        if current is not None:
            if not current.snapshot:
                raise SnapshotUnavailable(
                    "A REPEATABLE READ snapshot cannot join the open READ "
                    "COMMITTED transaction; open the snapshot first"
                )
            with self._joined(current):
                yield current.conn
            return
        with self.engine.connect() as conn:
            # Both options are reset when the connection returns to the pool.
            conn.execution_options(
                isolation_level="REPEATABLE READ", postgresql_readonly=True
            )
            with conn.begin(), self._ambient(conn, snapshot=True):
                yield conn

    @staticmethod
    @contextmanager
    def _joined(current: _Ambient) -> Iterator[None]:
        """A scope that joined ``current``: its failure dooms a writing transaction.

        A snapshot is read-only, so a failure inside it leaves nothing to undo.
        A database error still aborts the snapshot on the server.
        """
        try:
            yield
        except BaseException as exc:
            if not current.snapshot and current.failure is None:
                current.failure = exc
            raise

    @contextmanager
    def _ambient(self, conn: Connection, *, snapshot: bool) -> Iterator[None]:
        """Make ``conn`` the open transaction of this context for the outermost scope."""
        ambient = _Ambient(conn, snapshot=snapshot)
        token = self._current.set(ambient)
        try:
            yield
            if ambient.failure is not None:
                raise TransactionRollbackOnly(
                    "A nested database operation failed inside this "
                    "transaction; it was rolled back as a whole"
                ) from ambient.failure
        finally:
            self._current.reset(token)

    def close(self) -> None:
        """Close all pooled connections (after the server has stopped)."""
        self.engine.dispose()
