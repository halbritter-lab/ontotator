"""Actual PostgreSQL/API/worker variant imports; execution awaits root token.

The correction -> durable reanchor assertion is explicitly deferred to Task7's
real handler registration; no fake queued kind or skipped-green test lives here.
"""

from __future__ import annotations

from dataclasses import asdict

import pytest
from auth_harness import logged_in
from sqlalchemy import delete, select, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project
from test_auth_api import _app
from test_uploads_api import BASE, _ready, _run
from typer.testing import CliRunner

from ontocurator.cli import app as cli
from ontocurator.exchange.jobs import HANDLERS
from ontocurator.exchange.t1 import ImportedDocument, document_from_unit
from ontocurator.jobs.queue import JobQueue
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import (
    AuditEventRow,
    DocumentRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)


@pytest.fixture
def staged(tmp_path):
    application = _app(tmp_path)
    create_project(application.state.repo.db)
    admin = logged_in(application, "root", system_admin=True, assignments=[])
    lead = logged_in(application, "leader", projects={"proj": ["lead"]}, assignments=[])
    return application, admin, lead


def units(*, failed=False):
    source = native_unit("case", "en", "Original source")
    translated = translation_unit(
        "case",
        "de",
        "Deutscher Text",
        source=source,
        checks=(("units_added", not failed),),
    )
    return source, translated


def preview(application, client, path):
    return _ready(
        application,
        client,
        data=path.read_bytes(),
        name=path.name,
        kind="t1",
        language="",
    )


def enqueue(application, client, upload, overrides=()):
    return client.post(
        f"{BASE}/{upload['id']}/commit",
        json={
            "plan_sha256": upload["plan_sha256"],
            "status_overrides": list(overrides),
        },
    )


def commit(application, client, upload, overrides=()):
    response = enqueue(application, client, upload, overrides)
    assert response.status_code == 200, response.text
    result = _run(application, response.json()["job_id"])
    assert result.status == "succeeded", result.error
    return result


def override(
    *, reason="Clinically reviewed", external_id="case", language="de", version=1
):
    return dict(
        external_id=external_id, language=language, version=version, reason=reason
    )


def audit_rows(application, action):
    with application.state.repo.db.transaction() as conn:
        return list(
            conn.execute(
                select(AuditEventRow.details).where(AuditEventRow.action == action)
            ).scalars()
        )


@pytest.mark.parametrize("failed", [False, True])
def test_a_source_and_translation_are_planned_persisted_and_reimported(
    staged, tmp_path, failed
):
    application, admin, _ = staged
    source, translated = units(failed=failed)
    path = bundle(tmp_path, [translated, source])
    upload = preview(application, admin, path)
    rows = upload["preview"]["variants"]
    assert [v["document_id"] for v in rows] == ["case", "case~de~v1"]
    assert rows[1]["derived_from"] == "case"
    assert rows[1]["failed_checks"] == (["units_added"] if failed else [])
    assert Repository(application.state.repo.db).list_documents("proj") == []
    result = commit(application, admin, upload)
    assert result.result["documents_added"] == 2
    assert result.result["sets_added"] == result.result["proposals"] == 0
    variant = application.state.repo.get_variant("proj", "case~de~v1")
    assert variant.case_id == "case"
    assert variant.translation_status == (
        "automatic_check_failed" if failed else "ready_for_review"
    )
    assert variant.translation == translated.document.translation.model_dump(
        mode="json"
    )
    before = [asdict(v) for v in application.state.repo.list_variants("proj")]
    again = commit(application, admin, preview(application, admin, path))
    assert (
        again.result["documents_added"]
        == again.result["sets_added"]
        == again.result["proposals"]
        == 0
    )
    assert before == [asdict(v) for v in application.state.repo.list_variants("proj")]


def test_a_translation_resolves_an_existing_plain_text_source(staged, tmp_path):
    application, admin, _ = staged
    plain = _ready(
        application, admin, data=b"Original source", name="case.txt", language="en"
    )
    commit(application, admin, plain)
    _, translated = units()
    result = commit(
        application, admin, preview(application, admin, bundle(tmp_path, [translated]))
    )
    assert result.result["documents_added"] == 1
    assert (
        application.state.repo.get_variant("proj", "case~de~v1").derived_from == "case"
    )


