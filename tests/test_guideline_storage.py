"""Storage readers of the guideline versions (used by submit, views and exports)."""

import re
from pathlib import Path

from pg_harness import database_for
from sqlalchemy import text

from ontotator.storage.guidelines import (
    GuidelineFact,
    current_guideline_version,
    guideline_facts,
)
from ontotator.storage.tables import SCHEMA

S = SCHEMA
ROOT = Path(__file__).resolve().parents[1] / "src" / "ontotator" / "storage"


def _seed(conn) -> tuple[int, int, int]:
    ids = []
    for key in ("p", "q"):
        ids.append(
            conn.execute(
                text(
                    f"INSERT INTO {S}.projects (project_key, name, manifest,"
                    " manifest_sha256, task_profile, task_profile_sha256)"
                    " VALUES (:k, :k, '{}', 'm', '{}', 't') RETURNING id"
                ),
                {"k": key},
            ).scalar_one()
        )
    user = conn.execute(
        text(
            f"INSERT INTO {S}.users (username, display_name, pseudonym)"
            " VALUES ('lead', 'Lead', 'lead-0001') RETURNING id"
        )
    ).scalar_one()
    return ids[0], ids[1], user


def _upload(conn, project: int, user: int, version: int, kind: str = "markdown"):
    conn.execute(
        text(
            f"INSERT INTO {S}.guideline_versions (project_id, version, kind,"
            " body_sha256, size_bytes, created_by, created_by_label)"
            " VALUES (:p, :v, :k, :h, 1, :u, 'lead-0001')"
        ),
        {"p": project, "v": version, "k": kind, "h": f"h{version}", "u": user},
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.guideline_contents (project_id, version, filename, body)"
            " VALUES (:p, :v, 'g.md', 'x')"
        ),
        {"p": project, "v": version},
    )


def _withdraw(conn, project: int, user: int, version: int) -> None:
    conn.execute(
        text(
            f"DELETE FROM {S}.guideline_contents WHERE project_id = :p AND version = :v"
        ),
        {"p": project, "v": version},
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.guideline_withdrawals (project_id, version,"
            " withdrawn_by, withdrawn_by_label) VALUES (:p, :v, :u, 'lead-0001')"
        ),
        {"p": project, "v": version, "u": user},
    )


def test_current_version_reader(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    with db.engine.begin() as conn:
        project, other, user = _seed(conn)
        assert current_guideline_version(conn, project) is None
        _upload(conn, project, user, 1)
        _upload(conn, project, user, 2)
        _upload(conn, other, user, 1)
        _upload(conn, other, user, 2)
        _upload(conn, other, user, 3)
        assert current_guideline_version(conn, project) == 2
        _withdraw(conn, project, user, 1)
        assert current_guideline_version(conn, project) == 2
        _withdraw(conn, project, user, 2)
        assert current_guideline_version(conn, project) is None
        assert current_guideline_version(conn, other) == 3


def test_facts_reader(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    with db.engine.begin() as conn:
        project, other, user = _seed(conn)
        assert guideline_facts(conn, project) == {}
        _upload(conn, project, user, 1, "markdown")
        _upload(conn, project, user, 2, "text")
        _upload(conn, other, user, 1, "text")
        _withdraw(conn, project, user, 1)
        assert guideline_facts(conn, project) == {
            1: GuidelineFact(kind="markdown", sha256="h1", withdrawn=True),
            2: GuidelineFact(kind="text", sha256="h2", withdrawn=False),
        }


def test_storage_does_not_import_application() -> None:
    # The guideline storage modules import no application module at all;
    # repository.py already has a function-local workflow_guards import, so
    # for it the scan forbids the guideline service (that import is circular).
    anything = re.compile(r"^\s*(from|import)\s+ontotator\.application", re.M)
    service = re.compile(
        r"^\s*(from|import)\s+ontotator\.application(\.guidelines|\s+import\s+.*\bguidelines\b)",
        re.M,
    )
    for name in ("guidelines.py", "guideline_tables.py"):
        assert not anything.search((ROOT / name).read_text(encoding="utf-8")), name
    assert not service.search((ROOT / "repository.py").read_text(encoding="utf-8"))
