"""Final jobs freeze the acknowledged selection; they never select live latest."""

import io
import json
import zipfile

from test_annotation_versions import seed_submission
from test_case_api import BASE, SOURCE
from test_case_api import case_env as case_env


def test_queued_final_export_keeps_exact_old_selection(case_env):
    env = case_env
    seed_submission(env, "alice", "original")
    env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": SOURCE,
            "submission_id": "original",
            "expected_revision": 0,
        },
    )
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    request = {
        "request_id": "final-1",
        "state_digest": state["state_digest"],
        "acknowledged_warnings": [
            {"id": w["id"], "cause_revision": w["cause_revision"]}
            for w in state["warnings"]
        ],
        "accepted_omissions": state["omissions"],
    }
    queued = env.lead.post(f"{BASE}/exports/final", json=request)
    assert queued.status_code == 200, queued.text
    assert env.lead.post(f"{BASE}/exports/final", json=request).json() == queued.json()
    seed_submission(env, "alice", "later", timestamp="2026-10-18T12:00:00Z")
    changed = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": SOURCE, "submission_id": "later", "expected_revision": 1},
    )
    assert changed.status_code == 200, changed.text
    stale = env.lead.post(
        f"{BASE}/exports/final", json={**request, "request_id": "final-stale"}
    )
    assert stale.status_code == 409, stale.text
    job_id = queued.json()["job_id"]
    job = env.app.state.jobs.claim(job_id, "final-test")
    result = env.app.state.jobs.run(job, "final-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as bundle:
        receipt = json.loads(bundle.read("receipt.json"))
        assert receipt["selections"][0]["submission_id"] == "original"
        assert "selected.t1.zip" in bundle.namelist()
        assert receipt["omissions"] == state["omissions"]