def test_correction_uses_exact_predecessor_without_rewriting_history(staged, tmp_path):
    application, admin, _ = staged
    source, translated = units()
    first_path = tmp_path / "first"
    first_path.mkdir()
    commit(
        application,
        admin,
        preview(application, admin, bundle(first_path, [source, translated])),
    )
    before = application.state.repo.get_document("proj", "case~de~v1")
    corrected = correction_unit(translated, "Korrigierter Text")
    commit(
        application, admin, preview(application, admin, bundle(tmp_path, [corrected]))
    )
    value = application.state.repo.get_variant("proj", "case~de~v2")
    assert value.derived_from == "case~de~v1" and value.version == 2
    assert value.translation is None and value.translation_status == "ready_for_review"
    assert application.state.repo.get_document("proj", "case~de~v1") == before


@pytest.mark.parametrize("failure", ["unknown", "ambiguous", "skipped_version"])
def test_invalid_variant_previews_write_no_documents(staged, tmp_path, failure):
    application, admin, _ = staged
    source, translated = units()
    if failure == "unknown":
        incoming, code = [translated], "VARIANT_SOURCE_UNKNOWN"
    elif failure == "ambiguous":
        copy = native_unit("copy", "en", source.document.text, case_id="case")
        incoming, code = [source, copy, translated], "VARIANT_SOURCE_AMBIGUOUS"
    else:
        incoming, code = (
            [source, correction_unit(source, "Correction", version=3)],
            "VARIANT_VERSION_INVALID",
        )
    upload = preview(application, admin, bundle(tmp_path, incoming))
    assert upload["status"] == "invalid"
    assert code in {item["code"] for item in upload["preview"]["errors"]}
    assert enqueue(application, admin, upload).status_code == 409
    assert application.state.repo.list_documents("proj") == []


def test_lead_override_is_persisted_in_job_and_audited_by_restarted_queue(
    staged, tmp_path
):
    application, admin, lead = staged
    source, translated = units(failed=True)
    path = bundle(tmp_path, [source, translated])
    upload = preview(application, lead, path)
    response = enqueue(
        application, lead, upload, [override(reason="  Reviewed = accepted  ")]
    )
    assert response.status_code == 200, response.text
    db = application.state.repo.db
    with db.transaction() as conn:
        row = conn.execute(
            select(JobRow).where(JobRow.id == response.json()["job_id"])
        ).one()
        assert row.payload["status_overrides"] == [
            override(reason="Reviewed = accepted")
        ]
        assert row.project_id is not None and row.requested_by is not None
    queue = JobQueue(db, HANDLERS)
    claimed = queue.claim(response.json()["job_id"], "restarted-worker")
    assert claimed is not None
    result = queue.run(claimed, "restarted-worker")
    assert result.status == "succeeded", result.error
    accepted = application.state.repo.get_variant("proj", "case~de~v1")
    assert (
        accepted.translation_status == "accepted"
        and accepted.status_reason == "Reviewed = accepted"
    )
    assert audit_rows(application, "variant.status_override") == [
        {
            "document_id": "case~de~v1",
            "from": "automatic_check_failed",
            "to": "accepted",
            "reason": "Reviewed = accepted",
        }
    ]
    before = asdict(accepted)
    commit(application, admin, preview(application, admin, path))
    assert asdict(application.state.repo.get_variant("proj", "case~de~v1")) == before
    assert len(audit_rows(application, "variant.status_override")) == 1


@pytest.mark.parametrize(
    "bad,code",
    [
        ([override(reason=" ")], "OVERRIDE_REASON_REQUIRED"),
        ([override(language="en")], "OVERRIDE_NOT_APPLICABLE"),
        ([override(), override()], "OVERRIDE_NOT_APPLICABLE"),
        ([override(external_id="missing")], "OVERRIDE_NOT_APPLICABLE"),
    ],
)
def test_invalid_override_refuses_entire_enqueue_and_import(
    staged, tmp_path, bad, code
):
    application, admin, _ = staged
    upload = preview(application, admin, bundle(tmp_path, list(units())))
    before = audit_rows(application, "project.import")
    response = enqueue(application, admin, upload, bad)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == code
    assert application.state.repo.list_documents("proj") == []
    assert audit_rows(application, "variant.status_override") == []
    assert audit_rows(application, "project.import") == before


