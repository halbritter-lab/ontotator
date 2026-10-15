# T2a: PostgreSQL Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ontocurator stores everything in PostgreSQL through SQLAlchemy 2 and Alembic, and the whole existing test suite runs against PostgreSQL. The desktop launcher keeps working, with a database URL instead of a SQLite file.

**Architecture:**
- **Mappings and schema:** typed declarative table mappings live in `storage/tables.py`. A hand-written Alembic migration creates the schema `ontocurator`. Two roles: `ontocurator_owner` owns the schema and runs migrations. `ontocurator_app` is the runtime role; it may only read and insert on the append-only tables, and triggers reject updates and deletes there (T2 D6).
- **Repository:** `storage/repository.py` is rewritten for PostgreSQL with the **same public interface**, so application services, routes and tests stay as they are. A project replaces the package (`WorkspaceKey.package_id` carries the project key, index decision D-e).
- **Transactions:** `Database.transaction()` joins the transaction already open in the current context. A repository call made inside an editing operation therefore commits or rolls back with it, as the single SQLite connection did.
- **Tests:** `tests/pg_harness.py` starts one PostgreSQL testcontainer per session, migrates a template database once, and gives each test its own copy.

Spec: `docs/superpowers/specs/2026-10-14-t2-server-foundation-design.md` (P1, P2, P8, D3, D6). Index, decisions and open questions: `docs/superpowers/plans/2026-10-14-t2-index.md`.

**Tech Stack:** Python 3.12, SQLAlchemy 2.0, Alembic 1.14+, psycopg 3, PostgreSQL 16, testcontainers 4, pytest, FastAPI.

**Branch:** `feat/t2a-postgres-storage`, created from `main`, in the worktree `.worktrees/t2a-postgres-storage`.

---

## File map

| File | Change |
|---|---|
| `pyproject.toml`, `uv.lock` | add `sqlalchemy`, `alembic`, `psycopg[binary]`; dev: `testcontainers[postgres]` |
| `src/ontocurator/settings.py` | **new**: secrets from `NAME`/`NAME_FILE`, database URL resolution |
| `src/ontocurator/storage/blobs.py` | **new**: content-addressed files on the data volume (D3) |
| `src/ontocurator/storage/tables.py` | **new**: typed table mappings, schema and role names |
| `src/ontocurator/storage/schema.py` | **new**: Alembic upgrade, head and current revision |
| `src/ontocurator/storage/migrations/env.py`, `script.py.mako`, `versions/0001_initial.py` | **new**: Alembic environment and the first migration |
| `src/ontocurator/storage/database.py` | **rewritten**: engine, blob store, ambient transactions |
| `src/ontocurator/storage/repository.py` | **rewritten**: PostgreSQL repository with the old interface |
| `src/ontocurator/storage/sqlite_database.py`, `sqlite_repository.py`, `*.sql` | temporary copies of the old storage (Task 4), **deleted** in Task 9 |
| `src/ontocurator/config.py`, `api/app.py`, `cli.py` | `database_url` replaces `database_path`; `ontocurator db upgrade` |
| `src/ontocurator/application/editing.py`, `api/tree_routes.py` | pass the project to `get_search_event` |
| `tests/pg_harness.py` | **new**: PostgreSQL test server, template, per-test databases |
| `tests/conftest.py` | database provider and engine clean-up per test |
| `tests/test_settings.py`, `test_blobs.py`, `test_schema.py`, `test_database.py`, `test_pg_repository.py` | **new** |
| about 25 existing test files | converted by a script plus listed manual edits (Task 8) |
| `tests/browser_server.py` | uses a harness database |
| `scripts/check.sh` | **new**: the complete local gate (no CI, index R2) |

---

### Task 0: Worktree, Docker and baseline

- [ ] **Step 1: Create the worktree and install dependencies**

```bash
cd /c/Users/jan-p/Development/ontocurator
git worktree add .worktrees/t2a-postgres-storage -b feat/t2a-postgres-storage main
cd .worktrees/t2a-postgres-storage
uv sync
npm --prefix frontend ci
npx --prefix frontend playwright install chromium
```

All later commands run inside `.worktrees/t2a-postgres-storage`.

- [ ] **Step 2: Start Docker Desktop and check it**

Run: `docker version --format '{{.Server.Version}}'`
Expected: a version number such as `28.4.0`. If the command reports `failed to connect to the docker API`, start Docker Desktop and wait until `docker version` answers. Every backend test from Task 3 on needs it.

- [ ] **Step 3: Baseline**

Run: `uv run pytest -q && npm --prefix frontend test`
Expected: everything passes (about 660 backend tests and 323 frontend tests). Stop and report if not.

---

### Task 1: Dependencies and settings

The server reads its settings from the environment. Secrets come from `NAME` or from the file named in `NAME_FILE`, never both. The Docker contract uses only the file form (D1). The database URL is resolved through a replaceable provider, so tests can hand every app and CLI call its own database without setting environment variables.

**Files:**
- Modify: `pyproject.toml`
- Create: `src/ontocurator/settings.py`
- Test: `tests/test_settings.py`

- [ ] **Step 1: Add the dependencies**

```bash
uv add "sqlalchemy>=2.0.36,<2.1" "alembic>=1.14,<2" "psycopg[binary]>=3.2,<4"
uv add --dev "testcontainers[postgres]>=4.9,<5"
```

Expected: `pyproject.toml` lists the three packages under `dependencies` and `testcontainers[postgres]` under the `dev` group; `uv.lock` is updated.

- [ ] **Step 2: Write the failing test**

Create `tests/test_settings.py`:

```python
"""Settings from the environment: secrets and the database URL."""

from pathlib import Path

import pytest

from ontocurator import settings
from ontocurator.settings import SettingsError, database_url, read_secret


def test_a_secret_comes_from_the_variable(tmp_path: Path) -> None:
    assert read_secret("X", {"X": "value"}) == "value"


def test_a_secret_comes_from_its_file_without_the_line_end(tmp_path: Path) -> None:
    secret = tmp_path / "x"
    secret.write_text("value\n", encoding="utf-8")

    assert read_secret("X", {"X_FILE": str(secret)}) == "value"


def test_a_missing_secret_is_none() -> None:
    assert read_secret("X", {}) is None


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"X": "a", "X_FILE": "b"}, "Set only one of X and X_FILE"),
        ({"X": ""}, "X must not be empty"),
        ({"X_FILE": "/does/not/exist"}, "Unable to read X_FILE"),
    ],
)
def test_contradictory_or_unreadable_secrets_are_refused(
    env: dict[str, str], message: str
) -> None:
    with pytest.raises(SettingsError, match=message):
        read_secret("X", env)


def test_an_empty_secret_file_is_refused(tmp_path: Path) -> None:
    secret = tmp_path / "x"
    secret.write_text("\n", encoding="utf-8")

    with pytest.raises(SettingsError, match="X_FILE is empty"):
        read_secret("X", {"X_FILE": str(secret)})


def test_the_database_password_is_read_from_its_file(tmp_path: Path) -> None:
    secret = tmp_path / "pw"
    secret.write_text("s3cret\n", encoding="utf-8")
    env = {
        "ONTOCURATOR_DATABASE_URL": "postgresql://ontocurator_app@db:5432/ontocurator",
        "ONTOCURATOR_DATABASE_PASSWORD_FILE": str(secret),
    }

    url = database_url(env)

    assert url.drivername == "postgresql+psycopg"
    assert url.username == "ontocurator_app"
    assert url.password == "s3cret"
    assert url.host == "db"


def test_a_password_in_the_url_and_a_password_setting_conflict() -> None:
    env = {
        "ONTOCURATOR_DATABASE_URL": "postgresql://u:pw@db/x",
        "ONTOCURATOR_DATABASE_PASSWORD": "other",
    }

    with pytest.raises(SettingsError, match="already contains a password"):
        database_url(env)


@pytest.mark.parametrize(
    "env",
    [{}, {"ONTOCURATOR_DATABASE_URL": "sqlite:///x.db"}],
)
def test_only_postgresql_urls_are_accepted(env: dict[str, str]) -> None:
    with pytest.raises(SettingsError):
        database_url(env)


def test_the_migration_url_has_its_own_prefix() -> None:
    env = {"ONTOCURATOR_MIGRATION_DATABASE_URL": "postgresql://owner@db/x"}

    assert database_url(env, prefix="ONTOCURATOR_MIGRATION_DATABASE").username == (
        "owner"
    )


def test_an_explicit_url_wins_over_the_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "database_url_provider", lambda _ws: "from-provider")

    assert settings.resolve_database_url("explicit", None) == "explicit"
    assert settings.resolve_database_url(None, Path("ws")) == "from-provider"
```

- [ ] **Step 3: Run it and see it fail**

Run: `uv run pytest tests/test_settings.py -q`
Expected: FAIL with `ImportError: cannot import name 'SettingsError' from 'ontocurator.settings'` (or `ModuleNotFoundError`).

- [ ] **Step 4: Implement**

Create `src/ontocurator/settings.py`:

```python
"""Server settings from the environment.

Secrets are read from ``NAME`` or from the file named by ``NAME_FILE``, never
from both. The Docker service contract uses only the file form (T2 D1).
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from pathlib import Path

from sqlalchemy.engine import URL, make_url


class SettingsError(ValueError):
    """A setting is missing, contradictory or unreadable."""


def read_secret(name: str, env: Mapping[str, str] | None = None) -> str | None:
    """``NAME`` or the content of ``NAME_FILE`` without its line end, or None."""
    env = os.environ if env is None else env
    direct = env.get(name)
    path = env.get(f"{name}_FILE")
    if direct is not None and path is not None:
        raise SettingsError(f"Set only one of {name} and {name}_FILE")
    if direct is not None:
        if not direct:
            raise SettingsError(f"{name} must not be empty")
        return direct
    if path is None:
        return None
    try:
        value = Path(path).read_text(encoding="utf-8").rstrip("\r\n")
    except OSError as exc:
        raise SettingsError(f"Unable to read {name}_FILE: {exc.strerror}") from exc
    if not value:
        raise SettingsError(f"{name}_FILE is empty")
    return value


def database_url(
    env: Mapping[str, str] | None = None, *, prefix: str = "ONTOCURATOR_DATABASE"
) -> URL:
    """``<prefix>_URL`` with the password of ``<prefix>_PASSWORD[_FILE]``.

    The application uses ``ONTOCURATOR_DATABASE`` (role ``ontocurator_app``),
    migrations use ``ONTOCURATOR_MIGRATION_DATABASE`` (role
    ``ontocurator_owner``).
    """
    env = os.environ if env is None else env
    raw = env.get(f"{prefix}_URL")
    if not raw:
        raise SettingsError(f"{prefix}_URL is not set")
    url = make_url(raw)
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    if url.drivername != "postgresql+psycopg":
        raise SettingsError(f"{prefix}_URL must be a postgresql:// URL")
    has_setting = f"{prefix}_PASSWORD" in env or f"{prefix}_PASSWORD_FILE" in env
    if url.password is not None and has_setting:
        raise SettingsError(f"{prefix}_URL already contains a password")
    password = read_secret(f"{prefix}_PASSWORD", env)
    if password is not None:
        url = url.set(password=password)
    return url


def _from_environment(_workspace: Path | None) -> str:
    return database_url().render_as_string(hide_password=False)


# Where a database URL comes from when none is given explicitly. Tests replace
# it (tests/conftest.py) so that every app and CLI call gets its own database.
database_url_provider: Callable[[Path | None], str] = _from_environment


def resolve_database_url(explicit: str | None, workspace: Path | None) -> str:
    """The explicit URL, else the provider's URL for this workspace."""
    return explicit or database_url_provider(workspace)
```

Call sites always use `settings.resolve_database_url(...)` through the module (`from ontocurator import settings`), never `from ontocurator.settings import resolve_database_url`. Otherwise a test's replacement of the provider is not seen.

- [ ] **Step 5: Run it and see it pass**

Run: `uv run pytest tests/test_settings.py -q`
Expected: `13 passed`

- [ ] **Step 6: Lint and commit**

```bash
uv run ruff check --fix src/ontocurator/settings.py tests/test_settings.py
uv run ruff format src/ontocurator/settings.py tests/test_settings.py
uv run mypy src
git add pyproject.toml uv.lock src/ontocurator/settings.py tests/test_settings.py
git commit -m "feat(settings): read secrets and the PostgreSQL URL from the environment"
```

---

### Task 2: Content-addressed file store

Uploaded files are stored on the data volume under their SHA-256 (D3). The database keeps only metadata.

**Files:**
- Create: `src/ontocurator/storage/blobs.py`
- Test: `tests/test_blobs.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_blobs.py`:

```python
"""Files on the data volume, addressed by their SHA-256."""

import hashlib
from pathlib import Path

import pytest

from ontocurator.storage.blobs import BlobStore


def test_a_file_is_stored_under_its_hash_and_read_back(tmp_path: Path) -> None:
    store = BlobStore(tmp_path)
    digest = store.put(b"hello")

    assert digest == hashlib.sha256(b"hello").hexdigest()
    assert store.path(digest) == tmp_path / digest[:2] / digest
    assert store.get(digest) == b"hello"


def test_storing_the_same_content_twice_is_harmless(tmp_path: Path) -> None:
    store = BlobStore(tmp_path)

    assert store.put(b"x") == store.put(b"x")
    assert [p.name for p in tmp_path.rglob("*") if p.is_file()] == [
        hashlib.sha256(b"x").hexdigest()
    ]


def test_a_changed_file_is_reported_as_corrupt(tmp_path: Path) -> None:
    store = BlobStore(tmp_path)
    digest = store.put(b"original")
    store.path(digest).write_bytes(b"tampered")

    with pytest.raises(ValueError, match="corrupt"):
        store.get(digest)


@pytest.mark.parametrize("bad", ["", "../etc/passwd", "A" * 64, "0" * 63])
def test_only_hex_digests_address_files(tmp_path: Path, bad: str) -> None:
    with pytest.raises(ValueError, match="not a SHA-256"):
        BlobStore(tmp_path).path(bad)
```

- [ ] **Step 2: Run it and see it fail**

Run: `uv run pytest tests/test_blobs.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'ontocurator.storage.blobs'`

- [ ] **Step 3: Implement**

Create `src/ontocurator/storage/blobs.py`:

```python
"""Content-addressed files on the data volume (T2 D3)."""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from pathlib import Path

_SHA256 = re.compile(r"[0-9a-f]{64}")


class BlobStore:
    """``<root>/<first two hex digits>/<sha256>``; written atomically, never changed."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def path(self, sha256: str) -> Path:
        if not _SHA256.fullmatch(sha256):
            raise ValueError(f"not a SHA-256 hex digest: {sha256!r}")
        return self.root / sha256[:2] / sha256

    def put(self, data: bytes) -> str:
        """Store ``data`` and return its SHA-256; storing it again changes nothing."""
        digest = hashlib.sha256(data).hexdigest()
        target = self.path(digest)
        if target.is_file():
            return digest
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".incoming-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return digest

    def get(self, sha256: str) -> bytes:
        """The stored bytes; ``ValueError`` if they no longer match their hash."""
        data = self.path(sha256).read_bytes()
        if hashlib.sha256(data).hexdigest() != sha256:
            raise ValueError(f"stored file {sha256} is corrupt")
        return data
```

- [ ] **Step 4: Run it and see it pass**

