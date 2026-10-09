import sqlite3
import sys
import threading
from pathlib import Path
from typing import cast

from ontocurator.domain.errors import DomainError

CURRENT_SCHEMA_VERSION = 4

REQUIRED_TABLES = frozenset(
    {
        "workspace_metadata",
        "schema_migrations",
        "packages",
        "package_task_profiles",
        "documents",
        "evidence_snapshots",
        "package_evidence",
        "annotation_snapshots",
        "package_annotations",
        "workspaces",
        "workspace_annotations",
        "workspace_evidence",
        "workspace_decisions",
        "submissions",
        "imported_submission_bindings",
        "search_events",
        "package_search_events",
        "mutation_receipts",
        "package_ontology_resources",
        "package_search_conditions",
    }
)


def _get_sql_schema_path(filename: str) -> Path:
    p = Path(__file__).parent / filename
    if not p.is_file() and hasattr(sys, "_MEIPASS"):
        meipass_p = Path(sys._MEIPASS) / "ontocurator" / "storage" / filename
        if meipass_p.is_file():
            return meipass_p
    return p


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
            # as_uri() percent-encodes '#', '?', '%' and spaces in the path.
            ro_uri = f"{self.path.resolve().as_uri()}?mode=ro"
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

            # Format confirmed as v4. Older v4 workspaces predate the embedded
            # ontology resource table; add it idempotently and atomically.
            self._run_script_atomically(_get_sql_schema_path("ontology_resources.sql"))
            self._run_script_atomically(_get_sql_schema_path("search_conditions.sql"))
            self._verify_required_tables()
            return

        # Fresh database: initialize schema_v4.sql in a single transaction so a
        # crash cannot leave a partially created but v4-tagged workspace.
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_metadata';"
        )
        if cursor.fetchone() is None:
            self._run_script_atomically(_get_sql_schema_path("schema_v4.sql"))
        self._run_script_atomically(_get_sql_schema_path("search_conditions.sql"))
        self._verify_required_tables()

    def _run_script_atomically(self, schema_path: Path) -> None:
        """Execute a DDL script inside one explicit transaction."""
        sql = schema_path.read_text(encoding="utf-8")
        conn = self.get_connection()
        try:
            conn.executescript("BEGIN IMMEDIATE;\n" + sql + "\nCOMMIT;")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK;")
            raise

    def _verify_required_tables(self) -> None:
        """Reject workspaces whose v4 tag is not backed by the full schema."""
        rows = self.get_connection().execute(
            "SELECT name FROM sqlite_master WHERE type='table';"
        )
        missing = REQUIRED_TABLES - {row[0] for row in rows}
        if missing:
            raise DomainError(
                "UNSUPPORTED_WORKSPACE_VERSION",
                "Workspace database is incomplete; missing tables: "
                + ", ".join(sorted(missing)),
            )

    def close(self) -> None:
        """Close connections after request workers have stopped."""
        with self._lock:
            for conn in self._connections:
                conn.close()
            self._connections.clear()
        self._local = threading.local()
