"""Imports plan new language versions and accept package-reviewed translations."""

from __future__ import annotations

import json

import ontospan
import pytest
from auth_harness import logged_in
from sqlalchemy import func, insert, select, update
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from test_uploads_api import BASE, _run
from test_variant_import import audit_rows, commit, override, preview, units

from ontocurator.auth.audit import Actor
from ontocurator.domain.errors import DomainError
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.exchange.t1 import ImportedDocument, document_from_unit
from ontocurator.exchange.uploads import PlanChoice, UploadService, _require_override
from ontocurator.exchange.variant_plan import package_review
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.plan_tables import (
    DiscardedVariantRow,
    TranslationAcceptanceRow,
)
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import JobRow, ProjectRow, UserRow


@pytest.fixture
def staged(tmp_path):
    application = _app(tmp_path)
    create_project(application.state.repo.db)
    admin = logged_in(application, "root", system_admin=True, assignments=[])
    lead = logged_in(application, "leader", projects={"proj": ["lead"]}, assignments=[])
    return application, admin, lead


NEWER_MINOR = "1.3.0"
REVIEWED = {
    "status": "reviewed",
    "reviewer": "R. Roe",
    "reviewed_at": "2026-10-01T10:00:00Z",
}


def marked(item, review, *, version=NEWER_MINOR):
    """``translation.review`` is read only from format >= 1.3 (D20); ontospan
    1.2.0 reads a newer minor version leniently and keeps the extra field, and
    rejects the field in a 1.2 unit."""
    translation = item.document.translation.model_dump(mode="json")
    translation["review"] = review
    return item.model_copy(
        update={
            "schema_version": version,
            "document": item.document.model_copy(
                update={"translation": ontospan.Translation.model_validate(translation)}
            ),
        }
    )


def case_units(case, languages=("de", "fr")):
    source = native_unit(case, "en", f"Source text of {case}.")
    return source, [
        translation_unit(case, lang, f"{lang} text of {case}.", source=source)
        for lang in languages
    ]


def two_cases():
    result = []
    for case in ("c1", "c2"):
        source, translated = case_units(case)
        result += [source, *translated]
    return result


def project_id(application):
    with application.state.repo.db.transaction() as conn:
        value = Repository._project_id(conn, "proj")
        assert value is not None
        return value


def user_id(application, username):
    with application.state.repo.db.transaction() as conn:
        return conn.execute(
            select(UserRow.id).where(UserRow.username == username)
        ).scalar_one()


def stored_rows(application):
    with application.state.repo.db.transaction() as conn:
        return store.plan_rows(conn, project_id(application))


def acceptances(application):
    with application.state.repo.db.transaction() as conn:
        return store.acceptances(conn, project_id(application))


def enqueue_plan(client, upload, **body):
    return client.post(
        f"{BASE}/{upload['id']}/commit",
        json={"plan_sha256": upload["plan_sha256"], **body},
    )


def commit_plan(application, client, upload, **body):
    response = enqueue_plan(client, upload, **body)
    assert response.status_code == 200, response.text
    result = _run(application, response.json()["job_id"])
    assert result.status == "succeeded", result.error
    return result


def set_import_plan(application, value):
    with application.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(import_plan=value)
        )


def write_plan(application, rows):
    with application.state.repo.db.transaction() as conn:
        store.write_rows(conn, project_id(application), rows, actor_id=None)


def discard(application, document_id):
    with application.state.repo.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=project_id(application),
                document_id=document_id,
                reason="wrong source",
                discarded_by=user_id(application, "root"),
            )
        )


def by_row(entries):
    return {(e["case_id"], e["language"]): e for e in entries}