def test_an_annotator_cannot_request_translation_acceptance(staged, tmp_path):
    application, admin, _ = staged
    annotator = logged_in(
        application, "reader", projects={"proj": ["annotator"]}, assignments=[]
    )
    upload = preview(application, admin, bundle(tmp_path, list(units())))
    response = enqueue(application, annotator, upload, [override()])
    assert response.status_code == 403
    assert application.state.repo.list_documents("proj") == []


@pytest.mark.parametrize("loss", ["inactive", "membership"])
def test_worker_rechecks_current_override_authority_after_enqueue(
    staged, tmp_path, loss
):
    application, _, lead = staged
    upload = preview(application, lead, bundle(tmp_path, list(units())))
    response = enqueue(application, lead, upload, [override()])
    assert response.status_code == 200
    db = application.state.repo.db
    with db.transaction() as conn:
        user_id = conn.execute(
            select(UserRow.id).where(UserRow.username == "leader")
        ).scalar_one()
        if loss == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == user_id).values(active=False)
            )
        else:
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == user_id
                )
            )
    result = _run(application, response.json()["job_id"])
    assert result.status == "failed"
    assert application.state.repo.list_documents("proj") == []
    assert audit_rows(application, "variant.status_override") == []
    assert audit_rows(application, "project.import") == []


@pytest.mark.parametrize(
    "change", ["case", "status", "translation", "occupancy", "gate"]
)
def test_worker_replans_all_variant_decision_inputs_before_apply(
    staged, tmp_path, change
):
    application, admin, _ = staged
    source, translated = units()
    initial = tmp_path / "initial"
    initial.mkdir()
    commit(
        application,
        admin,
        preview(application, admin, bundle(initial, [source, translated])),
    )
    correction = correction_unit(translated, "Correction")
    upload = preview(application, admin, bundle(tmp_path, [correction]))
    response = enqueue(application, admin, upload)
    assert response.status_code == 200
    db = application.state.repo.db
    with db.transaction() as conn:
        if change == "gate":
            conn.execute(
                update(ProjectRow).values(annotate_accepted_translations_only=False)
            )
        elif change == "occupancy":
            doc = document_from_unit(native_unit("case~de~v2", "de", "Occupied"))
            Repository(db).add_documents_and_proposals(
                "proj", [ImportedDocument(doc)], [], source_sha256="a" * 64
            )
        else:
            patch = (
                {"case_id": "changed-case"}
                if change == "case"
                else {"translation_status": "reviewed"}
                if change == "status"
                else {
                    "translation": {
                        **translated.document.translation.model_dump(mode="json"),
                        "run_id": "changed-run",
                    }
                }
            )
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.document_id == "case~de~v1")
                .values(**patch)
            )
    result = _run(application, response.json()["job_id"])
    assert result.status == "failed" and "UPLOAD_STALE" in result.error
    if change != "occupancy":
        assert application.state.repo.get_document("proj", "case~de~v2") is None
    assert len(audit_rows(application, "project.import")) == 1


def test_cli_no_wait_persists_the_same_typed_override_payload(staged, tmp_path):
    from pg_harness import database_url_for

    application, _, _ = staged
    path = bundle(tmp_path, list(units()))
    db = application.state.repo.db
    result = CliRunner().invoke(
        cli,
        [
            "admin",
            "--database-url",
            database_url_for(tmp_path / "auth.db"),
            "import",
            "proj",
            str(path),
            "--no-wait",
            "--accept-translation",
            "case:de:1=Reviewed = accepted",
        ],
        env={"ONTOCURATOR_DATA_DIR": str(db.data_dir)},
    )
    assert result.exit_code == 0, result.output
    with db.transaction() as conn:
        row = conn.execute(select(JobRow).where(JobRow.kind == "t1_import")).one()
        assert row.payload["status_overrides"] == [
            override(reason="Reviewed = accepted")
        ]
    result = _run(application, row.id)
    assert result.status == "succeeded", result.error
    assert (
        application.state.repo.get_variant("proj", "case~de~v1").translation_status
        == "accepted"
    )


