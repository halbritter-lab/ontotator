import sqlite3
import threading
from pathlib import Path
from typing import cast

from ontocurator.domain.errors import DomainError

CURRENT_SCHEMA_VERSION = 4


class Database:
    """SQLite database connection manager for ontocurator-workspace/v4."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._local = threading.local()
        self._connections: list[sqlite3.Connection] = []
        self._lock = threading.Lock()
        self.migration_warnings: list[str] = []
        self._ensure_migrated()

    def run_migrations(self) -> None:
        """Run pending schema migrations."""
        self._ensure_migrated()

    def get_connection(self) -> sqlite3.Connection:
        """Return active connection with foreign keys enabled."""
        if getattr(self._local, "conn", None) is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(
                str(self.path),
                isolation_level=None,  # Autocommit: explicit transactions
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.execute("PRAGMA busy_timeout = 5000;")
            self._local.conn = conn
            with self._lock:
                self._connections.append(conn)
        return cast(sqlite3.Connection, self._local.conn)

    def _ensure_migrated(self) -> None:
        # Pre-DDL version check if file already exists with non-zero size
        if self.path.exists() and self.path.stat().st_size > 0:
            ro_uri = f"file:{self.path.resolve().as_posix()}?mode=ro"
            try:
                ro_conn = sqlite3.connect(ro_uri, uri=True)
            except Exception as exc:
                raise DomainError(
                    "UNSUPPORTED_WORKSPACE_VERSION",
                    f"Unable to read existing database: {exc}",
                ) from exc
            try:
                cursor = ro_conn.cursor()
                cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_metadata';"
                )
                has_meta = cursor.fetchone() is not None
                if has_meta:
                    cursor.execute(
                        "SELECT value FROM workspace_metadata WHERE key = 'format_version';"
                    )
                    row = cursor.fetchone()
                    if row is None or row[0] != "ontocurator-workspace/v4":
                        raise DomainError(
                            "UNSUPPORTED_WORKSPACE_VERSION",
                            f"Database workspace format '{row[0] if row else None}' is not supported. "
                            "Expected 'ontocurator-workspace/v4'.",
                        )
                else:
                    cursor.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations';"
                    )
                    has_mig = cursor.fetchone() is not None
                    if has_mig:
                        cursor.execute("SELECT MAX(version) FROM schema_migrations;")
                        row = cursor.fetchone()
                        ver = row[0] if row else None
                        raise DomainError(
                            "UNSUPPORTED_WORKSPACE_VERSION",
                            f"Legacy database version {ver} is not supported. "
                            "Please create a fresh workspace directory or use an external migration tool.",
                        )
                    else:
                        raise DomainError(
                            "UNSUPPORTED_WORKSPACE_VERSION",
                            "Existing database does not contain valid workspace metadata.",
                        )
            finally:
                ro_conn.close()

            # Format confirmed as v4
            return

        # Fresh database: initialize schema_v4.sql
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_metadata';"
        )
        if cursor.fetchone() is None:
            schema_path = Path(__file__).parent / "schema_v4.sql"
            sql = schema_path.read_text(encoding="utf-8")
            cursor.executescript(sql)

    def close(self) -> None:
        """Close connections after request workers have stopped."""
        with self._lock:
            for conn in self._connections:
                conn.close()
            self._connections.clear()
        self._local = threading.local()
