"""Phenopackets of the final results (#308): derived from the frozen snapshot,
one per text, with ontospan's report of what was left out."""

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace

import ontospan
import pytest
from auth_harness import logged_in
from pg_harness import database_url_for
from sqlalchemy import select
from t1_builders import bundle, native_unit
from t1_fixtures import HP_PATH, TEXT, annotation, create_project, hpo_profile
from t1_fixtures import run_import as import_bundle
from test_auth_api import _app
from typer.testing import CliRunner
from work_plan_support import plan_all

from ontotator.cli import app as cli_app
from ontotator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontotator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.exchange.final_phenopackets import SELECTED_RESULTS_FILE, to_packets
from ontotator.storage.final_tables import ExportSelectionSnapshotRow
from ontotator.storage.repository import _key_str

BASE = "/api/v1/projects/proj"
DOC = "EN-1"
CREATED = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)


def _check(packet):
    """Structure as Phenopacket v2 protobuf JSON; parsed if the extra is there."""
    assert set(packet) <= {"id", "subject", "phenotypicFeatures", "metaData"}
    assert packet["metaData"]["phenopacketSchemaVersion"] == "2.0"
    for feature in packet["phenotypicFeatures"]:
        assert feature["type"]["id"].startswith("HP:")
        assert feature["evidence"][0]["evidenceCode"]["id"].startswith("ECO:")
    try:
        parsed = ontospan.parse_phenopacket(packet)
    except ImportError:
        return
    assert parsed.id == packet["id"]


def _axes(value, **overrides):
    base = annotation(value, (6, 19))
    base["axes"] = {
        **base["axes"],
        **{k: {"value": v, "basis": "chosen"} for k, v in overrides.items()},
    }
    return base


def test_to_packets_uses_ontospan_and_leaves_out_unresolved():
    unit = native_unit(
        DOC,
        "de",
        TEXT,
        annotations=[
            _axes("present"),
            _axes("absent", assertion="absent"),
            _axes("family", experiencer="family_member"),
            _axes("suspected", assertion="uncertain"),
            _axes("past", temporality="historical"),
            _axes("unresolved"),
        ],
    )
    aset = unit.annotation_set
    unit = unit.model_copy(
        update={
            "annotation_set": aset.model_copy(
                update={
                    "annotations": tuple(
                        a.model_copy(
                            update={
                                "review_resolution": ontospan.ReviewResolution(
                                    outcome="uncertain",
                                    reviewer=ontospan.Actor(
                                        actor_id="ann-1", kind="human"
                                    ),
                                    note="unclear",
                                )
                            }
                        )
                        if a.annotation_id == "unresolved"
                        else a
                        for a in aset.annotations
                    )
                }
            )
        }
    )
    view = ontospan.ObographOntology.load(HP_PATH)
    [packet] = to_packets(
        [unit], [{"hp": view}], bundle_id="selected-s", created_at=CREATED
    )
    assert packet.packet["id"] == DOC
    assert packet.packet["subject"] == {"id": DOC}
    features = packet.packet["phenotypicFeatures"]
    assert len(features) == 3
    assert [f.get("excluded", False) for f in features] == [False, True, False]
    assert packet.report.exported == 3
    assert packet.report.omitted_family == 1
    assert packet.report.omitted_uncertain == 1
    assert packet.report.historical == 1
    assert packet.left_out_unresolved == 1
    assert features[0]["evidence"][0]["reference"]["id"] == ontospan.annotation_ref(
        aset.annotation_set_id, "present", "selected-s"
    )
    _check(packet.packet)


def _finding(document, annotation_id, word, **axes):
    start = document.text.index(word)
    evidence = snapshot_evidence(
        EvidenceMention(
            evidence_id=f"ev-{annotation_id}",
            segments=[Segment(start=start, end=start + len(word))],
        ),
        document,
    )
    values = {
        "assertion": "present",
        "experiencer": "patient",
        "temporality": "current",
    }
    return snapshot(
        Annotation(
            annotation_id=annotation_id,
            document_id=document.document_id,
            layer_id="hpo",
            term_id="HP:0001250",
            axes_values={**values, **axes},
            evidence_refs=[
                EvidenceRef(
                    evidence_id=evidence.mention.evidence_id, version=evidence.version
                )
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id="ann-0001", kind="human"), method="manual"
            ),
        ),
        [evidence],
        document,
        hpo_profile(),
    )


