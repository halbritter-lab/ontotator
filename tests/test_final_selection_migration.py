"""0014 keeps selections exact and rewrites only round acknowledgement identities."""

import json

from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine, text

from ontotator.storage.schema import upgrade

ACKS = [
    "SELECTED_ROUND_SUPERSEDED:round-aa:7",
    "SELECTED_ROUND_ABANDONED:round-bb:2",
    "SELECTED_RESULT_REVISED:sub-2",
    "SELECTED_TEXT_CORRECTED:doc/v1:doc/v2",
]


def _seed_project(conn, key, first_event_at):
    pid = conn.execute(
        text(
            "INSERT INTO ontotator.projects (project_key, name, manifest, manifest_sha256, task_profile, task_profile_sha256) "
            "VALUES (:k, :k, '{}', 'm', '{}', 't') RETURNING id"
        ),
        {"k": key},
    ).scalar_one()
    # Valid root first: documents.derived_from has a (project_id, document_id) foreign key.
    conn.execute(
        text(
            "INSERT INTO ontotator.documents (project_id, document_id, language, text, case_id, external_id, version, origin, derived_from, translation_status, text_sha256) "
            "VALUES (:pid, 'doc/v1', 'de', 'x', 'c', 'doc', 1, 'machine_translation', NULL, 'accepted', 'h1')"
        ),
        {"pid": pid},
    )
    conn.execute(
        text(
            "INSERT INTO ontotator.documents (project_id, document_id, language, text, case_id, external_id, version, origin, derived_from, translation_status, text_sha256) "
            "VALUES (:pid, 'doc/v2', 'de', 'y', 'c', 'doc', 2, 'correction', 'doc/v1', 'ready_for_review', 'h2')"
        ),
        {"pid": pid},
    )
    payload = {
        "case_id": "c",
        "language": "de",
        "document_id": "doc/v1",
        "submission_id": "sub-1",
    }
    for at in (
        first_event_at,
        "2026-10-18T12:00:00Z",
    ):  # second event = reaffirmation of the same choice
        conn.execute(
            text(
                "INSERT INTO ontotator.final_selection_events (project_id, payload, created_at) "
                "VALUES (:pid, CAST(:payload AS jsonb), :at)"
            ),
            {"pid": pid, "payload": json.dumps(payload), "at": at},
        )
    conn.execute(
        text(
            "INSERT INTO ontotator.final_selections (project_id, case_id, language, document_id, submission_id, revision, actor_id, acknowledged_cause_ids, updated_at) "
            "SELECT :pid, 'c', 'de', 'doc/v1', 'sub-1', 2, u.id, CAST(:acks AS jsonb), '2026-10-18T12:00:00Z' FROM ontotator.users u"
        ),
        {"pid": pid, "acks": json.dumps(ACKS)},
    )
    return pid


def test_0014_backfills_selected_at_per_project_and_rewrites_only_round_acks(tmp_path):
    url = unmigrated_database_url(tmp_path / "final-0014.db")
    upgrade(url, "0013")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO ontotator.users (username, display_name, pseudonym) VALUES ('lead', 'Lead', 'lead-0001')"
            )
        )
        # Identical document ids in two projects; only the project's own events count.
        first = _seed_project(conn, "p1", "2026-10-18T10:00:00Z")
        second = _seed_project(conn, "p2", "2026-10-18T09:00:00Z")
        before_events = conn.execute(
            text("SELECT id, payload FROM ontotator.final_selection_events ORDER BY id")
        ).all()
        before_rows = conn.execute(
            text(
                "SELECT project_id, case_id, language, document_id, submission_id, revision, actor_id, updated_at "
                "FROM ontotator.final_selections ORDER BY project_id"
            )
        ).all()
    upgrade(url, "0014")
    with engine.begin() as conn:
        rows = {
            row.project_id: row
            for row in conn.execute(
                text(
                    "SELECT project_id, selected_at, adjudicator_not_annotator, acknowledged_cause_ids FROM ontotator.final_selections"
                )
            )
        }
        after_events = conn.execute(
            text("SELECT id, payload FROM ontotator.final_selection_events ORDER BY id")
        ).all()
        after_rows = conn.execute(
            text(
                "SELECT project_id, case_id, language, document_id, submission_id, revision, actor_id, updated_at "
                "FROM ontotator.final_selections ORDER BY project_id"
            )
        ).all()
    assert rows[first].selected_at.isoformat().startswith("2026-10-18T10:00:00")
    assert rows[second].selected_at.isoformat().startswith("2026-10-18T09:00:00")
    for row in rows.values():
        assert row.adjudicator_not_annotator is None
        assert row.acknowledged_cause_ids == sorted(
            [
                "SELECTED_ROUND_SUPERSEDED:round-aa",
                "SELECTED_ROUND_ABANDONED:round-bb",
                "SELECTED_RESULT_REVISED:sub-2",
                # Old 3-part text acks stay as they are (open question 2): no status can be
                # reconstructed, so they never match a 4-part id and each correction asks once more.
                "SELECTED_TEXT_CORRECTED:doc/v1:doc/v2",
            ]
        )
    assert after_events == before_events  # event payloads are immutable history
    assert after_rows == before_rows  # selections keep their exact identity