Run: `uv run pytest tests/test_blobs.py -q`
Expected: `7 passed`

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check --fix src/ontocurator/storage/blobs.py tests/test_blobs.py
uv run ruff format src/ontocurator/storage/blobs.py tests/test_blobs.py
uv run mypy src
git add src/ontocurator/storage/blobs.py tests/test_blobs.py
git commit -m "feat(storage): content-addressed file store for the data volume"
```

---
### Task 3: Move the SQLite storage aside

The new modules take the final names `storage/database.py` and `storage/repository.py`. Until the switch in Task 7, the application and the existing tests keep using the SQLite code under temporary names, so every commit stays green.

**Files:**
- Rename: `src/ontocurator/storage/database.py` → `src/ontocurator/storage/sqlite_database.py`
- Rename: `src/ontocurator/storage/repository.py` → `src/ontocurator/storage/sqlite_repository.py`
- Modify: every importer in `src/`, `tests/` and `scripts/`

- [ ] **Step 1: Rename and rewrite the imports**

```bash
git mv src/ontocurator/storage/database.py src/ontocurator/storage/sqlite_database.py
git mv src/ontocurator/storage/repository.py src/ontocurator/storage/sqlite_repository.py
grep -rlE "ontocurator\.storage\.(database|repository)|from ontocurator\.storage import (database|repository)" src tests scripts \
  | xargs sed -i -E \
      -e 's/ontocurator\.storage\.database/ontocurator.storage.sqlite_database/g' \
      -e 's/ontocurator\.storage\.repository/ontocurator.storage.sqlite_repository/g' \
      -e 's/from ontocurator\.storage import repository as/from ontocurator.storage import sqlite_repository as/g' \
      -e 's/from ontocurator\.storage import database as/from ontocurator.storage import sqlite_database as/g'
```

- [ ] **Step 2: Check that nothing refers to the old names**

Run: `grep -rnE "storage\.(database|repository)\b|storage import (database|repository)\b" src tests scripts`
Expected: no output.

- [ ] **Step 3: Run the suite**

Run: `uv run pytest -q`
Expected: the same number of passed tests as in the baseline.

- [ ] **Step 4: Lint and commit**

```bash
uv run ruff check --fix src tests && uv run ruff format src tests
uv run mypy src
git add -A src tests scripts
git commit -m "refactor(storage): move the SQLite storage aside for the PostgreSQL port"
```

---

### Task 4: Schema, database access and the test harness

This task creates the typed mappings, the first migration with roles, grants and append-only triggers, the `Database` class with ambient transactions, and the harness that gives every test its own migrated PostgreSQL database.

**Files:**
- Create: `src/ontocurator/storage/tables.py`
- Create: `src/ontocurator/storage/schema.py`
- Create: `src/ontocurator/storage/migrations/env.py`, `src/ontocurator/storage/migrations/script.py.mako`, `src/ontocurator/storage/migrations/versions/0001_initial.py`
- Create: `src/ontocurator/storage/database.py`
- Create: `tests/pg_harness.py`
- Modify: `tests/conftest.py`
- Test: `tests/test_schema.py`, `tests/test_database.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_schema.py`:

```python
"""The migrated schema: mapped tables, roles, grants and append-only history."""

from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from pg_harness import database_for, owner_engine
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from ontocurator.storage.schema import current_revision, head_revision
from ontocurator.storage.tables import APPEND_ONLY_TABLES, SCHEMA, Base


def _only_our_schema(name: str | None, type_: str, _parents: object) -> bool:
    return type_ != "schema" or name == SCHEMA


def test_a_test_database_is_migrated_to_head(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.engine.connect() as conn:
        assert current_revision(conn) == head_revision()


def test_the_migration_creates_exactly_the_mapped_tables(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with owner_engine(db).connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_schemas": True,
                "include_name": _only_our_schema,
                "version_table_schema": SCHEMA,
                "compare_type": True,
            },
        )
        assert compare_metadata(context, Base.metadata) == []


@pytest.mark.parametrize("table", APPEND_ONLY_TABLES)
@pytest.mark.parametrize(
    "statement",
    ["UPDATE {t} SET project_id = project_id", "DELETE FROM {t}", "TRUNCATE {t}"],
)
def test_the_application_role_cannot_change_history(
    tmp_path: Path, table: str, statement: str
) -> None:
    db = database_for(tmp_path / "a.db")

    with pytest.raises(DBAPIError, match="permission denied"), db.engine.begin() as conn:
        conn.execute(text(statement.format(t=f"{SCHEMA}.{table}")))


def test_even_the_schema_owner_cannot_change_history(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    owner = owner_engine(db)
    with owner.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.projects (project_key, name, manifest,"
                " manifest_sha256, task_profile, task_profile_sha256)"
                " VALUES ('p', 'p', '{}', 'm', '{}', 't')"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.annotation_snapshots"
                " (project_id, annotation_id, version, document_id, payload)"
                f" SELECT id, 'a', 'v', 'd', '{{}}' FROM {SCHEMA}.projects"
            )
        )

    for statement in (
        f"UPDATE {SCHEMA}.annotation_snapshots SET document_id = 'x'",
        f"DELETE FROM {SCHEMA}.annotation_snapshots",
        f"TRUNCATE {SCHEMA}.annotation_snapshots",
    ):
        with pytest.raises(DBAPIError, match="append-only"), owner.begin() as conn:
            conn.execute(text(statement))


def test_the_application_role_cannot_create_tables(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with pytest.raises(DBAPIError, match="permission denied"), db.engine.begin() as conn:
        conn.execute(text(f"CREATE TABLE {SCHEMA}.intruder (id int)"))
```

In the second `INSERT`, `'{{}}'` sits in an f-string and becomes the JSON literal `'{}'`; the first `INSERT` is a plain string continuation and writes `'{}'` directly.

Create `tests/test_database.py`:

```python
"""Ambient transactions: one transaction per call chain, rolled back as a whole."""

import threading
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import func, insert, select

from ontocurator.storage.database import Database
from ontocurator.storage.tables import StoredFileRow


def _count(db: Database) -> int:
    with db.transaction() as conn:
        return conn.execute(
            select(func.count()).select_from(StoredFileRow)
        ).scalar_one()


def test_a_nested_transaction_joins_the_open_one(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.transaction() as outer, db.transaction() as inner:
        assert inner is outer


def test_a_failure_rolls_back_everything_written_in_the_chain(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with pytest.raises(RuntimeError, match="boom"), db.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="a" * 64, size=1))
        with db.transaction() as inner:
            inner.execute(insert(StoredFileRow).values(sha256="b" * 64, size=1))
        raise RuntimeError("boom")

    assert _count(db) == 0


def test_another_thread_gets_its_own_transaction(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    seen: dict[str, bool] = {}

    with db.transaction() as conn:

        def other() -> None:
            with db.transaction() as mine:
                seen["same"] = mine is conn

        thread = threading.Thread(target=other)
        thread.start()
        thread.join()

    assert seen == {"same": False}


def test_the_same_path_reopens_the_same_database(tmp_path: Path) -> None:
    first = database_for(tmp_path / "a.db")
    with first.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="c" * 64, size=1))

    assert _count(database_for(tmp_path / "a.db")) == 1
    assert _count(database_for(tmp_path / "b.db")) == 0
```

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest tests/test_schema.py tests/test_database.py -q`
Expected: FAIL during collection with `ModuleNotFoundError: No module named 'pg_harness'`

- [ ] **Step 3: Write the table mappings**

Create `src/ontocurator/storage/tables.py`:

```python
"""Typed table mappings of the server schema (T2 P2).

The repository runs Core statements against these mapped classes on a
``Connection``. It never loads ORM objects, so snapshot and submission
payloads stay plain JSON (JSONB). A project replaces the work package of the
desktop editor; ``WorkspaceKey.package_id`` carries ``projects.project_key``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    MetaData,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "ontocurator"
OWNER_ROLE = "ontocurator_owner"
APP_ROLE = "ontocurator_app"

# The application role may only read and insert these (T2 D6).
APPEND_ONLY_TABLES = ("annotation_snapshots", "evidence_snapshots", "submissions")

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        str: Text(),
        dict[str, Any]: JSONB(),
        list[Any]: JSONB(),
        datetime: DateTime(timezone=True),
    }


class ProjectRow(Base):
    """A project; until T2d it is created from an in-memory seed package."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    project_key: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    manifest: Mapped[dict[str, Any]]
    manifest_sha256: Mapped[str]
    task_profile: Mapped[dict[str, Any]]
    task_profile_sha256: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class StoredFileRow(Base):
    """A file of the content-addressed store on the data volume (D3)."""

    __tablename__ = "stored_files"

    sha256: Mapped[str] = mapped_column(primary_key=True)
    size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProjectResourceRow(Base):
    """An embedded ontology or captured search resource of a project."""

    __tablename__ = "project_resources"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    resource_path: Mapped[str] = mapped_column(primary_key=True)
    sha256: Mapped[str] = mapped_column(ForeignKey(StoredFileRow.sha256))


class ProjectSearchConditionsRow(Base):
    """The immutable search conditions captured at first use or imported."""

    __tablename__ = "project_search_conditions"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    conditions: Mapped[list[Any]]


class DocumentRow(Base):
    """A canonical text; ``position`` is its place in the project's order."""

    __tablename__ = "documents"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    document_id: Mapped[str] = mapped_column(primary_key=True)
    position: Mapped[int | None]
    language: Mapped[str]
    text: Mapped[str]
    text_sha256: Mapped[str]
    source_text_sha256: Mapped[str | None]


class AnnotationSnapshotRow(Base):
    """An immutable, content-addressed annotation snapshot (append-only)."""

    __tablename__ = "annotation_snapshots"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    annotation_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class EvidenceSnapshotRow(Base):
    """An immutable, content-addressed evidence snapshot (append-only)."""

    __tablename__ = "evidence_snapshots"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    evidence_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProposalAnnotationRow(Base):
    """An annotation the project offers as input (imported proposals)."""

    __tablename__ = "proposal_annotations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "annotation_id", "version"],
            [
                f"{SCHEMA}.annotation_snapshots.project_id",
                f"{SCHEMA}.annotation_snapshots.annotation_id",
                f"{SCHEMA}.annotation_snapshots.version",
            ],
        ),
    )

    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    annotation_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class ProposalEvidenceRow(Base):
    """Evidence that belongs to the project's proposals."""

    __tablename__ = "proposal_evidence"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "evidence_id", "version"],
            [
                f"{SCHEMA}.evidence_snapshots.project_id",
                f"{SCHEMA}.evidence_snapshots.evidence_id",
                f"{SCHEMA}.evidence_snapshots.version",
            ],
        ),
    )

    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    evidence_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class DraftRow(Base):
    """The mutable, revisioned working state of one workspace key."""

    __tablename__ = "drafts"
    __table_args__ = (
        UniqueConstraint("project_id", "draft_key"),
        Index(
            "ix_drafts_project_annotator_document",
            "project_id",
            "annotator_id",
            "document_id",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    draft_key: Mapped[str]
    document_id: Mapped[str]
    annotator_id: Mapped[str]
    mode: Mapped[str]
    scope_id: Mapped[str]
    target_set_id: Mapped[str]
    targets: Mapped[dict[str, Any]]
    revision: Mapped[int] = mapped_column(server_default=text("0"))
    checked_layer_ids: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )
    updated_at: Mapped[datetime]


class DraftAnnotationRow(Base):
    __tablename__ = "draft_annotations"

    draft_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(DraftRow.id, ondelete="CASCADE"), primary_key=True
    )
    annotation_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class DraftEvidenceRow(Base):
    __tablename__ = "draft_evidence"

    draft_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(DraftRow.id, ondelete="CASCADE"), primary_key=True
    )
    evidence_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class ReviewDecisionRow(Base):
    """A review decision of a draft, kept in the order it was made."""

    __tablename__ = "review_decisions"

    draft_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(DraftRow.id, ondelete="CASCADE"), primary_key=True
    )
    decision_id: Mapped[str] = mapped_column(primary_key=True)
    position: Mapped[int]
    target_id: Mapped[str]
    target_version: Mapped[str]
    outcome: Mapped[str]
    replacement_id: Mapped[str | None]
    replacement_version: Mapped[str | None]
    note: Mapped[str | None]
    reviewer_id: Mapped[str]
    payload: Mapped[dict[str, Any]]


class SubmissionRow(Base):
    """An immutable submission (append-only).

    ``local_key`` is the workspace key the submission belongs to in this
    project. For an imported submission it differs from ``origin_key``.
    """

    __tablename__ = "submissions"
    __table_args__ = (
        Index("ix_submissions_project_local_key", "project_id", "local_key"),
        Index("ix_submissions_project_document", "project_id", "document_id"),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    submission_id: Mapped[str] = mapped_column(primary_key=True)
    local_key: Mapped[str]
    origin_key: Mapped[str]
    document_id: Mapped[str]
    annotator_id: Mapped[str]
    mode: Mapped[str]
    draft_revision: Mapped[int]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[str]
    recorded_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SearchEventRow(Base):
    """Provenance of a term search or tree walk.

    ``seq`` keeps the order events were written in. ``imported`` marks events
    that came with a seed package (they take part in its re-import check).
    """

    __tablename__ = "search_events"
    __table_args__ = (
        Index("ix_search_events_project_local_key", "project_id", "local_key"),
        Index(
            "ix_search_events_project_workspace_key", "project_id", "workspace_key"
        ),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))
    workspace_key: Mapped[str]
    local_key: Mapped[str]
    imported: Mapped[bool] = mapped_column(server_default=text("false"))
    annotation_id: Mapped[str]
    layer_id: Mapped[str | None]
    ontology_sha256: Mapped[str | None]
    payload: Mapped[dict[str, Any]]
    timestamp: Mapped[str]


class MutationReceiptRow(Base):
    """The stored response of a committed write, replayed on a retry."""

    __tablename__ = "mutation_receipts"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    workspace_key: Mapped[str] = mapped_column(primary_key=True)
    mutation_id: Mapped[str] = mapped_column(primary_key=True)
    request_hash: Mapped[str]
    response: Mapped[dict[str, Any]]
    created_at: Mapped[datetime]
```

- [ ] **Step 4: Write the Alembic environment**

Create `src/ontocurator/storage/migrations/env.py`:

```python
"""Alembic environment: migrations run on a connection ontocurator provides.

Use ``ontocurator db upgrade`` (``storage.schema.upgrade``), never the plain
``alembic`` command: the upgrade takes the advisory lock and runs as the
schema owner. Migrations are forward-only.
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import Connection

from ontocurator.storage.tables import SCHEMA, Base


def _only_our_schema(name: str | None, type_: str, _parents: object) -> bool:
    return type_ != "schema" or name == SCHEMA


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        version_table_schema=SCHEMA,
        include_schemas=True,
        include_name=_only_our_schema,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Offline migrations are not supported")
connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Run migrations with 'ontocurator db upgrade'")
_run(connection)
```

Create `src/ontocurator/storage/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
```

- [ ] **Step 5: Write the first migration**

Create `src/ontocurator/storage/migrations/versions/0001_initial.py`:

