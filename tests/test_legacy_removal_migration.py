"""Migration 0020 (D1): legacy annotation review, ``assisted`` and keep-both
work is deleted as whole units; clean work stays; nothing dangles."""

from __future__ import annotations

import importlib.util
import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text

from ontocurator.storage.schema import upgrade

# Renumbering (plan Global rule 12) only touches these two constants.
REVISION = "0020"
PREVIOUS = "0019"
S = "ontocurator"
KEEP = {"consolidation": {"action": "keep"}}
KEEP_BOTH = {"consolidation": {"action": "keep_both"}}


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _one(conn: Connection, sql: str, **params: Any) -> Any:
    return _exec(conn, sql, **params).scalar_one()


class _Seed:
    """Raw SQL rows of one project at revision 0019."""

    def __init__(self, conn: Connection, key: str) -> None:
        self.conn = conn
        self.pid = _one(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256)"
            " VALUES (:k, :k, '{}', 'm', '{}', 't') RETURNING id",
            k=key,
        )

    def user(self, name: str) -> int:
        found = _exec(
            self.conn, f"SELECT id FROM {S}.users WHERE username = :u", u=name
        ).scalar_one_or_none()
        if found is not None:
            return int(found)
        return int(
            _one(
                self.conn,
                f"INSERT INTO {S}.users (username, display_name, pseudonym)"
                " VALUES (:u, :u, :u) RETURNING id",
                u=name,
            )
        )

    def doc(self, doc: str) -> None:
        _exec(
            self.conn,
            f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
            " case_id, external_id, version, origin, text_sha256)"
            " VALUES (:p, :d, 'en', 'x', :d, :d, 1, 'native', 'h')",
            p=self.pid,
            d=doc,
        )

    def assign(self, doc: str, user: str, task: str) -> int:
        return int(
            _one(
                self.conn,
                f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task)"
                " VALUES (:p, :d, :u, :t) RETURNING id",
                p=self.pid,
                d=doc,
                u=self.user(user),
                t=task,
            )
        )

    def round(self, rid: str, aid: int, doc: str, user: str, kind: str, mode: str):
        _exec(
            self.conn,
            f"INSERT INTO {S}.work_rounds (round_id, project_id, assignment_id,"
            " document_id, annotator_id, kind, mode, input_manifest_sha256,"
            " input_submission_ids, created_at)"
            " VALUES (:r, :p, :a, :d, :u, :k, :m, 'h', '[]', now())",
            r=rid,
            p=self.pid,
            a=aid,
            d=doc,
            u=user,
            k=kind,
            m=mode,
        )
        _exec(
            self.conn,
            f"INSERT INTO {S}.work_round_state (round_id, state) VALUES (:r, 'editable')",
            r=rid,
        )
        _exec(
            self.conn,
            f"INSERT INTO {S}.round_workspace_bindings (project_id, workspace_key,"
            " round_id) VALUES (:p, :k, :r)",
            p=self.pid,
            k=f"key-{rid}",
            r=rid,
        )
        _exec(
            self.conn,
            f"UPDATE {S}.assignments SET active_round_id = :r WHERE id = :a",
            r=rid,
            a=aid,
        )

    def draft(self, rid: str, doc: str, user: str, mode: str, *decisions: dict) -> None:
        draft_id = _one(
            self.conn,
            f"INSERT INTO {S}.drafts (project_id, draft_key, document_id,"
            " annotator_id, mode, scope_id, target_set_id, targets, updated_at)"
            " VALUES (:p, :k, :d, :u, :m, 's', 't', '{}', now()) RETURNING id",
            p=self.pid,
            k=f"key-{rid}",
            d=doc,
            u=user,
            m=mode,
        )
        for position, payload in enumerate(decisions):
            _exec(
                self.conn,
                f"INSERT INTO {S}.review_decisions (draft_id, decision_id, position,"
                " target_id, target_version, outcome, reviewer_id, payload)"
                " VALUES (:i, :n, :pos, 'a', '1', 'confirmed', :u, CAST(:x AS jsonb))",
                i=draft_id,
                n=f"dec-{position}",
                pos=position,
                u=user,
                x=json.dumps(payload),
            )

    def submit(
        self, sid: str, rid: str, aid: int, doc: str, user: str, mode: str, *decisions
    ) -> None:
        _exec(
            self.conn,
            f"INSERT INTO {S}.submissions (project_id, submission_id, local_key,"
            " origin_key, document_id, annotator_id, mode, draft_revision, payload,"
            " created_at, last_edit_event_id) VALUES (:p, :s, :k, :k, :d, :u, :m, 1,"
            " CAST(:x AS jsonb), '2026-10-21T10:00:00Z', (SELECT max(e.id)"
            f" FROM {S}.edit_events e JOIN {S}.drafts d ON d.id = e.draft_id"
            " WHERE d.project_id = :p AND d.draft_key = :k))",
            p=self.pid,
            s=sid,
            k=f"key-{rid}",
            d=doc,
            u=user,
            m=mode,
            x=json.dumps({"decisions": list(decisions)}),
        )
        _exec(
            self.conn,
            f"INSERT INTO {S}.round_submission_bindings (project_id, submission_id,"
            " round_id) VALUES (:p, :s, :r)",
            p=self.pid,
            s=sid,
            r=rid,
        )
        _exec(
            self.conn,
            f"UPDATE {S}.work_round_state SET state = 'submitted',"
            " latest_submission_id = :s WHERE round_id = :r",
            s=sid,
            r=rid,
        )
        _exec(
            self.conn,
            f"UPDATE {S}.assignments SET status = 'submitted', last_submission_id = :s"
            " WHERE id = :a",
            s=sid,
            a=aid,
        )

    def work(
        self,
        rid: str,
        doc: str,
        user: str,
        mode: str = "independent",
        edited: bool = False,
    ) -> int:
        """An annotate assignment with a submitted round."""
        aid = self.assign(doc, user, "annotate")
        self.round(rid, aid, doc, user, "ordinary", mode)
        self.draft(rid, doc, user, mode)
        if edited:
            self.edit(rid)
        self.submit(f"s-{rid}", rid, aid, doc, user, mode)
        return aid

    def consolidate(self, rid: str, doc: str, inputs: list[str], *decisions) -> int:
        aid = self.assign(doc, "cons", "review")
        self.round(rid, aid, doc, "cons", "consolidation", "review")
        for position, sid in enumerate(inputs):
            _exec(
                self.conn,
                f"INSERT INTO {S}.round_inputs (input_id, project_id, round_id,"
                " source_submission_id, position, payload)"
                " VALUES (:i, :p, :r, :s, :pos, '{}')",
                i=f"{rid}-in-{position}",
                p=self.pid,
                r=rid,
                s=sid,
                pos=position,
            )
        if decisions:
            self.submit(f"s-{rid}", rid, aid, doc, "cons", "review", *decisions)
        return aid

    def edit(self, rid: str) -> None:
        """One edit event on the draft of ``rid`` (before its submission)."""
        _exec(
            self.conn,
            f"INSERT INTO {S}.edit_events (project_id, draft_id, mutation_id, kind,"
            " command, revision_before, revision_after, state)"
            f" SELECT :p, id, :m, 'edit', '{{}}', 0, 1, '{{}}' FROM {S}.drafts"
            " WHERE project_id = :p AND draft_key = :k",
            p=self.pid,
            m=f"m-{rid}",
            k=f"key-{rid}",
        )

    def final(self, doc: str, sid: str) -> None:
        lead = self.user("lead")
        _exec(
            self.conn,
            f"INSERT INTO {S}.final_selections (project_id, case_id, language,"
            " document_id, submission_id, revision, actor_id, acknowledged_cause_ids)"
            " VALUES (:p, :d, 'en', :d, :s, 1, :u, '[]')",
            p=self.pid,
            d=doc,
            s=sid,
            u=lead,
        )
        _exec(
            self.conn,
            f"INSERT INTO {S}.final_selection_events (project_id, payload)"
            " VALUES (:p, CAST(:x AS jsonb))",
            p=self.pid,
            x=json.dumps({"case_id": doc, "language": "en", "submission_id": sid}),
        )


