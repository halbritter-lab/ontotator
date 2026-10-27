"""0016 creates work plans and migrates existing projects (spec "Migration")."""

from typing import Any

import pytest
from alembic import command
from pg_harness import PASSWORD, unmigrated_database_url
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from ontotator.storage.schema import alembic_config, upgrade
from ontotator.storage.tables import APP_ROLE

S = "ontotator"

# (case, language, origin, status); "d-<case>-<language>" is the document id.
DOCUMENTS = [
    ("c1", "en", "native", None),
    ("c1", "de", "machine_translation", "ready_for_review"),  # no work
    ("c1", "fr", "machine_translation", "accepted"),  # annotation only
    ("c1", "it", "machine_translation", "ready_for_review"),  # review only
    ("c1", "es", "machine_translation", "reviewed"),  # translation_reviews record
    ("c2", "en", "native", None),  # source without translation
    ("c3", "en", "native", None),  # source with a final selection
    ("c3", "de", "human_translation", "accepted"),  # submission and review work
]


def _exec(conn, sql: str, **params: Any) -> None:
    conn.execute(text(sql), params)


def _assign(conn, doc: str, task: str, user: str = "ann") -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task) "
        f"SELECT p.id, :doc, u.id, :task FROM {S}.projects p, {S}.users u "
        "WHERE p.project_key = 'p' AND u.username = :user",
        doc=doc,
        task=task,
        user=user,
    )


