"""Authenticated staged imports, with jobs explicitly claimed and run inline."""

from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from auth_harness import logged_in
from sqlalchemy import func, select, update
from t1_fixtures import bundle, create_project, manifest_sha256, unit
from test_auth_api import _app

from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.exchange.uploads import UploadService
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AuditEventRow,
    DocumentRow,
    JobRow,
    ProjectOntologyRow,
    ProjectRow,
    ProposalAnnotationRow,
    ProposalSetRow,
    StoredFileRow,
    UploadRow,
    UserRow,
)

BASE = "/api/v1/projects/proj/uploads"


@pytest.fixture
def staged(tmp_path):
    app = _app(tmp_path)
    create_project(app.state.repo.db)
    admin = logged_in(app, "root", system_admin=True)
    return app, admin


def _create(
    client,
    data=b"Some text.\r\n",
    *,
    name="a.txt",
    kind="text",
    language="de",
    files=None,
):
    return client.post(
        BASE,
        data={"kind": kind, "language": language},
        files=files or [("files[]", (name, data))],
    )


def _run(app, job_id):
    job = app.state.jobs.claim(job_id, "test-upload")
    assert job is not None
    return app.state.jobs.run(job, "test-upload")


def _ready(app, client, **kwargs):
    created = _create(client, **kwargs)
    assert created.status_code == 200, created.text
    ids = created.json()
    job = _run(app, ids["job_id"])
    assert job.status == "succeeded", job.error
    result = client.get(f"{BASE}/{ids['upload_id']}")
    assert result.status_code == 200, result.text
    return result.json()


def _commit(app, client, upload):
    queued = client.post(
        f"{BASE}/{upload['id']}/commit", json={"plan_sha256": upload["plan_sha256"]}
    )
    assert queued.status_code == 200, queued.text
    return _run(app, queued.json()["job_id"])


def _count(app, table):
    with app.state.repo.db.transaction() as conn:
        return conn.execute(select(func.count()).select_from(table)).scalar_one()


def test_preview_writes_nothing_until_commit(staged):
    app, admin = staged
    upload = _ready(app, admin)
    assert upload["status"] == "ready"
    assert _count(app, DocumentRow) == 0
    assert _count(app, ProposalSetRow) == 0
    assert _count(app, ProposalAnnotationRow) == 0
    assert _commit(app, admin, upload).status == "succeeded"
    doc = app.state.repo.get_document("proj", "a")
    assert doc.text == "Some text.\n"
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(DocumentRow.source_text_sha256)).scalar_one()
            == hashlib.sha256(b"Some text.\r\n").hexdigest()
        )
    assert admin.get(f"{BASE}/{upload['id']}").json()["status"] == "committed"


@pytest.mark.parametrize(
    "change", ["document", "rules", "pins", "conditions", "languages"]
)
def test_commit_rereads_fresh_complete_project_context(staged, change):
    app, admin = staged
    upload = _ready(app, admin)
    db = app.state.repo.db
    with db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        if change == "document":
            conn.execute(
                DocumentRow.__table__.insert().values(
                    project_id=project_id,
                    document_id="unrelated",
                    case_id="unrelated",
                    external_id="unrelated",
                    language="de",
                    text="Else",
                    text_sha256=hashlib.sha256(b"Else").hexdigest(),
                    position=0,
                )
            )
        elif change == "rules":
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == project_id)
                .values(require_chosen_axes=True)
            )
        elif change == "pins":
            conn.execute(
                update(ProjectOntologyRow)
                .where(ProjectOntologyRow.project_id == project_id)
                .values(allowed_roots=[])
            )
        elif change == "languages":
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == project_id)
                .values(languages=["de", "en"])
            )
        else:
            from ontotator.storage.tables import ProjectSearchConditionsRow

            conn.execute(
                ProjectSearchConditionsRow.__table__.insert().values(
                    project_id=project_id, conditions=[]
                )
            )
    job = _commit(app, admin, upload)
    assert job.status == "failed" and "UPLOAD_STALE" in job.error
    assert app.state.repo.get_document("proj", "a") is None
    assert admin.get(f"{BASE}/{upload['id']}").json()["status"] == "failed"
    with db.transaction() as conn:
        assert (
            conn.execute(
                select(AuditEventRow.id).where(AuditEventRow.action == "project.import")
            ).first()
            is None
        )


