"""Migration 0030 (issue 280): practice projects lose their owner's name."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text

from ontotator.storage.schema import upgrade

REVISION = "0030"
PREVIOUS = "0029"
S = "ontotator"
NAME = "Practice project"


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn: Connection) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256, practice) VALUES"
        " ('ward-7', 'Practice · Ann Zebrafinch', '{}', 'm', '{}', 't', false),"
        " ('practice-1-aa', 'Practice · Ann Zebrafinch', '{}', 'm', '{}', 't', true)",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.users (username, display_name, pseudonym)"
        " VALUES ('ann', 'Ann Zebrafinch', 'ann-0001')",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.practice_projects (project_id, user_id)"
        f" SELECT p.id, u.id FROM {S}.projects p, {S}.users u"
        " WHERE p.project_key = 'practice-1-aa'",
    )
    # A live practice project, a deleted one (detached by the purge) and a
    # real project that happens to carry the same name.
    _exec(
        conn,
        f"INSERT INTO {S}.audit_events (actor_label, action, target_type, target_id,"
        " project_id, details) VALUES"
        " ('system:practice', 'project.create', 'project', 'practice-1-aa',"
        f"  (SELECT id FROM {S}.projects WHERE project_key = 'practice-1-aa'),"
        ' \'{"name": "Practice · Ann Zebrafinch", "profile_id": "p",'
        ' "practice": true}\'),'
        " ('system:practice', 'project.create', 'project', 'practice-1-bb', NULL,"
        ' \'{"name": "Practice · Ann Zebrafinch", "profile_id": "p",'
        ' "practice": true, "practice_project_key": "practice-1-bb"}\'),'
        " ('cli:op', 'project.create', 'project', 'ward-7',"
        f"  (SELECT id FROM {S}.projects WHERE project_key = 'ward-7'),"
        ' \'{"name": "Practice · Ann Zebrafinch", "profile_id": "p"}\'),'
        " ('system:practice', 'practice.start', 'project', 'practice-1-aa',"
        f"  (SELECT id FROM {S}.projects WHERE project_key = 'practice-1-aa'),"
        ' \'{"consolidation": false, "practice": true}\')',
    )


@pytest.fixture
def migrated(tmp_path: Any) -> Iterator[tuple[Engine, list[Any]]]:
    url = unmigrated_database_url(tmp_path / "practice-name-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
        before = list(
            _exec(
                conn, f"SELECT to_jsonb(a) FROM {S}.audit_events a ORDER BY id"
            ).scalars()
        )
    upgrade(url, REVISION)
    yield engine, before
    engine.dispose()


def test_practice_names_go_and_nothing_else_changes(migrated):
    engine, before = migrated
    with engine.begin() as conn:
        names = dict(
            _exec(conn, f"SELECT project_key, name FROM {S}.projects").tuples().all()
        )
        after = list(
            _exec(
                conn, f"SELECT to_jsonb(a) FROM {S}.audit_events a ORDER BY id"
            ).scalars()
        )
    assert names == {"ward-7": "Practice · Ann Zebrafinch", "practice-1-aa": NAME}
    assert [row["details"].get("name") for row in after] == [
        NAME,
        NAME,
        "Practice · Ann Zebrafinch",
        None,
    ]
    # Only details.name of the two practice entries changed.
    for old, new in zip(before, after, strict=True):
        assert {**old, "details": {**old["details"], "name": None}} == {
            **new,
            "details": {**new["details"], "name": None},
        }
        if old["details"].get("practice") is not True:
            assert old == new


def test_the_audit_trail_stays_append_only_after_the_migration(migrated):
    engine, _ = migrated
    with pytest.raises(Exception, match="append-only"), engine.begin() as conn:
        _exec(conn, f"UPDATE {S}.audit_events SET details = '{{}}'")
