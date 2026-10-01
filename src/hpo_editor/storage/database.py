import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from hpo_editor.domain.errors import DomainError

CURRENT_SCHEMA_VERSION = 1


class Database:
    """SQLite database connection and migration manager."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._conn: sqlite3.Connection | None = None
        self._ensure_migrated()

    def run_migrations(self) -> None:
        """Run pending schema migrations."""
        self._ensure_migrated()

    def get_connection(self) -> sqlite3.Connection:
        """Return active connection with foreign keys enabled."""
        if self._conn is None:
            self._conn = sqlite3.connect(
                str(self.path),
                isolation_level=None,  # Autocommit: explicit transactions
            )
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA foreign_keys = ON;")
        return self._conn

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

    def close(self) -> None:
        """Close database connection."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None