def test_an_invalid_preview_cannot_be_committed(staged):
    app, admin = staged
    upload = _ready(app, admin, data=b"\xff", name="bad.txt")
    assert upload["status"] == "invalid"
    assert upload["preview"]["errors"][0]["code"] == "TEXT_NOT_UTF8"
    response = admin.post(
        f"{BASE}/{upload['id']}/commit", json={"plan_sha256": upload["plan_sha256"]}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "UPLOAD_STALE"
    discarded = admin.post(f"{BASE}/{upload['id']}/discard")
    assert discarded.json()["status"] == "discarded"


def test_wrong_hash_does_not_queue_a_commit(staged):
    app, admin = staged
    upload = _ready(app, admin)
    before = _count(app, JobRow)
    response = admin.post(
        f"{BASE}/{upload['id']}/commit", json={"plan_sha256": "0" * 64}
    )
    assert response.status_code == 409
    assert _count(app, JobRow) == before
    assert admin.get(f"{BASE}/{upload['id']}").json()["status"] == "ready"


def test_multi_file_provenance_and_counts_are_preserved(staged, tmp_path):
    app, admin = staged
    first = bundle(tmp_path / "first.zip", [unit("same")], "bundle-a")
    second = bundle(
        tmp_path / "second.zip", [unit("same", set_id="another")], "bundle-b"
    )
    upload = _ready(
        app,
        admin,
        kind="t1",
        files=[("files[]", (p.name, p.read_bytes())) for p in (first, second)],
    )
    assert upload["preview"]["counts"]["documents_added"] == 1
    assert upload["preview"]["counts"]["documents_skipped"] == 1
    job = _commit(app, admin, upload)
    assert job.status == "succeeded", job.error
    assert {
        k: job.result[k]
        for k in ("documents_added", "documents_skipped", "sets_added", "proposals")
    } == {
        k: upload["preview"]["counts"][k]
        for k in ("documents_added", "documents_skipped", "sets_added", "proposals")
    }
    with app.state.repo.db.transaction() as conn:
        rows = conn.execute(
            select(
                ProposalSetRow.bundle_id,
                ProposalSetRow.manifest_sha256,
                ProposalSetRow.source_sha256,
            )
        ).all()
        audit = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "project.import"
            )
        ).scalar_one()
        ids = conn.execute(select(ProposalAnnotationRow.annotation_id)).scalars().all()
    assert set(rows) == {
        (
            "bundle-a",
            manifest_sha256(first),
            hashlib.sha256(first.read_bytes()).hexdigest(),
        ),
        (
            "bundle-b",
            manifest_sha256(second),
            hashlib.sha256(second.read_bytes()).hexdigest(),
        ),
    }
    assert len(audit["sources"]) == 2
    assert audit["upload_id"] == upload["id"]
    assert all(
        source["producers"][0]["model"] == "bge-m3" for source in audit["sources"]
    )
    import ontospan

    assert {ontospan.parse_annotation_ref(i).bundle_id for i in ids} == {
        "bundle-a",
        "bundle-b",
    }


def test_multi_source_apply_failure_rolls_back_then_persists_failed(
    staged, tmp_path, monkeypatch
):
    app, admin = staged
    paths = [
        bundle(tmp_path / f"{i}.zip", [unit(f"doc-{i}")], f"b-{i}") for i in range(2)
    ]
    upload = _ready(
        app,
        admin,
        kind="t1",
        files=[("files[]", (p.name, p.read_bytes())) for p in paths],
    )
    original = Repository.add_documents_and_proposals
    calls = []

    def fail_second(self, *args, **kwargs):
        calls.append(True)
        if len(calls) == 2:
            raise RuntimeError("second source fails")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Repository, "add_documents_and_proposals", fail_second)
    job = _commit(app, admin, upload)
    # The exception text stays in the server log; the job names only its type.
    assert job.status == "failed" and job.error.startswith("RuntimeError")
    assert "second source fails" not in job.error
    assert len(calls) == 2
    assert (
        _count(app, DocumentRow)
        == _count(app, ProposalSetRow)
        == _count(app, ProposalAnnotationRow)
        == 0
    )
    assert admin.get(f"{BASE}/{upload['id']}").json()["status"] == "failed"
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(AuditEventRow.id).where(AuditEventRow.action == "project.import")
            ).first()
            is None
        )


def test_duplicate_commit_requests_enqueue_exactly_one_job(staged):
    app, admin = staged
    upload = _ready(app, admin)
    with app.state.repo.db.transaction() as conn:
        user_id = conn.execute(
            select(UserRow.id).where(UserRow.username == "root")
        ).scalar_one()
    barrier = Barrier(2)

    def commit():
        barrier.wait(timeout=10)
        try:
            return UploadService(
                app.state.repo.db, app.state.jobs, Actor.user(user_id, "root")
            ).commit("proj", upload["id"], upload["plan_sha256"])
        except DomainError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: commit(), range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert "UPLOAD_STALE" in results
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count())
                .select_from(JobRow)
                .where(JobRow.kind == "upload_commit")
            ).scalar_one()
            == 1
        )


