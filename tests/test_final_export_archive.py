"""The final archive carries README.txt and index.csv, hashed in the receipt."""

import csv
import hashlib
import io
import json
import zipfile

from sqlalchemy import select
from test_annotation_versions import seed_submission
from test_case_api import BASE, SOURCE
from test_case_api import case_env as case_env

from ontotator.exchange.final_export_guide import guide_files
from ontotator.storage.final_tables import ExportSelectionSnapshotRow


def _export(env):
    seed_submission(env, "alice", "original")
    selected = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": SOURCE,
            "submission_id": "original",
            "expected_revision": 0,
        },
    )
    assert selected.status_code == 200, selected.text
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": "guide-1",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    result = env.app.state.jobs.run(
        env.app.state.jobs.claim(job_id, "guide-test"), "guide-test"
    )
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    return state, zipfile.ZipFile(io.BytesIO(downloaded.content))


def test_archive_contains_hashed_readme_and_index(case_env):
    state, archive = _export(case_env)
    names = set(archive.namelist())
    assert {
        "selected.t1.zip",
        "source-texts.jsonl",
        "receipt.json",
        "README.txt",
        "index.csv",
    } <= names
    receipt = json.loads(archive.read("receipt.json"))
    assert receipt["format"] == "ontotator-final-export/v2"
    assert set(receipt["files"]) == names - {"receipt.json"}
    for name, digest in receipt["files"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
    table = list(
        csv.DictReader(
            io.StringIO(archive.read("index.csv").decode("utf-8-sig"), newline="")
        )
    )
    assert len(table) == (
        len(state["selections"])
        + len(state["omissions"])
        + len(receipt["provenance_only_submission_ids"])
    )
    selected_rows = [row for row in table if row["row_type"] == "selected"]
    assert [row["submission_id"] for row in selected_rows] == ["original"]
    assert selected_rows[0]["submitted_at"].endswith("Z")
    with zipfile.ZipFile(io.BytesIO(archive.read("selected.t1.zip"))) as bundle:
        for row in selected_rows:
            unit = json.loads(bundle.read(row["bundle_entry"]))
            assert (
                unit["annotation_set"]["annotation_set_id"] == row["annotation_set_id"]
            )
    readme = archive.read("README.txt").decode("utf-8")
    assert readme.startswith("Ontotator final export\n")
    assert f"Snapshot ID:      {receipt['snapshot_id']}" in readme


def test_guide_files_are_a_pure_function_of_the_stored_snapshot(case_env):
    _state, archive = _export(case_env)
    receipt = json.loads(archive.read("receipt.json"))
    with case_env.db.transaction() as conn:
        row = (
            conn.execute(
                select(ExportSelectionSnapshotRow).where(
                    ExportSelectionSnapshotRow.snapshot_id == receipt["snapshot_id"]
                )
            )
            .mappings()
            .one()
        )
    assert "project_name" in row["payload"]
    assert set(row["payload"]["submission_recorded_at"]) == {"original"}
    again = guide_files(
        row["payload"],
        snapshot_id=row["snapshot_id"],
        snapshot_sha256=row["sha256"],
        snapshot_created_at=row["created_at"],
    )
    assert again["README.txt"] == archive.read("README.txt")
    assert again["index.csv"] == archive.read("index.csv")