def test_translation_marked_reviewed_in_package_is_imported_accepted(staged, tmp_path):
    application, admin, _ = staged
    source, (de, fr, es) = case_units("c1", ("de", "fr", "es"))
    de, fr = marked(de, REVIEWED), marked(fr, {"status": "pending"})
    upload = preview(application, admin, bundle(tmp_path, [source, de, fr, es]))
    variants = {v["language"]: v for v in upload["preview"]["variants"]}
    assert variants["de"]["status"] == "accepted"
    assert variants["de"]["status_reason"] == "Marked as reviewed in the package"
    assert variants["de"]["marked_in_package"] is True
    assert variants["fr"]["status"] == variants["es"]["status"] == "ready_for_review"
    assert not variants["fr"]["marked_in_package"]
    commit(application, admin, upload)
    repo = application.state.repo
    assert repo.get_variant("proj", "c1~de~v1").translation_status == "accepted"
    assert repo.get_variant("proj", "c1~fr~v1").translation_status == (
        "ready_for_review"
    )
    found = acceptances(application)
    assert set(found) == {"c1~de~v1"}
    record = found["c1~de~v1"]
    assert record["source"] == "package"
    assert record["upload_id"] == upload["id"]
    assert record["reason"] is None and record["accepted_by"] is None
    assert record["metadata"] == {
        "reviewer": "R. Roe",
        "reviewed_at": "2026-10-01T10:00:00Z",
    }
    assert stored_rows(application) == {
        RowKey("c1", "en"): PlanFlags(False, False),
        RowKey("c1", "de"): PlanFlags(False, True),
        RowKey("c1", "fr"): PlanFlags(True, True),
        RowKey("c1", "es"): PlanFlags(True, True),
    }


def test_preview_returns_default_plan_by_language(staged, tmp_path):
    application, admin, _ = staged
    path = bundle(tmp_path, two_cases())
    plan = preview(application, admin, path)["preview"]["work_plan"]
    assert plan["setting"] == "review_and_annotate_translations"
    assert plan["existing_rows_kept"] == 0
    languages = {entry["key"]: entry for entry in plan["languages"]}
    assert [entry["key"] for entry in plan["languages"]] == ["source", "de", "fr"]
    assert languages["source"] == {
        "key": "source",
        "source_languages": ["en"],
        "rows": 2,
        "versions": 2,
        "review": None,
        "annotate": True,
        "source_rule": "if_no_translation",
        "marked_in_package": 0,
        "not_accepted": 0,
    }
    for lang in ("de", "fr"):
        assert languages[lang] == {
            "key": lang,
            "source_languages": [],
            "rows": 2,
            "versions": 2,
            "review": True,
            "annotate": True,
            "source_rule": None,
            "marked_in_package": 0,
            "not_accepted": 2,
        }
    cases = by_row(plan["cases"])
    assert len(cases) == 6 and all(entry["new_row"] for entry in cases.values())
    assert cases[("c1", "en")] == {
        "case_id": "c1",
        "language": "en",
        "review": None,
        "annotate": False,
        "new_row": True,
        "accepted": False,
        "marked_in_package": False,
    }
    assert cases[("c2", "de")]["review"] is cases[("c2", "de")]["annotate"] is True
    set_import_plan(application, "nothing")
    plan = preview(application, admin, path)["preview"]["work_plan"]
    assert plan["setting"] == "nothing"
    for entry in plan["languages"]:
        assert entry["annotate"] is False and entry["review"] in (None, False)
        assert entry["source_rule"] is None
    assert not any(e["review"] or e["annotate"] for e in plan["cases"])


def test_commit_applies_language_and_case_overrides(staged, tmp_path):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    result = commit_plan(
        application,
        admin,
        upload,
        plan_languages={"fr": {"review": False, "annotate": False}},
        plan_cases=[
            {"case_id": "c2", "language": "fr", "review": True, "annotate": False}
        ],
    )
    assert result.result["documents_added"] == 6
    rows = stored_rows(application)
    assert rows[RowKey("c1", "fr")] == PlanFlags(False, False)
    assert rows[RowKey("c2", "fr")] == PlanFlags(True, False)
    assert rows[RowKey("c1", "de")] == rows[RowKey("c2", "de")] == PlanFlags(True, True)
    assert (
        rows[RowKey("c1", "en")] == rows[RowKey("c2", "en")] == PlanFlags(False, False)
    )
    with application.state.repo.db.transaction() as conn:
        assert store.revisions(conn, project_id(application), ["c1", "c2"]) == {
            "c1": 1,
            "c2": 1,
        }


