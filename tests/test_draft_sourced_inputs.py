"""Rounds of the text-change kinds in every reader, visibility rule and export (O2d).

A ``text_change`` round takes its inputs from a frozen draft
(``round_inputs.source_draft_snapshot_id``); a ``handover`` round takes them
from another author's submission. Both must read like a carry-forward round.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from time import monotonic, sleep
from typing import Any
from uuid import uuid4

import pytest
from browser_documents_scenarios import select
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select as sa_select
from test_text_change_api import _login
from test_text_change_service import (
    Env,
    _carry,
    _env,
    _move,
    _per_text,
    _pid,
    _scoped,
    _started,
    _submitted,
)

from ontotator.api.app import create_app
from ontotator.config import AppConfig
from ontotator.storage.overview_tables import DraftSnapshotRow
from ontotator.storage.tables import JobRow


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "draft-sourced.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    # The context starts the job worker (imports with corrections, exports).
    with TestClient(app) as client:
        yield client


@pytest.fixture
def env(client: TestClient) -> Env:
    return _env(client.app)


def _snapshot_id(env: Env) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                sa_select(DraftSnapshotRow.id).where(
                    DraftSnapshotRow.project_id == _pid(env)
                )
            ).scalar_one()
        )


def _finish(env: Env, name: str, round_view: Any) -> str:
    """Resolve every input of ``round_view`` as ``name`` and submit the round."""
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.work_rounds import RoundInputResolutionService
    from ontotator.domain.workspace import MutationEnvelope

    key = round_view.workspace_key
    scoped = _scoped(env, name)

    def envelope(payload: dict[str, Any]) -> MutationEnvelope:
        return MutationEnvelope(
            mutation_id=f"m-{uuid4().hex}",
            expected_revision=scoped.open_draft(key).revision,
            payload=payload,
        )

    resolver = RoundInputResolutionService(scoped)
    for item in env.repo.get_round_input_inventory(env.key, round_view.round_id):
        target = item["target_snapshot"]
        payload: dict[str, Any] = (
            {
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "Not on the corrected text",
            }
            if target is None
            else {
                "input_id": item["input_id"],
                "outcome": "completed",
                "annotation_ref": {
                    "annotation_id": target["annotation"]["annotation_id"],
                    "version": target["version"],
                },
            }
        )
        resolver.resolve(key, envelope(payload))
    ontology = env.scenario.app.state.ontology_registry
    return (
        SubmissionService(scoped, ontology)
        .submit(key, envelope({"document_checked": True}))
        .submission_id
    )


def _moved(env: Env) -> dict[str, Any]:
    """Tom's v1 draft moved to v2: an editable ``text_change`` round."""
    work = _started(env)
    result = _move(env, work["assignment_id"])
    return {"old": work, "round": result.round, "snapshot_id": _snapshot_id(env)}


