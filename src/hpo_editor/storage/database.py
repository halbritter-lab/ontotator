import sqlite3
import threading
import warnings
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from hpo_editor.domain.errors import DomainError

CURRENT_SCHEMA_VERSION = 2


class Database:
    """SQLite database connection and migration manager."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._local = threading.local()
        self._connections: list[sqlite3.Connection] = []
        self._lock = threading.Lock()
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
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='schema_migrations';"
        )
        table_exists = cursor.fetchone() is not None

        current_ver = 0
        if table_exists:
            cursor.execute("SELECT MAX(version) FROM schema_migrations;")
            row = cursor.fetchone()
            if row and row[0] is not None:
                current_ver = int(row[0])

        if current_ver > CURRENT_SCHEMA_VERSION:
            raise DomainError(
                "UNKNOWN_DB_VERSION",
                f"Database version {current_ver} is newer than supported "
                f"version {CURRENT_SCHEMA_VERSION}",
            )

        if current_ver < 1:
            migration_path = Path(__file__).parent / "migrations" / "001_initial.sql"
            sql = migration_path.read_text(encoding="utf-8")
            now = datetime.now(UTC).isoformat()
            full_script = (
                f"{sql}\nINSERT INTO schema_migrations (version, applied_at) "
                f"VALUES (1, '{now}');"
            )
            cursor.executescript(full_script)

        if current_ver < 2:
            sql = (
                Path(__file__).parent / "migrations" / "002_membership.sql"
            ).read_text(encoding="utf-8")
            conn.executescript("BEGIN IMMEDIATE;\n" + sql)
            try:
                import json

                for row in conn.execute(
                    "SELECT b.local_package_id, s.submission_id, s.payload_json FROM "
                    "imported_submission_bindings b JOIN submissions s "
                    "USING(submission_id)"
                ).fetchall():
                    key = json.loads(row[2])["origin_key"]
                    key["package_id"] = row[0]
                    if key["mode"] == "independent":
                        key["target_set_id"] = "targets-0"
                    local_key = ":".join(
                        key[k]
                        for k in (
                            "package_id",
                            "document_id",
                            "annotator_id",
                            "mode",
                            "target_set_id",
                        )
                    )
                    conn.execute(
                        "UPDATE imported_submission_bindings SET local_key = ? WHERE "
                        "local_package_id = ? AND submission_id = ?",
                        (local_key, row[0], row[1]),
                    )
                conn.execute(
                    "INSERT INTO schema_migrations VALUES (2, ?)",
                    (datetime.now(UTC).isoformat(),),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        self.migration_warnings = [
            row[0] for row in conn.execute("SELECT message FROM migration_warnings")
        ]
        for message in self.migration_warnings:
            warnings.warn(message, RuntimeWarning, stacklevel=2)

    def close(self) -> None:
        """Close connections after request workers have stopped."""
        with self._lock:
            for conn in self._connections:
                conn.close()
            self._connections.clear()
        self._local = threading.local()