```python
"""Initial server schema: projects, documents, drafts, submissions, search events.

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"
APPEND_ONLY = ("annotation_snapshots", "evidence_snapshots", "submissions")
MUTABLE = (
    "projects",
    "stored_files",
    "project_resources",
    "project_search_conditions",
    "documents",
    "proposal_annotations",
    "proposal_evidence",
    "drafts",
    "draft_annotations",
    "draft_evidence",
    "review_decisions",
    "search_events",
    "mutation_receipts",
)


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def _project_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["project_id"], [f"{SCHEMA}.projects.id"], name=f"fk_{table}_project_id"
    )


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("manifest", _jsonb(), nullable=False),
        sa.Column("manifest_sha256", sa.Text(), nullable=False),
        sa.Column("task_profile", _jsonb(), nullable=False),
        sa.Column("task_profile_sha256", sa.Text(), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
        sa.UniqueConstraint("project_key", name="uq_projects_project_key"),
        schema=SCHEMA,
    )
    op.create_table(
        "stored_files",
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("sha256", name="pk_stored_files"),
        schema=SCHEMA,
    )
    op.create_table(
        "project_resources",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("resource_path", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        _project_fk("project_resources"),
        sa.ForeignKeyConstraint(
            ["sha256"],
            [f"{SCHEMA}.stored_files.sha256"],
            name="fk_project_resources_sha256",
        ),
        sa.PrimaryKeyConstraint(
            "project_id", "resource_path", name="pk_project_resources"
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "project_search_conditions",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("conditions", _jsonb(), nullable=False),
        _project_fk("project_search_conditions"),
        sa.PrimaryKeyConstraint("project_id", name="pk_project_search_conditions"),
        schema=SCHEMA,
    )
    op.create_table(
        "documents",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("text_sha256", sa.Text(), nullable=False),
        sa.Column("source_text_sha256", sa.Text(), nullable=True),
        _project_fk("documents"),
        sa.PrimaryKeyConstraint("project_id", "document_id", name="pk_documents"),
        schema=SCHEMA,
    )
    for table, id_column in (
        ("annotation_snapshots", "annotation_id"),
        ("evidence_snapshots", "evidence_id"),
    ):
        op.create_table(
            table,
            sa.Column("project_id", sa.BigInteger(), nullable=False),
            sa.Column(id_column, sa.Text(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.Column("document_id", sa.Text(), nullable=False),
            sa.Column("payload", _jsonb(), nullable=False),
            sa.Column(
                "created_at", _ts(), server_default=sa.func.now(), nullable=False
            ),
            _project_fk(table),
            sa.PrimaryKeyConstraint(
                "project_id", id_column, "version", name=f"pk_{table}"
            ),
            schema=SCHEMA,
        )
    for table, id_column, snapshots in (
        ("proposal_annotations", "annotation_id", "annotation_snapshots"),
        ("proposal_evidence", "evidence_id", "evidence_snapshots"),
    ):
        op.create_table(
            table,
            sa.Column("project_id", sa.BigInteger(), nullable=False),
            sa.Column(id_column, sa.Text(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.ForeignKeyConstraint(
                ["project_id", id_column, "version"],
                [
                    f"{SCHEMA}.{snapshots}.project_id",
                    f"{SCHEMA}.{snapshots}.{id_column}",
                    f"{SCHEMA}.{snapshots}.version",
                ],
                name=f"fk_{table}_project_id_{id_column}_version",
            ),
            sa.PrimaryKeyConstraint(
                "project_id", id_column, "version", name=f"pk_{table}"
            ),
            schema=SCHEMA,
        )
    op.create_table(
        "drafts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("draft_key", sa.Text(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("annotator_id", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("scope_id", sa.Text(), nullable=False),
        sa.Column("target_set_id", sa.Text(), nullable=False),
        sa.Column("targets", _jsonb(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "checked_layer_ids",
            _jsonb(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("updated_at", _ts(), nullable=False),
        _project_fk("drafts"),
        sa.PrimaryKeyConstraint("id", name="pk_drafts"),
        sa.UniqueConstraint(
            "project_id", "draft_key", name="uq_drafts_project_id_draft_key"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_drafts_project_annotator_document",
        "drafts",
        ["project_id", "annotator_id", "document_id"],
        schema=SCHEMA,
    )
    for table, id_column in (
        ("draft_annotations", "annotation_id"),
        ("draft_evidence", "evidence_id"),
    ):
        op.create_table(
            table,
            sa.Column("draft_id", sa.BigInteger(), nullable=False),
            sa.Column(id_column, sa.Text(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.ForeignKeyConstraint(
                ["draft_id"],
                [f"{SCHEMA}.drafts.id"],
                name=f"fk_{table}_draft_id",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint(
                "draft_id", id_column, "version", name=f"pk_{table}"
            ),
            schema=SCHEMA,
        )
    op.create_table(
        "review_decisions",
        sa.Column("draft_id", sa.BigInteger(), nullable=False),
        sa.Column("decision_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("target_version", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("replacement_id", sa.Text(), nullable=True),
        sa.Column("replacement_version", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reviewer_id", sa.Text(), nullable=False),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.ForeignKeyConstraint(
            ["draft_id"],
            [f"{SCHEMA}.drafts.id"],
            name="fk_review_decisions_draft_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("draft_id", "decision_id", name="pk_review_decisions"),
        schema=SCHEMA,
    )
    op.create_table(
        "submissions",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("submission_id", sa.Text(), nullable=False),
        sa.Column("local_key", sa.Text(), nullable=False),
        sa.Column("origin_key", sa.Text(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("annotator_id", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column(
            "recorded_at", _ts(), server_default=sa.func.now(), nullable=False
        ),
        _project_fk("submissions"),
        sa.PrimaryKeyConstraint("project_id", "submission_id", name="pk_submissions"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_submissions_project_local_key",
        "submissions",
        ["project_id", "local_key"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_submissions_project_document",
        "submissions",
        ["project_id", "document_id"],
        schema=SCHEMA,
    )
    op.create_table(
        "search_events",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("workspace_key", sa.Text(), nullable=False),
        sa.Column("local_key", sa.Text(), nullable=False),
        sa.Column(
            "imported", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("annotation_id", sa.Text(), nullable=False),
        sa.Column("layer_id", sa.Text(), nullable=True),
        sa.Column("ontology_sha256", sa.Text(), nullable=True),
        sa.Column("payload", _jsonb(), nullable=False),
        sa.Column("timestamp", sa.Text(), nullable=False),
        _project_fk("search_events"),
        sa.PrimaryKeyConstraint("project_id", "event_id", name="pk_search_events"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_search_events_project_local_key",
        "search_events",
        ["project_id", "local_key"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_search_events_project_workspace_key",
        "search_events",
        ["project_id", "workspace_key"],
        schema=SCHEMA,
    )
    op.create_table(
        "mutation_receipts",
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_key", sa.Text(), nullable=False),
        sa.Column("mutation_id", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("response", _jsonb(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        _project_fk("mutation_receipts"),
        sa.PrimaryKeyConstraint(
            "project_id", "workspace_key", "mutation_id", name="pk_mutation_receipts"
        ),
        schema=SCHEMA,
    )

    # History cannot be rewritten: not by the application role (grants below)
    # and not by the owner either, short of dropping these triggers.
    op.execute(
        f"""
        CREATE FUNCTION {SCHEMA}.forbid_history_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'ontocurator: % on %.% is not allowed, the table is append-only',
            TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '42501';
        END
        $$
        """
    )
    for table in APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE"
            f" ON {SCHEMA}.{table}"
            f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE"
            f" ON {SCHEMA}.{table}"
            f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )

    for table in MUTABLE:
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{table} TO {APP_ROLE}"
        )
    for table in APPEND_ONLY:
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{table} TO {APP_ROLE}")
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")
    op.execute(f"GRANT SELECT ON {SCHEMA}.alembic_version TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
```

- [ ] **Step 6: Write the schema functions**

Create `src/ontocurator/storage/schema.py`:

```python
"""Applying and checking the database schema (Alembic, forward only)."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import URL

from ontocurator.storage.tables import SCHEMA

MIGRATIONS = Path(__file__).parent / "migrations"
# Every upgrading process takes this transaction lock, so two migrate runs
# never interleave.
UPGRADE_LOCK = 7_011_337_421


def alembic_config(connection: Connection | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    if head is None:
        raise RuntimeError("No migrations found")
    return head


def current_revision(connection: Connection) -> str | None:
    """The revision the database is at, or None if it was never migrated."""
    context = MigrationContext.configure(
        connection, opts={"version_table_schema": SCHEMA}
    )
    return context.get_current_revision()


def upgrade(url: str | URL) -> str:
    """Upgrade to head as the schema owner and return the head revision."""
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": UPGRADE_LOCK})
            command.upgrade(alembic_config(conn), "head")
    finally:
        engine.dispose()
    return head_revision()
```

- [ ] **Step 7: Write the database class**

Create `src/ontocurator/storage/database.py`:

```python
"""PostgreSQL access: one engine per process and ambient transactions."""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

from sqlalchemy import Connection, Engine, create_engine
from sqlalchemy.engine import URL, make_url

from ontocurator.storage.blobs import BlobStore

_numbers = itertools.count()


class Database:
    """The engine, the file store and the transaction of the current context.

    ``transaction()`` joins a transaction that is already open in this context
    (thread or task). A repository call made inside an editing operation thus
    commits or rolls back together with it (T2 index decision D-b).
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
        self._current: ContextVar[Connection | None] = ContextVar(
            f"ontocurator-transaction-{next(_numbers)}", default=None
        )

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """The open transaction of this context, or a new one committed at the end."""
        current = self._current.get()
        if current is not None:
            yield current
            return
        with self.engine.begin() as conn:
            token = self._current.set(conn)
            try:
                yield conn
            finally:
                self._current.reset(token)

    def close(self) -> None:
        """Close all pooled connections (after the server has stopped)."""
        self.engine.dispose()
```

- [ ] **Step 8: Write the test harness**

Create `tests/pg_harness.py`:

```python
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
                        f"CREATE DATABASE {name} TEMPLATE {TEMPLATE}"
                        f" OWNER {OWNER_ROLE}"
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
```

- [ ] **Step 9: Register the harness in `tests/conftest.py`**

Append to `tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def database_per_workspace(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    """Every app and CLI run without an explicit URL gets one database per workspace.

    Engines created during the test are closed afterwards and its databases
    are dropped, so connections and disk space do not accumulate.
    """
    import pg_harness

    from ontocurator import settings
    from ontocurator.storage.database import Database

    monkeypatch.setattr(
        settings,
        "database_url_provider",
        lambda workspace: pg_harness.database_url_for(
            (workspace or Path.cwd()) / "editor.db"
        ),
    )
    created: list[Database] = []
    original_init = Database.__init__

    def tracking_init(self: Database, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        original_init(self, *args, **kwargs)
        created.append(self)

    monkeypatch.setattr(Database, "__init__", tracking_init)
    yield
    for db in created:
        db.close()
    pg_harness.reset()
```

`Path` and `pytest` are already imported at the top of `tests/conftest.py`.

- [ ] **Step 10: Run the new tests and see them pass**

Run: `uv run pytest tests/test_schema.py tests/test_database.py -v`
Expected: `17 passed`. The first run pulls `postgres:16.15-alpine3.24` and can take up to a minute.

If `test_the_migration_creates_exactly_the_mapped_tables` fails, the assertion prints the differences between `tables.py` and `0001_initial.py`, for example `('add_index', Index('ix_…'))` or `('modify_nullable', …)`. Change the **migration** until the list is empty. The mappings are the reference.

- [ ] **Step 11: Run the whole suite**

Run: `uv run pytest -q`
Expected: all tests pass. The old tests still use `sqlite_repository`; the new autouse fixture only adds a monkeypatch to them.

- [ ] **Step 12: Lint and commit**

```bash
uv run ruff check --fix src tests && uv run ruff format src tests
uv run mypy src
git add src/ontocurator/storage tests/pg_harness.py tests/conftest.py tests/test_schema.py tests/test_database.py
git commit -m "feat(storage): PostgreSQL schema with owner and app roles, append-only history and a test harness"
```

---

### Task 5: Repository, part 1: projects, documents, proposals and files

The new repository keeps the public interface of `sqlite_repository.Repository`, so application services and routes do not change. This task covers seeding a project from an in-memory package and reading projects, documents, proposals, search conditions and embedded files.

Behaviour kept from v4, with the reason:
- **Content identities stay global.** A snapshot, submission or search event that already exists in *any* project with different content is refused (`InvalidPackage`). v4 had one global table per kind, and `test_import_rejects_conflicting_existing_snapshot_atomically` relies on it.
- **Files** go to the blob store before the transaction. If it rolls back, they are merely unreferenced, never wrong.
- **Each project** is created under an advisory lock on its key, so two concurrent imports of the same package serialise.

**Files:**
- Create: `src/ontocurator/storage/repository.py`
- Test: `tests/test_pg_repository.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_pg_repository.py`:

