"""Administration constraints exercised through the application database role."""

from pathlib import Path

import pytest
from pg_harness import database_for
from psycopg import Error as PsycopgError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.database import Database
from ontotator.storage.tables import SCHEMA


@pytest.fixture
def administration(tmp_path: Path) -> tuple[Database, int, int]:
    db = database_for(tmp_path / "admin.db")
    with db.engine.begin() as conn:
        project_id = conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.projects (project_key, name, manifest, manifest_sha256, task_profile, task_profile_sha256)"
                " VALUES ('p', 'Project', '{}', 'm', '{}', 't') RETURNING id"
            )
        ).scalar_one()
        user_id = conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.users (username, display_name, pseudonym)"
                " VALUES ('alice', 'Alice', 'ann-0001') RETURNING id"
            )
        ).scalar_one()
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.documents (project_id, document_id, case_id, external_id, language, text, text_sha256)"
                " VALUES (:project, 'd', 'd', 'd', 'en', 'A document', 'sha')"
            ),
            {"project": project_id},
        )
    return db, project_id, user_id


def test_only_one_active_assignment_per_task(
    administration: tuple[Database, int, int],
) -> None:
    db, project_id, user_id = administration
    insert = text(
        f"INSERT INTO {SCHEMA}.assignments (project_id, document_id, user_id, task,"
        " annotation_mode) VALUES (:project, 'd', :user, :task,"
        " CASE WHEN :task = 'annotate' THEN 'scratch' END) RETURNING id"
    )
    params = {"project": project_id, "user": user_id, "task": "annotate"}
    with db.engine.begin() as conn:
        first = conn.execute(insert, params).scalar_one()
        # A review is a separate task for the same user and document.
        conn.execute(insert, {**params, "task": "review"})
    with (
        pytest.raises(IntegrityError) as duplicate,
        db.engine.begin() as conn,
    ):
        conn.execute(insert, params)
    assert isinstance(duplicate.value.orig, PsycopgError)
    assert duplicate.value.orig.diag.constraint_name == "uq_assignments_active"
    with db.engine.begin() as conn:
        conn.execute(
            text(f"UPDATE {SCHEMA}.assignments SET revoked_at = now() WHERE id = :id"),
            {"id": first},
        )
        replacement = conn.execute(insert, params).scalar_one()
        assert replacement != first
        assert (
            conn.execute(
                text(f"SELECT count(*) FROM {SCHEMA}.assignments")
            ).scalar_one()
            == 3
        )
        assert (
            conn.execute(
                text(f"SELECT status FROM {SCHEMA}.assignments WHERE id = :id"),
                {"id": replacement},
            ).scalar_one()
            == "open"
        )


@pytest.mark.parametrize(
    ("column", "bad", "constraint"),
    [
        ("task", "adjudicate", "ck_assignments_task"),
        ("status", "revoked", "ck_assignments_status"),
        ("document_id", "elsewhere", "fk_assignments_project_id_document_id"),
    ],
)
def test_assignments_reject_invalid_values(
    administration: tuple[Database, int, int], column: str, bad: str, constraint: str
) -> None:
    db, project_id, user_id = administration
    params = {
        "project": project_id,
        "user": user_id,
        "task": "annotate",
        "status": "open",
        "document_id": "d",
    }
    params[column] = bad
    with pytest.raises(IntegrityError) as invalid, db.engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.assignments (project_id, document_id, user_id, task,"
                " status, annotation_mode) VALUES (:project, :document_id, :user, :task,"
                " :status, CASE WHEN :task = 'annotate' THEN 'scratch' END)"
            ),
            params,
        )
    assert isinstance(invalid.value.orig, PsycopgError)
    assert invalid.value.orig.diag.constraint_name == constraint


def test_user_languages_validate_codes_and_cascade(
    administration: tuple[Database, int, int],
) -> None:
    db, _project_id, user_id = administration
    insert = text(
        f"INSERT INTO {SCHEMA}.user_languages (user_id, language) VALUES (:user, :language)"
    )
    with db.engine.begin() as conn:
        conn.execute(insert, {"user": user_id, "language": "en"})
    for language in ("EN", "eng", "e1", ""):
        with (
            pytest.raises(IntegrityError) as invalid,
            db.engine.begin() as conn,
        ):
            conn.execute(insert, {"user": user_id, "language": language})
        assert isinstance(invalid.value.orig, PsycopgError)
        assert invalid.value.orig.diag.constraint_name == "ck_user_languages_language"
    with db.engine.begin() as conn:
        conn.execute(
            text(f"DELETE FROM {SCHEMA}.users WHERE id = :user"), {"user": user_id}
        )
        assert (
            conn.execute(
                text(f"SELECT count(*) FROM {SCHEMA}.user_languages")
            ).scalar_one()
            == 0
        )


def test_project_settings_have_defaults(
    administration: tuple[Database, int, int],
) -> None:
    db, project_id, _user_id = administration
    with db.engine.begin() as conn:
        row = conn.execute(
            text(
                f"SELECT languages, hidden_axis_values, require_chosen_axes, adjudicator_not_annotator, contiguous_mentions_only, updated_at FROM {SCHEMA}.projects WHERE id = :project"
            ),
            {"project": project_id},
        ).one()
    assert tuple(row[:5]) == ([], {}, False, False, False)
    assert row.updated_at is not None


@pytest.mark.parametrize(
    ("kind", "status", "constraint"),
    [
        ("zip", "ready", "ck_uploads_kind"),
        ("t1", "open", "ck_uploads_status"),
    ],
)
def test_uploads_reject_invalid_values(
    administration: tuple[Database, int, int], kind: str, status: str, constraint: str
) -> None:
    db, project_id, _user_id = administration
    with pytest.raises(IntegrityError) as invalid, db.engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.uploads (project_id, kind, files, status) VALUES (:project, :kind, '[]', :status)"
            ),
            {"project": project_id, "kind": kind, "status": status},
        )
    assert isinstance(invalid.value.orig, PsycopgError)
    assert invalid.value.orig.diag.constraint_name == constraint


def test_application_can_manage_uploads(
    administration: tuple[Database, int, int],
) -> None:
    db, project_id, _user_id = administration
    with db.engine.begin() as conn:
        upload_id = conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.uploads (project_id, kind, files, status) VALUES (:project, 'text', '[]', 'previewing') RETURNING id"
            ),
            {"project": project_id},
        ).scalar_one()
        conn.execute(
            text(f"UPDATE {SCHEMA}.uploads SET status = 'discarded' WHERE id = :id"),
            {"id": upload_id},
        )
        assert (
            conn.execute(
                text(f"SELECT status FROM {SCHEMA}.uploads WHERE id = :id"),
                {"id": upload_id},
            ).scalar_one()
            == "discarded"
        )
        conn.execute(
            text(f"DELETE FROM {SCHEMA}.uploads WHERE id = :id"), {"id": upload_id}
        )