def test_variants_export_with_real_1_1_metadata_without_source_submission(
    staged, tmp_path
):
    from test_t1_export import _read, _submit
    from test_t1_export import _run as run_export

    application, admin, _ = staged
    source, translated = units()
    # Reuse the established real repository submit helper's internal document ID.
    translated = translated.model_copy(
        update={
            "document": translated.document.model_copy(
                update={"document_id": "EN100017"}
            )
        }
    )
    commit(
        application,
        admin,
        preview(application, admin, bundle(tmp_path, [source, translated])),
    )
    db = application.state.repo.db
    _submit(db, "ann-variant", "independent", [], submission_id="variant-submission")
    exported = run_export(db, "t1_export")
    _, delivered = _read(db, exported)
    assert len(delivered) == 1
    value = delivered[0].document
    assert value.document_id == "EN100017" and value.case_id == "case"
    assert value.variant.derived_from == source.document.text_sha256
    assert value.translation == translated.document.translation


@pytest.mark.parametrize("case_id", [None, "custom-case"])
def test_single_native_export_preserves_plain_shape_and_explicit_case(
    staged, tmp_path, case_id
):
    from test_t1_export import _read, _submit
    from test_t1_export import _run as run_export

    application, admin, _ = staged
    raw = native_unit("EN100017", "en", "Original", case_id=case_id)
    commit(application, admin, preview(application, admin, bundle(tmp_path, [raw])))
    db = application.state.repo.db
    _submit(db, "ann-native", "independent", [], submission_id="native-submission")
    _, delivered = _read(db, run_export(db, "t1_export"))
    assert delivered[0].document.case_id == case_id
    assert delivered[0].document.variant is None


def test_unchanged_stored_translation_can_be_explicitly_accepted(staged, tmp_path):
    application, admin, lead = staged
    path = bundle(tmp_path, list(units()))
    commit(application, admin, preview(application, admin, path))
    result = commit(application, lead, preview(application, lead, path), [override()])
    assert result.result["documents_added"] == 0
    assert (
        application.state.repo.get_variant("proj", "case~de~v1").translation_status
        == "accepted"
    )
    assert len(audit_rows(application, "variant.status_override")) == 1


def test_invalid_persisted_worker_override_rolls_back_the_complete_import(
    staged, tmp_path
):
    from ontocurator.auth.audit import Actor
    from ontocurator.exchange.jobs import store_file

    application, _, _ = staged
    path = bundle(tmp_path, list(units()))
    db = application.state.repo.db
    sha = store_file(db, path.read_bytes())
    with db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
    job_id = application.state.jobs.enqueue(
        "t1_import",
        {
            "project": "proj",
            "blob_sha256": sha,
            "filename": path.name,
            "status_overrides": [override(), override(language="en")],
        },
        project_id=project_id,
        actor=Actor.cli(),
    )
    result = _run(application, job_id)
    assert result.status == "failed" and "OVERRIDE_NOT_APPLICABLE" in result.error
    assert application.state.repo.list_documents("proj") == []
    assert audit_rows(application, "variant.status_override") == []
    assert audit_rows(application, "project.import") == []


def test_internal_snapshot_mapping_persists_original_payload_and_defaulted_basis(
    staged, tmp_path
):
    from t1_fixtures import TEXT, unit

    from ontocurator.storage.tables import ProposalSetRow

    application, admin, _ = staged
    source, _ = units()
    translated = translation_unit("case", "de", TEXT, source=source)
    translated = translated.model_copy(
        update={
            "annotation_set": translated.annotation_set.model_copy(
                update={"annotations": unit().annotation_set.annotations}
            )
        }
    )
    result = commit(
        application,
        admin,
        preview(application, admin, bundle(tmp_path, [source, translated])),
    )
    assert result.result["proposals"] == 2 and result.result["defaulted_axes"] == 2
    with application.state.repo.db.transaction() as conn:
        payload = conn.execute(select(ProposalSetRow.payload)).scalar_one()
    assert payload == translated.annotation_set.model_dump(mode="json")
    snapshots = application.state.repo.list_annotations_for_document(
        "proj", "case~de~v1"
    )
    assert len(snapshots) == 2
    assert all(
        s.annotation.document_id == "case~de~v1"
        and s.annotation.axes_defaulted == ["experiencer"]
        for s in snapshots
    )
