"""The documents-overview migration: decided rows, visits, text changes."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import PASSWORD, unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, make_url, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from ontocurator.storage.schema import alembic_config, upgrade
from ontocurator.storage.tables import APP_ROLE

# Renumbering (plan Global rule 12) only touches these two constants.
REVISION = "0018"
PREVIOUS = "0017"
S = "ontocurator"


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _one(conn: Connection, sql: str, **params: Any) -> Any:
    return _exec(conn, sql, **params).scalar_one()


def _seed(conn: Connection) -> None:
    for key, plan in (("n", "nothing"), ("d", "review_and_annotate_translations")):
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256, import_plan)"
            " VALUES (:k, :k, '{}', 'm', '{}', 't', :plan)",
            k=key,
            plan=plan,
        )
    for name, pseudonym in (("ann", "ann-0001"), ("lead", "lead-0002")):
        _exec(
            conn,
            f"INSERT INTO {S}.users (username, display_name, pseudonym)"
            " VALUES (:u, :u, :p)",
            u=name,
            p=pseudonym,
        )
    # Per project: off/off by the system, off/off by a lead, on/on by the system.
    for key in ("n", "d"):
        for language, flag, user in (
            ("de", False, None),
            ("fr", False, "lead"),
            ("it", True, None),
        ):
            _exec(
                conn,
                f"INSERT INTO {S}.work_plan_rows (project_id, case_id, language,"
                " review, annotate, updated_by)"
                f" SELECT p.id, 'c1', :lang, :flag, :flag,"
                f" (SELECT id FROM {S}.users WHERE username = :user)"
                f" FROM {S}.projects p WHERE p.project_key = :key",
                lang=language,
                flag=flag,
                user=user,
                key=key,
            )
    # Project d: a source v1, its correction v2, an assignment, a submission
    # and a round on v1.
    for doc, version, derived in (("v1", 1, None), ("v2", 2, "v1")):
        _exec(
            conn,
            f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
            " case_id, external_id, version, origin, derived_from, text_sha256)"
            f" SELECT id, :doc, 'en', 'x', 'c1', 'c1', :version,"
            f" CASE WHEN :version = 1 THEN 'native' ELSE 'correction' END, :derived,"
            f" 'h' FROM {S}.projects WHERE project_key = 'd'",
            doc=doc,
            version=version,
            derived=derived,
        )
    _exec(
        conn,
        f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task)"
        f" SELECT p.id, 'v1', u.id, 'annotate' FROM {S}.projects p, {S}.users u"
        " WHERE p.project_key = 'd' AND u.username = 'ann'",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.submissions (project_id, submission_id, local_key,"
        " origin_key, document_id, annotator_id, mode, draft_revision, payload,"
        " created_at) SELECT id, 's1', 'k', 'k', 'v1', 'ann-0001', 'independent',"
        f" 1, '{{}}', '2026-10-21T10:00:00Z' FROM {S}.projects WHERE project_key = 'd'",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.work_rounds (round_id, project_id, assignment_id,"
        " document_id, annotator_id, kind, input_manifest_sha256,"
        " input_submission_ids, created_at)"
        f" SELECT 'r1', a.project_id, a.id, 'v1', 'ann-0001', 'carry_forward', 'h',"
        f" '[]', now() FROM {S}.assignments a",
    )


@pytest.fixture
def migrated(tmp_path) -> Iterator[tuple[str, Engine]]:
    url = unmigrated_database_url(tmp_path / "overview-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, REVISION)
    yield url, engine
    engine.dispose()


def _ids(conn: Connection) -> dict[str, int]:
    row = _exec(
        conn,
        f"SELECT p.id AS pid, a.id AS aid, u.id AS lead FROM {S}.projects p"
        f" JOIN {S}.assignments a ON a.project_id = p.id, {S}.users u"
        " WHERE p.project_key = 'd' AND u.username = 'lead'",
    ).one()
    return {"pid": row.pid, "aid": row.aid, "lead": row.lead}


def _snapshot(conn: Connection) -> int:
    return int(
        _one(
            conn,
            f"INSERT INTO {S}.draft_snapshots (project_id, assignment_id,"
            " document_id, workspace_key, draft_revision, payload)"
            " VALUES (:pid, :aid, 'v1', 'k', 3, '{}') RETURNING id",
            **_ids(conn),
        )
    )


def _resolution(
    conn: Connection,
    *,
    assignment: bool = True,
    submission: str | None = None,
    resolution: str = "moved",
) -> None:
    ids = _ids(conn)
    _exec(
        conn,
        f"INSERT INTO {S}.text_change_resolutions (project_id, case_id, language,"
        " from_document_id, to_document_id, assignment_id, submission_id,"
        " resolution, decided_by)"
        " VALUES (:pid, 'c1', 'en', 'v1', 'v2', :aid, :sid, :resolution, :lead)",
        pid=ids["pid"],
        aid=ids["aid"] if assignment else None,
        sid=submission,
        resolution=resolution,
        lead=ids["lead"],
    )


def _round_input(
    conn: Connection, input_id: str, submission: str | None, snapshot: int | None
) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.round_inputs (input_id, project_id, round_id,"
        " source_submission_id, source_draft_snapshot_id, position, payload)"
        " VALUES (:input_id, :pid, 'r1', :sid, :snap, 0, '{}')",
        input_id=input_id,
        pid=_ids(conn)["pid"],
        sid=submission,
        snap=snapshot,
    )


def _columns(conn: Connection, table: str) -> dict[str, Any]:
    rows = _exec(
        conn,
        "SELECT column_name, is_nullable, column_default"
        " FROM information_schema.columns"
        " WHERE table_schema = :s AND table_name = :t",
        s=S,
        t=table,
    ).all()
    return {r.column_name: r for r in rows}


def test_upgrade_creates_tables_and_columns(migrated) -> None:
    with migrated[1].connect() as conn:
        for table in ("documents_visits", "text_change_resolutions", "draft_snapshots"):
            assert _columns(conn, table), table
        assert set(_columns(conn, "documents_visits")) == {
            "user_id",
            "project_id",
            "baseline_at",
            "last_seen_at",
        }
        decided = _columns(conn, "work_plan_rows")["decided"]
        assert decided.is_nullable == "NO"
        assert decided.column_default is None
        inputs = _columns(conn, "round_inputs")
        assert inputs["source_submission_id"].is_nullable == "YES"
        assert inputs["source_draft_snapshot_id"].is_nullable == "YES"


def test_decided_backfill(migrated) -> None:
    with migrated[1].connect() as conn:
        rows = _exec(
            conn,
            f"SELECT p.project_key, r.language, r.decided FROM {S}.work_plan_rows r"
            f" JOIN {S}.projects p ON p.id = r.project_id",
        ).all()
    decided = {(r.project_key, r.language): r.decided for r in rows}
    assert decided == {
        ("n", "de"): False,  # off, system row, "Nothing planned"
        ("n", "fr"): True,  # off, written by a lead
        ("n", "it"): True,  # on
        ("d", "de"): True,  # default import plan
        ("d", "fr"): True,
        ("d", "it"): True,
    }


def test_round_inputs_need_exactly_one_source(migrated) -> None:
    engine = migrated[1]
    with engine.begin() as conn:
        snapshot = _snapshot(conn)
        _round_input(conn, "ok-sub", "s1", None)
        _round_input(conn, "ok-snap", None, snapshot)
    for input_id, submission, snap in (
        ("none", None, None),
        ("both", "s1", snapshot),
    ):
        with (
            pytest.raises(IntegrityError, match="ck_round_inputs_one_source"),
            engine.begin() as conn,
        ):
            _round_input(conn, input_id, submission, snap)


def test_resolutions_and_snapshots_are_append_only(migrated) -> None:
    url, engine = migrated
    with engine.begin() as conn:
        _snapshot(conn)
        _resolution(conn)
    app = create_engine(make_url(url).set(username=APP_ROLE, password=PASSWORD))
    try:
        with app.begin() as conn:
            _resolution(conn, assignment=False, submission="s1", resolution="carried")
            _snapshot(conn)
        for table in ("text_change_resolutions", "draft_snapshots"):
            for statement in (
                f"UPDATE {S}.{table} SET project_id = project_id",
                f"DELETE FROM {S}.{table}",
            ):
                with (
                    pytest.raises(DBAPIError, match="permission denied"),
                    app.begin() as conn,
                ):
                    _exec(conn, statement)
        with app.begin() as conn:
            ids = _ids(conn)
            _exec(
                conn,
                f"INSERT INTO {S}.documents_visits (user_id, project_id,"
                " baseline_at, last_seen_at) VALUES (:lead, :pid, now(), now())",
                **ids,
            )
            _exec(conn, f"UPDATE {S}.documents_visits SET last_seen_at = now()")
    finally:
        app.dispose()
    for table in ("text_change_resolutions", "draft_snapshots"):
        for statement in (
            f"UPDATE {S}.{table} SET project_id = project_id",
            f"DELETE FROM {S}.{table}",
            f"TRUNCATE {S}.{table} CASCADE",
        ):
            with pytest.raises(DBAPIError, match="append-only"), engine.begin() as conn:
                _exec(conn, statement)


def test_resolution_needs_assignment_or_submission(migrated) -> None:
    with (
        pytest.raises(
            IntegrityError, match="ck_text_change_resolutions_assignment_or_submission"
        ),
        migrated[1].begin() as conn,
    ):
        _resolution(conn, assignment=False)
    with migrated[1].begin() as conn:
        with (
            pytest.raises(
                IntegrityError, match="ck_text_change_resolutions_resolution"
            ),
            conn.begin_nested(),
        ):
            _resolution(conn, resolution="kept_final")
        _resolution(conn, resolution="withdrawn")


def test_resolution_uniques(migrated) -> None:
    engine = migrated[1]
    with engine.begin() as conn:
        _resolution(conn, resolution="finish_then_carry")
        # The automatic carry of the same item: assignment NULL, new submission.
        _resolution(conn, assignment=False, submission="s1", resolution="carried")
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _resolution(conn, resolution="moved")
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _resolution(conn, assignment=False, submission="s1", resolution="dismissed")


def _downgrade(engine: Engine) -> None:
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), PREVIOUS)


def test_downgrade_refuses_with_draft_inputs(migrated) -> None:
    engine = migrated[1]
    with engine.begin() as conn:
        _round_input(conn, "snap", None, _snapshot(conn))
    with pytest.raises(RuntimeError, match="draft snapshot"):
        _downgrade(engine)
    with engine.connect() as conn:
        assert _columns(conn, "draft_snapshots")
        assert _one(conn, f"SELECT version_num FROM {S}.alembic_version") == REVISION


def test_downgrade_reverses_without_them(migrated) -> None:
    engine = migrated[1]
    with engine.begin() as conn:
        _snapshot(conn)
        _resolution(conn)
        _round_input(conn, "sub", "s1", None)
    _downgrade(engine)
    with engine.connect() as conn:
        for table in ("documents_visits", "text_change_resolutions", "draft_snapshots"):
            assert _columns(conn, table) == {}, table
        assert "decided" not in _columns(conn, "work_plan_rows")
        inputs = _columns(conn, "round_inputs")
        assert "source_draft_snapshot_id" not in inputs
        assert inputs["source_submission_id"].is_nullable == "NO"
        assert _one(conn, f"SELECT version_num FROM {S}.alembic_version") == PREVIOUS
        assert _one(conn, f"SELECT count(*) FROM {S}.round_inputs") == 1