@pytest.fixture
def env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    result = import_bundle(
        db, bundle(tmp_path, [native_unit(DOC, "de", TEXT, annotations=[])])
    )
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    alice = logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
    del alice
    user = app.state.accounts.get_by_username("alice")
    document = app.state.repo.get_document("proj", DOC)
    key = WorkspaceKey(
        project_key="proj",
        document_id=DOC,
        annotator_id=user.pseudonym,
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id="final-1",
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[
            _finding(document, "a", "Krampfanfälle"),
            _finding(document, "b", "Krampfanfälle", experiencer="family_member"),
            _finding(document, "c", "Krampfanfälle", assertion="absent"),
        ],
        decisions=[],
        created_at="2026-10-30T10:00:00Z",
    )
    with db.transaction() as conn:
        project_id = app.state.repo._require_project(conn, "proj")
        app.state.repo._insert_submission(
            conn, project_id, record, local_key=_key_str(key), imported=False
        )
    selected = lead.put(
        f"{BASE}/final-selections",
        json={"document_id": DOC, "submission_id": "final-1", "expected_revision": 0},
    )
    assert selected.status_code == 200, selected.text
    return SimpleNamespace(app=app, db=db, lead=lead, tmp_path=tmp_path)


def _request(env, request_id, **extra):
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    return {
        "request_id": request_id,
        "state_digest": state["state_digest"],
        "acknowledged_warnings": [
            {"id": w["id"], "cause_revision": w["cause_revision"]}
            for w in state["warnings"]
        ],
        "accepted_omissions": state["omissions"],
        **extra,
    }


def _run(env, job_id):
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(job_id, "pp-test"), "pp-test")
    assert result.status == "succeeded", result.error
    return result


def _archive(data):
    return zipfile.ZipFile(io.BytesIO(data))


def test_final_phenopacket_export_per_text_with_reports(env):
    request = _request(env, "pp-1", format="phenopacket")
    queued = env.lead.post(f"{BASE}/exports/final", json=request)
    assert queued.status_code == 200, queued.text
    # The same request returns the same job.
    assert env.lead.post(f"{BASE}/exports/final", json=request).json() == queued.json()
    job_id = queued.json()["job_id"]
    assert env.lead.get(f"/api/v1/jobs/{job_id}").json()["kind"] == (
        "final_phenopacket_export"
    )
    result = _run(env, job_id)
    assert result.result["phenopackets"] == 1
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    assert "final-phenopackets" in downloaded.headers["content-disposition"]
    archive = _archive(downloaded.content)
    names = set(archive.namelist())
    assert names == {
        "README.txt",
        "phenopackets/00000.json",
        "reports/00000.json",
        "report.json",
        SELECTED_RESULTS_FILE,
        "receipt.json",
    }
    receipt = json.loads(archive.read("receipt.json"))
    for name, digest in receipt["files"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
    packet = json.loads(archive.read("phenopackets/00000.json"))
    assert packet["id"] == DOC and packet["subject"] == {"id": DOC}
    assert [f.get("excluded", False) for f in packet["phenotypicFeatures"]] == [
        False,
        True,
    ]
    reference = packet["phenotypicFeatures"][0]["evidence"][0]["reference"]["id"]
    assert f"selected-{receipt['snapshot_id']}" in reference
    _check(packet)
    report = json.loads(archive.read("reports/00000.json"))
    assert report["document_id"] == DOC
    assert report["submission_id"] == "final-1"
    assert report["ontospan_report"]["exported"] == 2
    assert report["ontospan_report"]["omitted_family"] == 1
    summary = json.loads(archive.read("report.json"))
    assert summary["totals"]["omitted_family"] == 1
    assert summary["documents"] == [report]
    readme = archive.read("README.txt").decode()
    assert readme.startswith("Ontotator Phenopacket export\n")
    assert "not grouped" in readme


def test_t1_request_is_stored_as_before(env):
    """A request without format is the T1 export; its stored request is unchanged."""
    request = _request(env, "t1-1")
    queued = env.lead.post(f"{BASE}/exports/final", json=request)
    assert queued.status_code == 200, queued.text
    job = env.lead.get(f"/api/v1/jobs/{queued.json()['job_id']}").json()
    assert job["kind"] == "final_t1_export"
    explicit = env.lead.post(f"{BASE}/exports/final", json={**request, "format": "t1"})
    assert explicit.json() == queued.json()


def test_cli_exports_phenopackets_of_the_newest_final_export(env, monkeypatch):
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(env.db.data_dir))
    out = env.tmp_path / "pp.zip"
    runner = CliRunner()
    args = ["--database-url", database_url_for(env.tmp_path / "auth.db")]
    refused = runner.invoke(
        cli_app, ["admin", *args, "export", "proj", str(out), "--format", "phenopacket"]
    )
    assert refused.exit_code == 1
    assert "NO_FINAL_EXPORT" in refused.output
    queued = env.lead.post(f"{BASE}/exports/final", json=_request(env, "t1-2"))
    _run(env, queued.json()["job_id"])
    done = runner.invoke(
        cli_app, ["admin", *args, "export", "proj", str(out), "--format", "phenopacket"]
    )
    assert done.exit_code == 0, done.output
    assert "1 Phenopacket" in done.output
    packet = json.loads(_archive(out.read_bytes()).read("phenopackets/00000.json"))
    assert packet["id"] == DOC


