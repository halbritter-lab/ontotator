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


@dataclass
class _Ambient:
    """The open transaction of a context, and whether a joined scope failed."""

    conn: Connection
    rollback_only: bool = False


class Database:
    """The engine, the file store and the transaction of the current context.

    ``transaction()`` joins a transaction that is already open in this context
    (thread or task). A repository call made inside an editing operation thus
    commits or rolls back together with it (T2 index decision D-b). An
    exception leaving a joined scope makes the whole transaction rollback-only:
    the writes of the failed call cannot be told apart from the others, so the
    outermost scope rolls back and raises ``TransactionRollbackOnly`` even if
    the caller caught the exception.
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
        """The open transaction of this context, or a new one committed at the end."""
        current = self._current.get()
        if current is not None:
            try:
                yield current.conn
            except BaseException:
                current.rollback_only = True
                raise
            return
        with self.engine.begin() as conn:
            ambient = _Ambient(conn)
            token = self._current.set(ambient)
            try:
                yield conn
                if ambient.rollback_only:
                    raise TransactionRollbackOnly(
                        "A nested database operation failed inside this "
                        "transaction; it was rolled back as a whole"
                    )
            finally:
                self._current.reset(token)

    def close(self) -> None:
        """Close all pooled connections (after the server has stopped)."""
        self.engine.dispose()
