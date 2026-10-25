"""Actual runtime/producer PostgreSQL regressions; COLLECT ONLY until root token."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace

import ontospan
import pytest
from auth_harness import logged_in
from modifier_fixtures import MOD_PATH, MOD_PIN, modifier_profile
from sqlalchemy import delete, func, select, update
from t1_builders import bundle, correction_unit
from t1_fixtures import HP_PATH, TEXT, create_project, run_import, unit
from test_auth_api import _app
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save
from test_uploads_api import BASE, _ready, _run

from ontocurator.api.variant_routes import ReanchorItem
from ontocurator.auth.audit import Actor
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    Modifier,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.exchange.jobs import HANDLERS
from ontocurator.exchange.reanchor_job import ReanchorSource, rebuild_source
from ontocurator.exchange.t1 import ImportedProposals, ImportedSet, document_to_t1
from ontocurator.jobs.queue import JobQueue
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    EvidenceSnapshotRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    ProposalAnnotationRow,
    ProposalSetRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserRow,
)


@pytest.fixture
def runtime(tmp_path):
    app = _app(tmp_path)
    create_project(app.state.repo.db)
    db = app.state.repo.db
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
    return SimpleNamespace(
        app=app, db=db, pid=pid, tmp_path=tmp_path, source=unit("case")
    )


def imported(env, units, actor=None):
    with TemporaryDirectory(dir=env.tmp_path) as directory:
        result = run_import(
            env.db, bundle(Path(directory), units), actor=actor or Actor.cli()
        )
    assert result.status == "succeeded", result.error
    return result


def children(env):
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                select(JobRow.id)
                .where(JobRow.kind == "reanchor", JobRow.project_id == env.pid)
                .order_by(JobRow.id)
            ).scalars()
        )


def execute(env, job_id, *, worker="reanchor-test", queue=None):
    queue = queue or JobQueue(env.db, HANDLERS)
    job = queue.claim(job_id, worker)
    assert job is not None
    return queue.run(job, worker)


def rows(env, table, *conditions):
    with env.db.transaction() as conn:
        return list(conn.execute(select(table).where(*conditions)).mappings())


def generated(env):
    return rows(env, ProposalSetRow, ProposalSetRow.origin == "reanchor")


def corrected(env, text=None):
    child = correction_unit(env.source, text or "Prefix " + TEXT)
    parent = imported(env, [env.source, child])
    return parent, child


def test_import_trigger_is_durable_restartable_and_reconstruction_is_real(runtime):
    env = runtime
    parent, _ = corrected(env)
    job_id = children(env)[0]
    stored = rows(env, JobRow, JobRow.id == job_id)[0]
    assert stored["project_id"] == env.pid
    assert stored["payload"]["producer"] == {"kind": "import", "job_id": parent.id}
    pair = {
        key: stored["payload"][key] for key in ["old_document_id", "new_document_id"]
    }
    persisted = rows(env, JobRow, JobRow.id == parent.id)[0]
    assert pair in persisted["result"]["reanchor_pairs"]
    assert "reanchor_pairs" not in persisted["payload"]
    outcome = execute(env, job_id, queue=JobQueue(env.db, HANDLERS))
    assert outcome.status == "succeeded", outcome.error
    assert outcome.result == {"sets": 1, "carried": 2, "needs_review": 0}
    target = env.app.state.repo.get_document("proj", pair["new_document_id"])
    variant = env.app.state.repo.get_variant("proj", target.document_id)
    output = generated(env)[0]
    assert (
        output["source_sha256"] is None
        and output["bundle_id"] is None
        and output["job_id"] == job_id
    )
    payload = ontospan.AnnotatedDocument(
        document=document_to_t1(
            target,
            variant,
            {"case": env.source.document.text_sha256},
            single_native_case=False,
        ),
        annotation_set=ontospan.AnnotationSet.model_validate(output["payload"]),
    )
    report = ontospan.validate(payload, {"hp": ontospan.ObographOntology.load(HP_PATH)})
    assert report.ok, report.issues
    snapshots = env.app.state.repo.list_annotations_for_document(
        "proj", target.document_id
    )
    assert len(snapshots) == 2 and all(
        s.text_sha256 == target.text_sha256 for s in snapshots
    )
    assert all(
        s.annotation.provenance.source_refs[0].startswith("urn:ontospan:b-1:")
        for s in snapshots
    )
    assert all(s.annotation.axes_defaulted == ["experiencer"] for s in snapshots)
    assert all(
        a.provenance.notes == ("score 0.91",)
        for a in payload.annotation_set.annotations
    )


def test_parent_running_before_queue_finish_still_proves_its_created_pair(runtime):
    env = runtime
    parent, _ = corrected(env)
    with env.db.transaction() as conn:
        conn.execute(
            update(JobRow).where(JobRow.id == parent.id).values(status="running")
        )
    outcome = execute(env, children(env)[0])
    assert outcome.status == "succeeded", outcome.error


@pytest.mark.parametrize("entrypoint", ["t1_import", "upload_commit"])
def test_import_success_outcome_failure_preserves_durable_child_proof(
    runtime, monkeypatch, entrypoint
):
    env = runtime
    client = logged_in(env.app, "importer", projects={"proj": ["lead"]}, assignments=[])
    user = env.app.state.accounts.get_by_username("importer")
    path = bundle(
        env.tmp_path, [env.source, correction_unit(env.source, "Prefix " + TEXT)]
    )
    if entrypoint == "upload_commit":
        upload = _ready(
            env.app,
            client,
            data=path.read_bytes(),
            name=path.name,
            kind="t1",
            language="",
        )
        queued = client.post(
            f"{BASE}/{upload['id']}/commit",
            json={"plan_sha256": upload["plan_sha256"]},
        )
        assert queued.status_code == 200, queued.text
    finish = JobQueue._finish
    failed_successes = []
    finish_statuses = []

    def fail_first_success(self, job_id, worker, *, status, result=None, error=None):
        finish_statuses.append(status)
        if status == "succeeded" and not failed_successes:
            failed_successes.append(job_id)
            raise RuntimeError("first success outcome write failed")
        # In particular, a subsequent failure-outcome write is allowed to work.
        return finish(self, job_id, worker, status=status, result=result, error=error)

    with monkeypatch.context() as patch:
        patch.setattr(JobQueue, "_finish", fail_first_success)
        with pytest.raises(RuntimeError, match=r"^first success outcome write failed$"):
            if entrypoint == "t1_import":
                run_import(env.db, path, actor=Actor.user(user.id, user.username))
            else:
                _run(env.app, queued.json()["job_id"])
    assert len(failed_successes) == 1
    assert finish_statuses == ["succeeded"]
    parent = rows(env, JobRow, JobRow.id == failed_successes[0])[0]
    assert parent["kind"] == entrypoint
    assert parent["status"] == "running" and parent["error"] is None
    assert len(rows(env, DocumentRow)) == 2
    assert len(children(env)) == 1
    child = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    assert child["status"] == "queued"
    assert child["payload"]["producer"] == {"kind": "import", "job_id": parent["id"]}
    pair = {
        key: child["payload"][key] for key in ["old_document_id", "new_document_id"]
    }
    assert pair in (parent["result"] or {}).get("reanchor_pairs", [])

    # A new queue instance consumes only the actual persisted job/proof.
    restarted = JobQueue(env.db, HANDLERS)
    outcome = execute(env, child["id"], queue=restarted)
    assert outcome.status == "succeeded", outcome.error
    assert outcome.result == {"sets": 1, "carried": 2, "needs_review": 0}
    replay_id = restarted.enqueue(
        "reanchor",
        child["payload"],
        project_id=env.pid,
        actor=Actor.user(user.id, user.username),
    )
    replayed = execute(env, replay_id, queue=restarted)
    assert replayed.status == "succeeded", replayed.error
    assert replayed.result == {"sets": 0, "carried": 0, "needs_review": 0}
    assert (
        len(rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor")) == 1
    )
    with env.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == user.id,
            )
        )
    retry = restarted.enqueue(
        "reanchor",
        child["payload"],
        project_id=env.pid,
        actor=Actor.user(user.id, user.username),
    )
    refused = execute(env, retry, queue=restarted)
    assert refused.status == "failed" and "PROJECT_NOT_FOUND" in refused.error
    assert len(generated(env)) == 1


def test_unchanged_reimport_enqueues_no_second_correction_job(runtime):
    env = runtime
    _parent, child = corrected(env)
    ids = children(env)
    imported(env, [env.source, child])
    assert children(env) == ids


@pytest.mark.parametrize("loss", ["role", "membership", "inactive"])
def test_import_job_uses_current_requester_authority_before_reading_sources(
    runtime, loss
):
    env = runtime
    logged_in(env.app, "importer", projects={"proj": ["lead"]}, assignments=[])
    user = env.app.state.accounts.get_by_username("importer")
    imported(
        env,
        [env.source, correction_unit(env.source, "Prefix " + TEXT)],
        actor=Actor.user(user.id, user.username),
    )
    with env.db.transaction() as conn:
        if loss == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == user.id).values(active=False)
            )
        else:
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == user.id,
                    ProjectMembershipRow.project_id == env.pid,
                )
            )
            if loss == "role":
                from sqlalchemy import insert

                conn.execute(
                    insert(ProjectMembershipRow).values(
                        user_id=user.id, project_id=env.pid, role="annotator"
                    )
                )
    outcome = execute(env, children(env)[0])
    expected = {
        "role": "NOT_ALLOWED",
        "membership": "PROJECT_NOT_FOUND",
        "inactive": "NOT_AUTHENTICATED",
    }[loss]
    assert outcome.status == "failed" and expected in outcome.error
    assert generated(env) == []
    assert rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor") == []


def test_same_actor_labels_are_distinct_sources_and_empty_set_creates_no_output(
    runtime,
):
    env = runtime
    original = env.source
    second = unit("case", set_id="another-set")
    empty = unit("case", set_id="empty-set", annotations=[])
    parent = imported(
        env, [original, second, empty, correction_unit(original, "Prefix " + TEXT)]
    )
    source_rows = rows(env, ProposalSetRow, ProposalSetRow.document_id == "case")
    # The importer treats an empty delivered set as document-only. Materialize
    # that delivered set through the common writer to test empty-source
    # exclusion without changing importer semantics.
    aset = empty.annotation_set
    inserted = env.app.state.repo.add_documents_and_proposals(
        "proj",
        [],
        [
            ImportedSet(
                "case",
                "b-1",
                source_rows[0]["manifest_sha256"],
                aset.annotation_set_id,
                aset.set_kind,
                [
                    actor.model_dump(mode="json", exclude_none=True)
                    for actor in aset.actors
                ],
                aset.model_dump(mode="json"),
                ImportedProposals([], [], {}, 0),
            )
        ],
        source_sha256=source_rows[0]["source_sha256"],
        job_id=parent.id,
    )
    assert inserted["sets_added"] == 1 and inserted["proposals"] == 0
    source_rows = rows(env, ProposalSetRow, ProposalSetRow.document_id == "case")
    assert len(source_rows) == 3
    before = [(row["id"], row["payload"], row["actors"]) for row in source_rows]
    result = execute(env, children(env)[0])
    assert result.status == "succeeded", result.error
    assert result.result == {"sets": 2, "carried": 4, "needs_review": 0}
    output = generated(env)
    assert len({row["annotation_set_id"] for row in output}) == 2
    refs = {
        row["payload"]["annotations"][0]["provenance"]["source_refs"][0]
        for row in output
    }
    assert len(refs) == 2
    assert before == [
        (row["id"], row["payload"], row["actors"])
        for row in rows(env, ProposalSetRow, ProposalSetRow.document_id == "case")
    ]


def test_upload_commit_activates_the_second_import_entrypoint(runtime):
    env = runtime
    admin = logged_in(env.app, "root", system_admin=True, assignments=[])
    path = bundle(
        env.tmp_path, [env.source, correction_unit(env.source, "Prefix " + TEXT)]
    )
    upload = _ready(
        env.app, admin, data=path.read_bytes(), name=path.name, kind="t1", language=""
    )
    response = admin.post(
        f"{BASE}/{upload['id']}/commit", json={"plan_sha256": upload["plan_sha256"]}
    )
    assert response.status_code == 200, response.text
    outcome = _run(env.app, response.json()["job_id"])
    assert outcome.status == "succeeded", outcome.error
    child = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    assert child["payload"]["producer"]["job_id"] == outcome.id
    assert execute(env, child["id"]).status == "succeeded"


def test_retry_is_zero_write_and_zero_additional_audit(runtime):
    env = runtime
    corrected(env)
    original = children(env)[0]
    assert execute(env, original).status == "succeeded"
    row = rows(env, JobRow, JobRow.id == original)[0]
    before = (
        len(generated(env)),
        len(rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor")),
        len(rows(env, AnnotationSnapshotRow)),
        len(rows(env, EvidenceSnapshotRow)),
    )
    queue = JobQueue(env.db, HANDLERS)
    duplicate = queue.enqueue(
        "reanchor",
        row["payload"],
        project_id=env.pid,
        actor=Actor(row["requested_by"], row["requested_label"]),
    )
    outcome = execute(env, duplicate)
    assert outcome.status == "succeeded", outcome.error
    assert outcome.result == {"sets": 0, "carried": 0, "needs_review": 0}
    assert before == (
        len(generated(env)),
        len(rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor")),
        len(rows(env, AnnotationSnapshotRow)),
        len(rows(env, EvidenceSnapshotRow)),
    )


def test_all_needs_review_persists_typed_windows_without_partial_carry(runtime):
    env = runtime
    corrected(env, "ΩΩΩ")
    result = execute(env, children(env)[0])
    assert result.status == "succeeded", result.error
    output = generated(env)[0]
    assert result.result == {"sets": 1, "carried": 0, "needs_review": 2}
    assert output["payload"]["annotations"] == []
    for raw in output["pending_items"]:
        item = ReanchorItem.model_validate({**raw, "proposal_set_id": output["id"]})
        assert item.new_context.text == "ΩΩΩ"
        assert item.old_segments
        assert "".join(op.new_text for op in item.diff) == item.new_context.text
    leader = logged_in(env.app, "reader", projects={"proj": ["lead"]}, assignments=[])
    response = leader.get(
        f"/api/v1/projects/proj/documents/{output['document_id']}/reanchor-items"
    )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 2
    for raw in response.json():
        item = ReanchorItem.model_validate(
            {key: value for key, value in raw.items() if key != "old_segments"}
        )
        assert item.proposal_set_id == output["id"]
        assert raw["old_segments"] == [
            segment.model_dump(mode="json")
            for mention in item.old_mentions
            for segment in [*mention.segments, *mention.cue_segments]
        ]
    assert (
        len(
            rows(
                env,
                ProposalAnnotationRow,
                ProposalAnnotationRow.proposal_set_id == output["id"],
            )
        )
        == 0
    )


def test_reserved_import_set_identity_is_collision_not_replay(runtime):
    env = runtime
    corrected(env)
    source = rows(env, ProposalSetRow, ProposalSetRow.document_id == "case")[0]
    child = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    target = child["payload"]["new_document_id"]
    from sqlalchemy import insert

    with env.db.transaction() as conn:
        conn.execute(
            insert(ProposalSetRow).values(
                project_id=env.pid,
                document_id=target,
                annotation_set_id=f"proj:reanchor:{target}:{source['id']}",
                set_kind="tool_output",
                actors=[],
                payload={},
                origin="import",
                pending_items=[],
                source_sha256=None,
            )
        )
    result = execute(env, child["id"])
    assert result.status == "failed" and "REANCHOR_SET_COLLISION" in result.error
    assert generated(env) == []


@pytest.mark.parametrize(
    "spoof", ["parent_pair", "parent_project", "requester", "target"]
)
def test_real_job_parent_or_pair_spoof_is_refused(runtime, spoof):
    env = runtime
    parent, _ = corrected(env)
    row = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    payload = dict(row["payload"])
    if spoof == "parent_pair":
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(JobRow.id == parent.id)
                .values(result={"reanchor_pairs": []})
            )
    elif spoof == "parent_project":
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow).where(JobRow.id == parent.id).values(project_id=None)
            )
    elif spoof == "requester":
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(JobRow.id == row["id"])
                .values(requested_label="cli:someone-else")
            )
    else:
        payload["new_document_id"] = "case"
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow).where(JobRow.id == row["id"]).values(payload=payload)
            )
    result = execute(env, row["id"])
    assert result.status == "failed", result.result
    assert generated(env) == []


def test_reversed_worker_chain_builds_precursors_before_descendant(runtime):
    env = runtime
    v2 = correction_unit(env.source, "Prefix " + TEXT)
    v3 = correction_unit(v2, "More Prefix " + TEXT)
    imported(env, [v3, v2, env.source])
    upstream, downstream = children(env)
    queue = JobQueue(env.db, HANDLERS)
    first = queue.claim(upstream, "upstream-worker")
    second = queue.claim(downstream, "downstream-worker")
    assert first is not None and second is not None
    # Both workers claimed distinct real jobs. Explicit event ordering forces v3
    # to finish its pair processor before the earlier v2 worker attempts it.
    descendant_done = Event()

    def late_upstream():
        assert descendant_done.wait(10)
        return queue.run(first, "upstream-worker")

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(late_upstream)
        descendant = queue.run(second, "downstream-worker")
        descendant_done.set()
        predecessor = pending.result(timeout=15)
    assert descendant.status == predecessor.status == "succeeded", (
        descendant.error,
        predecessor.error,
    )
    assert descendant.result == {"sets": 2, "carried": 4, "needs_review": 0}
    assert predecessor.result == {"sets": 0, "carried": 0, "needs_review": 0}
    outputs = sorted(generated(env), key=lambda row: row["job_id"])
    assert len(outputs) == 2
    assert [row["job_id"] for row in outputs] == [upstream, downstream]
    assert (
        len(rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor")) == 2
    )
    newest = env.app.state.repo.list_annotations_for_document("proj", "case~de~v3")
    assert len(newest) == 2
    assert all(
        "proj%3Areanchor" in snap.annotation.provenance.source_refs[0]
        or "reanchor" in snap.annotation.provenance.source_refs[0]
        for snap in newest
    )


def test_two_different_jobs_for_one_pair_write_only_once(runtime):
    env = runtime
    corrected(env)
    original = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    queue = JobQueue(env.db, HANDLERS)
    duplicate = queue.enqueue(
        "reanchor",
        original["payload"],
        project_id=env.pid,
        actor=Actor(original["requested_by"], original["requested_label"]),
    )
    jobs = [queue.claim(original["id"], "worker-a"), queue.claim(duplicate, "worker-b")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(queue.run, job, worker)
            for job, worker in zip(jobs, ["worker-a", "worker-b"], strict=True)
        ]
        results = [future.result(timeout=20) for future in futures]
    assert all(r.status == "succeeded" for r in results), [r.error for r in results]
    assert sorted(r.result["sets"] for r in results) == [0, 1]
    assert len(generated(env)) == 1
    assert (
        len(rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor")) == 1
    )


def test_handler_audit_failure_rolls_back_all_targets_and_retry_succeeds(
    runtime, monkeypatch
):
    import ontocurator.exchange.reanchor_job as module

    env = runtime
    corrected(env)
    row = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    real = module.record_audit

    def failed(*_args, **_kwargs):
        raise RuntimeError("forced final audit")

    monkeypatch.setattr(module, "record_audit", failed)
    failed_job = execute(env, row["id"])
    assert failed_job.status == "failed"
    assert generated(env) == []
    monkeypatch.setattr(module, "record_audit", real)
    queue = JobQueue(env.db, HANDLERS)
    retry = queue.enqueue(
        "reanchor",
        row["payload"],
        project_id=env.pid,
        actor=Actor(row["requested_by"], row["requested_label"]),
    )
    assert execute(env, retry).status == "succeeded"
    assert len(generated(env)) == 1


@pytest.mark.parametrize("entrypoint", ["t1_import", "upload_commit"])
def test_import_enqueue_failure_rolls_back_variant_sets_parent_manifest_and_success_audit(
    runtime, monkeypatch, entrypoint
):
    env = runtime
    real = JobQueue.enqueue

    def fail(self, kind, *args, **kwargs):
        if kind == "reanchor":
            raise RuntimeError("enqueue rejected")
        return real(self, kind, *args, **kwargs)

    monkeypatch.setattr(JobQueue, "enqueue", fail)
    path = bundle(
        env.tmp_path, [env.source, correction_unit(env.source, "Prefix " + TEXT)]
    )
    if entrypoint == "t1_import":
        result = run_import(env.db, path, actor=Actor.cli())
    else:
        admin = logged_in(env.app, "root", system_admin=True, assignments=[])
        upload = _ready(
            env.app,
            admin,
            data=path.read_bytes(),
            name=path.name,
            kind="t1",
            language="",
        )
        queued = admin.post(
            f"{BASE}/{upload['id']}/commit", json={"plan_sha256": upload["plan_sha256"]}
        )
        result = _run(env.app, queued.json()["job_id"])
    assert result.status == "failed"
    assert rows(env, DocumentRow) == []
    assert rows(env, ProposalSetRow) == []
    assert rows(env, AuditEventRow, AuditEventRow.action == "project.import") == []
    assert children(env) == []


def test_assigned_reviewer_producer_needs_no_import_right_and_uses_real_record(
    review_env,
):
    env = review_env
    from t1_fixtures import annotation

    imported_unit = unit(
        "target",
        text="Übersetzt",
        annotations=[annotation("p1", (0, 9), text="Übersetzt")],
    ).model_copy(update={"document": env.target.document})
    imported(env, [imported_unit])
    reader = logged_in(env.app, "alice", assignments=[])
    old_set = rows(env, ProposalSetRow, ProposalSetRow.document_id == "target")[0]
    assert (
        reader.get(f"/api/v1/projects/proj/proposal-sets/{old_set['id']}").status_code
        == 404
    )
    revision = save(env, "accepted_corrected", "Prefix Übersetzt")
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    job_id = children(env)[0]
    stored = rows(env, JobRow, JobRow.id == job_id)[0]
    assert stored["requested_by"] == env.accesses["alice"].user_id
    assert stored["payload"]["producer"] == {
        "kind": "translation_review",
        "review_id": record.id,
    }
    result = execute(env, job_id)
    assert result.status == "succeeded", result.error
    assert result.result == {"sets": 1, "carried": 1, "needs_review": 0}
    output = generated(env)[0]
    assert (
        reader.get(f"/api/v1/projects/proj/proposal-sets/{output['id']}").status_code
        == 404
    )
    assert (
        reader.get(
            f"/api/v1/projects/proj/documents/{output['document_id']}/reanchor-items"
        ).status_code
        == 404
    )


def test_review_enqueue_failure_rolls_back_immutable_record_child_status_and_revision(
    review_env, monkeypatch
):
    env = review_env
    revision = save(env, "accepted_corrected", "Korrigiert")

    def fail(*_args, **_kwargs):
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr(env.service.jobs, "enqueue", fail)
    with pytest.raises(RuntimeError, match="queue unavailable"):
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=revision
        )
    assert rows(env, TranslationReviewRow) == []
    assert rows(env, DocumentRow, DocumentRow.origin == "correction") == []
    draft = rows(
        env,
        TranslationReviewDraftRow,
        TranslationReviewDraftRow.assignment_id == env.ids["alice"],
    )[0]
    assignment = rows(env, AssignmentRow, AssignmentRow.id == env.ids["alice"])[0]
    assert draft["revision"] == revision and assignment["status"] == "in_progress"
    assert children(env) == []


@pytest.mark.parametrize("loss", ["role", "revoked", "inactive"])
def test_reviewer_current_authority_is_rechecked_when_worker_runs(review_env, loss):
    env = review_env
    revision = save(env, "accepted_corrected", "Korrigiert")
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    with env.db.transaction() as conn:
        if loss == "role":
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == env.accesses["alice"].user_id
                )
            )
        elif loss == "revoked":
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == env.ids["alice"])
                .values(revoked_at=func.now())
            )
        else:
            conn.execute(
                update(UserRow)
                .where(UserRow.id == env.accesses["alice"].user_id)
                .values(active=False)
            )
    outcome = execute(env, children(env)[0])
    assert outcome.status == "failed" and "ASSIGNMENT_NOT_FOUND" in outcome.error
    assert generated(env) == []


def test_individual_submission_is_not_a_reanchor_source(runtime):
    from ontocurator.application.editing import CreateAnnotationCommand

    env = runtime
    imported(env, [env.source])
    client = logged_in(
        env.app,
        "annotator",
        projects={"proj": ["annotator"]},
        assignments=[("proj", "case", "annotate")],
    )
    task = client.get("/api/v1/me/tasks").json()[0]
    opened = client.post(f"/api/v1/assignments/{task['assignment_id']}/open")
    assert opened.status_code == 200, opened.text
    token = opened.json()["workspace_id"]
    command = CreateAnnotationCommand(
        annotation_id="manual-own",
        evidence_id="manual-own-evidence",
        segments=[{"start": 6, "end": 19}],
        layer_id="hpo",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values={
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
    )
    edited = client.post(
        f"/api/v1/workspaces/{token}/commands",
        json={
            "mutation_id": "manual-create",
            "expected_revision": 0,
            "payload": command.model_dump(),
        },
    )
    assert edited.status_code == 200, edited.text
    submitted = client.post(
        f"/api/v1/workspaces/{token}/submit",
        json={
            "mutation_id": "manual-submit",
            "expected_revision": edited.json()["revision"],
            "payload": {
                "document_checked": True,
                "command": "submit_workspace",
                "checked_layer_ids": ["hpo"],
            },
        },
    )
    assert submitted.status_code == 200, submitted.text
    imported(env, [correction_unit(env.source, "Prefix " + TEXT)])
    outcome = execute(env, children(env)[0])
    assert outcome.status == "succeeded", outcome.error
    assert outcome.result["carried"] == 2
    carried = env.app.state.repo.list_annotations_for_document("proj", "case~de~v2")
    assert not any(
        "manual-own" in ref
        for snap in carried
        for ref in snap.annotation.provenance.source_refs
    )
    assert (
        client.get(
            f"/api/v1/workspaces/{token}/submissions/{submitted.json()['submission_id']}"
        ).json()
        == submitted.json()
    )


def test_cross_language_payload_cannot_project_from_a_sibling(runtime):
    from t1_builders import native_unit

    env = runtime
    imported(
        env,
        [
            env.source,
            native_unit("english", "en", "English source"),
            correction_unit(env.source, "Prefix " + TEXT),
        ],
    )
    job = rows(env, JobRow, JobRow.id == children(env)[0])[0]
    payload = {**job["payload"], "old_document_id": "english"}
    with env.db.transaction() as conn:
        conn.execute(
            update(JobRow).where(JobRow.id == job["id"]).values(payload=payload)
        )
    outcome = execute(env, job["id"])
    assert outcome.status == "failed" and "REANCHOR_LANGUAGE_MISMATCH" in outcome.error
    assert generated(env) == []


def test_status_finish_failure_does_not_duplicate_already_committed_handler_effects(
    runtime, monkeypatch
):
    env = runtime
    corrected(env)
    queue = JobQueue(env.db, HANDLERS)
    job = queue.claim(children(env)[0], "finish-failure")

    def fail(*_args, **_kwargs):
        raise RuntimeError("outcome recording failed")

    with monkeypatch.context() as patch:
        patch.setattr(queue, "_finish", fail)
        with pytest.raises(RuntimeError, match="outcome recording failed"):
            queue.run(job, "finish-failure")
    assert len(generated(env)) == 1
    duplicate = queue.enqueue(
        "reanchor", job.payload, project_id=env.pid, actor=Actor.cli()
    )
    replay = execute(env, duplicate)
    assert replay.status == "succeeded", replay.error
    assert replay.result == {"sets": 0, "carried": 0, "needs_review": 0}
    assert (
        len(rows(env, AuditEventRow, AuditEventRow.action == "variant.reanchor")) == 1
    )


def test_worker_revalidates_account_after_waiting_for_project_lock(review_env):
    from sqlalchemy import event

    from ontocurator.storage.repository import _lock_id

    env = review_env
    revision = save(env, "accepted_corrected", "Korrigiert")
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    project_lock = _lock_id("project", "proj")
    waiting = Event()

    def observed(_conn, _cursor, statement, parameters, _context, _many):
        values = parameters.values() if isinstance(parameters, dict) else parameters
        if "pg_advisory_xact_lock(" in statement and project_lock in values:
            waiting.set()

    with env.db.engine.begin() as blocker:
        blocker.execute(select(func.pg_advisory_xact_lock(project_lock)))
        event.listen(env.db.engine, "before_cursor_execute", observed)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(execute, env, children(env)[0])
            assert waiting.wait(10)
            blocker.execute(
                update(UserRow)
                .where(UserRow.id == env.accesses["alice"].user_id)
                .values(active=False)
            )
            blocker.commit()
            outcome = future.result(timeout=15)
        event.remove(env.db.engine, "before_cursor_execute", observed)
    assert outcome.status == "failed" and "ASSIGNMENT_NOT_FOUND" in outcome.error
    assert generated(env) == []


@pytest.mark.parametrize("decision", ["accepted_unchanged", "query", "rejected"])
def test_noncorrecting_review_decisions_enqueue_nothing(review_env, decision):
    env = review_env
    form = (
        {}
        if decision == "accepted_unchanged"
        else {
            "clinical_change": True,
            "categories": ["source"],
            "rationale": "Clarification required",
        }
    )
    revision = save(env, decision, **form)
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    assert children(env) == []


# Modifier segments (modifiers plan M1b): rebuild_source writes the mapped
# modifiers into the target proposals and the delivered T1 unit.
def _modifier_source(old_text):
    def doc(document_id, text):
        return Document(
            document_id=document_id,
            text=text,
            language="de",
            text_sha256=hashlib.sha256(text.encode()).hexdigest(),
        )

    old = doc("old", old_text)
    evidence = EvidenceSnapshot.create(
        EvidenceMention(evidence_id="e0", segments=[Segment(start=8, end=20)]), old
    )
    annotation = Annotation(
        annotation_id="tool-a1",
        document_id="old",
        layer_id="hpo",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values={"assertion": "present", "experiencer": "patient"},
        evidence_refs=[EvidenceRef(evidence_id="e0", version=evidence.version)],
        modifiers=[
            Modifier(term_id="HP:0012828", segments=[Segment(start=0, end=7)]),
            Modifier(term_id="HP:0031796"),
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="tool", kind="tool"),
            method="tool",
            source_refs=["urn:tool"],
        ),
    )
    profile = modifier_profile()
    source = ReanchorSource(
        row_id=1,
        annotation_set_id="set-1",
        bundle_id=None,
        payload={},
        annotations=(snapshot(annotation, [evidence], old, profile),),
        notes={},
    )

    def rebuild(new_text):
        return rebuild_source(
            "proj",
            source,
            old,
            doc("new", new_text),
            profile,
            {"hp": MOD_PIN},
            created_at=datetime(2026, 10, 25, tzinfo=UTC),
        )

    return rebuild, ontospan.ObographOntology.load(MOD_PATH)


def test_reanchored_proposal_keeps_its_mapped_modifiers():
    rebuild, ontology = _modifier_source("schwere Krampfanfall")
    built, unit = rebuild("Ein schwere Krampfanfall")
    assert built is not None and unit is not None
    assert built.pending_items == []
    (target,) = built.proposals.annotations
    assert [m.model_dump() for m in target.annotation.modifiers] == [
        {"term_id": "HP:0012828", "segments": [{"start": 4, "end": 11}]},
        {"term_id": "HP:0031796"},
    ]
    (delivered,) = unit.annotation_set.annotations
    assert [(m.term_id, [s.text for s in m.segments]) for m in delivered.modifiers] == [
        ("HP:0012828", ["schwere"]),
        ("HP:0031796", []),
    ]
    assert ontospan.validate(unit, {"hp": ontology}).ok


def test_changed_modifier_text_sends_the_whole_proposal_to_review():
    rebuild, _ = _modifier_source("schwere Krampfanfall")
    built, _unit = rebuild("leichte Krampfanfall")
    assert built is not None
    assert built.proposals.annotations == []
    (pending,) = built.pending_items
    assert pending["reason"] == "changed_modifier_segment"
    # The stored item stays a valid ReanchorItem (no contract change in M1b).
    ReanchorItem.model_validate({**pending, "proposal_set_id": 1})