def test_replayed_request_after_cli_export_returns_its_own_job(env, monkeypatch):
    """The CLI queues a second Phenopacket job of the same snapshot; a replay of
    the lead's request still answers with the lead's job, not a 500."""
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(env.db.data_dir))
    request = _request(env, "pp-replay", format="phenopacket")
    queued = env.lead.post(f"{BASE}/exports/final", json=request)
    assert queued.status_code == 200, queued.text
    _run(env, queued.json()["job_id"])
    out = env.tmp_path / "cli.zip"
    args = ["--database-url", database_url_for(env.tmp_path / "auth.db")]
    done = CliRunner().invoke(
        cli_app, ["admin", *args, "export", "proj", str(out), "--format", "phenopacket"]
    )
    assert done.exit_code == 0, done.output
    replay = env.lead.post(f"{BASE}/exports/final", json=request)
    assert replay.status_code == 200, replay.text
    assert replay.json() == queued.json()


def test_t1_request_keeps_nested_fields(env):
    """Only ``format`` is left out of a stored T1 request, not nested fields."""
    request = _request(env, "t1-nested")
    queued = env.lead.post(f"{BASE}/exports/final", json=request)
    assert queued.status_code == 200, queued.text
    with env.db.transaction() as conn:
        stored = conn.execute(
            select(ExportSelectionSnapshotRow.payload).where(
                ExportSelectionSnapshotRow.request_id == "t1-nested"
            )
        ).scalar_one()["request"]
    assert stored == request


def test_selected_results_equal_the_final_export_of_the_same_snapshot(env, monkeypatch):
    """The embedded Ontospan bundle is byte for byte the final export's selected
    results of the same snapshot, and every evidence reference resolves in it."""
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(env.db.data_dir))
    queued = env.lead.post(f"{BASE}/exports/final", json=_request(env, "t1-same"))
    job_id = queued.json()["job_id"]
    _run(env, job_id)
    final_zip = _archive(env.lead.get(f"/api/v1/jobs/{job_id}/download").content)
    final_receipt = json.loads(final_zip.read("receipt.json"))
    out = env.tmp_path / "same.zip"
    args = ["--database-url", database_url_for(env.tmp_path / "auth.db")]
    done = CliRunner().invoke(
        cli_app, ["admin", *args, "export", "proj", str(out), "--format", "phenopacket"]
    )
    assert done.exit_code == 0, done.output
    archive = _archive(out.read_bytes())
    receipt = json.loads(archive.read("receipt.json"))
    assert receipt["snapshot_id"] == final_receipt["snapshot_id"]
    embedded = archive.read(SELECTED_RESULTS_FILE)
    assert embedded == final_zip.read("selected.t1.zip")
    assert receipt["files"][SELECTED_RESULTS_FILE] == (
        hashlib.sha256(embedded).hexdigest()
    )
    bundle_id = f"selected-{receipt['snapshot_id']}"
    assert receipt["selected_results"] == {
        "file": SELECTED_RESULTS_FILE,
        "bundle_id": bundle_id,
    }
    path = env.tmp_path / "embedded.zip"
    path.write_bytes(embedded)
    manifest, units = ontospan.read_bundle(path)
    assert manifest.bundle_id == bundle_id
    findings = {
        (unit.annotation_set.annotation_set_id, a.annotation_id)
        for unit in units
        for a in unit.annotation_set.annotations
    }
    packet = json.loads(archive.read("phenopackets/00000.json"))
    assert packet["phenotypicFeatures"]
    for feature in packet["phenotypicFeatures"]:
        ref = ontospan.parse_annotation_ref(feature["evidence"][0]["reference"]["id"])
        assert ref.bundle_id == bundle_id
        assert (ref.annotation_set_id, ref.annotation_id) in findings
    readme = archive.read("README.txt").decode()
    assert SELECTED_RESULTS_FILE in readme and "Ontospan bundle" in readme
    assert "T1" not in readme and "t1.zip" not in readme
    assert "onset" in readme and "temporality" in readme