@pytest.mark.parametrize(
    "path,method",
    [
        ("", "get"),
        ("/1", "get"),
        ("/1/commit", "post"),
        ("/1/discard", "post"),
        ("", "post"),
    ],
)
def test_all_upload_routes_require_import_rights(staged, path, method):
    app, _admin = staged
    member = logged_in(app, "ann", projects={"proj": ["annotator"]})
    kwargs = {"json": {"plan_sha256": "x"}} if path.endswith("commit") else {}
    if not path and method == "post":
        response = _create(member)
    else:
        response = getattr(member, method)(BASE + path, **kwargs)
    assert response.status_code == 403, response.text


@pytest.mark.parametrize(
    "suffix,method", [("", "get"), ("/commit", "post"), ("/discard", "post")]
)
def test_upload_ids_cannot_cross_project_boundaries(staged, suffix, method):
    app, admin = staged
    upload = _ready(app, admin)
    create_project(app.state.repo.db, "other")
    other = logged_in(app, "other-lead", projects={"other": ["lead"]})
    kwargs = (
        {"json": {"plan_sha256": upload["plan_sha256"]}} if suffix == "/commit" else {}
    )
    response = getattr(other, method)(
        f"/api/v1/projects/other/uploads/{upload['id']}{suffix}", **kwargs
    )
    assert response.status_code == 404, response.text


def test_aggregate_upload_limit_precedes_any_store_write(staged):
    app, admin = staged
    app.state.config.max_upload_bytes = 10
    before = _count(app, StoredFileRow)
    response = _create(
        admin,
        files=[("files[]", ("a.txt", b"123456")), ("files[]", ("b.txt", b"123456"))],
    )
    assert response.status_code == 413
    assert _count(app, StoredFileRow) == before
    assert _count(app, UploadRow) == 0


@pytest.mark.parametrize("commit", [False, True])
def test_jobs_recheck_current_import_rights(staged, commit):
    app, admin = staged
    lead = logged_in(app, "lead", projects={"proj": ["lead"]})
    created = _create(lead).json()
    if commit:
        assert _run(app, created["job_id"]).status == "succeeded"
        upload = lead.get(f"{BASE}/{created['upload_id']}").json()
        created = lead.post(
            f"{BASE}/{upload['id']}/commit", json={"plan_sha256": upload["plan_sha256"]}
        ).json()
    app.state.memberships.set_roles(Actor.cli(), "proj", "lead", ["annotator"])
    job = _run(app, created["job_id"])
    assert job.status == "failed" and "NOT_ALLOWED" in job.error
    assert _count(app, DocumentRow) == 0
    assert admin.get(f"{BASE}/{created['upload_id']}").json()["status"] == "failed"


def test_proposal_metadata_has_current_document_scope(staged, tmp_path):
    app, admin = staged
    path = bundle(tmp_path / "one.zip", [unit("doc")])
    upload = _ready(app, admin, kind="t1", name=path.name, data=path.read_bytes())
    assert _commit(app, admin, upload).status == "succeeded"
    with app.state.repo.db.transaction() as conn:
        set_id = conn.execute(select(ProposalSetRow.id)).scalar_one()
    metadata = admin.get(f"/api/v1/projects/proj/proposal-sets/{set_id}")
    assert metadata.status_code == 200, metadata.text
    assert metadata.json()["document_id"] == "doc"
    assert metadata.json()["actors"][0]["model"] == "bge-m3"
    assert (
        metadata.json()["imported_by_pseudonym"]
        == admin.get("/api/v1/auth/me").json()["pseudonym"]
    )
    stranger = logged_in(app, "stranger")
    assert (
        stranger.get(f"/api/v1/projects/proj/proposal-sets/{set_id}").status_code == 404
    )
    create_project(app.state.repo.db, "other")
    assert (
        admin.get(f"/api/v1/projects/other/proposal-sets/{set_id}").status_code == 404
    )


def test_editor_proposals_include_notes_and_set_id(staged, tmp_path):
    app, admin = staged
    path = bundle(tmp_path / "one.zip", [unit("doc")])
    upload = _ready(app, admin, kind="t1", name=path.name, data=path.read_bytes())
    assert _commit(app, admin, upload).status == "succeeded"
    reviewer = logged_in(
        app,
        "reviewer",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", "doc", "review")],
    )
    response = reviewer.post(
        "/api/v1/workspaces/review-inputs",
        json={"project_key": "proj", "document_id": "doc", "mode": "review"},
    )
    assert response.status_code == 200, response.text
    assert all(
        p["proposal_set_id"] and p["notes"] == ["score 0.91"] for p in response.json()
    )