```python
"""The PostgreSQL repository: projects stay apart, history stays immutable."""

import hashlib
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import select
from test_storage import _sample_package

from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import StoredFileRow


def _repo(tmp_path: Path) -> Repository:
    return Repository(database_for(tmp_path / "editor.db"))


def _document(document_id: str) -> Document:
    text = f"Text of {document_id}."
    return Document(
        document_id=document_id,
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def test_a_seed_package_becomes_a_project(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a")

    assert repo.import_package(package) == "pkg-a"

    assert repo.get_manifest("pkg-a") == package.manifest
    assert repo.manifest_hash("pkg-a") == Repository.package_manifest_hash(package)
    assert repo.get_task_profile("pkg-a") == package.manifest.task_profile
    assert repo.list_documents("pkg-a") == list(package.documents.values())
    assert repo.list_annotations_for_document("pkg-a", "doc-1") == list(
        package.annotations.values()
    )


def test_importing_the_same_package_again_changes_nothing(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a")

    repo.import_package(package)
    repo.import_package(package)

    assert [m.package_id for m in repo.list_manifests()] == ["pkg-a"]


def test_a_changed_package_under_a_known_key_is_refused(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.import_package(_sample_package("pkg-a"))
    changed = _sample_package("pkg-a")
    changed.manifest.created_at = "2026-10-02T00:00:00Z"

    with pytest.raises(InvalidPackage, match="different manifest hash"):
        repo.import_package(changed)


def test_projects_do_not_see_each_others_content(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.import_package(_sample_package("pkg-a"))
    repo.import_package(
        _sample_package("pkg-b").model_copy(update={"annotations": {}, "evidence": {}})
    )

    assert repo.list_annotations_for_document("pkg-b", "doc-1") == []
    assert repo.get_document("pkg-c", "doc-1") is None
    with pytest.raises(DomainError, match="PACKAGE_NOT_FOUND"):
        repo.get_task_profile("pkg-c")


def test_documents_follow_the_declared_order_then_their_ids(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a").model_copy(
        update={
            "annotations": {},
            "evidence": {},
            "documents": {d: _document(d) for d in ("doc-b", "doc-a", "doc-c")},
        }
    )
    package.manifest.document_order = ["doc-c"]

    repo.import_package(package)

    assert [d.document_id for d in repo.list_documents("pkg-a")] == [
        "doc-c",
        "doc-a",
        "doc-b",
    ]


def test_embedded_files_are_stored_once_on_the_data_volume(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a")
    package.embedded_files = {"ontologies/a.json": b"{}", "ontologies/b.json": b"{}"}

    repo.import_package(package)

    assert repo.get_embedded_files("pkg-a") == {
        "ontologies/a.json": b"{}",
        "ontologies/b.json": b"{}",
    }
    with repo.db.transaction() as conn:
        assert conn.execute(select(StoredFileRow.sha256)).scalars().all() == [
            hashlib.sha256(b"{}").hexdigest()
        ]


def test_a_failed_import_leaves_nothing_behind(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repo(tmp_path)

    def fail(*_args: object) -> None:
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(Repository, "_store_resources", fail)

    with pytest.raises(RuntimeError, match="simulated failure"):
        repo.import_package(_sample_package("pkg-a"))

    assert repo.list_manifests() == []
    assert repo.get_document("pkg-a", "doc-1") is None
```

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest tests/test_pg_repository.py -q`
Expected: FAIL during collection with `ModuleNotFoundError: No module named 'ontocurator.storage.repository'`

- [ ] **Step 3: Write the module helpers and the project part of the repository**

Create `src/ontocurator/storage/repository.py`:

```python
"""PostgreSQL repository for projects, revisioned drafts and immutable submissions.

A project replaces the desktop editor's work package: ``package_id`` in
``WorkspaceKey`` and in the method names below is the project key (T2 index
decision D-e). Every query is filtered by project. Snapshots and submissions
are append-only (T2 D6): the application role can only insert and read them.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import quote

from sqlalchemy import Connection, Row, and_, delete, exists, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import Document, EvidenceSnapshot
from ontocurator.domain.errors import DomainError, InvalidPackage, RevisionConflict
from ontocurator.domain.profiles import OntologyDefinition, TaskProfile, profile_hash
from ontocurator.domain.results import latest_submissions
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.serialization import decode_snapshot, encode_snapshot
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.ontology.conditions import SearchCondition, validate_resources
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
    is_tree_walk,
)
from ontocurator.storage.database import Database
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    DocumentRow,
    DraftAnnotationRow,
    DraftEvidenceRow,
    DraftRow,
    EvidenceSnapshotRow,
    MutationReceiptRow,
    ProjectResourceRow,
    ProjectRow,
    ProjectSearchConditionsRow,
    ProposalAnnotationRow,
    ProposalEvidenceRow,
    ReviewDecisionRow,
    SearchEventRow,
    StoredFileRow,
    SubmissionRow,
)

_ESCAPED_KEY_PREFIX = "wk2|"


def _key_str(key: WorkspaceKey) -> str:
    """The persisted identity of a workspace key.

    Keys whose components contain no ':' use the ':'-joined form. Any other
    key is percent-encoded per component and joined with '|' behind a prefix,
    which keeps the encoding injective.
    """
    parts = [
        key.package_id,
        key.document_id,
        key.annotator_id,
        key.mode,
        key.scope_id,
        key.target_set_id,
    ]
    if not any(":" in part for part in parts):
        return ":".join(parts)
    return _ESCAPED_KEY_PREFIX + "|".join(quote(part, safe="") for part in parts)


def _same_tree_walk(stored: SearchEventRecord, incoming: SearchEventRecord) -> bool:
    """Whether two records are one tree walk seen at two moments.

    A walk only ever gains terms at the end, its two lists gain them together,
    and it lists every term once.
    """
    if not is_tree_walk(stored) or not is_tree_walk(incoming):
        return False
    grown = {"candidates", "ranked_ids"}
    if stored.model_dump(exclude=grown) != incoming.model_dump(exclude=grown):
        return False
    earlier, later = sorted((stored, incoming), key=lambda e: len(e.candidates))
    shown, ranked = len(earlier.candidates), len(earlier.ranked_ids)
    return (
        later.candidates[:shown] == earlier.candidates
        and later.ranked_ids[:ranked] == earlier.ranked_ids
        and later.candidates[shown:] == later.ranked_ids[ranked:]
        and len(set(later.candidates)) == len(later.candidates)
    )


def _local_import_key(
    origin: WorkspaceKey, package_id: str, profile: TaskProfile
) -> WorkspaceKey:
    """Bind imported history to the importing project's workspace identity."""
    return origin.model_copy(
        update={
            "package_id": package_id,
            "scope_id": build_scope(profile, origin.mode).scope_id,
            "target_set_id": "targets-0"
            if origin.mode == "independent"
            else origin.target_set_id,
        }
    )


def _workspace_aliases(key: WorkspaceKey) -> tuple[str, ...]:
    """Both historical empty-target and API-default independent bindings."""
    keys = {_key_str(key)}
    if key.mode == "independent":
        for target_id in ("targets-0", ReviewTargetSet.create([]).target_set_id):
            keys.add(_key_str(key.model_copy(update={"target_set_id": target_id})))
    return tuple(sorted(keys))


def _lock_id(*parts: str) -> int:
    """A signed 64-bit advisory lock id derived from a name."""
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def _submission_payload(submission: Submission) -> dict[str, Any]:
    payload = submission.model_dump(mode="json")
    payload["snapshots"] = [encode_snapshot(s) for s in submission.snapshots]
    return payload


def _draft_payload(draft: Draft) -> dict[str, Any]:
    payload = draft.model_dump(mode="json")
    payload["annotations"] = [encode_snapshot(a) for a in draft.annotations]
    return payload


class Repository:
    """Projects, drafts, submissions and search provenance in PostgreSQL."""

    def __init__(self, db: Database) -> None:
        self.db = db

    # --- projects ---------------------------------------------------------- #

    @staticmethod
    def _project_id(conn: Connection, package_id: str) -> int | None:
        return conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == package_id)
        ).scalar_one_or_none()

    def _require_project(self, conn: Connection, package_id: str) -> int:
        project_id = self._project_id(conn, package_id)
        if project_id is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{package_id}'"
            )
        return project_id

    @staticmethod
    def package_manifest_hash(package: ValidatedPackage) -> str:
        """The hash :meth:`import_package` stores for ``package``."""
        return canonical_hash(package.manifest.model_dump())

    def import_package(
        self,
        package: ValidatedPackage,
        fallback_axes_config: AxesConfig | None = None,
    ) -> str:
        """Create the project of an in-memory seed package, or verify an identical one.

        Re-importing a manifest is idempotent only if every dataset is equal.
        """
        del fallback_axes_config  # profiles carry their axes; kept for callers
        manifest = package.manifest
        profile = manifest.task_profile
        if profile is None:
            raise InvalidPackage(
                f"Package '{manifest.package_id}' is missing mandatory task profile"
            )
        manifest_hash = self.package_manifest_hash(package)
        profile_sha = manifest.task_profile_sha256 or profile_hash(profile)
        if manifest.search_conditions is not None:
            validate_resources(
                manifest.search_conditions, profile, package.embedded_files
            )
        files = {
            path: (self.db.blobs.put(data), len(data))
            for path, data in package.embedded_files.items()
        }
        with self.db.transaction() as conn:
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(_lock_id("project", manifest.package_id))
                )
            )
            self._verify_existing_snapshots(conn, package)
            existing = conn.execute(
                select(
                    ProjectRow.id,
                    ProjectRow.manifest_sha256,
                    ProjectRow.task_profile_sha256,
                ).where(ProjectRow.project_key == manifest.package_id)
            ).one_or_none()
            if existing is not None:
                if existing.manifest_sha256 != manifest_hash:
                    raise InvalidPackage(
                        f"Package '{manifest.package_id}' exists with "
                        "different manifest hash"
                    )
                if existing.task_profile_sha256 != profile_sha:
                    raise InvalidPackage(
                        "Conflicting task profile resolution for existing package"
                    )
                self._verify_existing_package_content(conn, existing.id, package)
                self._store_resources(
                    conn, existing.id, manifest.search_conditions, files
                )
                return manifest.package_id
            project_id = conn.execute(
                insert(ProjectRow)
                .values(
                    project_key=manifest.package_id,
                    name=manifest.package_id,
                    manifest=manifest.model_dump(mode="json"),
                    manifest_sha256=manifest_hash,
                    task_profile=profile.model_dump(mode="json"),
                    task_profile_sha256=profile_sha,
                )
                .returning(ProjectRow.id)
            ).scalar_one()
            self._insert_project_content(conn, project_id, package, profile)
            self._store_resources(conn, project_id, manifest.search_conditions, files)
        return manifest.package_id

    def _insert_project_content(
        self,
        conn: Connection,
        project_id: int,
        package: ValidatedPackage,
        profile: TaskProfile,
    ) -> None:
        package_id = package.manifest.package_id
        order = {
            doc_id: index
            for index, doc_id in enumerate(package.manifest.document_order)
        }
        documents = [
            {
                "project_id": project_id,
                "document_id": doc.document_id,
                "position": order.get(doc.document_id),
                "language": doc.language,
                "text": doc.text,
                "text_sha256": doc.text_sha256,
            }
            for doc in package.documents.values()
        ]
        if documents:
            conn.execute(insert(DocumentRow), documents)
        self._insert_snapshots(
            conn, project_id, package.annotations.values(), package.evidence.values()
        )
        if package.annotations:
            conn.execute(
                insert(ProposalAnnotationRow),
                [
                    {"project_id": project_id, "annotation_id": a, "version": v}
                    for a, v in package.annotations
                ],
            )
        if package.evidence:
            conn.execute(
                insert(ProposalEvidenceRow),
                [
                    {"project_id": project_id, "evidence_id": e, "version": v}
                    for e, v in package.evidence
                ],
            )
        for submission in package.submissions.values():
            local = _local_import_key(submission.origin_key, package_id, profile)
            self._insert_submission(
                conn, project_id, submission, local_key=_key_str(local)
            )
        for event in package.search_events:
            local = _local_import_key(event.workspace_key, package_id, profile)
            self._insert_search_event(
                conn, project_id, event, local_key=_key_str(local), imported=True
            )

    def _verify_existing_snapshots(
        self, conn: Connection, package: ValidatedPackage
    ) -> None:
        """Never keep conflicting immutable content under an existing identity.

        Identities are global, as in the desktop workspace: a snapshot,
        submission or search event of any project with the same identity must
        have the same content. Two exports of one tree walk keep the longer one.
        """
        for (annotation_id, version), snap in package.annotations.items():
            expected = canonical_hash(encode_snapshot(snap))
            for stored in conn.execute(
                select(AnnotationSnapshotRow.payload).where(
                    AnnotationSnapshotRow.annotation_id == annotation_id,
                    AnnotationSnapshotRow.version == version,
                )
            ).scalars():
                if canonical_hash(stored) != expected:
                    raise InvalidPackage("Conflicting immutable snapshot content")
        for (evidence_id, version), ev in package.evidence.items():
            expected = canonical_hash(ev.model_dump())
            for stored in conn.execute(
                select(EvidenceSnapshotRow.payload).where(
                    EvidenceSnapshotRow.evidence_id == evidence_id,
                    EvidenceSnapshotRow.version == version,
                )
            ).scalars():
                if canonical_hash(stored) != expected:
                    raise InvalidPackage("Conflicting immutable snapshot content")
        for submission in package.submissions.values():
            for stored in conn.execute(
                select(SubmissionRow.payload).where(
                    SubmissionRow.submission_id == submission.submission_id
                )
            ).scalars():
                if Submission.model_validate(stored) != submission:
                    raise InvalidPackage("Conflicting immutable submission content")
        for event in package.search_events:
            rows = conn.execute(
                select(SearchEventRow.project_id, SearchEventRow.payload).where(
                    SearchEventRow.event_id == event.event_id
                )
            ).all()
            for row in rows:
                existing = SearchEventRecord.model_validate(row.payload)
                if existing == event:
                    continue
                if not _same_tree_walk(existing, event):
                    raise InvalidPackage("Conflicting search event content")
                if len(event.candidates) > len(existing.candidates):
                    conn.execute(
                        update(SearchEventRow)
                        .where(
                            SearchEventRow.project_id == row.project_id,
                            SearchEventRow.event_id == event.event_id,
                        )
                        .values(payload=event.model_dump(mode="json"))
                    )

    @staticmethod
    def _verify_existing_package_content(
        conn: Connection, project_id: int, package: ValidatedPackage
    ) -> None:
        """A re-import is idempotent only if its datasets equal the installed ones."""
        stored_docs = dict(
            conn.execute(
                select(DocumentRow.document_id, DocumentRow.text_sha256).where(
                    DocumentRow.project_id == project_id
                )
            )
            .tuples()
            .all()
        )
        stored_annotations = set(
            conn.execute(
                select(
                    ProposalAnnotationRow.annotation_id, ProposalAnnotationRow.version
                ).where(ProposalAnnotationRow.project_id == project_id)
            )
            .tuples()
            .all()
        )
        stored_evidence = set(
            conn.execute(
                select(ProposalEvidenceRow.evidence_id, ProposalEvidenceRow.version)
                .where(ProposalEvidenceRow.project_id == project_id)
            )
            .tuples()
            .all()
        )
        stored_events = set(
            conn.execute(
                select(SearchEventRow.event_id).where(
                    SearchEventRow.project_id == project_id,
                    SearchEventRow.imported.is_(True),
                )
            ).scalars()
        )
        bound_submissions = set(
            conn.execute(
                select(SubmissionRow.submission_id).where(
                    SubmissionRow.project_id == project_id
                )
            ).scalars()
        )
        if (
            stored_docs
            != {d.document_id: d.text_sha256 for d in package.documents.values()}
            or stored_annotations != set(package.annotations)
            or stored_evidence != set(package.evidence)
            or stored_events != {e.event_id for e in package.search_events}
            or not set(package.submissions) <= bound_submissions
        ):
            raise InvalidPackage(
                f"Package '{package.manifest.package_id}' exists with identical "
                "manifest but different dataset content"
            )

    def _store_resources(
        self,
        conn: Connection,
        project_id: int,
        conditions: list[SearchCondition] | None,
        files: dict[str, tuple[str, int]],
    ) -> None:
        if conditions is not None:
            existing = self._search_conditions(conn, project_id)
            if existing is not None and existing != conditions:
                raise InvalidPackage("Conflicting immutable package search conditions")
            conn.execute(
                pg_insert(ProjectSearchConditionsRow)
                .values(
                    project_id=project_id,
                    conditions=[c.model_dump(mode="json") for c in conditions],
                )
                .on_conflict_do_nothing()
            )
        self._store_files(conn, project_id, files)

    @staticmethod
    def _store_files(
        conn: Connection, project_id: int, files: dict[str, tuple[str, int]]
    ) -> None:
        if not files:
            return
        conn.execute(
            pg_insert(StoredFileRow).on_conflict_do_nothing(),
            [{"sha256": sha, "size": size} for sha, size in files.values()],
        )
        conn.execute(
            pg_insert(ProjectResourceRow).on_conflict_do_nothing(),
            [
                {"project_id": project_id, "resource_path": path, "sha256": sha}
                for path, (sha, _size) in files.items()
            ],
        )

    @staticmethod
    def _search_conditions(
        conn: Connection, project_id: int
    ) -> list[SearchCondition] | None:
        stored = conn.execute(
            select(ProjectSearchConditionsRow.conditions).where(
                ProjectSearchConditionsRow.project_id == project_id
            )
        ).scalar_one_or_none()
        if stored is None:
            return None
        return [SearchCondition.model_validate(c) for c in stored]

    def get_search_conditions(self, package_id: str) -> list[SearchCondition] | None:
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, package_id)
            if project_id is None:
                return None
            return self._search_conditions(conn, project_id)

    def capture_search_conditions(
        self,
        package_id: str,
        conditions: list[SearchCondition],
        resources: dict[str, bytes],
    ) -> list[SearchCondition]:
        """Store first-use conditions once; concurrent captures get the first ones."""
        validate_resources(conditions, self.get_task_profile(package_id), resources)
        files = {
            path: (self.db.blobs.put(data), len(data))
            for path, data in resources.items()
        }
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            inserted = conn.execute(
                pg_insert(ProjectSearchConditionsRow)
                .values(
                    project_id=project_id,
                    conditions=[c.model_dump(mode="json") for c in conditions],
                )
                .on_conflict_do_nothing()
                .returning(ProjectSearchConditionsRow.project_id)
            ).scalar_one_or_none()
            if inserted is None:
                existing = self._search_conditions(conn, project_id)
                if existing is None:
                    raise DomainError("SEARCH_CONDITIONS_MISSING", package_id)
                return existing
            self._store_files(conn, project_id, files)
            return conditions

    def get_embedded_files(self, package_id: str) -> dict[str, bytes]:
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, package_id)
            if project_id is None:
                return {}
            rows = (
                conn.execute(
                    select(
                        ProjectResourceRow.resource_path, ProjectResourceRow.sha256
                    ).where(ProjectResourceRow.project_id == project_id)
                )
                .tuples()
                .all()
            )
        return {path: self.db.blobs.get(sha) for path, sha in rows}

    def ontology_resources(self) -> list[tuple[OntologyDefinition, bytes]]:
        """Definitions and bytes of every embedded ontology, for start-up loading."""
        with self.db.transaction() as conn:
            rows = (
                conn.execute(
                    select(
                        ProjectRow.task_profile,
                        ProjectResourceRow.resource_path,
                        ProjectResourceRow.sha256,
                    ).join(ProjectResourceRow, ProjectResourceRow.project_id == ProjectRow.id)
                )
                .tuples()
                .all()
            )
        result: list[tuple[OntologyDefinition, bytes]] = []
        for stored_profile, path, sha in rows:
            for ont in TaskProfile.model_validate(stored_profile).ontologies:
                if ont.resource_path == path:
                    result.append((ont, self.db.blobs.get(sha)))
        return result

    def get_manifest(self, package_id: str) -> PackageManifest:
        """The stored manifest of a project."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(ProjectRow.manifest).where(ProjectRow.project_key == package_id)
            ).scalar_one_or_none()
        if stored is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{package_id}'"
            )
        return PackageManifest.model_validate(stored)

    def manifest_hash(self, package_id: str) -> str | None:
        """Canonical manifest hash of a project, or None if absent."""
        with self.db.transaction() as conn:
            return conn.execute(
                select(ProjectRow.manifest_sha256).where(
                    ProjectRow.project_key == package_id
                )
            ).scalar_one_or_none()

    def list_manifests(self) -> list[PackageManifest]:
        """Manifests of all projects, newest first."""
        with self.db.transaction() as conn:
            stored = (
                conn.execute(
                    select(ProjectRow.manifest).order_by(
                        ProjectRow.created_at.desc(), ProjectRow.id.desc()
                    )
                )
                .scalars()
                .all()
            )
        return [PackageManifest.model_validate(m) for m in stored]

    def get_task_profile(self, package_id: str) -> TaskProfile:
        """The resolved task profile of a project."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(ProjectRow.task_profile).where(
                    ProjectRow.project_key == package_id
                )
            ).scalar_one_or_none()
        if stored is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND",
                f"No package or task profile found for package '{package_id}'",
            )
        return TaskProfile.model_validate(stored)

    def get_axes_config(self, package_id: str) -> AxesConfig:
        """AxesConfig synthesized from the task profile, for older callers."""
        profile = self.get_task_profile(package_id)
        name = profile.preset or "custom"
        for layer in profile.layers:
            for annotation_type in layer.annotation_types:
                if annotation_type.axes:
                    return AxesConfig(definition_name=name, axes=annotation_type.axes)
        return AxesConfig(definition_name=name, axes=[])

    # --- documents and proposals ------------------------------------------- #

    def get_document(self, package_id: str, document_id: str) -> Document | None:
        with self.db.transaction() as conn:
            row = conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.text,
                    DocumentRow.language,
                    DocumentRow.text_sha256,
                )
                .join(ProjectRow, ProjectRow.id == DocumentRow.project_id)
                .where(
                    ProjectRow.project_key == package_id,
                    DocumentRow.document_id == document_id,
                )
            ).one_or_none()
        if row is None:
            return None
        return Document(
            document_id=row.document_id,
            text=row.text,
            language=row.language,
            text_sha256=row.text_sha256,
        )

    def list_documents(self, package_id: str) -> list[Document]:
        """Documents in the declared order, the rest by ID."""
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.text,
                    DocumentRow.language,
                    DocumentRow.text_sha256,
                )
                .join(ProjectRow, ProjectRow.id == DocumentRow.project_id)
                .where(ProjectRow.project_key == package_id)
                .order_by(DocumentRow.position.asc().nulls_last(), DocumentRow.document_id)
            ).all()
        return [
            Document(
                document_id=row.document_id,
                text=row.text,
                language=row.language,
                text_sha256=row.text_sha256,
            )
            for row in rows
        ]

    @staticmethod
    def _insert_snapshots(
        conn: Connection,
        project_id: int,
        annotations: Iterable[AnnotationSnapshot],
        evidence: Iterable[EvidenceSnapshot],
    ) -> None:
        """Insert content-addressed snapshots; known identities are skipped."""
        annotation_rows = [
            {
                "project_id": project_id,
                "annotation_id": snap.annotation.annotation_id,
                "version": snap.version,
                "document_id": snap.document_id,
                "payload": encode_snapshot(snap),
            }
            for snap in annotations
        ]
        if annotation_rows:
            conn.execute(
                pg_insert(AnnotationSnapshotRow).on_conflict_do_nothing(),
                annotation_rows,
            )
        evidence_rows = [
            {
                "project_id": project_id,
                "evidence_id": ev.mention.evidence_id,
                "version": ev.version,
                "document_id": ev.document_id,
                "payload": ev.model_dump(mode="json"),
            }
            for ev in evidence
        ]
        if evidence_rows:
            conn.execute(
                pg_insert(EvidenceSnapshotRow).on_conflict_do_nothing(), evidence_rows
            )

    def get_annotation_snapshot(
        self, annotation_id: str, version: str, package_id: str | None = None
    ) -> AnnotationSnapshot | None:
        statement = select(AnnotationSnapshotRow.payload).where(
            AnnotationSnapshotRow.annotation_id == annotation_id,
            AnnotationSnapshotRow.version == version,
        )
        if package_id is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == AnnotationSnapshotRow.project_id
            ).where(ProjectRow.project_key == package_id)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else decode_snapshot(stored)

    def get_evidence_snapshot(
        self, evidence_id: str, version: str, package_id: str | None = None
    ) -> EvidenceSnapshot | None:
        statement = select(EvidenceSnapshotRow.payload).where(
            EvidenceSnapshotRow.evidence_id == evidence_id,
            EvidenceSnapshotRow.version == version,
        )
        if package_id is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == EvidenceSnapshotRow.project_id
            ).where(ProjectRow.project_key == package_id)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else EvidenceSnapshot.model_validate(stored)

    def list_annotations_for_document(
        self, package_id: str, document_id: str
    ) -> list[AnnotationSnapshot]:
        """The project's proposals for one document, ordered by identity."""
        with self.db.transaction() as conn:
            stored = (
                conn.execute(
                    select(AnnotationSnapshotRow.payload)
                    .join(
                        ProposalAnnotationRow,
                        and_(
                            ProposalAnnotationRow.project_id
                            == AnnotationSnapshotRow.project_id,
                            ProposalAnnotationRow.annotation_id
                            == AnnotationSnapshotRow.annotation_id,
                            ProposalAnnotationRow.version
                            == AnnotationSnapshotRow.version,
                        ),
                    )
                    .join(ProjectRow, ProjectRow.id == AnnotationSnapshotRow.project_id)
                    .where(
                        ProjectRow.project_key == package_id,
                        AnnotationSnapshotRow.document_id == document_id,
                    )
                    .order_by(
                        AnnotationSnapshotRow.annotation_id,
                        AnnotationSnapshotRow.version,
                    )
                )
                .scalars()
                .all()
            )
        return [decode_snapshot(p) for p in stored]

    # --- submissions and search events: insertion -------------------------- #

    @staticmethod
    def _insert_submission(
        conn: Connection, project_id: int, submission: Submission, *, local_key: str
    ) -> None:
        origin = submission.origin_key
        conn.execute(
            pg_insert(SubmissionRow)
            .values(
                project_id=project_id,
                submission_id=submission.submission_id,
                local_key=local_key,
                origin_key=_key_str(origin),
                document_id=origin.document_id,
                annotator_id=origin.annotator_id,
                mode=origin.mode,
                draft_revision=submission.draft_revision,
                payload=_submission_payload(submission),
                created_at=submission.created_at,
            )
            .on_conflict_do_nothing()
        )

    @staticmethod
    def _insert_search_event(
        conn: Connection,
        project_id: int,
        event: SearchEventRecord,
        *,
        local_key: str,
        imported: bool,
    ) -> None:
        statement = pg_insert(SearchEventRow).values(
            project_id=project_id,
            event_id=event.event_id,
            workspace_key=_key_str(event.workspace_key),
            local_key=local_key,
            imported=imported,
            annotation_id=event.annotation_id,
            layer_id=event.layer_id,
            ontology_sha256=event.ontology_sha256,
            payload=event.model_dump(mode="json"),
            timestamp=event.timestamp,
        )
        # Imported events may already be known; a locally written one must be new.
        conn.execute(statement.on_conflict_do_nothing() if imported else statement)
