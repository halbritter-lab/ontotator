"""Explicit lead selection, compare-and-set and shared export preflight."""

from urllib.parse import quote

from test_annotation_versions import seed_submission
from test_case_api import BASE, SOURCE, TARGET
from test_case_api import case_env as case_env


def test_only_lead_can_pin_exact_results_and_replacement_is_compare_and_set(case_env):
    env = case_env
    seed_submission(env, "alice", "selected-1")
    body = {
        "document_id": SOURCE,
        "submission_id": "selected-1",
        "expected_revision": 0,
    }
    url = f"{BASE}/final-selections"
    assert env.alice.put(url, json=body).status_code == 403
    selected = env.lead.put(url, json=body)
    assert selected.status_code == 200, selected.text
    assert selected.json()["revision"] == 1
    assert env.lead.put(url, json=body).status_code == 409
    preflight = env.lead.post(f"{BASE}/exports/final/preflight")
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["selections"][0]["submission_id"] == "selected-1"
    dashboard = env.lead.get(f"{BASE}/workflow-warnings")
    assert dashboard.json() == preflight.json()
    assert preflight.json()["omissions"]


def test_selection_cannot_name_another_documents_submission(case_env):
    env = case_env
    seed_submission(env, "alice", "selected-1")
    response = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": "other",
            "submission_id": "selected-1",
            "expected_revision": 0,
        },
    )
    assert response.status_code in (404, 422)


def test_language_slots_coexist_and_reaffirmation_does_not_resurrect_old_causes(
    case_env,
):
    env = case_env
    for sid, document in [("english", SOURCE), ("german", TARGET)]:
        seed_submission(env, "alice", sid, document=document)
        result = env.lead.put(
            f"{BASE}/final-selections",
            json={
                "document_id": document,
                "submission_id": sid,
                "expected_revision": 0,
            },
        )
        assert result.status_code == 200, result.text
    state = env.lead.get(f"{BASE}/workflow-warnings").json()
    assert {row["language"] for row in state["selections"]} == {"en", "de"}
    cause = next(w for w in state["warnings"] if w["code"] == "SELECTED_TEXT_CORRECTED")
    assert cause["destination"] == (
        f"#{BASE.removeprefix('/api/v1')}/cases/{quote(cause['case_id'], safe='')}"
        f"?variant={quote(TARGET, safe='')}"
    )
    body = {
        "document_id": TARGET,
        "submission_id": "german",
        "expected_revision": 1,
        "acknowledged_cause_ids": [cause["cause_id"]],
    }
    assert env.lead.put(f"{BASE}/final-selections", json=body).status_code == 200
    assert (
        env.lead.put(
            f"{BASE}/final-selections",
            json={**body, "expected_revision": 2, "acknowledged_cause_ids": []},
        ).status_code
        == 200
    )
    refreshed = env.lead.get(f"{BASE}/workflow-warnings").json()
    assert cause["id"] not in {w["id"] for w in refreshed["warnings"]}
    future = env.lead.put(
        f"{BASE}/final-selections",
        json={
            **body,
            "expected_revision": 3,
            "acknowledged_cause_ids": ["future-cause"],
        },
    )
    assert future.status_code == 409
