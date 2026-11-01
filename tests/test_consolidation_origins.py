"""How a consolidated result came about (#133) and the kept finding's text
(#132): derived from the consolidation's own decisions, shown in the final
panel and exported in ``receipt.json`` (``ontotator-final-export/v2``)."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

import pytest
from test_consolidation_resolve_api import (
    add_finding,
    build_round,
    cons_id,
    edit_note,
    group,
    inputs,
    mutate,
    ok,
    payload,
    revision,
    view,
)
from test_consolidation_submit_gating import submit_acknowledged
from test_final_panel_api import span_of
from work_plan_support import BASE, doc, preflight, select_final

from ontotator.domain.consolidation_origins import finding_origins, origin_counts
from ontotator.storage.repository import Repository

STATUS = "HP:0002133"  # known to the test ontology


@pytest.fixture
def cons(tmp_path):
    return build_round(tmp_path)


def resolve_and_add(ns: Any) -> dict[str, str]:
    """match: auto; term_differs: choose; values_differ: leave out;
    partial: keep; plus one finding added outside the groups."""
    ids = {
        "auto": cons_id(ns, inputs(group(ns, "match")), 0),
        "choose": cons_id(ns, inputs(group(ns, "term_differs")), 0),
        "keep": cons_id(ns, inputs(group(ns, "partial")), 0),
    }
    ok(mutate(ns, "resolve", payload(group(ns, "term_differs"), "choose")))
    ok(mutate(ns, "resolve", payload(group(ns, "values_differ"), "leave_out")))
    ok(mutate(ns, "resolve", payload(group(ns, "partial"), "keep")))
    ids["added"] = add_finding(ns, STATUS, "Neonatalzeit")
    return ids


def submitted(ns: Any) -> dict[str, Any]:
    response = submit_acknowledged(ns.adj, view(ns)["workspace_id"], revision(ns))
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_result_names_the_text_of_the_kept_finding(cons):
    """R-3 (#132): the kept finding's spans, so one term on separate spans
    is no duplicate."""
    target = doc("c1", "en")
    match = group(cons, "match")
    assert match["result"]["spans"] == [list(span_of(cons.env, target, "Neonatalzeit"))]
    ok(mutate(cons, "resolve", payload(group(cons, "term_differs"), "choose")))
    chosen = group(cons, "term_differs")
    # ``choose`` takes the first member's span ("Seit 2").
    assert chosen["result"]["spans"] == [list(span_of(cons.env, target, "Seit 2"))]
    assert group(cons, "values_differ")["result"] is None


def test_origins_tell_matched_decided_and_added_apart(cons):
    ids = resolve_and_add(cons)
    body = submitted(cons)
    sid = body["submission_id"]
    panel = cons.env.lead.get(f"{BASE}/document-rows/c1/en/final-panel")
    assert panel.status_code == 200, panel.text
    items = {s["submission_id"]: s for s in panel.json()["submissions"]}
    # The left-out values_differ group is no finding, but named (#248).
    assert items[sid]["consolidation_origins"] == {
        "matched": 1,
        "decided": 2,
        "added": 1,
        "left_out": 1,
    }
    assert items[sid]["finding_count"] == 4
    assert all(
        item["consolidation_origins"] is None
        for key, item in items.items()
        if key != sid
    )

    select_final(cons.env, doc("c1", "en"), sid)
    receipt = export_receipt(cons.env)
    assert receipt["format"] == "ontotator-final-export/v2"
    record = receipt["consolidations"][sid]
    assert record["consolidator"] == cons.round.annotator_id
    assert record["counts"] == {"matched": 1, "decided": 2, "added": 1}
    found = {item["annotation_id"]: item for item in record["findings"]}
    assert {
        key: (v["origin"], v["decision"], v["edited"]) for key, v in found.items()
    } == {
        ids["auto"]: ("matched", "auto", False),
        ids["choose"]: ("decided", "choose", False),
        ids["keep"]: ("decided", "keep", False),
        ids["added"]: ("added", None, False),
    }
    # The decisions behind each finding are those of review_decisions.
    decisions = {d["decision_id"] for d in receipt["review_decisions"][sid]}
    assert all(set(item["decision_ids"]) <= decisions for item in record["findings"])
    assert len(found[ids["auto"]]["decision_ids"]) == 2
    assert found[ids["added"]]["decision_ids"] == []
    # The annotation sources keep their submissions out of ``consolidations``.
    assert set(receipt["consolidations"]) == {sid}


def test_an_edited_automatic_finding_counts_as_decided(cons):
    cid = cons_id(cons, inputs(group(cons, "match")), 0)
    edit_note(cons, cid, "Changed by the consolidator")
    repo = Repository(cons.env.db)
    with cons.env.db.transaction() as conn:
        draft = repo._open_draft(conn, cons.round.workspace_key, None)
    [origin] = finding_origins(draft.annotations, draft.decisions)
    assert (origin.annotation_id, origin.origin, origin.decision, origin.edited) == (
        cid,
        "decided",
        "auto",
        True,
    )
    assert origin_counts([origin]).decided == 1


def export_receipt(env: Any) -> dict[str, Any]:
    state = preflight(env)
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": "origins-1",
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
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(job_id, "origins-test"), "origins-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    archive = zipfile.ZipFile(io.BytesIO(downloaded.content))
    readme = archive.read("README.txt").decode("utf-8")
    assert "consolidations    Per consolidation" in readme
    return dict(json.loads(archive.read("receipt.json")))