def test_existing_rows_keep_their_plan(staged, tmp_path):
    application, admin, _ = staged
    source, (de,) = case_units("c1", ("de",))
    first = tmp_path / "first"
    first.mkdir()
    commit(application, admin, preview(application, admin, bundle(first, [source, de])))
    write_plan(application, {RowKey("c1", "de"): PlanFlags(True, False)})
    es = translation_unit("c1", "es", "es text of c1.", source=source)
    upload = preview(application, admin, bundle(tmp_path, [source, de, es]))
    plan = upload["preview"]["work_plan"]
    cases = by_row(plan["cases"])
    assert {k for k, e in cases.items() if e["new_row"]} == {("c1", "es")}
    assert plan["existing_rows_kept"] == 2
    assert [entry["key"] for entry in plan["languages"]] == ["es"]
    assert cases[("c1", "de")]["review"] is True
    assert cases[("c1", "de")]["annotate"] is False
    assert cases[("c1", "es")]["review"] is cases[("c1", "es")]["annotate"] is True
    with application.state.repo.db.transaction() as conn:
        assert store.revisions(conn, project_id(application), ["c1"]) == {"c1": 2}
    commit(application, admin, upload)
    assert stored_rows(application) == {
        RowKey("c1", "en"): PlanFlags(False, False),
        RowKey("c1", "de"): PlanFlags(True, False),
        RowKey("c1", "es"): PlanFlags(True, True),
    }
    # A new row in an existing case changes its plan: open dialogs go stale.
    with application.state.repo.db.transaction() as conn:
        assert store.revisions(conn, project_id(application), ["c1"]) == {"c1": 3}


def test_existing_source_without_stored_row_keeps_its_effective_plan(staged, tmp_path):
    application, admin, _ = staged
    source, (de,) = case_units("c1", ("de",))
    # A document stored without a plan row behaves as the import default.
    Repository(application.state.repo.db).add_documents_and_proposals(
        "proj",
        [ImportedDocument(document_from_unit(source))],
        [],
        source_sha256="a" * 64,
    )
    assert stored_rows(application) == {}
    commit(application, admin, preview(application, admin, bundle(tmp_path, [de])))
    assert stored_rows(application) == {
        RowKey("c1", "en"): PlanFlags(False, True),
        RowKey("c1", "de"): PlanFlags(True, True),
    }


def test_commit_refuses_annotate_without_accepted_translation_when_rule_on(
    staged, tmp_path
):
    application, _, lead = staged
    upload = preview(application, lead, bundle(tmp_path, two_cases()))
    service = UploadService(
        application.state.repo.db,
        application.state.jobs,
        Actor.user(user_id(application, "leader"), "leader"),
    )
    with pytest.raises(DomainError) as error:
        service.commit(
            "proj",
            upload["id"],
            upload["plan_sha256"],
            plan_languages={"de": PlanChoice(review=False, annotate=True)},
        )
    assert error.value.code == "WORK_PLAN_INVALID"
    assert error.value.details["reason"] == "annotate_not_accepted"
    assert {(r["case_id"], r["language"]) for r in error.value.details["rows"]} == {
        ("c1", "de"),
        ("c2", "de"),
    }
    assert error.value.details["rows"][0] == {
        "case_id": "c1",
        "language": "de",
        "reason": "annotate_not_accepted",
        "not_accepted": True,
        "not_acceptable": False,
        "marked_in_package": False,
    }
    assert application.state.repo.list_documents("proj") == []
    commit_plan(
        application,
        lead,
        upload,
        plan_languages={"de": {"review": False, "annotate": True}},
        accept_external_review={"languages": ["de"], "reason": "external QA"},
    )
    found = acceptances(application)
    assert set(found) == {"c1~de~v1", "c2~de~v1"}
    for record in found.values():
        assert record["source"] == "lead"
        assert record["reason"] == "external QA"
        assert record["accepted_by"] == user_id(application, "leader")
        assert record["upload_id"] == upload["id"]
    repo = application.state.repo
    assert repo.get_variant("proj", "c1~de~v1").translation_status == "accepted"
    assert repo.get_variant("proj", "c1~fr~v1").translation_status == (
        "ready_for_review"
    )
    assert stored_rows(application)[RowKey("c2", "de")] == PlanFlags(False, True)


def test_plan_without_rule_accepts_annotate_without_review(staged, tmp_path):
    application, admin, _ = staged
    with application.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotate_accepted_translations_only=False)
        )
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    commit_plan(
        application,
        admin,
        upload,
        plan_languages={"de": {"review": False, "annotate": True}},
    )
    assert stored_rows(application)[RowKey("c1", "de")] == PlanFlags(False, True)
    assert acceptances(application) == {}


def test_plan_choices_name_only_rows_of_the_upload(staged, tmp_path):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    response = enqueue_plan(
        admin,
        upload,
        plan_cases=[
            {"case_id": "c9", "language": "de", "review": True, "annotate": True}
        ],
    )
    assert response.status_code >= 400
    assert response.json()["code"] == "WORK_PLAN_INVALID"
    response = enqueue_plan(
        admin,
        upload,
        plan_languages={"source": {"review": True, "annotate": True}},
    )
    assert response.status_code >= 400
    assert response.json()["code"] == "WORK_PLAN_INVALID"
    assert application.state.repo.list_documents("proj") == []