```

Several imports (`Callable`, `Literal`, `Row`, `delete`, `exists`, `or_`, `datetime`, `UTC`, `RevisionConflict`, `latest_submissions`, `ReviewDecision`, `Draft`, `MutationEnvelope`, `WorkspaceKey`'s use in later methods, the draft and receipt rows) are used by the methods added in Tasks 6 and 7. Until then Ruff reports them as unused; do **not** let `ruff check --fix` remove them in this task. Run Ruff on this file with `--ignore F401` until Task 7.

- [ ] **Step 4: Run the tests and see them pass**

Run: `uv run pytest tests/test_pg_repository.py -q`
Expected: `7 passed`

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check --fix --ignore F401 src/ontocurator/storage/repository.py tests/test_pg_repository.py
uv run ruff format src/ontocurator/storage/repository.py tests/test_pg_repository.py
uv run mypy src
git add src/ontocurator/storage/repository.py tests/test_pg_repository.py
git commit -m "feat(storage): PostgreSQL repository for projects, documents, proposals and files"
```

`mypy` passes because unused imports are not type errors.

---

### Task 6: Repository, part 2: drafts, mutations, submissions and status

Writers of one draft are serialised by a transaction-scoped advisory lock on the draft identity. The lock works before the draft row exists. It replaces SQLite's `BEGIN IMMEDIATE`, which locked the whole database. Inside the lock, a retried mutation ID replays its stored response, and a stale revision is a 409 conflict, as before.

Rows that SQLite returned without `ORDER BY` now have explicit orders:
- draft annotations and evidence by identity (SQLite read them through the primary-key index, which gave the same order);
- decisions by the order they were written (SQLite: insertion order);
- submissions by `created_at`, then `submission_id`;
- search events by `seq`.

**Files:**
- Modify: `src/ontocurator/storage/repository.py` (append to the class)
- Test: `tests/test_pg_repository.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_pg_repository.py`:

```python
import threading  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402

from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import DBAPIError  # noqa: E402

from ontocurator.domain.errors import RevisionConflict  # noqa: E402
from ontocurator.domain.review import ReviewTargetSet  # noqa: E402
from ontocurator.domain.workspace import (  # noqa: E402
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)


def _key(package_id: str = "pkg-a", annotator_id: str = "ann-1") -> WorkspaceKey:
    return WorkspaceKey(
        package_id=package_id,
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


def _envelope(mutation_id: str, expected: int) -> MutationEnvelope:
    return MutationEnvelope(mutation_id=mutation_id, expected_revision=expected, payload={})


def _check(draft: Draft) -> Draft:
    draft.document_checked = True
    return draft


def _seeded(tmp_path: Path) -> Repository:
    repo = _repo(tmp_path)
    repo.import_package(_sample_package("pkg-a"))
    return repo


def test_a_draft_starts_at_revision_zero_and_each_write_counts(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    assert repo.open_draft(_key()).revision == 0
    result = repo.run_mutation(_key(), _envelope("m1", 0), _check)

    assert isinstance(result, Draft) and result.revision == 1
    reopened = repo.open_draft(_key())
    assert reopened.revision == 1
    assert reopened.checked_layer_ids == ["hpo"]


def test_two_writers_on_one_revision_get_exactly_one_conflict(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.open_draft(_key())
    lock = threading.Lock()
    outcomes: list[str] = []

    def write(mutation_id: str) -> None:
        try:
            repo.run_mutation(_key(), _envelope(mutation_id, 0), _check)
            result = "ok"
        except RevisionConflict:
            result = "conflict"
        with lock:
            outcomes.append(result)

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(write, ["first", "second"]))

    assert sorted(outcomes) == ["conflict", "ok"]
    assert repo.open_draft(_key()).revision == 1


def test_a_retry_replays_the_stored_answer_without_running_again(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    first = repo.run_mutation(_key(), _envelope("m1", 0), _check)

    def must_not_run(_draft: Draft) -> Draft:
        raise AssertionError("a replay must not run the operation")

    assert repo.run_mutation(_key(), _envelope("m1", 0), must_not_run) == first


def test_a_reused_mutation_id_with_another_payload_is_a_conflict(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    other = MutationEnvelope(mutation_id="m1", expected_revision=0, payload={"x": 1})

    with pytest.raises(RevisionConflict, match="reused"):
        repo.run_mutation(_key(), other, _check)


def test_a_failing_operation_writes_nothing(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    def broken(draft: Draft) -> Draft:
        draft.document_checked = True
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        repo.run_mutation(_key(), _envelope("m1", 0), broken)

    draft = repo.open_draft(_key())
    assert (draft.revision, draft.checked_layer_ids) == (0, [])


def _submission(key: WorkspaceKey, revision: int) -> Submission:
    return Submission(
        submission_id=f"sub-{revision}",
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=revision,
        snapshots=[],
        decisions=[],
        checked_layer_ids=["hpo"],
        created_at="2026-10-14T12:00:00Z",
    )


def test_a_submission_is_stored_and_cannot_be_changed(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    submission = _submission(_key(), 1)

    repo.run_mutation(_key(), _envelope("submit", 0), lambda _d: submission)

    assert repo.get_submissions_for_workspace(_key()) == [submission]
    assert repo.get_submission("sub-1") == submission
    with (
        pytest.raises(DBAPIError, match="permission denied"),
        repo.db.transaction() as conn,
    ):
        conn.execute(text("UPDATE ontocurator.submissions SET mode = 'review'"))


def test_document_status_follows_drafts_and_submissions(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    def status() -> str:
        return repo.get_document_status("pkg-a", "doc-1", "ann-1", "independent")

    assert status() == "not_started"
    repo.open_draft(_key())
    assert status() == "not_started"
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    assert status() == "in_progress"
    repo.run_mutation(_key(), _envelope("m2", 1), lambda _d: _submission(_key(), 2))
    assert status() == "completed"
    assert repo.list_workspace_keys("pkg-a", "ann-1") == [_key()]


def test_a_new_draft_resumes_the_latest_submission(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    package = _sample_package("pkg-a")
    resumed = _submission(_key(), 7).model_copy(
        update={"snapshots": list(package.annotations.values())}
    )
    repo.run_mutation(_key(), _envelope("submit", 0), lambda _d: resumed)
    other_key = _key().model_copy(update={"target_set_id": "targets-0"})

    draft = repo.open_draft(other_key)

    assert draft.revision == 7
    assert draft.annotations == resumed.snapshots
```

