"""Lead view: identity, labels, holds with releases, events with actors."""

from auth_harness import HARNESS
from problem_report_team import act, report

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def test_lead_view_has_identity_labels_and_release_records(team):
    created = report(team.bob, team.bob_task.id, "Text is cut off\nsecond line")
    act(team.bob, created["report_id"], 1, "resume", "upsi", [team.bob_task.id])
    act(
        team.lead,
        created["report_id"],
        2,
        "extend_hold",
        "Wait for new source",
        [team.carol_task.id],
    )
    act(team.lead, created["report_id"], 3, "resolve", "Source fixed")
    view = team.lead.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    assert view["reporter_label"] == "ann-0004" and view["created_at"]
    assert view["case_id"] and view["language"] and view["task"] == "annotate"
    assert (
        view["state"] == "resolved" and view["state_changed_by_label"] == "own-reviewer"
    )
    assert view["viewer_is_lead"] is True and view["withdrawable"] is False
    own, other = sorted(view["holds"], key=lambda h: h["created_at"])
    assert own["owner_label"] == "ann-0004" and own["active"] is False
    assert own["release_action"] == "resume" and own["released_by_label"] == "ann-0004"
    assert other["owner_label"] == "ann-0005" and other["active"] is True
    assert [e["action"] for e in view["events"]] == ["resume", "extend_hold", "resolve"]
    assert view["events"][1]["affected"][0]["owner_label"] == "ann-0005"
    assert (
        view["events"][0]["actor_label"] == "ann-0004"
        and view["events"][0]["reason"] == "upsi"
    )


def test_restarts_name_the_round_actually_abandoned_not_the_reported_round(team):
    created = report(team.bob, team.bob_task.id)
    filed = team.lead.get(f"/api/v1/problem-reports/{created['report_id']}").json()[
        "round_ordinal"
    ]
    act(team.lead, created["report_id"], 1, "restart", "Agreed", [team.bob_task.id])
    act(team.lead, created["report_id"], 2, "reopen", "Still broken")
    act(
        team.lead,
        created["report_id"],
        3,
        "restart",
        "Agreed again",
        [team.bob_task.id],
    )
    view = team.lead.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    restarts = [e for e in view["events"] if e["action"] == "restart"]
    # The second restart acts on an old report: it abandons the restarted round, not the reported one.
    assert [(e["abandoned_round_ordinal"], e["round_ordinal"]) for e in restarts] == [
        (filed, filed + 1),
        (filed + 1, filed + 2),
    ]
    assert view["round_ordinal"] == filed
    assert view["current_round_ordinal"] == filed + 2
    mine = team.bob.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    assert [
        e["abandoned_round_ordinal"] for e in mine["events"] if e["action"] == "restart"
    ] == [filed, filed + 1]


def test_other_active_holds_name_the_other_report_for_leads(team):
    first = report(team.bob, team.bob_task.id)
    second = report(team.carol, team.carol_task.id)
    act(
        team.lead, second["report_id"], 1, "extend_hold", "Hold Bob", [team.bob_task.id]
    )
    view = team.lead.get(f"/api/v1/problem-reports/{first['report_id']}").json()
    [hold] = view["holds"]
    assert hold["other_active_holds"] == [{"report_id": second["report_id"]}]


def test_assignment_filter_returns_newest_first(team):
    one = report(team.bob, team.bob_task.id, "One", request_id="r-one")
    act(team.bob, one["report_id"], 1, "resume", "ok", [team.bob_task.id])
    two = report(team.bob, team.bob_task.id, "Two", request_id="r-two")
    listed = team.bob.get(
        f"/api/v1/projects/{team.key}/problem-reports",
        params={"assignment_id": team.bob_task.id},
    ).json()
    assert [r["report_id"] for r in listed] == [two["report_id"], one["report_id"]]
    assert (
        team.bob.get(
            f"/api/v1/projects/{team.key}/problem-reports",
            params={"assignment_id": team.carol_task.id},
        ).json()
        == []
    )


def test_pause_candidates_for_leads_only(team):
    created = report(team.bob, team.bob_task.id)
    rows = team.lead.get(
        f"/api/v1/problem-reports/{created['report_id']}/pause-candidates"
    ).json()
    bob = next(r for r in rows if r["assignment_id"] == team.bob_task.id)
    assert bob["reporter_task"] and bob["paused_by_this_report"] and bob["same_text"]
    assert rows[0]["same_text"] is True
    assert (
        team.bob.get(
            f"/api/v1/problem-reports/{created['report_id']}/pause-candidates"
        ).status_code
        == 404
    )


def test_pause_candidates_skip_tasks_of_deactivated_users(team):
    created = report(team.bob, team.bob_task.id)
    url = f"/api/v1/problem-reports/{created['report_id']}/pause-candidates"
    ids = {r["assignment_id"] for r in team.lead.get(url).json()}
    assert team.carol_task.id in ids
    team.app.state.accounts.set_active(HARNESS, "carol", False)
    ids = {r["assignment_id"] for r in team.lead.get(url).json()}
    assert team.carol_task.id not in ids and team.bob_task.id in ids
