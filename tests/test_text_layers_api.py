"""Text view "Show" list and the final-result layer (spec 2026-10-23 §4, D3)."""

from __future__ import annotations

from typing import Any

import pytest
from proposal_check_support import BASE, assign, client, proposal_env
from sqlalchemy import update
from work_plan_support import select_final, submit

from ontotator.storage.plan_tables import WorkPlanFlagsRow


@pytest.fixture
def env(tmp_path):
    return proposal_env(tmp_path)


def layers(env: Any, username: str | None, document: str) -> list[dict[str, Any]]:
    who = env.lead if username is None else client(env, username)
    response = who.get(f"{BASE}/documents/{document}/layers")
    assert response.status_code == 200, response.text
    return list(response.json()["entries"])


def _scratch_override(env: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(WorkPlanFlagsRow)
            .where(
                WorkPlanFlagsRow.project_id == env.pid,
                WorkPlanFlagsRow.case_id == "c1",
                WorkPlanFlagsRow.language == "en",
            )
            .values(annotation_mode="scratch")
        )


def test_lead_sees_proposals_people_and_final_placeholder(env):
    submit(env, assign(env, env.c1, "anno")["id"], "sub-anno")
    assign(env, env.c1, "anno2")
    entries = layers(env, None, env.c1)
    assert [e["kind"] for e in entries] == [
        "proposals",
        "submission",
        "person",
        "final",
    ]
    proposals, submitted, person, final = entries
    assert proposals["available"] and proposals["label"] == "Tool proposals (3)"
    assert proposals["count"] == 3 and proposals["ref"]["kind"] == "proposals"
    assert submitted["available"] and submitted["ref"]["id"] == "sub-anno"
    assert submitted["label"].startswith("Anne Notator, submitted ")
    assert submitted["state"] == "submitted" and submitted["count"] == 0
    assert person == {
        "kind": "person",
        "ref": None,
        "label": "Arne Notator, not started",
        "state": "not_started",
        "count": None,
        "available": False,
        "reason": "Not submitted yet.",
    }
    assert not final["available"] and final["ref"] is None
    assert final["label"] == "Final result"
    assert final["reason"] == "Not accepted yet."
    assert final["state"] == "not_accepted"


def test_final_layer_after_acceptance_opens_the_selected_submission(env):
    submit(env, assign(env, env.c1, "anno")["id"], "sub-anno")
    select_final(env, env.c1, "sub-anno")
    final = layers(env, None, env.c1)[-1]
    assert final["kind"] == "final" and final["available"]
    assert final["state"] == "accepted"
    assert final["label"].startswith("Final result, accepted ")
    assert final["ref"]["kind"] == "final" and final["ref"]["id"] == "sub-anno"
    assert final["ref"]["label"] == "Final result"
    response = env.lead.get(
        f"{BASE}/documents/{env.c1}/annotation-versions/final/sub-anno"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ref"]["kind"] == "final" and body["annotations"] == []


def test_scratch_annotator_sees_proposals_greyed_and_no_people(env):
    _scratch_override(env)
    mine = assign(env, env.c1, "anno")
    assert mine["annotation_mode"] == "scratch"
    submit(env, mine["id"], "sub-anno")
    submit(env, assign(env, env.c1, "anno2")["id"], "sub-anno2")
    entries = layers(env, "anno", env.c1)
    assert [e["kind"] for e in entries] == ["proposals", "own"]
    proposals, own = entries
    assert not proposals["available"] and proposals["ref"] is None
    assert proposals["reason"] == "Hidden while you annotate from scratch."
    assert own["available"] and own["ref"]["id"] == "sub-anno"


def test_annotator_from_proposals_sees_proposals_and_only_own_work(env):
    submit(env, assign(env, env.c1, "anno")["id"], "sub-anno")
    submit(env, assign(env, env.c1, "anno2")["id"], "sub-anno2")
    select_final(env, env.c1, "sub-anno2")
    entries = layers(env, "anno", env.c1)
    assert [e["kind"] for e in entries] == ["proposals", "own"]
    assert entries[0]["available"] and entries[0]["ref"]["kind"] == "proposals"
    assert entries[1]["ref"]["id"] == "sub-anno"
    assert "sub-anno2" not in str(entries) and "Arne" not in str(entries)
    shown = client(env, "anno").get(
        f"{BASE}/documents/{env.c1}/annotation-versions/proposals/"
        f"{entries[0]['ref']['id']}"
    )
    assert shown.status_code == 200, shown.text
    assert len(shown.json()["annotations"]) == 3


def test_layers_use_the_annotation_versions_gate(env):
    assign(env, env.c1, "anno")
    tom = client(env, "tom").get(f"{BASE}/documents/{env.c1}/layers")
    versions = client(env, "tom").get(f"{BASE}/documents/{env.c1}/annotation-versions")
    assert tom.status_code == versions.status_code == 404
    assert tom.json()["code"] == versions.json()["code"]


def test_unlisted_final_ref_is_not_found(env):
    submit(env, assign(env, env.c1, "anno")["id"], "sub-anno")
    select_final(env, env.c1, "sub-anno")
    response = client(env, "anno").get(
        f"{BASE}/documents/{env.c1}/annotation-versions/final/sub-anno"
    )
    assert response.status_code == 404
    assert response.json()["code"] == "VERSION_NOT_FOUND"


def test_final_on_another_version_names_that_version(env):
    from test_proposal_check_assignments import _correction_of_c1

    submit(env, assign(env, env.c1, "anno")["id"], "sub-anno")
    select_final(env, env.c1, "sub-anno")
    v2 = _correction_of_c1(env)
    final = layers(env, None, v2)[-1]
    assert final["kind"] == "final" and not final["available"]
    assert final["ref"] is None and final["reason"] == "Accepted on version 1."


def test_scratch_annotator_cannot_fetch_the_newest_proposals(env):
    _scratch_override(env)
    assert assign(env, env.c1, "anno")["annotation_mode"] == "scratch"
    newest = layers(env, None, env.c1)[0]["ref"]["id"]
    response = client(env, "anno").get(
        f"{BASE}/documents/{env.c1}/annotation-versions/proposals/{newest}"
    )
    assert response.status_code == 404
    assert response.json()["code"] == "VERSION_NOT_FOUND"