def _seed(conn) -> None:
    for key in ("p", "empty", "q"):
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256) VALUES (:k, :k, '{}', 'm', '{}', 't')",
            k=key,
        )
    for name, pseudonym in (("ann", "ann-0001"), ("lead", "lead-0002")):
        _exec(
            conn,
            f"INSERT INTO {S}.users (username, display_name, pseudonym)"
            " VALUES (:u, :u, :p)",
            u=name,
            p=pseudonym,
        )
    for case, lang, origin, status in DOCUMENTS:
        source = f"d-{case}-en" if origin != "native" else None
        _exec(
            conn,
            f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
            " case_id, external_id, version, origin, derived_from,"
            " translation_status, text_sha256) SELECT id, :doc, :lang, 'x', :case,"
            f" :doc, 1, :origin, :source, :status, 'h' FROM {S}.projects"
            " WHERE project_key = 'p'",
            doc=f"d-{case}-{lang}",
            lang=lang,
            case=case,
            origin=origin,
            source=source,
            status=status,
        )
    _assign(conn, "d-c1-fr", "annotate")
    _assign(conn, "d-c1-it", "translation_review")
    _assign(conn, "d-c1-es", "translation_review")
    _assign(conn, "d-c3-de", "translation_review", "lead")
    _exec(
        conn,
        f"INSERT INTO {S}.translation_reviews (project_id, document_id, assignment_id,"
        " reviewer_user_id, reviewer_pseudonym, reviewer_qualification,"
        " reviewer_languages, decision, clinical_change, machine_text_sha256,"
        " proposed_text, proposed_text_sha256, status_before, status_after,"
        " review_policy) SELECT a.project_id, a.document_id, a.id, a.user_id,"
        " 'ann-0001', 'q', '[]', 'query', false, 'h', 'x', 'h', 'ready_for_review',"
        f" 'reviewed', 'p' FROM {S}.assignments a WHERE a.document_id = 'd-c1-es'",
    )
    # The review assignment of c1/es was revoked; its record still counts.
    _exec(
        conn,
        f"UPDATE {S}.assignments SET revoked_at = now() WHERE document_id = 'd-c1-es'",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.submissions (project_id, submission_id, local_key,"
        " origin_key, document_id, annotator_id, mode, draft_revision, payload,"
        " created_at) SELECT id, 's1', 'k', 'k', 'd-c3-de', 'ann-0001',"
        f" 'independent', 1, '{{}}', '2026-10-19' FROM {S}.projects"
        " WHERE project_key = 'p'",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.final_selections (project_id, case_id, language,"
        " document_id, submission_id, revision, actor_id, acknowledged_cause_ids)"
        f" SELECT p.id, 'c3', 'en', 'd-c3-en', 's0', 1, u.id, '[]'"
        f" FROM {S}.projects p, {S}.users u"
        " WHERE p.project_key = 'p' AND u.username = 'lead'",
    )
    # Overrides: c1/fr is still accepted; c1/de is not (no record); c3/de was
    # overridden, then accepted by a later translation review (no record).
    for doc, action, reason in (
        ("d-c1-fr", "variant.status_override", "old reason"),
        ("d-c1-fr", "variant.status_override", "checked by phone"),
        ("d-c1-de", "variant.status_override", "later reverted"),
        ("d-c3-de", "variant.status_override", "overridden"),
        ("d-c3-de", "translation.review", None),
    ):
        _exec(
            conn,
            f"INSERT INTO {S}.audit_events (at, actor_user_id, actor_label, action,"
            " target_type, target_id, project_id, details)"
            " SELECT '2026-10-01T10:00:00Z', u.id, 'lead', :action, 'document',"
            " :doc, p.id, jsonb_build_object('reason', CAST(:reason AS text))"
            f" FROM {S}.projects p, {S}.users u"
            " WHERE p.project_key = 'p' AND u.username = 'lead'",
            action=action,
            doc=doc,
            reason=reason,
        )
    # Project q reuses c1/en and c1/fr without any work; its override on c1/fr
    # has no reason in the audit details.
    for lang, origin, status in (
        ("en", "native", None),
        ("fr", "machine_translation", "accepted"),
    ):
        _exec(
            conn,
            f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
            " case_id, external_id, version, origin, derived_from,"
            " translation_status, text_sha256) SELECT id, :doc, :lang, 'x', 'c1',"
            f" :doc, 1, :origin, :source, :status, 'h' FROM {S}.projects"
            " WHERE project_key = 'q'",
            doc=f"d-c1-{lang}",
            lang=lang,
            origin=origin,
            source=None if origin == "native" else "d-c1-en",
            status=status,
        )
    _exec(
        conn,
        f"INSERT INTO {S}.audit_events (at, actor_user_id, actor_label, action,"
        " target_type, target_id, project_id, details)"
        " SELECT '2026-10-02T10:00:00Z', u.id, 'lead', 'variant.status_override',"
        f" 'document', 'd-c1-fr', p.id, '{{}}' FROM {S}.projects p, {S}.users u"
        " WHERE p.project_key = 'q' AND u.username = 'lead'",
    )


@pytest.fixture
def migrated(tmp_path) -> Any:
    url = unmigrated_database_url(tmp_path / "work-plans-0016.db")
    upgrade(url, "0015")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0016")
    yield url, engine
    engine.dispose()


def _flags(
    engine: Engine, project: str = "p"
) -> dict[tuple[str, str], tuple[bool, bool]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT r.case_id, r.language, r.review, r.annotate"
                f" FROM {S}.work_plan_rows r JOIN {S}.projects p ON p.id = r.project_id"
                " WHERE p.project_key = :project"
            ),
            {"project": project},
        ).all()
    return {(r.case_id, r.language): (r.review, r.annotate) for r in rows}


def test_rows_with_work_keep_their_work_in_plan(migrated) -> None:
    flags = _flags(migrated[1])
    assert flags[("c1", "fr")][1] is True  # annotation assignment
    assert flags[("c1", "it")][0] is True  # review assignment
    assert flags[("c1", "es")][0] is True  # translation_reviews record
    assert flags[("c3", "en")] == (False, True)  # final selection on a source
    assert flags[("c3", "de")] == (True, True)  # review and annotation work


def test_rows_without_work_get_the_default(migrated) -> None:
    flags = _flags(migrated[1])
    assert flags[("c1", "de")] == (True, True)
    assert flags[("c1", "en")] == (False, False)  # source of a translated case
    assert flags[("c2", "en")] == (False, True)  # source without translation


def test_review_only_rows_get_annotate_from_the_default(migrated) -> None:
    flags = _flags(migrated[1])
    assert flags[("c1", "it")] == (True, True)
    assert flags[("c1", "es")] == (True, True)


def test_rows_with_annotation_work_only_keep_review_off(migrated) -> None:
    assert _flags(migrated[1])[("c1", "fr")] == (False, True)


def test_no_row_with_work_is_out_of_plan(migrated) -> None:
    flags = _flags(migrated[1])
    assert set(flags) == {(case, lang) for case, lang, _, _ in DOCUMENTS}
    with migrated[1].connect() as conn:
        plans = conn.execute(
            text(
                f"SELECT w.case_id, w.revision FROM {S}.work_plans w"
                f" JOIN {S}.projects p ON p.id = w.project_id"
                " WHERE p.project_key = 'p' ORDER BY w.case_id"
            )
        ).all()
    assert [(p.case_id, p.revision) for p in plans] == [
        ("c1", 1),
        ("c2", 1),
        ("c3", 1),
    ]
    worked = [("c1", "fr"), ("c1", "it"), ("c1", "es"), ("c3", "en"), ("c3", "de")]
    assert all(any(flags[key]) for key in worked)


def test_override_audit_becomes_acceptance_record(migrated) -> None:
    with migrated[1].connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT p.project_key, a.document_id, a.source, a.reason,"
                " a.upload_id, a.accepted_at, u.username"
                f" FROM {S}.translation_acceptances a"
                f" JOIN {S}.users u ON u.id = a.accepted_by"
                f" JOIN {S}.projects p ON p.id = a.project_id"
                " ORDER BY p.project_key"
            )
        ).all()
    assert [
        (r.project_key, r.document_id, r.source, r.reason, r.upload_id, r.username)
        for r in rows
    ] == [
        ("p", "d-c1-fr", "override", "checked by phone", None, "lead"),
        # No reason in the audit details: the fallback text.
        ("q", "d-c1-fr", "override", "Accepted without review", None, "lead"),
    ]
    assert rows[0].accepted_at.isoformat().startswith("2026-10-01")


