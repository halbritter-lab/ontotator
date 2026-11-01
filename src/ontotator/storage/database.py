"""PostgreSQL access: one engine per process and ambient transactions."""

from __future__ import annotations

import hashlib
import itertools
import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import Connection, Engine, create_engine, func, select
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from ontotator.storage.blobs import BlobStore

logger = logging.getLogger(__name__)
_numbers = itertools.count()

CONNECT_TIMEOUT_SECONDS = 10
"""Seconds a new connection may take before the driver gives up.

Without it, a host that drops packets keeps a CLI command waiting for the
operating system's TCP timeout (minutes) instead of failing fast.
"""

POOL_TIMEOUT_SECONDS = 10
"""Seconds a request may wait for a free pooled connection."""

BUSY_SQLSTATES = frozenset({"55P03", "57014"})
"""lock_not_available (lock limit) and query_canceled (statement limit)."""


def busy_cause(exc: BaseException | None) -> str | None:
    """The SQLSTATE of the limit behind ``exc``, ``"pool"``, or None for anything else.

    Follows ``__cause__``, as a caught failure of a joined scope surfaces as
    ``TransactionRollbackOnly``.
    """
    while exc is not None:
        if isinstance(exc, PoolTimeoutError):
            return "pool"
        if isinstance(exc, DBAPIError):
            sqlstate = getattr(exc.orig, "sqlstate", None)
            if sqlstate in BUSY_SQLSTATES:
                return str(sqlstate)
        exc = exc.__cause__
    return None


def psycopg_url(url: str | URL) -> URL:
    """``url`` parsed, with a plain ``postgresql://`` mapped to the psycopg driver."""
    parsed = make_url(url) if isinstance(url, str) else url
    if parsed.drivername == "postgresql":
        parsed = parsed.set(drivername="postgresql+psycopg")
    return parsed


def connect_args(url: URL) -> dict[str, object]:
    """The driver arguments for ``url``: the default connect timeout, unless set.

    A ``connect_timeout`` in the URL's query wins over the default.
    """
    if "connect_timeout" in url.query:
        return {}
    return {"connect_timeout": CONNECT_TIMEOUT_SECONDS}


def advisory_lock_id(*parts: str) -> int:
    """A signed 64-bit advisory lock id derived from a name."""
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


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
    after_commit: list[Callable[[], None]] = field(default_factory=list)


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
        lock_timeout_ms: int = 0,
        statement_timeout_ms: int = 0,
    ) -> None:
        """Open the engine; the limits are per lock and per statement, 0 is none."""
        parsed = psycopg_url(url)
        self.url = parsed
        args = connect_args(parsed)
        if lock_timeout_ms or statement_timeout_ms:
            args["options"] = (
                f"-c lock_timeout={lock_timeout_ms} "
                f"-c statement_timeout={statement_timeout_ms}"
            )
        self.engine: Engine = create_engine(
            parsed,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_timeout=POOL_TIMEOUT_SECONDS,
            pool_pre_ping=True,
            connect_args=args,
            # Never repeat statement parameters (password hashes, codes) in
            # errors and logs.
            hide_parameters=True,
        )
        self.data_dir = Path(data_dir)
        self.blobs = BlobStore(self.data_dir / "blobs")
        self._current: ContextVar[_Ambient | None] = ContextVar(
            f"ontotator-transaction-{next(_numbers)}", default=None
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
        with (
            self.engine.begin() as conn,
            self._ambient(conn, snapshot=False) as ambient,
        ):
            yield conn
        # Committed: run what waited for it (file removal), outside any transaction.
        for callback in ambient.after_commit:
            try:
                callback()
            except Exception:
                logger.warning("A post-commit step failed.", exc_info=True)

    def after_commit(self, callback: Callable[[], None]) -> None:
        """Run ``callback`` once the open transaction has committed; at once
        when none is open. A rolled-back transaction drops it. A failure is
        logged, never raised: the commit it waited for stands."""
        current = self._current.get()
        if current is None:
            callback()
            return
        current.after_commit.append(callback)

    def in_transaction(self) -> bool:
        """Whether this context has an open transaction or snapshot."""
        return self._current.get() is not None

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

    @contextmanager
    def savepoint(self, conn: Connection) -> Iterator[None]:
        """A SAVEPOINT whose failure leaves the surrounding transaction usable.

        A failure inside a joined ``transaction()`` scope marks the ambient
        transaction rollback-only. Within this block the savepoint undoes that
        scope's writes, so the mark is taken back:

        - an exception rolls the savepoint back, restores the mark and is
          re-raised;
        - a normal exit after a joined scope failed (its exception was caught
          inside the block) also rolls the savepoint back, restores the mark
          and raises ``RuntimeError`` chained to that failure;
        - otherwise the savepoint is released.
        """
        ambient = self._current.get()
        before = None if ambient is None else ambient.failure
        nested = conn.begin_nested()
        try:
            yield
        except BaseException:
            if nested.is_active:
                nested.rollback()
            if ambient is not None:
                ambient.failure = before
            raise
        if ambient is not None and ambient.failure is not before:
            failure = ambient.failure
            if nested.is_active:
                nested.rollback()
            ambient.failure = before
            raise RuntimeError("A joined scope inside the savepoint failed") from (
                failure
            )
        nested.commit()

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
    def _ambient(self, conn: Connection, *, snapshot: bool) -> Iterator[_Ambient]:
        """Make ``conn`` the open transaction of this context for the outermost scope."""
        ambient = _Ambient(conn, snapshot=snapshot)
        token = self._current.set(ambient)
        try:
            yield ambient
            if ambient.failure is not None:
                raise TransactionRollbackOnly(
                    "A nested database operation failed inside this "
                    "transaction; it was rolled back as a whole"
                ) from ambient.failure
        finally:
            self._current.reset(token)

    @staticmethod
    def lock_blob(conn: Connection, sha256: str) -> None:
        """Serialize writing, referencing and deleting one blob until ``conn`` ends."""
        conn.execute(
            select(func.pg_advisory_xact_lock(advisory_lock_id("blob", sha256)))
        )

    def put_blob(self, conn: Connection, data: bytes) -> str:
        """Store ``data`` under the blob lock of ``conn``'s transaction.

        Record its ``stored_files`` row and reference in that same transaction;
        then a discard cannot delete the file before the reference exists.
        """
        digest = hashlib.sha256(data).hexdigest()
        self.lock_blob(conn, digest)
        self.blobs.put(data)
        return digest

    def close(self) -> None:
        """Close all pooled connections (after the server has stopped)."""
        self.engine.dispose()