def test_annotator_cannot_accept_external_review(staged, tmp_path):
    application, admin, _ = staged
    annotator = logged_in(
        application, "reader", projects={"proj": ["annotator"]}, assignments=[]
    )
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    response = enqueue_plan(
        annotator,
        upload,
        accept_external_review={"languages": ["de"], "reason": "external QA"},
    )
    assert response.status_code == 403


def test_plan_hash_covers_project_import_setting(staged, tmp_path):
    application, admin, _ = staged
    path = bundle(tmp_path, two_cases())
    upload = preview(application, admin, path)
    set_import_plan(application, "nothing")
    # The project state hash itself covers the setting, not only work_plan.
    again = preview(application, admin, path)["preview"]
    assert again["state_sha256"] != upload["preview"]["state_sha256"]
    response = enqueue_plan(admin, upload)
    if response.status_code == 200:
        job = _run(application, response.json()["job_id"])
        assert job.status == "failed" and "UPLOAD_STALE" in job.error
    else:
        assert response.json()["code"] == "UPLOAD_STALE"
    assert application.state.repo.list_documents("proj") == []


def test_imports_without_preview_create_default_rows(staged, tmp_path):
    application, _, _ = staged
    source, (de,) = case_units("c1", ("de",))
    job = run_import(application.state.repo.db, bundle(tmp_path, [source, de]))
    assert job.status == "succeeded", job.error
    assert stored_rows(application) == {
        RowKey("c1", "en"): PlanFlags(False, False),
        RowKey("c1", "de"): PlanFlags(True, True),
    }


def test_fully_discarded_row_counts_as_new_row(staged, tmp_path):
    application, admin, _ = staged
    s1, (d1,) = case_units("c1", ("de",))
    s2, (d2,) = case_units("c2", ("de",))
    d2b = translation_unit("c2-b", "de", "Second de root of c2.", source=s2)
    first = tmp_path / "first"
    first.mkdir()
    commit(
        application,
        admin,
        preview(application, admin, bundle(first, [s1, d1, s2, d2, d2b])),
    )
    write_plan(
        application,
        {
            RowKey("c1", "de"): PlanFlags(False, False),
            RowKey("c2", "de"): PlanFlags(True, False),
        },
    )
    discard(application, "c1~de~v1")
    discard(application, "c2~de~v1")
    d1b = translation_unit("c1-b", "de", "Fresh de root of c1.", source=s1)
    d2c = translation_unit("c2-c", "de", "Third de root of c2.", source=s2)
    upload = preview(application, admin, bundle(tmp_path, [d1b, d2c]))
    cases = by_row(upload["preview"]["work_plan"]["cases"])
    assert cases[("c1", "de")]["new_row"] is True
    assert cases[("c1", "de")]["review"] is cases[("c1", "de")]["annotate"] is True
    assert cases[("c2", "de")]["new_row"] is False
    assert upload["preview"]["work_plan"]["existing_rows_kept"] == 1
    commit(application, admin, upload)
    rows = stored_rows(application)
    assert rows[RowKey("c1", "de")] == PlanFlags(True, True)
    assert rows[RowKey("c2", "de")] == PlanFlags(True, False)


def test_import_override_writes_override_acceptance_with_upload(staged, tmp_path):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, list(units(failed=True))))
    commit(application, admin, upload, [override()])
    record = acceptances(application)["case~de~v1"]
    assert record["source"] == "override"
    assert record["reason"] == "Clinically reviewed"
    assert record["accepted_by"] == user_id(application, "root")
    assert record["upload_id"] == upload["id"]
    assert (
        audit_rows(application, "variant.status_override")[-1]["upload_id"]
        == (upload["id"])
    )


def test_override_of_an_earlier_imported_variant_writes_no_acceptance(staged, tmp_path):
    application, admin, _ = staged
    path = bundle(tmp_path, list(units(failed=True)))
    commit(application, admin, preview(application, admin, path))
    commit(application, admin, preview(application, admin, path), [override()])
    variant = application.state.repo.get_variant("proj", "case~de~v1")
    assert variant.translation_status == "accepted"
    assert acceptances(application) == {}