def test_project_settings_defaults_and_checks(migrated) -> None:
    _url, engine = migrated
    with engine.connect() as conn:
        assert conn.execute(
            text(f"SELECT DISTINCT annotations_per_text, import_plan FROM {S}.projects")
        ).all() == [(1, "review_and_annotate_translations")]
    for column, value in (
        ("annotations_per_text", "0"),
        ("annotations_per_text", "6"),
        ("import_plan", "'everything'"),
    ):
        with (
            pytest.raises(IntegrityError, match=f"ck_projects_{column}"),
            engine.begin() as conn,
        ):
            _exec(conn, f"UPDATE {S}.projects SET {column} = {value}")
    with engine.begin() as conn:
        _exec(
            conn,
            f"UPDATE {S}.projects SET annotations_per_text = 5, import_plan = 'nothing'",
        )


def test_acceptances_and_discards_are_append_only(migrated) -> None:
    url, engine = migrated
    with engine.begin() as conn:
        _exec(
            conn,
            f"INSERT INTO {S}.discarded_variants (project_id, document_id, reason,"
            f" discarded_by) SELECT p.id, 'd-c1-de', 'bad', u.id FROM {S}.projects p,"
            f" {S}.users u WHERE p.project_key = 'p' AND u.username = 'lead'",
        )
    app = create_engine(make_url(url).set(username=APP_ROLE, password=PASSWORD))
    try:
        with app.begin() as conn:
            _exec(
                conn,
                f"INSERT INTO {S}.translation_acceptances (project_id, document_id,"
                f" source) SELECT id, 'd-c1-de', 'package' FROM {S}.projects"
                " WHERE project_key = 'p'",
            )
        for table in ("translation_acceptances", "discarded_variants"):
            for statement in (
                f"UPDATE {S}.{table} SET project_id = project_id",
                f"DELETE FROM {S}.{table}",
            ):
                with (
                    pytest.raises(DBAPIError, match="permission denied"),
                    app.begin() as conn,
                ):
                    _exec(conn, statement)
    finally:
        app.dispose()
    with pytest.raises(DBAPIError, match="append-only"), engine.begin() as conn:
        _exec(conn, f"DELETE FROM {S}.discarded_variants")


def test_migration_is_audited_per_project(migrated) -> None:
    with migrated[1].connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT p.project_key, e.actor_user_id, e.actor_label, e.at,"
                " e.target_type, e.target_id, e.details"
                f" FROM {S}.audit_events e JOIN {S}.projects p ON p.id = e.project_id"
                " WHERE e.action = 'work_plan.migrate' ORDER BY p.project_key"
            )
        ).all()
    assert [r.project_key for r in rows] == ["empty", "p", "q"]
    for row in rows:
        assert row.actor_user_id is None
        assert row.actor_label == "migration"
        assert row.at is not None
        assert (row.target_type, row.target_id) == ("project", row.project_key)
    assert rows[0].details == {"rows": 0, "review": 0, "annotate": 0, "not_in_plan": 0}
    # p: 8 rows; review on c1/de, it, es, c3/de; annotate on all but c1/en.
    assert rows[1].details == {"rows": 8, "review": 4, "annotate": 7, "not_in_plan": 1}
    assert rows[2].details == {"rows": 2, "review": 1, "annotate": 1, "not_in_plan": 1}


def test_projects_are_migrated_in_isolation(migrated) -> None:
    # Same case/language as p, but p's annotation work on c1/fr does not leak.
    assert _flags(migrated[1])[("c1", "fr")] == (False, True)
    assert _flags(migrated[1], "q") == {
        ("c1", "en"): (False, False),
        ("c1", "fr"): (True, True),
    }


def test_downgrade_is_not_supported(migrated) -> None:
    _url, engine = migrated
    with (
        pytest.raises(NotImplementedError, match="forward-only"),
        engine.begin() as conn,
    ):
        command.downgrade(alembic_config(conn), "0015")