def test_rules_refuse_only_violating_proposals_and_keep_raw_payload(staged, tmp_path):
    from t1_fixtures import annotation

    app, admin = staged
    raw = unit(
        "doc",
        annotations=[
            annotation("accepted", (6, 19)),
            annotation("refused", (63, 76), assertion="absent"),
        ],
    )
    original = raw.annotation_set.model_dump(mode="json")
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(
                require_chosen_axes=True,
                hidden_axis_values={"hpo": {"assertion": ["absent"]}},
            )
        )
    path = bundle(tmp_path / "rules.zip", [raw])
    upload = _ready(app, admin, kind="t1", name=path.name, data=path.read_bytes())
    assert upload["status"] == "ready"
    planned = upload["preview"]["proposal_sets"][0]
    assert len(planned["refused"]) == 1
    assert planned["refused"][0]["annotation_id"].endswith(":refused")
    assert _commit(app, admin, upload).status == "succeeded"
    with app.state.repo.db.transaction() as conn:
        assert conn.execute(select(ProposalSetRow.payload)).scalar_one() == original
        assert (
            conn.execute(select(ProposalSetRow.actors)).scalar_one()
            == original["actors"]
        )
    proposals = app.state.repo.list_annotations_for_document("proj", "doc")
    assert len(proposals) == 1
    assert proposals[0].annotation.annotation_id.endswith(":accepted")
    assert proposals[0].annotation.axes_defaulted == ["experiencer"]
    for ref in proposals[0].annotation.evidence_refs:
        evidence = app.state.repo.get_evidence_snapshot(
            ref.evidence_id, ref.version, "proj"
        )
        assert evidence is not None and evidence.version == ref.version


@pytest.mark.parametrize("set_kind", ["individual", "adjudicated", "release"])
def test_nonempty_disallowed_sets_refuse_whole_upload(staged, tmp_path, set_kind):
    from t1_fixtures import TOOL

    app, admin = staged
    path = bundle(
        tmp_path / "human.zip",
        [unit("good"), unit("bad", set_kind=set_kind, actors=[TOOL])],
    )
    upload = _ready(app, admin, kind="t1", name=path.name, data=path.read_bytes())
    assert upload["status"] == "invalid"
    assert any(
        i["code"] == "T1_SET_KIND" and i["unit"] == "bad"
        for i in upload["preview"]["errors"]
    )
    assert _count(app, DocumentRow) == 0


def test_json_blob_uses_original_filename_and_full_ontology_validation(
    staged, tmp_path
):
    from t1_fixtures import single

    app, admin = staged
    path = single(tmp_path / "original.json", unit("doc"))
    upload = _ready(app, admin, kind="t1", name=path.name, data=path.read_bytes())
    assert upload["status"] == "ready"
    assert "hierarchy_not_checked" not in {
        i["code"] for i in upload["preview"]["warnings"]
    }
    assert _commit(app, admin, upload).status == "succeeded"


def test_repeated_bundle_sources_keep_one_set_and_accurate_unit_counts(
    staged, tmp_path
):
    app, admin = staged
    path = bundle(tmp_path / "same.zip", [unit("doc")])
    upload = _ready(
        app,
        admin,
        kind="t1",
        files=[("files[]", (name, path.read_bytes())) for name in ("a.zip", "b.zip")],
    )
    job = _commit(app, admin, upload)
    assert job.status == "succeeded", job.error
    assert {
        k: job.result[k] for k in upload["preview"]["counts"] if k in job.result
    } == {k: v for k, v in upload["preview"]["counts"].items() if k in job.result}
    assert job.result["sets_added"] == job.result["sets_skipped"] == 1
    assert _count(app, ProposalSetRow) == 1