The `# noqa: E402` imports keep this task's additions in one block; Task 7 moves every import to the top of the file.

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest tests/test_pg_repository.py -q`
Expected: the seven tests of Task 5 pass; the new ones fail with `AttributeError: 'Repository' object has no attribute 'open_draft'`.

- [ ] **Step 3: Append the draft and submission methods to the class**

Append to `src/ontocurator/storage/repository.py` (inside `class Repository`, after `_insert_search_event`):

```python

    # --- drafts and mutations ---------------------------------------------- #

    def list_workspace_keys(
        self,
        package_id: str,
        annotator_id: str,
        mode: str | None = None,
        document_id: str | None = None,
    ) -> list[WorkspaceKey]:
        """Workspace identities of one annotator: opened drafts and submissions."""
        profile = self.get_task_profile(package_id)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            drafts = select(
                DraftRow.document_id,
                DraftRow.mode,
                DraftRow.scope_id,
                DraftRow.target_set_id,
            ).where(
                DraftRow.project_id == project_id, DraftRow.annotator_id == annotator_id
            )
            submissions = select(SubmissionRow.payload).where(
                SubmissionRow.project_id == project_id,
                SubmissionRow.annotator_id == annotator_id,
            )
            if mode is not None:
                drafts = drafts.where(DraftRow.mode == mode)
                submissions = submissions.where(SubmissionRow.mode == mode)
            if document_id is not None:
                drafts = drafts.where(DraftRow.document_id == document_id)
                submissions = submissions.where(SubmissionRow.document_id == document_id)
            draft_rows = conn.execute(drafts).all()
            payloads = conn.execute(submissions).scalars().all()
        keys: dict[str, WorkspaceKey] = {}
        for row in draft_rows:
            key = WorkspaceKey(
                package_id=package_id,
                document_id=row.document_id,
                annotator_id=annotator_id,
                mode=row.mode,
                scope_id=row.scope_id,
                target_set_id=row.target_set_id,
            )
            keys[_key_str(key)] = key
        for payload in payloads:
            origin = WorkspaceKey.model_validate(payload["origin_key"])
            key = (
                origin
                if origin.package_id == package_id
                else _local_import_key(origin, package_id, profile)
            )
            keys.setdefault(_key_str(key), key)
        return sorted(
            keys.values(),
            key=lambda k: (k.document_id, k.mode, k.scope_id, k.target_set_id),
        )

    @staticmethod
    def _draft_row(conn: Connection, project_id: int, key_string: str) -> Row[Any] | None:
        return conn.execute(
            select(
                DraftRow.id,
                DraftRow.revision,
                DraftRow.checked_layer_ids,
                DraftRow.targets,
            ).where(DraftRow.project_id == project_id, DraftRow.draft_key == key_string)
        ).one_or_none()

    def open_draft(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> Draft:
        """Open or initialize the draft of a workspace key."""
        with self.db.transaction() as conn:
            return self._open_draft(conn, key, targets)

    def _open_draft(
        self, conn: Connection, key: WorkspaceKey, targets: ReviewTargetSet | None
    ) -> Draft:
        project_id = self._require_project(conn, key.package_id)
        key_string = _key_str(key)
        row = self._draft_row(conn, project_id, key_string)
        if row is None:
            self._create_draft(conn, project_id, key, key_string, targets)
            row = self._draft_row(conn, project_id, key_string)
            if row is None:
                raise DomainError("DRAFT_NOT_CREATED", key_string)
        annotations = (
            conn.execute(
                select(AnnotationSnapshotRow.payload)
                .join(
                    DraftAnnotationRow,
                    and_(
                        DraftAnnotationRow.annotation_id
                        == AnnotationSnapshotRow.annotation_id,
                        DraftAnnotationRow.version == AnnotationSnapshotRow.version,
                    ),
                )
                .where(
                    DraftAnnotationRow.draft_id == row.id,
                    AnnotationSnapshotRow.project_id == project_id,
                )
                .order_by(DraftAnnotationRow.annotation_id, DraftAnnotationRow.version)
            )
            .scalars()
            .all()
        )
        evidence = (
            conn.execute(
                select(EvidenceSnapshotRow.payload)
                .join(
                    DraftEvidenceRow,
                    and_(
                        DraftEvidenceRow.evidence_id == EvidenceSnapshotRow.evidence_id,
                        DraftEvidenceRow.version == EvidenceSnapshotRow.version,
                    ),
                )
                .where(
                    DraftEvidenceRow.draft_id == row.id,
                    EvidenceSnapshotRow.project_id == project_id,
                )
                .order_by(DraftEvidenceRow.evidence_id, DraftEvidenceRow.version)
            )
            .scalars()
            .all()
        )
        decisions = (
            conn.execute(
                select(ReviewDecisionRow.payload)
                .where(ReviewDecisionRow.draft_id == row.id)
                .order_by(ReviewDecisionRow.position)
            )
            .scalars()
            .all()
        )
        return Draft(
            key=key,
            targets=ReviewTargetSet.model_validate(row.targets),
            revision=int(row.revision),
            annotations=[decode_snapshot(p) for p in annotations],
            evidence=[EvidenceSnapshot.model_validate(p) for p in evidence],
            decisions=[ReviewDecision.model_validate(p) for p in decisions],
            checked_layer_ids=list(row.checked_layer_ids),
        )

    def _create_draft(
        self,
        conn: Connection,
        project_id: int,
        key: WorkspaceKey,
        key_string: str,
        targets: ReviewTargetSet | None,
    ) -> None:
        """Create the draft row; a new draft resumes the latest submission of its key."""
        effective = targets if targets is not None else ReviewTargetSet.create([])
        draft_id = conn.execute(
            pg_insert(DraftRow)
            .values(
                project_id=project_id,
                draft_key=key_string,
                document_id=key.document_id,
                annotator_id=key.annotator_id,
                mode=key.mode,
                scope_id=key.scope_id,
                target_set_id=key.target_set_id,
                targets=effective.model_dump(mode="json"),
                updated_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=["project_id", "draft_key"])
            .returning(DraftRow.id)
        ).scalar_one_or_none()
        if draft_id is None:
            return  # created by a concurrent request; the caller reads it
        submissions = self._submissions_for_workspace(conn, project_id, key)
        if not submissions:
            return
        current = latest_submissions(submissions)
        if len(current) != 1:
            raise DomainError(
                "AMBIGUOUS_SUBMISSION_ORIGIN",
                {
                    "message": "Cannot restore multiple submission origins into one draft",
                    "origins": [s.origin_key.model_dump() for s in current],
                },
            )
        latest = current[0]
        confirmed = {
            (d.target.annotation_id, d.target.version)
            for d in latest.decisions
            if d.outcome == "confirmed"
        }
        annotations = [
            a
            for a in latest.snapshots
            if key.mode != "review"
            or (a.annotation.annotation_id, a.version) not in confirmed
        ]
        evidence = [ev for a in annotations for ev in a.evidence]
        decisions = [
            # Rebind the local decision identity to this workspace.
            d.model_copy(
                update={
                    "decision_id": canonical_hash(
                        {"workspace": key.model_dump(), "target": d.target.model_dump()}
                    )
                }
            )
            for d in latest.decisions
        ]
        self._insert_snapshots(conn, project_id, annotations, evidence)
        self._write_draft_content(conn, draft_id, annotations, evidence, decisions)
        conn.execute(
            update(DraftRow)
            .where(DraftRow.id == draft_id)
            .values(
                targets=latest.targets.model_dump(mode="json"),
                revision=latest.draft_revision,
                checked_layer_ids=list(latest.checked_layer_ids),
            )
        )

    @staticmethod
    def _write_draft_content(
        conn: Connection,
        draft_id: int,
        annotations: list[AnnotationSnapshot],
        evidence: list[EvidenceSnapshot],
        decisions: list[ReviewDecision],
    ) -> None:
        """Insert the content rows of a draft whose previous rows are gone."""
        if annotations:
            conn.execute(
                pg_insert(DraftAnnotationRow).on_conflict_do_nothing(),
                [
                    {
                        "draft_id": draft_id,
                        "annotation_id": a.annotation.annotation_id,
                        "version": a.version,
                    }
                    for a in annotations
                ],
            )
        if evidence:
            conn.execute(
                pg_insert(DraftEvidenceRow).on_conflict_do_nothing(),
                [
                    {
                        "draft_id": draft_id,
                        "evidence_id": e.mention.evidence_id,
                        "version": e.version,
                    }
                    for e in evidence
                ],
            )
        if decisions:
            conn.execute(
                insert(ReviewDecisionRow),
                [
                    {
                        "draft_id": draft_id,
                        "decision_id": d.decision_id,
                        "position": position,
                        "target_id": d.target.annotation_id,
                        "target_version": d.target.version,
                        "outcome": d.outcome,
                        "replacement_id": d.replacement.annotation_id
                        if d.replacement
                        else None,
                        "replacement_version": d.replacement.version
                        if d.replacement
                        else None,
                        "note": d.note,
                        "reviewer_id": d.reviewer_id,
                        "payload": d.model_dump(mode="json"),
                    }
                    for position, d in enumerate(decisions)
                ],
            )

    def run_mutation(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        operation: Callable[[Draft], Draft | Submission],
    ) -> Draft | Submission:
        """Run ``operation`` on the draft at the expected revision, exactly once.

        Writers of one draft are serialised by a transaction-scoped advisory
        lock. A retried mutation ID with the same payload replays the stored
        response; with another payload it is a conflict.
        """
        key_string = _key_str(key)
        request_hash = canonical_hash(envelope.model_dump())
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, key.package_id)
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(
                        _lock_id("draft", key.package_id, key_string)
                    )
                )
            )
            receipt = conn.execute(
                select(MutationReceiptRow.request_hash, MutationReceiptRow.response).where(
                    MutationReceiptRow.project_id == project_id,
                    MutationReceiptRow.workspace_key == key_string,
                    MutationReceiptRow.mutation_id == envelope.mutation_id,
                )
            ).one_or_none()
            if receipt is not None:
                if receipt.request_hash != request_hash:
                    raise RevisionConflict(
                        "Mutation ID reused with different payload: "
                        f"{envelope.mutation_id}"
                    )
                if "submission_id" in receipt.response:
                    return Submission.model_validate(receipt.response)
                return Draft.model_validate(receipt.response)

            row = self._draft_row(conn, project_id, key_string)
            current_revision = 0 if row is None else int(row.revision)
            if current_revision != envelope.expected_revision:
                raise RevisionConflict(
                    f"REVISION_CONFLICT: Expected revision "
                    f"{envelope.expected_revision}, current is {current_revision}"
                )
            result = operation(self._open_draft(conn, key, None))
            draft_row = self._draft_row(conn, project_id, key_string)
            if draft_row is None:
                raise DomainError("DRAFT_NOT_CREATED", key_string)
            now = datetime.now(UTC)
            new_revision = current_revision + 1
            response: dict[str, Any]
            if isinstance(result, Draft):
                result.revision = new_revision
                conn.execute(
                    update(DraftRow)
                    .where(DraftRow.id == draft_row.id)
                    .values(
                        revision=new_revision,
                        checked_layer_ids=list(result.checked_layer_ids),
                        updated_at=now,
                    )
                )
                conn.execute(
                    delete(DraftAnnotationRow).where(
                        DraftAnnotationRow.draft_id == draft_row.id
                    )
                )
                conn.execute(
                    delete(DraftEvidenceRow).where(
                        DraftEvidenceRow.draft_id == draft_row.id
                    )
                )
                conn.execute(
                    delete(ReviewDecisionRow).where(
                        ReviewDecisionRow.draft_id == draft_row.id
                    )
                )
                self._insert_snapshots(
                    conn, project_id, result.annotations, result.evidence
                )
                self._write_draft_content(
                    conn,
                    draft_row.id,
                    result.annotations,
                    result.evidence,
                    result.decisions,
                )
                response = _draft_payload(result)
            elif isinstance(result, Submission):
                conn.execute(
                    update(DraftRow)
                    .where(DraftRow.id == draft_row.id)
                    .values(revision=new_revision, updated_at=now)
                )
                self._insert_submission(conn, project_id, result, local_key=key_string)
                response = _submission_payload(result)
            else:
                raise ValueError(f"Unsupported operation return type: {type(result)}")
            conn.execute(
                insert(MutationReceiptRow).values(
                    project_id=project_id,
                    workspace_key=key_string,
                    mutation_id=envelope.mutation_id,
                    request_hash=request_hash,
                    response=response,
                    created_at=now,
                )
            )
            return result

    def get_document_status(
        self,
        package_id: str,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> Literal["not_started", "in_progress", "completed"]:
        """Progress of one annotator in one mode on one document."""
        keys = self.list_workspace_keys(package_id, annotator_id, mode, document_id)
        any_completed = False
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            for key in keys:
                current = latest_submissions(
                    self._submissions_for_workspace(conn, project_id, key)
                )
                row = self._draft_row(conn, project_id, _key_str(key))
                if current:
                    any_completed = True
                    # Never compare a draft revision across unrelated origins.
                    if row is not None and (
                        len(current) != 1 or row.revision > current[0].draft_revision
                    ):
                        return "in_progress"
                    continue
                if row is None:
                    continue
                if row.revision > 0 or row.checked_layer_ids:
                    return "in_progress"
                has_content = conn.execute(
                    select(
                        exists().where(DraftAnnotationRow.draft_id == row.id)
                        | exists().where(ReviewDecisionRow.draft_id == row.id)
                    )
                ).scalar_one()
                if has_content:
                    return "in_progress"
        return "completed" if any_completed else "not_started"

    # --- submissions -------------------------------------------------------- #

    @staticmethod
    def _submissions_for_workspace(
        conn: Connection, project_id: int, key: WorkspaceKey
    ) -> list[Submission]:
        stored = (
            conn.execute(
                select(SubmissionRow.payload)
                .where(
                    SubmissionRow.project_id == project_id,
                    SubmissionRow.local_key.in_(_workspace_aliases(key)),
                )
                .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
            )
            .scalars()
            .all()
        )
        return [Submission.model_validate(p) for p in stored]

    def get_submissions_for_workspace(self, key: WorkspaceKey) -> list[Submission]:
        """Submissions bound to this workspace key, oldest first."""
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, key.package_id)
            if project_id is None:
                return []
            return self._submissions_for_workspace(conn, project_id, key)

    def get_submissions_for_document(
        self, package_id: str, document_id: str
    ) -> list[Submission]:
        """Every submission of the project for one document."""
        with self.db.transaction() as conn:
            stored = (
                conn.execute(
                    select(SubmissionRow.payload)
                    .join(ProjectRow, ProjectRow.id == SubmissionRow.project_id)
                    .where(
                        ProjectRow.project_key == package_id,
                        SubmissionRow.document_id == document_id,
                    )
                    .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
                )
                .scalars()
                .all()
            )
        return [Submission.model_validate(p) for p in stored]

    def get_submission(
        self, submission_id: str, package_id: str | None = None
    ) -> Submission | None:
        """A submission by ID, within a project when ``package_id`` is given."""
        statement = select(SubmissionRow.payload).where(
            SubmissionRow.submission_id == submission_id
        )
        if package_id is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == SubmissionRow.project_id
            ).where(ProjectRow.project_key == package_id)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else Submission.model_validate(stored)
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `uv run pytest tests/test_pg_repository.py -q`
Expected: `15 passed`

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check --fix --ignore F401 src/ontocurator/storage/repository.py tests/test_pg_repository.py
uv run ruff format src/ontocurator/storage/repository.py tests/test_pg_repository.py
uv run mypy src
git add src/ontocurator/storage/repository.py tests/test_pg_repository.py
git commit -m "feat(storage): drafts, idempotent mutations and submissions on PostgreSQL"
```

---

### Task 7: Repository, part 3: search events and project export

**Files:**
- Modify: `src/ontocurator/storage/repository.py` (append to the class)
- Test: `tests/test_pg_repository.py` (append, then tidy the imports)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_pg_repository.py`:

