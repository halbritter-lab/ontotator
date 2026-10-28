"""The annotator's own workspace after a mode change discarded their work (#109).

Re-assigned on the text in the old mode, the person starts fresh: no prior
submission, draft content or decisions from the discarded work. A restore
brings the old workspace back unchanged.
"""

from __future__ import annotations

from typing import Any

from proposal_check_support import BASE, assign, client, open_task, proposal_env
from test_consolidation_tool_proposals import HEAVY, Workspace
from work_plan_support import revision_of

CHANGES = f"{BASE}/annotation-mode-changes"


def submitted(tmp_path: Any) -> Any:
    """Anne checked c1-en from proposals, added a finding and submitted."""
    env = proposal_env(tmp_path)
    anne = Workspace(env, "anno")
    for target in anne.targets:
        anne.decide(target, "confirmed")
    anne.create("anne-heavy", HEAVY, HEAVY + len("schwere"), assertion="present")
    env.submission = anne.submit()
    env.anne = anne
    return env


def change(env: Any, mode: str) -> dict[str, Any]:
    seen = env.lead.post(
        f"{CHANGES}/preview", json={"case_id": "c1", "language": "en", "mode": mode}
    ).json()
    response = env.lead.post(
        CHANGES,
        json={
            "case_id": "c1",
            "language": "en",
            "mode": mode,
            "reason": "Proposals were from the wrong model",
            "expected_revision": revision_of(env, "c1"),
            "expected_submission_ids": [
                s["submission_id"] for s in seen["submissions"]
            ],
        },
    )
    assert response.status_code == 200, response.text
    return dict(response.json()["change"])


def back_to_proposals(env: Any) -> None:
    """The lead plans the text from proposals again (no work fixes it now)."""
    response = env.lead.patch(
        f"{BASE}/work-plans/c1/en",
        json={
            "annotation_mode": "proposals",
            "expected_revision": revision_of(env, "c1"),
        },
    )
    assert response.status_code == 200, response.text


def pseudonym(env: Any, username: str) -> str:
    return str(env.app.state.accounts.get_by_username(username).pseudonym)


def test_a_new_assignment_after_a_discard_starts_fresh(tmp_path):
    env = submitted(tmp_path)
    old = change(env, "scratch")
    [old_assignment] = old["revoked_assignment_ids"]
    back_to_proposals(env)
    again = assign(env, env.c1, "anno")
    assert again["annotation_mode"] == "proposals"
    opened = open_task(env, "anno", again["id"])
    view = opened["view"]
    assert opened["read_only"] is False
    # Nothing of the discarded work: no submission, findings or decisions.
    assert view["submissions"] == []
    assert view["draft"]["annotations"] == []
    assert view["draft"]["decisions"] == []
    assert view["checked_layer_ids"] == []
    # A workspace of its own, not the discarded one.
    assert view["key"]["round_id"] is not None
    assert opened["workspace_id"] != env.anne.id
    repo = env.app.state.repo
    who = pseudonym(env, "anno")
    assert repo.get_document_statuses("proj", who, "proposal_check")[env.c1] == (
        "not_started"
    )
    keys = repo.list_workspace_keys("proj", who, "proposal_check", env.c1)
    assert [k.round_id for k in keys] == [view["key"]["round_id"]]
    # Opening again resumes the same fresh workspace.
    reopened = open_task(env, "anno", again["id"])
    assert reopened["view"]["key"] == view["key"]
    assert old_assignment != again["id"]


def test_the_fresh_workspace_submits_its_own_work(tmp_path):
    env = submitted(tmp_path)
    change(env, "scratch")
    back_to_proposals(env)
    again = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", again["id"])
    fresh = client(env, "anno")
    revision = opened["view"]["draft"]["revision"]
    workspace = opened["workspace_id"]
    for target in opened["view"]["targets"]["targets"]:
        response = fresh.post(
            f"/api/v1/workspaces/{workspace}/decisions",
            json={
                "mutation_id": f"d-{target['annotation_id']}",
                "expected_revision": revision,
                "payload": {"target": target, "outcome": "rejected"},
            },
        )
        assert response.status_code == 200, response.text
        revision = response.json()["revision"]
    listed = env.lead.get(f"{BASE}/document-rows/c1/en/submissions").json()
    assert listed["submissions"] == []  # the discarded one stays out


def test_restore_brings_the_old_workspace_back(tmp_path):
    env = submitted(tmp_path)
    old = change(env, "scratch")
    [old_assignment] = old["revoked_assignment_ids"]
    restored = env.lead.post(
        f"{CHANGES}/{old['change_id']}/restore",
        json={"expected_revision": revision_of(env, "c1")},
    )
    assert restored.status_code == 200, restored.text
    opened = open_task(env, "anno", old_assignment)
    view = opened["view"]
    assert opened["read_only"] is True  # submitted
    assert [s["submission_id"] for s in view["submissions"]] == [env.submission]
    assert [a["annotation"]["annotation_id"] for a in view["draft"]["annotations"]]
    assert "anne-heavy" in {
        a["annotation"]["annotation_id"] for a in view["draft"]["annotations"]
    }
    repo = env.app.state.repo
    assert (
        repo.get_document_statuses("proj", pseudonym(env, "anno"), "proposal_check")[
            env.c1
        ]
        == "completed"
    )