@pytest.mark.parametrize("change", ["revoke", "unrelated_document"])
def test_commit_rechecks_after_a_real_import_lock_wait(staged, change):
    from sqlalchemy import text
    from test_admin_write_authority import _wait_for_database_lock

    from ontotator.storage.repository import _lock_id

    app, admin = staged
    lead = logged_in(app, "lead", projects={"proj": ["lead"]})
    upload = _ready(app, lead)
    queued = lead.post(
        f"{BASE}/{upload['id']}/commit", json={"plan_sha256": upload["plan_sha256"]}
    ).json()
    db = app.state.repo.db
    with db.engine.begin() as holder:
        holder.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(_run, app, queued["job_id"])
            try:
                _wait_for_database_lock(app, pending)
                if change == "revoke":
                    app.state.memberships.set_roles(
                        Actor.cli(), "proj", "lead", ["annotator"]
                    )
                else:
                    holder.execute(
                        text(
                            "INSERT INTO ontotator.documents (project_id, document_id, case_id, external_id, position, language, text, text_sha256) SELECT id, 'unrelated', 'unrelated', 'unrelated', 0, 'de', 'Else', :sha FROM ontotator.projects WHERE project_key = 'proj'"
                        ),
                        {"sha": hashlib.sha256(b"Else").hexdigest()},
                    )
            finally:
                holder.commit()
            job = pending.result(timeout=15)
    assert job.status == "failed", job.result
    assert ("NOT_ALLOWED" if change == "revoke" else "UPLOAD_STALE") in job.error
    assert app.state.repo.get_document("proj", "a") is None
    assert admin.get(f"{BASE}/{upload['id']}").json()["status"] == "failed"


def test_empty_sets_keep_original_tool_producers_in_import_audit(staged, tmp_path):
    app, admin = staged
    path = bundle(tmp_path / "empty.zip", [unit("doc", annotations=[])])
    upload = _ready(app, admin, kind="t1", name=path.name, data=path.read_bytes())
    job = _commit(app, admin, upload)
    assert job.status == "succeeded", job.error
    assert job.result["documents_only"] == 1
    assert job.result["producers"] == [
        {"name": "phentrieve", "version": "1.4.0", "model": "bge-m3", "run_id": "run-7"}
    ]
    assert _count(app, ProposalSetRow) == 0


@pytest.mark.parametrize("projection", ["set_provenance", "document_provenance"])
def test_reversed_sources_keep_canonical_payload_with_its_own_blob(
    staged, tmp_path, projection
):
    from t1_fixtures import annotation

    app, admin = staged
    first = unit("doc", annotations=[annotation("p1", (6, 19), assertion="present")])
    chosen = unit("doc", annotations=[annotation("p1", (6, 19), assertion="absent")])
    first = first.model_copy(
        update={
            "document": first.document.model_copy(
                update={"language": "en", "source_text_sha256": "b" * 64}
            )
        }
    )
    chosen = chosen.model_copy(
        update={
            "document": chosen.document.model_copy(
                update={"language": "en", "source_text_sha256": "a" * 64}
            )
        }
    )
    b = bundle(tmp_path / "b.zip", [first], "same-bundle")
    a = bundle(tmp_path / "a.zip", [chosen], "same-bundle")
    upload = _ready(
        app,
        admin,
        kind="t1",
        files=[("files[]", (p.name, p.read_bytes())) for p in (b, a)],
    )
    plan = upload["preview"]
    assert plan["documents"][0]["label"].startswith("a.zip/")
    assert plan["proposal_sets"][0]["payload"] == chosen.annotation_set.model_dump(
        mode="json"
    )
    job = _commit(app, admin, upload)
    assert job.status == "succeeded", job.error
    assert job.result["sets_added"] == job.result["sets_skipped"] == 1
    with app.state.repo.db.transaction() as conn:
        if projection == "set_provenance":
            stored = conn.execute(
                select(
                    ProposalSetRow.payload,
                    ProposalSetRow.manifest_sha256,
                    ProposalSetRow.source_sha256,
                )
            ).one()
            assert stored.payload == chosen.annotation_set.model_dump(mode="json")
            assert stored.manifest_sha256 == manifest_sha256(a)
            assert stored.source_sha256 == hashlib.sha256(a.read_bytes()).hexdigest()
        else:
            stored = conn.execute(
                select(DocumentRow.language, DocumentRow.source_text_sha256)
            ).one()
            assert (stored.language, stored.source_text_sha256) == ("en", "a" * 64)


def test_preview_with_existing_sets_and_new_set_only_change_is_stale(staged, tmp_path):
    from t1_fixtures import run_import

    app, admin = staged
    initial = run_import(
        app.state.repo.db, bundle(tmp_path / "initial.zip", [unit("known")], "initial")
    )
    assert initial.status == "succeeded", initial.error
    upload = _ready(app, admin)
    added = run_import(
        app.state.repo.db, bundle(tmp_path / "next.zip", [unit("known")], "next")
    )
    assert added.status == "succeeded", added.error
    assert added.result["documents_added"] == 0
    assert added.result["sets_added"] == 1
    job = _commit(app, admin, upload)
    assert job.status == "failed" and "UPLOAD_STALE" in job.error
    assert app.state.repo.get_document("proj", "a") is None