def test_format_1_2_package_with_translation_review_is_invalid(staged, tmp_path):
    application, admin, _ = staged
    _, (de,) = case_units("c1", ("de",))
    # The bundle writer refuses such a unit, so write the single file directly.
    data = json.loads(ontospan.dump_json(marked(de, REVIEWED)))
    data["schema_version"] = "1.2.0"
    path = tmp_path / "unit.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    upload = preview(application, admin, path)
    assert upload["status"] == "invalid"
    assert any(
        error["code"] == "schema" and "document.translation" in error["message"]
        for error in upload["preview"]["errors"]
    ), upload["preview"]["errors"]


def test_package_review_metadata_is_sanitized():
    long = "x" * 600
    assert package_review(
        {"review": {"status": "reviewed", "reviewer": long, "note": 12}}
    ) == {"reviewer": "x" * 500, "note": "12"}
    assert package_review({"review": {"reviewed_at": "yesterday"}}) == {}
    assert package_review({"review": {"reviewed_at": "2026-10-01T10:00:00Z"}}) == {
        "reviewed_at": "2026-10-01T10:00:00Z"
    }
    assert package_review({"review": "reviewed"}) == {}
    assert package_review(None) == {}


def test_reimporting_a_marked_package_adds_no_second_acceptance(staged, tmp_path):
    application, admin, _ = staged
    source, (de,) = case_units("c1", ("de",))
    path = bundle(tmp_path, [source, marked(de, REVIEWED)])
    commit(application, admin, preview(application, admin, path))
    again = commit(application, admin, preview(application, admin, path))
    assert again.result["documents_added"] == 0
    with application.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(TranslationAcceptanceRow)
            ).scalar_one()
            == 1
        )


def test_external_acceptance_skips_rows_with_review_on(staged, tmp_path):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    commit_plan(
        application,
        admin,
        upload,
        plan_cases=[
            {"case_id": "c1", "language": "de", "review": False, "annotate": True}
        ],
        accept_external_review={"languages": ["de"], "reason": "external QA"},
    )
    assert set(acceptances(application)) == {"c1~de~v1"}
    repo = application.state.repo
    assert repo.get_variant("proj", "c2~de~v1").translation_status == (
        "ready_for_review"
    )
    (details,) = audit_rows(application, "work_plan.import")
    assert details["accepted_documents"] == ["c1~de~v1"]
    accepted = audit_rows(application, "translation.accept_external_review")
    assert [d["document_id"] for d in accepted] == ["c1~de~v1"]


def test_external_acceptance_without_eligible_rows_is_refused(staged, tmp_path):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    # Review stays on for every de row: nothing to accept.
    response = enqueue_plan(
        admin,
        upload,
        accept_external_review={"languages": ["de"], "reason": "external QA"},
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "WORK_PLAN_INVALID"
    assert body["details"]["reason"] == "not_acceptable"
    assert body["details"]["languages"] == ["de"]
    assert application.state.repo.list_documents("proj") == []


def test_override_requires_a_user_or_the_cli_operator(staged):
    application, _, _ = staged
    pid = project_id(application)
    reader = logged_in(
        application, "reader", projects={"proj": ["annotator"]}, assignments=[]
    )
    assert reader is not None
    db = application.state.repo.db
    with db.transaction() as conn, pytest.raises(DomainError) as error:
        _require_override(conn, Actor(None, "system:worker"), "proj", pid)
    assert error.value.code == "NOT_ALLOWED"
    with db.transaction() as conn:
        _require_override(conn, Actor.cli(), "proj", pid)
        _require_override(
            conn, Actor.user(user_id(application, "leader"), "l"), "proj", pid
        )
    with db.transaction() as conn, pytest.raises(DomainError) as error:
        _require_override(
            conn, Actor.user(user_id(application, "reader"), "reader"), "proj", pid
        )
    assert error.value.code == "NOT_ALLOWED"


def test_invalid_plan_at_job_time_writes_no_documents(staged, tmp_path):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    response = enqueue_plan(admin, upload)
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]
    # A payload that skipped the service check (e.g. an older queued job).
    with application.state.repo.db.transaction() as conn:
        payload = conn.execute(
            select(JobRow.payload).where(JobRow.id == job_id)
        ).scalar_one()
        payload["plan_languages"] = {"de": {"review": False, "annotate": True}}
        conn.execute(update(JobRow).where(JobRow.id == job_id).values(payload=payload))
    job = _run(application, job_id)
    assert job.status == "failed" and "WORK_PLAN_INVALID" in job.error
    assert application.state.repo.list_documents("proj") == []
    assert stored_rows(application) == {}
    assert admin.get(f"{BASE}/{upload['id']}").json()["status"] == "failed"