```python
from ontocurator.packages.models import SearchEventRecord  # noqa: E402


def _walk(event_id: str, key: WorkspaceKey, candidates: list[str]) -> SearchEventRecord:
    return SearchEventRecord(
        event_id=event_id,
        workspace_key=key,
        annotation_id="ann-1",
        query="",
        route="browse",
        candidates=candidates,
        ranked_ids=list(candidates),
        layer_id="hpo-layer",
        ontology_release="2026-06-23",
        index_identity="tree",
        timestamp="2026-10-14T12:00:00Z",
    )


def test_a_search_event_belongs_to_its_project(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.import_package(_sample_package("pkg-b"))
    event = _walk("walk-1", _key(), ["HP:0001252"])

    repo.save_search_event(event)

    assert repo.get_search_event("walk-1") == event
    assert repo.get_search_event("walk-1", "pkg-a") == event
    assert repo.get_search_event("walk-1", "pkg-b") is None
    assert repo.get_search_events_for_workspace(_key()) == [event]
    assert repo.get_search_events_for_workspace(_key("pkg-b")) == []


def test_a_walk_grows_only_for_its_owner(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.save_search_event(_walk("walk-1", _key(), ["HP:0001252"]))

    grown = repo.append_search_event_candidates(
        "walk-1", ["HP:0001250", "HP:0001252"], workspace_key=_key()
    )
    foreign = repo.append_search_event_candidates(
        "walk-1", ["HP:0000001"], workspace_key=_key(annotator_id="ann-2")
    )

    assert grown is not None
    assert grown.candidates == ["HP:0001252", "HP:0001250"]
    assert foreign is None
    stored = repo.get_search_event("walk-1", "pkg-a")
    assert stored is not None and stored.candidates == ["HP:0001252", "HP:0001250"]


def test_an_export_contains_proposals_drafts_history_and_events(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    package = _sample_package("pkg-a")
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    submission = _submission(_key(), 2)
    repo.run_mutation(_key(), _envelope("m2", 1), lambda _d: submission)
    event = _walk("walk-1", _key(), ["HP:0001252"])
    repo.save_search_event(event)

    exported = repo.export_package("pkg-a")

    assert exported.manifest == package.manifest
    assert exported.documents == package.documents
    assert exported.annotations == package.annotations
    assert exported.evidence == package.evidence
    assert exported.submissions == {"sub-2": submission}
    assert exported.search_events == [event]
```

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest tests/test_pg_repository.py -q`
Expected: the new tests fail with `AttributeError: 'Repository' object has no attribute 'save_search_event'`.

- [ ] **Step 3: Append the search-event and export methods to the class**

Append to `src/ontocurator/storage/repository.py` (inside `class Repository`, after `get_submission`):

```python

    # --- search events ------------------------------------------------------ #

    def save_search_event(self, event: SearchEventRecord) -> None:
        """Store a new event in the project of its workspace."""
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, event.workspace_key.package_id)
            self._insert_search_event(
                conn,
                project_id,
                event,
                local_key=_key_str(event.workspace_key),
                imported=False,
            )

    def get_search_event(
        self, event_id: str, package_id: str | None = None
    ) -> SearchEventRecord | None:
        """The event with this ID; within a project when ``package_id`` is given.

        Without a project, an ID stored in several projects must have the same
        content everywhere; otherwise the lookup is ambiguous.
        """
        statement = select(SearchEventRow.payload).where(
            SearchEventRow.event_id == event_id
        )
        with self.db.transaction() as conn:
            if package_id is not None:
                project_id = self._project_id(conn, package_id)
                if project_id is None:
                    return None
                statement = statement.where(SearchEventRow.project_id == project_id)
            stored = conn.execute(statement).scalars().all()
        events = [SearchEventRecord.model_validate(p) for p in stored]
        if not events:
            return None
        if any(e != events[0] for e in events[1:]):
            raise DomainError("AMBIGUOUS_SEARCH_EVENT", {"event_id": event_id})
        return events[0]

    def append_search_event_candidates(
        self,
        event_id: str,
        term_ids: Iterable[str],
        *,
        workspace_key: WorkspaceKey | None = None,
        annotation_id: str | None = None,
        layer_id: str | None = None,
    ) -> SearchEventRecord | None:
        """Add newly shown terms to a stored tree walk, in order of first appearance.

        Only a walk grows. ``workspace_key``, ``annotation_id`` and ``layer_id``
        name the owner the caller acts for; the event must belong to each one
        that is given. Returns None, and stores nothing, for an unknown event
        and for one that fails these checks. The row is locked while it grows,
        so two requests of one walk cannot lose each other's terms.
        """
        with self.db.transaction() as conn:
            statement = select(SearchEventRow.project_id, SearchEventRow.payload).where(
                SearchEventRow.event_id == event_id
            )
            if workspace_key is not None:
                project_id = self._project_id(conn, workspace_key.package_id)
                if project_id is None:
                    return None
                statement = statement.where(SearchEventRow.project_id == project_id)
            rows = conn.execute(statement.with_for_update()).all()
            if len(rows) != 1:
                return None
            event = SearchEventRecord.model_validate(rows[0].payload)
            if (
                not is_tree_walk(event)
                or (workspace_key is not None and event.workspace_key != workspace_key)
                or (annotation_id is not None and event.annotation_id != annotation_id)
                or (layer_id is not None and event.layer_id != layer_id)
            ):
                return None
            known = set(event.candidates)
            added = [t for t in dict.fromkeys(term_ids) if t not in known]
            if added:
                event.candidates = [*event.candidates, *added]
                event.ranked_ids = [*event.ranked_ids, *added]
                conn.execute(
                    update(SearchEventRow)
                    .where(
                        SearchEventRow.project_id == rows[0].project_id,
                        SearchEventRow.event_id == event_id,
                    )
                    .values(payload=event.model_dump(mode="json"))
                )
            return event

    def get_search_events_for_workspace(
        self, key: WorkspaceKey
    ) -> list[SearchEventRecord]:
        """Events written in, or imported into, this workspace, in written order."""
        aliases = _workspace_aliases(key)
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, key.package_id)
            if project_id is None:
                return []
            stored = (
                conn.execute(
                    select(SearchEventRow.payload)
                    .where(
                        SearchEventRow.project_id == project_id,
                        or_(
                            SearchEventRow.workspace_key.in_(aliases),
                            SearchEventRow.local_key.in_(aliases),
                        ),
                    )
                    .order_by(SearchEventRow.seq)
                )
                .scalars()
                .all()
            )
        return [SearchEventRecord.model_validate(p) for p in stored]

    # --- export ------------------------------------------------------------- #

    def export_package(
        self, package_id: str, *, include_captured_conditions: bool = True
    ) -> ValidatedPackage:
        """Everything of a project as an in-memory package."""
        with self.db.transaction() as conn:
            project = conn.execute(
                select(ProjectRow.id, ProjectRow.manifest).where(
                    ProjectRow.project_key == package_id
                )
            ).one_or_none()
            if project is None:
                raise InvalidPackage(f"Package '{package_id}' not found")
            project_id = project.id
            manifest = PackageManifest.model_validate(project.manifest)
            documents = {
                row.document_id: Document(
                    document_id=row.document_id,
                    text=row.text,
                    language=row.language,
                    text_sha256=row.text_sha256,
                )
                for row in conn.execute(
                    select(
                        DocumentRow.document_id,
                        DocumentRow.text,
                        DocumentRow.language,
                        DocumentRow.text_sha256,
                    ).where(DocumentRow.project_id == project_id)
                )
            }
            in_drafts = (
                exists()
                .where(DraftRow.project_id == project_id)
                .where(DraftAnnotationRow.draft_id == DraftRow.id)
                .where(DraftAnnotationRow.annotation_id == AnnotationSnapshotRow.annotation_id)
                .where(DraftAnnotationRow.version == AnnotationSnapshotRow.version)
            )
            proposed = (
                exists()
                .where(ProposalAnnotationRow.project_id == project_id)
                .where(
                    ProposalAnnotationRow.annotation_id
                    == AnnotationSnapshotRow.annotation_id
                )
                .where(ProposalAnnotationRow.version == AnnotationSnapshotRow.version)
            )
            annotation_payloads = (
                conn.execute(
                    select(AnnotationSnapshotRow.payload).where(
                        AnnotationSnapshotRow.project_id == project_id,
                        or_(proposed, in_drafts),
                    )
                )
                .scalars()
                .all()
            )
            evidence_in_drafts = (
                exists()
                .where(DraftRow.project_id == project_id)
                .where(DraftEvidenceRow.draft_id == DraftRow.id)
                .where(DraftEvidenceRow.evidence_id == EvidenceSnapshotRow.evidence_id)
                .where(DraftEvidenceRow.version == EvidenceSnapshotRow.version)
            )
            evidence_proposed = (
                exists()
                .where(ProposalEvidenceRow.project_id == project_id)
                .where(ProposalEvidenceRow.evidence_id == EvidenceSnapshotRow.evidence_id)
                .where(ProposalEvidenceRow.version == EvidenceSnapshotRow.version)
            )
            evidence_payloads = (
                conn.execute(
                    select(EvidenceSnapshotRow.payload).where(
                        EvidenceSnapshotRow.project_id == project_id,
                        or_(evidence_proposed, evidence_in_drafts),
                    )
                )
                .scalars()
                .all()
            )
            submission_payloads = (
                conn.execute(
                    select(SubmissionRow.payload)
                    .where(SubmissionRow.project_id == project_id)
                    .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
                )
                .scalars()
                .all()
            )
            event_payloads = (
                conn.execute(
                    select(SearchEventRow.payload)
                    .where(SearchEventRow.project_id == project_id)
                    .order_by(SearchEventRow.seq)
                )
                .scalars()
                .all()
            )
            conditions = (
                self._search_conditions(conn, project_id)
                if include_captured_conditions
                else None
            )
        if conditions is not None:
            manifest = manifest.model_copy(update={"search_conditions": conditions})
        annotations: dict[tuple[str, str], AnnotationSnapshot] = {}
        for payload in annotation_payloads:
            snap = decode_snapshot(payload)
            annotations[(snap.annotation.annotation_id, snap.version)] = snap
        evidence: dict[tuple[str, str], EvidenceSnapshot] = {}
        for payload in evidence_payloads:
            ev = EvidenceSnapshot.model_validate(payload)
            evidence[(ev.mention.evidence_id, ev.version)] = ev
        submissions = {
            s.submission_id: s
            for s in (Submission.model_validate(p) for p in submission_payloads)
        }
        declared = {
            item.resource_path
            for condition in manifest.search_conditions or []
            for item in condition.translations
        }
        # A first capture can commit after the condition read above. Its bytes
        # are only part of this export if this manifest observed their declaration.
        embedded_files = {
            path: content
            for path, content in self.get_embedded_files(package_id).items()
            if not path.startswith("search-resources/") or path in declared
        }
        return ValidatedPackage(
            manifest=manifest,
            documents=documents,
            annotations=annotations,
            evidence=evidence,
            submissions=submissions,
            search_events=[SearchEventRecord.model_validate(p) for p in event_payloads],
            embedded_files=embedded_files,
        )
```

- [ ] **Step 4: Move every test import to the top of the file**

In `tests/test_pg_repository.py`, delete the `# noqa: E402` import lines added in Tasks 6 and 7 and put their imports into the import block at the top:

```python
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from test_storage import _sample_package

from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError, InvalidPackage, RevisionConflict
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import Draft, MutationEnvelope, Submission, WorkspaceKey
from ontocurator.packages.models import SearchEventRecord
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import StoredFileRow
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `uv run pytest tests/test_pg_repository.py -q`
Expected: `18 passed`

- [ ] **Step 6: Lint (now without exceptions) and commit**

```bash
uv run ruff check --fix src/ontocurator/storage/repository.py tests/test_pg_repository.py
uv run ruff format src/ontocurator/storage/repository.py tests/test_pg_repository.py
uv run mypy src
git add src/ontocurator/storage/repository.py tests/test_pg_repository.py
git commit -m "feat(storage): search provenance and project export on PostgreSQL"
```

Expected: Ruff reports no unused import; every import of the repository module is used now.

---

### Task 8: Switch the application and the test suite to PostgreSQL

One commit switches the application, the CLI and every test from the SQLite storage to the PostgreSQL storage. A script makes the mechanical changes; the places that issued raw SQL against the old tables are changed by hand, with the replacements given below. Tests that only checked SQLite file formats are deleted, because there are no SQLite workspaces any more (E6).

**Files:**
- Modify: `src/ontocurator/config.py`, `src/ontocurator/api/app.py`, `src/ontocurator/cli.py`, `src/ontocurator/storage/__init__.py`, `src/ontocurator/application/editing.py`, `src/ontocurator/api/tree_routes.py`, every `src` importer of `sqlite_repository`
- Modify: `tests/pg_harness.py` (helpers for the manual edits)
- Modify: about 25 test files (script plus manual edits)
- Create: `tests/test_cli_db.py`

- [ ] **Step 1: Point the source at the new storage**

```bash
grep -rl "sqlite_repository\|sqlite_database" src | grep -v "storage/sqlite_" \
  | xargs sed -i -e 's/ontocurator\.storage\.sqlite_repository/ontocurator.storage.repository/g' \
                 -e 's/ontocurator\.storage\.sqlite_database/ontocurator.storage.database/g'
```

Expected: `grep -rn "sqlite_" src --include=*.py | grep -v "storage/sqlite_"` prints nothing.

- [ ] **Step 2: Replace `database_path` by `database_url` in the configuration**

In `src/ontocurator/config.py`, replace the line

```python
    database_path: Path | None = None
```

with

```python
    # PostgreSQL URL of the application role. None: ONTOCURATOR_DATABASE_URL.
    database_url: str | None = None
```

In `src/ontocurator/api/app.py`, add `from ontocurator import settings` to the imports and replace

```python
        db_path = config.database_path or (config.workspace_dir / "editor.db")
        db = Database(db_path)
        repo = Repository(db)
```

with

```python
        db = Database(
            settings.resolve_database_url(config.database_url, config.workspace_dir),
            data_dir=config.workspace_dir,
        )
        repo = Repository(db)
```

Uploaded and embedded files now live in `<workspace>/blobs/`.

- [ ] **Step 3: Add `--database-url` to `serve` and the `db upgrade` command**

In `src/ontocurator/cli.py`, add this parameter to `serve` directly after the `workspace` parameter:

```python
    database_url: Annotated[
        str | None,
        typer.Option(
            "--database-url",
            help=(
                "PostgreSQL URL of the application role. Default: "
                "ONTOCURATOR_DATABASE_URL, with the password from "
                "ONTOCURATOR_DATABASE_PASSWORD or ONTOCURATOR_DATABASE_PASSWORD_FILE."
            ),
            show_default=False,
        ),
    ] = None,
```

In the `AppConfig(...)` call inside `serve`, replace `database_path=ws / "editor.db",` with `database_url=database_url,`.

Insert the `db` command group before the section comment `# Zero-CLI entry point`:

```python
db_app = typer.Typer(help="Database schema (PostgreSQL).", no_args_is_help=True)
app.add_typer(db_app, name="db")


@db_app.command("upgrade")
def db_upgrade() -> None:
    """Upgrade the schema to this version, as the schema owner.

    Reads ONTOCURATOR_MIGRATION_DATABASE_URL and the password from
    ONTOCURATOR_MIGRATION_DATABASE_PASSWORD or ..._PASSWORD_FILE.
    """
    from ontocurator.settings import SettingsError, database_url
    from ontocurator.storage.schema import upgrade

    try:
        head = upgrade(database_url(prefix="ONTOCURATOR_MIGRATION_DATABASE"))
    except SettingsError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"Database schema is at revision {head}.")
```