def _final_export(env: Env, request_id: str) -> zipfile.ZipFile:
    from ontotator.application.final_results import FinalResultService

    access, actor = env.lead()
    service = FinalResultService(env.db, actor, access)
    state = service.preflight(env.key)
    job_id = service.freeze(
        env.key,
        {
            "request_id": request_id,
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )["job_id"]
    deadline = monotonic() + 60
    while True:
        with env.db.transaction() as conn:
            job = conn.execute(sa_select(JobRow).where(JobRow.id == job_id)).one()
        if job.status == "succeeded":
            break
        assert job.status != "failed", job.error
        assert monotonic() < deadline, "final export did not finish"
        sleep(0.05)
    data = env.db.blobs.path(job.result["sha256"]).read_bytes()
    return zipfile.ZipFile(io.BytesIO(data))


def _units(archive: zipfile.ZipFile, name: str) -> list[dict[str, Any]]:
    with zipfile.ZipFile(io.BytesIO(archive.read(name))) as bundle:
        return [
            json.loads(bundle.read(entry))
            for entry in sorted(bundle.namelist())
            if entry.startswith("documents/")
        ]


# --- reads ------------------------------------------------------------------- #


def test_text_change_round_reads_like_carry_forward(env):
    from ontotator.application.round_reads import enrich_inputs, enrich_rounds

    moved = _moved(env)
    round_view = moved["round"]
    scoped = _scoped(env, "tom")
    [view] = enrich_rounds(
        scoped, env.key, [scoped.get_work_round(env.key, round_view.round_id)]
    )
    assert view.kind == "text_change"
    assert view.input_count == 2
    assert (view.document_language, view.document_version) == ("de", 2)
    inputs = enrich_inputs(
        scoped,
        env.key,
        scoped.get_round_input_inventory(env.key, round_view.round_id),
    )
    assert len(inputs) == 2
    for item in inputs:
        assert item.source_submission_id is None
        assert item.source_draft_snapshot_id == moved["snapshot_id"]
        assert (item.source_language, item.source_version) == ("de", 1)
        assert item.source_round_ordinal is None
        assert item.source_recorded_at is None
    # The editor workspace starts with the placed (carried) finding.
    carried = [i for i in inputs if i.target_snapshot is not None]
    assert [
        s.annotation.annotation_id
        for s in scoped.workspace_input_snapshots(round_view.workspace_key)
    ] == [c.target_snapshot.annotation.annotation_id for c in carried]


def test_handover_round_submission_kind_is_carry_forward(env):
    from ontotator.domain.submission_labels import submission_kind
    from ontotator.exchange import final_export_guide

    work = _submitted(env)
    result = _carry(env, work["submission_id"], mode="other", username=env.user("ana"))
    assert result.round.kind == "handover"
    sid = _finish(env, "ana", result.round)
    round_view = env.repo.get_round_for_submission(env.key, sid)
    assert round_view.kind == "handover"
    assert submission_kind(round_view.kind, round_view.mode) == "carry_forward"
    submission = {"submission_id": sid, "origin_key": {"mode": "independent"}}
    assert (
        final_export_guide.submission_kind(submission, {sid: "handover"})
        == "carry_forward"
    )
    assert (
        final_export_guide.submission_kind(submission, {sid: "text_change"})
        == "carry_forward"
    )


def test_submission_history_of_text_change_round(env, client):
    moved = _moved(env)
    sid = _finish(env, "tom", moved["round"])
    _login(client, env, "tom")
    response = client.get(
        f"/api/v1/projects/{env.key}/documents/{env.docs[1]}/submissions/{sid}"
    )
    assert response.status_code == 200, response.text
    detail = response.json()
    assert len(detail["round_inputs"]) == 2
    for item in detail["round_inputs"]:
        assert item["source_submission_id"] is None
        assert item["source_draft_snapshot_id"] == moved["snapshot_id"]
        assert item["source_version"] == 1
    assert len(detail["round_input_resolutions"]) == 2


def test_round_input_view_of_draft_source(env, client):
    moved = _moved(env)
    _login(client, env, "tom")
    response = client.get(f"/api/v1/rounds/{moved['round'].round_id}/inputs")
    assert response.status_code == 200, response.text
    items = response.json()
    assert len(items) == 2
    for item in items:
        assert item["source_submission_id"] is None
        assert item["source_draft_snapshot_id"] == moved["snapshot_id"]
        assert (item["source_language"], item["source_version"]) == ("de", 1)


def test_visibility_of_draft_inputs(env, client):
    moved = _moved(env)
    rid = moved["round"].round_id
    old_text = f"/api/v1/projects/{env.key}/documents/{env.docs[0]}/text"
    # The input owner: the inputs and the frozen draft's text (the evidence dialog).
    _login(client, env, "tom")
    assert client.get(f"/api/v1/rounds/{rid}/inputs").status_code == 200
    assert client.get(old_text).status_code == 200
    # A lead sees everything.
    _login(client, env, "lead")
    assert client.get(f"/api/v1/rounds/{rid}/inputs").status_code == 200
    assert client.get(old_text).status_code == 200
    # Another annotator sees neither.
    _login(client, env, "ana")
    assert client.get(f"/api/v1/rounds/{rid}/inputs").status_code == 404
    assert client.get(old_text).status_code in {403, 404}


def test_final_causes_treat_new_kinds_as_carry(env):
    from ontotator.application.final_results import FinalResultService

    ana = _submitted(env, "ana")
    select(env.scenario, env.docs[0], ana["submission_id"])
    moved = _moved(env)
    access, actor = env.lead()
    state = FinalResultService(env.db, actor, access).preflight(env.key)
    pending = [w for w in state["warnings"] if w["code"] == "ROUND_REVIEW_PENDING"]
    assert [w["cause_id"] for w in pending] == [
        f"ROUND_REVIEW_PENDING:{moved['round'].round_id}"
    ]


# --- exports ----------------------------------------------------------------- #


def test_human_inputs_skip_draft_sources(env):
    from ontotator.exchange.human_inputs import human_input_closure

    moved = _moved(env)
    sid = _finish(env, "tom", moved["round"])
    access, actor = env.lead()
    from ontotator.authz.scoped import ScopedRepository

    closure, inputs, kinds = human_input_closure(
        ScopedRepository(env.db, access, actor), env.key, [sid]
    )
    assert closure == [sid]
    assert kinds == {sid: "text_change"}
    assert len(inputs[sid]) == 2
    assert all(entry["source_submission_id"] is None for entry in inputs[sid])


def test_final_export_with_draft_sourced_final(env):
    # Ana's v1 submission is carried to v2 by its author (a carry-forward round
    # from a submission); Tom's v1 draft is moved to v2 (a text-change round).
    _per_text(env, 2)
    ana = _submitted(env, "ana")
    moved = _moved(env)
    carried = _carry(env, ana["submission_id"])
    ana_v2 = _finish(env, "ana", carried.round)
    tom_v2 = _finish(env, "tom", moved["round"])

    select(env.scenario, env.docs[1], tom_v2)
    archive = _final_export(env, "final-draft")
    receipt = json.loads(archive.read("receipt.json"))
    assert len(receipt["human_inputs"]) == 2
    for entry in receipt["human_inputs"]:
        assert "source_submission_id" not in entry
        assert entry["source_draft_snapshot_id"] == moved["snapshot_id"]
        assert entry["exported_ref"].startswith("urn:")
    assert receipt["provenance_only_submission_ids"] == []
    assert "provenance.t1.zip" not in archive.namelist()
    [unit] = _units(archive, "selected.t1.zip")
    assert unit["annotation_set"]["stage"] == "carry_forward"
    [row] = [
        r
        for r in csv.DictReader(
            io.StringIO(archive.read("index.csv").decode("utf-8-sig"))
        )
        if r["row_type"] == "selected"
    ]
    assert row["submission_kind"] == "carry_forward"
    readme = archive.read("README.txt").decode()
    assert "source_draft_snapshot_id" in readme

    # An export without draft-sourced inputs keeps its shape: the old receipt
    # keys and no draft sentence in the README.
    select(env.scenario, env.docs[1], ana_v2)
    archive = _final_export(env, "final-submission")
    receipt = json.loads(archive.read("receipt.json"))
    assert receipt["human_inputs"]
    for entry in receipt["human_inputs"]:
        assert set(entry) == {
            "input_id",
            "input_alias",
            "source_submission_id",
            "source_ref",
            "exported_ref",
        }
        assert entry["source_submission_id"] == ana["submission_id"]
    assert receipt["provenance_only_submission_ids"] == [ana["submission_id"]]
    assert "draft" not in archive.read("README.txt").decode().lower()


def test_package_export_keeps_draft_sourced_rounds(env):
    moved = _moved(env)
    package = env.repo.export_package(env.key)
    archived = package.manifest.workflow_history[moved["round"].round_id]
    assert archived["round"]["kind"] == "text_change"
    assert {item["source_draft_snapshot_id"] for item in archived["inputs"]} == {
        moved["snapshot_id"]
    }
    assert all(item["source_submission_id"] is None for item in archived["inputs"])


def test_t1_export_names_draft_sources_by_draft_ref(env, monkeypatch):
    """The individual T1 export over a text-change submission: every
    draft-sourced input is exported under ``draft_input_ref``."""
    from ontotator.exchange import jobs
    from ontotator.exchange.jobs import HANDLERS, draft_input_ref
    from ontotator.jobs.queue import JobQueue

    moved = _moved(env)
    sid = _finish(env, "tom", moved["round"])
    entries = env.repo.get_round_input_inventory(env.key, moved["round"].round_id)
    seen: list[dict[str, str]] = []
    original = jobs.serialize_t1_content

    def spy(*args: Any, **kwargs: Any) -> Any:
        seen.append(dict(kwargs["source_ref_overrides"]))
        return original(*args, **kwargs)

    monkeypatch.setattr(jobs, "serialize_t1_content", spy)
    _access, lead = env.lead()
    job_id = JobQueue(env.db, HANDLERS).enqueue(
        "t1_export", {"project": env.key}, actor=lead
    )
    deadline = monotonic() + 60
    while True:
        with env.db.transaction() as conn:
            job = conn.execute(sa_select(JobRow).where(JobRow.id == job_id)).one()
        if job.status == "succeeded":
            break
        assert job.status != "failed", job.error
        assert monotonic() < deadline, "T1 export did not finish"
        sleep(0.05)
    [overrides] = seen
    assert len(entries) == 2
    for entry in entries:
        assert entry["source_submission_id"] is None
        ref = draft_input_ref(env.key, entry)
        assert overrides[f"input-{entry['input_id']}"] == ref
        assert overrides[f"round-input:{entry['input_id']}"] == ref
        assert f"draft-snapshot-{moved['snapshot_id']}" in ref
    assert sid not in job.result["provenance_only_submission_ids"]


def test_package_round_trip_keeps_draft_inputs_without_local_lookup(
    env, tmp_path, monkeypatch
):
    """An imported text-change round reads its inputs from the archive; its
    draft snapshot ids are not looked up in the importing database."""
    from pg_harness import database_for

    from ontotator.application import round_reads
    from ontotator.storage.repository import Repository

    moved = _moved(env)
    _finish(env, "tom", moved["round"])
    package = env.repo.export_package(env.key)
    target = Repository(database_for(tmp_path / "imported.db"))
    target.import_package(package)
    looked_up: list[set[int]] = []
    original = round_reads._draft_versions

    def spy(conn: Any, pid: int, ids: Any) -> dict[int, int]:
        looked_up.append(set(ids))
        return original(conn, pid, ids)

    monkeypatch.setattr(round_reads, "_draft_versions", spy)
    items = target.get_round_input_inventory(env.key, moved["round"].round_id)
    inputs = round_reads.enrich_inputs(target, env.key, items)
    assert looked_up == [set()]
    assert len(inputs) == 2
    for item in inputs:
        assert item.source_submission_id is None
        assert item.source_draft_snapshot_id == moved["snapshot_id"]
        assert (item.source_language, item.source_version) == ("de", 1)