def _seed(conn: Connection) -> dict[str, int]:
    seed = _Seed(conn, "p")
    for doc in ("d1", "d2", "d3", "d4"):
        seed.doc(doc)
    ids: dict[str, int] = {}
    # d1: independent and assisted work, a consolidation over both.
    ids["ind"] = seed.work("r-ind", "d1", "ann1")
    ids["as"] = seed.work("r-as", "d1", "ann2", mode="assisted", edited=True)
    ids["c1"] = seed.consolidate("r-c1", "d1", ["s-r-ind", "s-r-as"])
    # d2: a submitted keep-both consolidation chosen as the final result.
    ids["ind2"] = seed.work("r-ind2", "d2", "ann1")
    ids["ind3"] = seed.work("r-ind3", "d2", "ann2")
    ids["c2"] = seed.consolidate(
        "r-c2", "d2", ["s-r-ind2", "s-r-ind3"], KEEP, KEEP_BOTH
    )
    seed.final("d2", "s-r-c2")
    # d3: a clean consolidation chosen as the final result.
    ids["ind4"] = seed.work("r-ind4", "d3", "ann1")
    ids["ind5"] = seed.work("r-ind5", "d3", "ann2")
    ids["c3"] = seed.consolidate("r-c3", "d3", ["s-r-ind4", "s-r-ind5"], KEEP)
    seed.final("d3", "s-r-c3")
    # d4: an ordinary annotation review with a draft decision and a submission.
    ids["rev"] = seed.assign("d4", "cons", "review")
    seed.round("r-rev", ids["rev"], "d4", "cons", "ordinary", "review")
    seed.draft("r-rev", "d4", "cons", "review", {"note": None})
    seed.edit("r-rev")
    seed.submit("s-r-rev", "r-rev", ids["rev"], "d4", "cons", "review", {})
    # A problem report on the review task that paused an annotator's task.
    lead = seed.user("lead")
    _exec(
        conn,
        f"INSERT INTO {S}.problem_reports (report_id, project_id, assignment_id,"
        " reporter_id, reason, created_at) VALUES ('rep', :p, :a, :u, 'x', now())",
        p=seed.pid,
        a=ids["rev"],
        u=lead,
    )
    _exec(
        conn,
        f"INSERT INTO {S}.problem_report_state (report_id, state, revision)"
        " VALUES ('rep', 'open', 1)",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.task_holds (hold_id, project_id, assignment_id, report_id,"
        " reason, created_by, created_at) VALUES ('hold', :p, :a, 'rep', 'x', :u,"
        " now())",
        p=seed.pid,
        a=ids["ind"],
        u=lead,
    )
    _exec(
        conn, f"INSERT INTO {S}.task_hold_state (hold_id, active) VALUES ('hold', true)"
    )
    _exec(
        conn,
        f"UPDATE {S}.assignments SET held = true, hold_reason = 'x' WHERE id = :a",
        a=ids["ind"],
    )
    _exec(
        conn,
        f"INSERT INTO {S}.user_preferences (user_id, preferences)"
        " VALUES (:u, CAST(:x AS jsonb))",
        u=lead,
        x=json.dumps({"mode_by_package": {"p": "assisted", "q": "independent"}}),
    )
    return ids


@pytest.fixture
def migrated(tmp_path, caplog) -> Iterator[tuple[str, Engine, dict[str, int]]]:
    caplog.set_level(logging.WARNING, logger="ontocurator.migrations")
    url = unmigrated_database_url(tmp_path / "legacy-removal-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        ids = _seed(conn)
    upgrade(url, REVISION)
    yield url, engine, ids
    engine.dispose()


def _assignments(engine: Engine) -> set[int]:
    with engine.connect() as conn:
        return set(_exec(conn, f"SELECT id FROM {S}.assignments").scalars())


def _rounds(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return set(_exec(conn, f"SELECT round_id FROM {S}.work_rounds").scalars())


def _submissions(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return set(_exec(conn, f"SELECT submission_id FROM {S}.submissions").scalars())


def _draft_keys(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return set(_exec(conn, f"SELECT draft_key FROM {S}.drafts").scalars())


def test_annotation_review_assignments_are_deleted_with_their_work(migrated) -> None:
    _, engine, ids = migrated
    assert ids["rev"] not in _assignments(engine)
    assert "r-rev" not in _rounds(engine)
    assert "s-r-rev" not in _submissions(engine)
    assert "key-r-rev" not in _draft_keys(engine)
    with engine.connect() as conn:
        assert _one(conn, f"SELECT count(*) FROM {S}.review_decisions") == 0
        assert _one(conn, f"SELECT count(*) FROM {S}.problem_reports") == 0
        # The paused annotator's task is released with the report.
        held = _exec(
            conn, f"SELECT held FROM {S}.assignments WHERE id = :a", a=ids["ind"]
        ).scalar_one()
    assert held is False


def test_assisted_work_is_deleted(migrated) -> None:
    _, engine, ids = migrated
    assert ids["as"] not in _assignments(engine)
    assert "r-as" not in _rounds(engine)
    assert "s-r-as" not in _submissions(engine)
    assert "key-r-as" not in _draft_keys(engine)


def test_consolidations_over_deleted_inputs_are_deleted(migrated) -> None:
    _, engine, ids = migrated
    assert ids["c1"] not in _assignments(engine)
    assert "r-c1" not in _rounds(engine)
    assert ids["ind"] in _assignments(engine)
    assert "s-r-ind" in _submissions(engine)


def test_keep_both_consolidations_and_their_final_selection_are_deleted(
    migrated,
) -> None:
    _, engine, ids = migrated
    assert ids["c2"] not in _assignments(engine)
    assert "s-r-c2" not in _submissions(engine)
    with engine.connect() as conn:
        finals = set(
            _exec(conn, f"SELECT submission_id FROM {S}.final_selections").scalars()
        )
        events = set(
            _exec(
                conn,
                f"SELECT payload->>'submission_id' FROM {S}.final_selection_events",
            ).scalars()
        )
    assert finals == events == {"s-r-c3"}


def test_clean_consolidation_and_independent_work_stay(migrated) -> None:
    _, engine, ids = migrated
    kept = {ids[k] for k in ("ind", "ind2", "ind3", "ind4", "ind5", "c3")}
    assert _assignments(engine) == kept
    assert _rounds(engine) == {"r-ind", "r-ind2", "r-ind3", "r-ind4", "r-ind5", "r-c3"}
    assert _submissions(engine) == {
        "s-r-ind",
        "s-r-ind2",
        "s-r-ind3",
        "s-r-ind4",
        "s-r-ind5",
        "s-r-c3",
    }
    with engine.connect() as conn:
        assert _one(conn, f"SELECT count(*) FROM {S}.round_inputs") == 2


def test_edit_events_of_purged_drafts_stay(migrated) -> None:
    _, engine, _ = migrated
    with engine.connect() as conn:
        kept = set(_exec(conn, f"SELECT mutation_id FROM {S}.edit_events").scalars())
    assert kept == {"m-r-as", "m-r-rev"}
    assert "key-r-as" not in _draft_keys(engine)


def test_assisted_preferences_become_independent(migrated) -> None:
    _, engine, _ = migrated
    with engine.connect() as conn:
        prefs = _one(conn, f"SELECT preferences FROM {S}.user_preferences")
    assert prefs == {"mode_by_package": {"p": "independent", "q": "independent"}}


DANGLING = {
    "work_rounds.assignment_id": "SELECT 1 FROM {s}.work_rounds r WHERE NOT EXISTS"
    " (SELECT 1 FROM {s}.assignments a WHERE a.id = r.assignment_id)",
    "assignments.last_submission_id": "SELECT 1 FROM {s}.assignments a"
    " WHERE a.last_submission_id IS NOT NULL AND NOT EXISTS (SELECT 1"
    " FROM {s}.submissions x WHERE x.project_id = a.project_id"
    " AND x.submission_id = a.last_submission_id)",
    "assignments.active_round_id": "SELECT 1 FROM {s}.assignments a"
    " WHERE a.active_round_id IS NOT NULL AND NOT EXISTS (SELECT 1"
    " FROM {s}.work_rounds r WHERE r.round_id = a.active_round_id)",
    "work_round_state.latest_submission_id": "SELECT 1 FROM {s}.work_round_state t"
    " WHERE t.latest_submission_id IS NOT NULL AND NOT EXISTS (SELECT 1"
    " FROM {s}.submissions x WHERE x.submission_id = t.latest_submission_id)",
    "final_selections.submission_id": "SELECT 1 FROM {s}.final_selections f"
    " WHERE NOT EXISTS (SELECT 1 FROM {s}.submissions x"
    " WHERE x.project_id = f.project_id AND x.submission_id = f.submission_id)",
    "round_inputs.source_submission_id": "SELECT 1 FROM {s}.round_inputs i"
    " WHERE i.source_submission_id IS NOT NULL AND NOT EXISTS (SELECT 1"
    " FROM {s}.submissions x WHERE x.submission_id = i.source_submission_id)",
    "round_workspace_bindings": "SELECT 1 FROM {s}.drafts d WHERE NOT EXISTS"
    " (SELECT 1 FROM {s}.round_workspace_bindings b"
    " WHERE b.workspace_key = d.draft_key)",
    "task_holds.report_id": "SELECT 1 FROM {s}.task_holds h WHERE NOT EXISTS"
    " (SELECT 1 FROM {s}.problem_reports r WHERE r.report_id = h.report_id)",
}


def test_no_reference_dangles(migrated) -> None:
    _, engine, _ = migrated
    with engine.connect() as conn:
        dangling = [
            name
            for name, sql in DANGLING.items()
            if _exec(conn, sql.format(s=S)).first() is not None
        ]
    assert dangling == []


def test_purge_logs_the_row_counts(migrated, caplog) -> None:
    [record] = [
        r
        for r in caplog.get_records("setup")
        if r.getMessage().startswith("0020 legacy purge:")
    ]
    counts = record.args
    assert isinstance(counts, dict)
    assert {k: v for k, v in counts.items() if v} == {
        "assignments": 4,  # rev, as, c1, c2
        "work_rounds": 4,
        "work_round_state": 4,
        "round_workspace_bindings": 4,
        "round_submission_bindings": 3,  # s-r-rev, s-r-as, s-r-c2
        "round_inputs": 4,
        "submissions": 3,
        "drafts": 2,  # key-r-rev, key-r-as
        "final_selections": 1,
        "final_selection_events": 1,
        "problem_reports": 1,
        "problem_report_state": 1,
        "task_holds": 1,
        "task_hold_state": 1,
        "user_preferences_converted": 1,
    }


def _purge_script() -> Any:
    path = Path(__file__).resolve().parents[1] / "scripts" / "purge_annotation_work.py"
    spec = importlib.util.spec_from_file_location("purge_annotation_work", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_purge_script_removes_annotation_work_of_one_project(migrated) -> None:
    url, engine, ids = migrated
    with engine.begin() as conn:
        other = _Seed(conn, "q")
        other.doc("e1")
        gone = other.work("r-q", "e1", "ann1")
    script = _purge_script()
    assert script.main(["--project", "q", "--database-url", url]) == 2
    assert gone in _assignments(engine)
    assert script.main(["--project", "q", "--confirm", "--database-url", url]) == 0
    remaining = _assignments(engine)
    assert gone not in remaining
    assert "s-r-q" not in _submissions(engine)
    assert {ids[k] for k in ("ind", "ind2", "c3")} <= remaining
