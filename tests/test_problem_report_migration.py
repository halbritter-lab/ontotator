"""0015 records hold releases, backfilled from events; states are constrained."""

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import upgrade

S = "ontotator"


def _seed(conn) -> None:
    conn.execute(
        text(
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256, task_profile, task_profile_sha256) "
            "VALUES ('p', 'p', '{}', 'm', '{}', 't')"
        )
    )
    for name, pseudonym in (("rep", "ann-0004"), ("lead", "lead-0002")):
        conn.execute(
            text(
                f"INSERT INTO {S}.users (username, display_name, pseudonym) VALUES (:u, :u, :p)"
            ),
            {"u": name, "p": pseudonym},
        )
    conn.execute(
        text(
            f"INSERT INTO {S}.documents (project_id, document_id, language, text, case_id, external_id, version, origin, derived_from, translation_status, text_sha256) "
            f"SELECT id, 'd', 'de', 'x', 'c', 'd', 1, 'native', NULL, NULL, 'h' FROM {S}.projects"
        )
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task) "
            f"SELECT p.id, 'd', u.id, 'annotate' FROM {S}.projects p, {S}.users u WHERE u.username = 'rep'"
        )
    )
    ids = f"(SELECT id FROM {S}.projects), (SELECT id FROM {S}.assignments), (SELECT id FROM {S}.users WHERE username = 'rep')"
    conn.execute(
        text(
            f"INSERT INTO {S}.problem_reports (report_id, project_id, assignment_id, reporter_id, reason, created_at) "
            f"VALUES ('r1', {ids}, 'broken', '2026-10-19T01:00:00Z')"
        )
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.problem_report_state (report_id, state, revision) VALUES ('r1', 'open', 3)"
        )
    )
    for hold, at in (("h1", "2026-10-19T01:00:00Z"), ("h2", "2026-10-19T03:00:00Z")):
        conn.execute(
            text(
                f"INSERT INTO {S}.task_holds (hold_id, project_id, assignment_id, report_id, reason, created_by, created_at) "
                f"SELECT '{hold}', a.project_id, a.id, 'r1', 'broken', a.user_id, '{at}' FROM {S}.assignments a"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {S}.task_hold_state (hold_id, active) VALUES ('{hold}', false)"
            )
        )
    conn.execute(
        text(
            f"INSERT INTO {S}.problem_report_events (event_id, project_id, report_id, actor_id, action, details, created_at) "
            f"SELECT 'e1', a.project_id, 'r1', u.id, 'resume', jsonb_build_object('reason', 'upsi', 'assignment_ids', jsonb_build_array(a.id)), '2026-10-19T02:00:00Z' "
            f"FROM {S}.assignments a, {S}.users u WHERE u.username = 'lead'"
        )
    )


def test_0015_backfills_matching_releases_and_leaves_unmatched_null(tmp_path):
    url = unmigrated_database_url(tmp_path / "reports-0015.db")
    upgrade(url, "0014")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0015")
    with engine.begin() as conn:
        rows = {
            r.hold_id: r
            for r in conn.execute(
                text(
                    f"SELECT s.hold_id, s.release_action, s.release_event_id, u.username AS by "
                    f"FROM {S}.task_hold_state s LEFT JOIN {S}.users u ON u.id = s.released_by"
                )
            )
        }
    assert (rows["h1"].release_action, rows["h1"].release_event_id, rows["h1"].by) == (
        "resume",
        "e1",
        "lead",
    )
    # h2 was created after e1: no matching event, so "no record".
    assert (rows["h2"].release_action, rows["h2"].release_event_id, rows["h2"].by) == (
        None,
        None,
        None,
    )


def test_0015_rejects_unknown_report_states(tmp_path):
    url = unmigrated_database_url(tmp_path / "reports-0015-check.db")
    upgrade(url, "0014")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0015")
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text(f"UPDATE {S}.problem_report_state SET state = 'closed'"))


def test_0023_adds_an_unset_reporter_seen_at_to_existing_reports(tmp_path):
    url = unmigrated_database_url(tmp_path / "reports-0023.db")
    # 0020: the seed predates the annotation mode check of 0021.
    upgrade(url, "0020")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0023")
    with engine.begin() as conn:
        # NULL: a lead answer given before the upgrade still counts as unseen.
        assert (
            conn.execute(
                text(f"SELECT reporter_seen_at FROM {S}.problem_report_state")
            ).scalar_one()
            is None
        )
        conn.execute(
            text(f"UPDATE {S}.problem_report_state SET reporter_seen_at = now()")
        )