Add `"db",` to `PASSTHROUGH_FIRST_ARGS`, so `ontocurator db upgrade` is not routed to `serve`.

- [ ] **Step 4: Search events are looked up within the project**

In `src/ontocurator/application/editing.py`, replace

```python
                event = self.repo.get_search_event(cmd.search_event_id)
```

with

```python
                event = self.repo.get_search_event(
                    cmd.search_event_id, key.package_id
                )
```

In `src/ontocurator/api/tree_routes.py`, replace

```python
    event = repo.get_search_event(req.browse_id)
```

with

```python
    event = repo.get_search_event(req.browse_id, req.workspace_key.package_id)
```

- [ ] **Step 5: Export the new classes from `storage/__init__.py`**

Replace the content of `src/ontocurator/storage/__init__.py` with:

```python
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository

__all__ = ["Database", "Repository"]
```

- [ ] **Step 6: Add helpers for the hand-edited tests to the harness**

Append to `tests/pg_harness.py`:

```python
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
```

- [ ] **Step 7: Convert the test suite mechanically**

Save this script outside the repository, for example as `$TEMP/convert_tests.py`, and run it from the worktree root:

```python
"""One-off: point the test suite at the PostgreSQL storage (T2a Task 8)."""

import re
from pathlib import Path

SKIP = {
    "pg_harness.py",
    "conftest.py",
    "test_pg_repository.py",
    "test_schema.py",
    "test_database.py",
    "test_settings.py",
    "test_blobs.py",
}
IMPORT_LINE = re.compile(r"^(import |from )", re.M)


def add_import(source: str, line: str) -> str:
    """Insert ``line`` before the first top-level import (Ruff sorts it later)."""
    match = IMPORT_LINE.search(source)
    index = match.start() if match else 0
    return source[:index] + line + "\n" + source[index:]


for path in sorted(Path("tests").glob("*.py")):
    if path.name in SKIP:
        continue
    source = path.read_text(encoding="utf-8")
    original = source
    source = source.replace(
        "ontocurator.storage.sqlite_repository", "ontocurator.storage.repository"
    )
    source = source.replace(
        "from ontocurator.storage import sqlite_repository as",
        "from ontocurator.storage import repository as",
    )
    source = re.sub(
        r"^([ \t]*)from ontocurator\.storage\.sqlite_database import Database\n",
        r"\1from pg_harness import database_for\n",
        source,
        flags=re.M,
    )
    source = re.sub(r"\bDatabase\(", "database_for(", source)
    source = re.sub(
        r"^[ \t]*[\w.\[\]\"']+\.run_migrations\(\)[ \t]*\n", "", source, flags=re.M
    )
    if "database_path=" in source:
        source = re.sub(
            r"database_path=([^,\n]+)", r"database_url=database_url_for(\1)", source
        )
        source = add_import(source, "from pg_harness import database_url_for")
    if "database_for(" in source and "import database_for" not in source:
        source = add_import(source, "from pg_harness import database_for")
    if source != original:
        path.write_text(source, encoding="utf-8")
        print(f"converted {path}")
```

Run: `uv run python "$TEMP/convert_tests.py"`
Expected: a list of `converted tests/...` lines, among them `test_storage.py`, `test_editing.py`, `test_reviews.py`, `test_api.py`, `test_tree_api.py` and `browser_server.py`.

- [ ] **Step 8: Delete the tests that only checked SQLite files**

Delete these test functions completely (decorators included):

| File | Functions |
|---|---|
| `tests/test_storage.py` | `test_legacy_v2_database_rejected_byte_identically`, `test_legacy_v1_database_rejected_byte_identically` |
| `tests/test_storage_regressions.py` | `test_legacy_database_rejected_byte_identically` |
| `tests/test_compatibility.py` | `test_frozen_v2_workspace_is_cleanly_rejected_and_byte_identical` |
| `tests/test_layered_editing.py` | `test_old_database_rejected_unsupported_workspace_version_and_byte_identical`, `test_fresh_database_initializes_v4_format` |
| `tests/test_review_findings.py` | `test_schema_init_is_atomic`, `test_database_reopens_path_with_uri_special_characters`, `test_fresh_schema_contains_ontology_resources_and_no_legacy_migrations` |
| `tests/test_followup_findings.py` | `test_legacy_colon_workspace_key_is_found_and_migrated`, `test_mutation_on_legacy_key_does_not_create_second_workspace`, `test_empty_duplicate_from_unfixed_build_is_replaced_by_legacy_row`, `test_legacy_row_of_other_colliding_key_is_not_adopted`, and the helpers `_legacy_key_str` and `_write_legacy_workspace` |

In `tests/test_followup_findings.py` also delete the section comment `# --- Finding 1: legacy ':'-joined workspace keys stay reachable --- #`. Keep `_colon_key` and `_search_event`, which later tests use; delete either one if `grep -n "_colon_key\|_search_event(" tests/test_followup_findings.py` shows only its definition.

- [ ] **Step 9: Replace the raw SQL in the remaining tests**

Each block below replaces SQL against the old SQLite tables. Import the helpers with `from pg_harness import ...` at the top of the file.

1. `tests/test_api_regressions.py`, the test that inserts `ann-target-1` (≈ line 114): replace everything from `db_conn = client.app.state.repo.db.get_connection()` through `db_conn.commit()` with

   ```python
    insert_proposal(client.app.state.repo, pkg_id, snap)
   ```

   and delete the now unused local import of `encode_snapshot`.

2. `tests/test_api_regressions.py`, the test that checks the persisted search event (≈ line 192): replace the `row = (...)` block and the assertion after it with

   ```python
    stored = client.app.state.repo.get_search_event(event.event_id)
    assert stored is not None
    assert stored.ontology_release == "2026-06-23"
   ```

3. `tests/test_demo_fixture.py` (≈ line 62): replace the `len(api_app.state.repo.db.get_connection()...fetchall())` expression with `len(api_app.state.repo.list_manifests())`.

4. `tests/test_layered_workflows.py`, both places (≈ lines 354 and 445): replace the three `repo.db.get_connection()...` statements with

   ```python
    insert_proposal(repo, "pkg-scenario-c", snap)
   ```

5. `tests/test_scientific_review_integrity.py`, `test_status_uses_revision_even_when_last_clock_is_older`: replace the `ctx["repo"].db.get_connection().execute(...)` statement with

   ```python
    tamper(
        ctx["repo"].db,
        "submissions",
        "UPDATE ontocurator.submissions SET created_at = :at WHERE submission_id = :id",
        at="2099-01-01",
        id=first.submission_id,
    )
   ```

6. `tests/test_scientific_review_integrity.py` (≈ line 478): replace the `clean.db.get_connection().execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]` expression with `count_rows(clean, "drafts")`.

7. `tests/test_storage.py`, `test_import_package_rollback_on_failure`: replace the five lines from `c = db.get_connection().cursor()` to the second `assert` with

   ```python
    assert count_rows(repo, "projects") == 0
    assert count_rows(repo, "documents") == 0
   ```

8. `tests/test_storage.py`, `test_export_p_import_q_preserves_historical_submission`: replace the three lines from `c2 = db2.get_connection().cursor()` to the `assert c2.fetchone()[0] == 0` with

   ```python
    assert repo2.manifest_hash("pkg-P") is None
   ```

9. `tests/test_storage_regressions.py`, `test_independent_import_resumes_at_default_api_key`: replace the block from `local_key = (` through the `UPDATE imported_submission_bindings` statement with

   ```python
        (local_key,) = column_values(repo, "submissions", "local_key")
        assert local_key.endswith(":targets-0")
        # Earlier databases can still contain the pre-fix canonical binding.
        from ontocurator.storage.repository import _key_str

        tamper(
            repo.db,
            "submissions",
            "UPDATE ontocurator.submissions SET local_key = :k",
            k=_key_str(key_for()),
        )
   ```

10. `tests/test_cli_standalone.py`, `test_database_closed_after_server_stops`: replace `assert captured["db"]._connections == []` with `assert captured["db"].engine.pool.checkedout() == 0`.

- [ ] **Step 10: Check that no SQLite access is left in the tests**

Run: `grep -nE "get_connection|sqlite3|sqlite_|\.fetchone\(|\.cursor\(" tests/*.py`
Expected: no output.

- [ ] **Step 11: Write the CLI test for `db upgrade`**

Create `tests/test_cli_db.py`:

```python
"""``ontocurator db upgrade`` brings a bootstrapped database to the current schema."""

from pathlib import Path

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine
from typer.testing import CliRunner

from ontocurator.cli import app
from ontocurator.storage.schema import current_revision, head_revision

runner = CliRunner()


def test_upgrade_migrates_once_and_then_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = unmigrated_database_url(tmp_path / "fresh.db")
    monkeypatch.setenv("ONTOCURATOR_MIGRATION_DATABASE_URL", url)

    first = runner.invoke(app, ["db", "upgrade"])
    second = runner.invoke(app, ["db", "upgrade"])

    assert first.exit_code == 0, first.output
    assert second.exit_code == 0, second.output
    assert f"Database schema is at revision {head_revision()}." in second.output
    engine = create_engine(url)
    with engine.connect() as conn:
        assert current_revision(conn) == head_revision()
    engine.dispose()


def test_upgrade_without_a_url_explains_what_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ONTOCURATOR_MIGRATION_DATABASE_URL", raising=False)

    result = runner.invoke(app, ["db", "upgrade"])

    assert result.exit_code == 1
    assert "ONTOCURATOR_MIGRATION_DATABASE_URL is not set" in result.output
```

- [ ] **Step 12: Run the whole suite**

Run: `uv run ruff check --fix tests src && uv run ruff format tests src && uv run pytest -q`
Expected: all tests pass. The count is the baseline count minus the 13 deleted tests plus the new ones (settings 13, blobs 7, schema 13, database 4, repository 18, CLI 2).

If a test fails:
- **An assertion on the order of a list** (proposals, draft annotations, submissions, events) means the test relied on an order SQLite produced without `ORDER BY`. Compare with the orders listed at the top of Task 6 and change the **test** to compare sets or to sort, unless the order is visible to the user. In that case keep the SQLite order in the repository query and add a test for it in `tests/test_pg_repository.py`.
- **`permission denied` or `append-only`:** a test changes history directly. Use `tamper()` as in Step 9.
- **Too many connections:** a test keeps more than 10 open `Database` objects. The autouse fixture closes them only at the end of the test.

- [ ] **Step 13: Lint and commit**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src
git add -A src tests
git commit -m "feat(storage): run the editor and its test suite on PostgreSQL"
```

---

### Task 9: Remove the SQLite storage, update the build scripts, verify everything

**Files:**
- Delete: `src/ontocurator/storage/sqlite_database.py`, `src/ontocurator/storage/sqlite_repository.py`, `src/ontocurator/storage/schema_v4.sql`, `src/ontocurator/storage/ontology_resources.sql`, `src/ontocurator/storage/search_conditions.sql`
- Modify: `scripts/build_release.py`, `scripts/build_standalone.py`, `tests/test_standalone_packaging.py`
- Modify: `frontend/playwright.config.ts`
- Create: `scripts/check.sh`

- [ ] **Step 1: Delete the old storage**

```bash
git rm src/ontocurator/storage/sqlite_database.py src/ontocurator/storage/sqlite_repository.py \
       src/ontocurator/storage/schema_v4.sql src/ontocurator/storage/ontology_resources.sql \
       src/ontocurator/storage/search_conditions.sql
```

Run: `grep -rn "sqlite\|\.sql\b" src --include=*.py`
Expected: no output.

- [ ] **Step 2: The wheel ships the migrations instead of the SQL scripts**

In `scripts/build_release.py`, replace the three `ontocurator/storage/*.sql` entries of `REQUIRED_WHEEL_FILES` with:

```python
    "ontocurator/storage/migrations/env.py",
    "ontocurator/storage/migrations/script.py.mako",
    "ontocurator/storage/migrations/versions/0001_initial.py",
```

In `scripts/build_standalone.py`, replace the three `--add-data=...sql...` lines with:

```python
        f"--add-data={STORAGE_DIR / 'migrations'}{sep}ontocurator/storage/migrations",
```

In `tests/test_standalone_packaging.py`:
- in `test_pyinstaller_args`, replace `assert any("search_conditions.sql" in arg for arg in args)` with `assert any("migrations" in arg for arg in args)`;
- in `test_build_release_wheel_check`, replace the `"ontocurator/storage/search_conditions.sql"` membership assertion with `assert "ontocurator/storage/migrations/env.py" in build_release.REQUIRED_WHEEL_FILES`.

The standalone build itself is removed in T2b (P1); this only keeps its tests honest until then.

- [ ] **Step 3: Give the browser fixture server time to start PostgreSQL**

`tests/browser_server.py` already gets its database from `pg_harness.database_url_for` (Task 8). Its first start launches a container. In `frontend/playwright.config.ts`, change `timeout: 60_000,` to `timeout: 180_000,`.

- [ ] **Step 4: Write the local gate**

Create `scripts/check.sh`:

```bash
#!/usr/bin/env bash
# The complete local gate. There is no CI (T2 index R2); run this before a merge.
# Docker must be running: the backend and browser tests use PostgreSQL containers.
set -euo pipefail
cd "$(dirname "$0")/.."

uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run python scripts/export_openapi.py --check
npm --prefix frontend run typecheck
npm --prefix frontend run api:check
npm --prefix frontend test
uv run pytest -q
npm --prefix frontend run test:e2e
echo "All local checks passed."
```

Run: `chmod +x scripts/check.sh` (Git records the mode; on Windows run `git update-index --chmod=+x scripts/check.sh` after `git add`).

- [ ] **Step 5: Run the complete gate**

Run: `scripts/check.sh`
Expected: every step passes and the last line is `All local checks passed.` The browser suite runs against the real backend on PostgreSQL. The OpenAPI and TypeScript drift checks pass unchanged, because no API model changed.

- [ ] **Step 6: Commit**

```bash
git add -A scripts src tests frontend/playwright.config.ts
git update-index --chmod=+x scripts/check.sh
git commit -m "chore(storage): remove the SQLite storage and add the local check script"
```

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| P1: evolve in place, keep domain/ontology/search and their tests | Tasks 5–8: repository interface unchanged, about 500 existing tests converted, not rewritten |
| P2: SQLAlchemy 2 typed mappings, Alembic, PostgreSQL 16+, JSONB snapshots, RFC 8785 hashes unchanged, optimistic concurrency (409) | Tasks 4–7; `test_two_writers_on_one_revision_get_exactly_one_conflict` |
| P8: PostgreSQL through testcontainers, no SQLite stand-in | Task 4 harness; Task 9 removes SQLite |
| D3: files on the data volume by SHA-256, metadata in PostgreSQL | Tasks 2 and 5 (`stored_files`, `project_resources`) |
| D6: the application role only inserts and reads history | Task 4 grants and triggers, `test_schema.py`, `test_a_submission_is_stored_and_cannot_be_changed` |
| D1: application role never superuser, owner role separate | Task 4 roles; T2e init script and migrate service |
| Data model rows: documents, drafts, draft_annotations/evidence, snapshots, submissions, review_decisions, search_events, mutation_receipts | Task 4 `tables.py` |
| Identity, authorization, jobs, edit and audit events, ontology files | T2b, T2c, T2d (index) |
