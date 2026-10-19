"""Withdraw, reopen, recorded releases; holds are never lifted silently."""

from problem_report_team import act, held, report
from sqlalchemy import select

from ontocurator.storage.workflow_tables import TaskHoldRow, TaskHoldStateRow

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def _hold_states(app, report_id):
    with app.state.repo.db.transaction() as conn:
        return [
            dict(r)
            for r in conn.execute(
                select(
                    TaskHoldRow.assignment_id,
                    TaskHoldStateRow.active,
                    TaskHoldStateRow.release_action,
                    TaskHoldStateRow.release_event_id,
                    TaskHoldStateRow.released_by,
                    TaskHoldStateRow.released_at,
                )
                .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                .where(TaskHoldRow.report_id == report_id)
                .order_by(TaskHoldRow.created_at)
            ).mappings()
        ]


def test_reporter_withdraws_untouched_report_and_only_own_pause_is_released(team):
    created = report(team.bob, team.bob_task.id)
    withdrawn = act(
        team.bob, created["report_id"], 1, "withdraw", "Reported by mistake"
    )
    assert withdrawn["state"] == "withdrawn" and withdrawn["resolution"] is None
    assert held(team.app, team.bob_task.id) == (False, None)
    [state] = _hold_states(team.app, created["report_id"])
    assert state["active"] is False and state["release_action"] == "withdraw"
    assert state["release_event_id"] and state["released_at"] is not None


def test_withdraw_after_own_resume_is_allowed_and_releases_nothing_more(team):
    created = report(team.bob, team.bob_task.id)
    act(team.bob, created["report_id"], 1, "resume", "upsi", [team.bob_task.id])
    withdrawn = act(team.bob, created["report_id"], 2, "withdraw", "By mistake")
    assert withdrawn["state"] == "withdrawn"
    [state] = _hold_states(team.app, created["report_id"])
    assert state["release_action"] == "resume"  # first release record kept


def test_withdraw_is_refused_after_any_lead_action_and_for_non_reporters(team):
    created = report(team.bob, team.bob_task.id)
    denied = act(team.lead, created["report_id"], 1, "withdraw", "Not mine", status=403)
    assert denied["code"] == "NOT_ALLOWED"
    act(
        team.lead,
        created["report_id"],
        1,
        "extend_hold",
        "Pause too",
        [team.carol_task.id],
    )
    refused = act(
        team.bob, created["report_id"], 2, "withdraw", "By mistake", status=409
    )
    assert refused["details"] == {"reason": "REPORT_LEAD_ACTED"}


def test_lead_reopens_closed_and_withdrawn_reports_without_pausing_again(team):
    created = report(team.bob, team.bob_task.id)
    act(team.bob, created["report_id"], 1, "withdraw", "By mistake")
    reopened = act(team.lead, created["report_id"], 2, "reopen", "Still a problem")
    assert reopened["state"] == "open" and reopened["held_assignment_ids"] == []
    assert held(team.app, team.bob_task.id) == (False, None)
    assert act(team.bob, created["report_id"], 3, "withdraw", "Again", status=409)[
        "details"
    ] == {"reason": "REPORT_LEAD_ACTED"}
    act(team.lead, created["report_id"], 3, "resolve", "Fixed the source text")
    again = act(team.lead, created["report_id"], 4, "reopen", "Came back")
    assert again["state"] == "open" and again["resolution"] is None
    assert act(team.lead, created["report_id"], 5, "reopen", "Twice", status=409)[
        "details"
    ] == {"reason": "REPORT_OPEN"}
    assert (
        act(team.bob, created["report_id"], 5, "reopen", "Me", status=403)["code"]
        == "NOT_ALLOWED"
    )


def test_closed_and_withdrawn_reports_accept_only_resume_and_reopen(team):
    created = report(team.bob, team.bob_task.id)
    act(team.lead, created["report_id"], 1, "resolve", "Outcome")
    for action in ("resolve", "extend_hold", "restart"):
        refused = act(
            team.lead,
            created["report_id"],
            2,
            action,
            "x",
            [team.carol_task.id],
            status=409,
        )
        assert refused["details"] == {"reason": "REPORT_RESOLVED"}
    resumed = act(
        team.lead, created["report_id"], 2, "resume", "Continue", [team.bob_task.id]
    )
    assert resumed["state"] == "resolved"
    [state] = _hold_states(team.app, created["report_id"])
    assert state["release_action"] == "resume" and state["released_by"] is not None


def test_release_from_one_report_never_lifts_another_reports_pause(team):
    first = report(team.bob, team.bob_task.id, "First problem")
    second = report(team.carol, team.carol_task.id, "Second problem")
    act(
        team.lead,
        second["report_id"],
        1,
        "extend_hold",
        "Hold Bob as well",
        [team.bob_task.id],
    )
    act(team.lead, first["report_id"], 1, "resume", "First is fine", [team.bob_task.id])
    assert held(team.app, team.bob_task.id) == (True, "Hold Bob as well")
    assert any(
        s["active"]
        for s in _hold_states(team.app, second["report_id"])
        if s["assignment_id"] == team.bob_task.id
    )
    # Report-level actions never touch any hold.
    act(team.lead, first["report_id"], 2, "resolve", "Done")
    act(team.lead, first["report_id"], 3, "reopen", "Not done")
    assert held(team.app, team.bob_task.id) == (True, "Hold Bob as well")


def test_restart_is_atomic_when_another_report_pauses_the_task(team):
    first = report(team.bob, team.bob_task.id, "First problem")
    second = report(team.carol, team.carol_task.id, "Second problem")
    act(
        team.lead, second["report_id"], 1, "extend_hold", "Hold Bob", [team.bob_task.id]
    )
    refused = act(
        team.lead,
        first["report_id"],
        1,
        "restart",
        "Agreed",
        [team.bob_task.id],
        status=409,
    )
    assert refused["code"] == "TASK_HELD"
    assert held(team.app, team.bob_task.id)[0] is True
    assert all(s["active"] for s in _hold_states(team.app, first["report_id"]))
    act(team.lead, second["report_id"], 2, "resume", "Released", [team.bob_task.id])
    restarted = act(
        team.lead, first["report_id"], 1, "restart", "Agreed", [team.bob_task.id]
    )
    assert restarted["state"] == "resolved" and restarted["new_round"] is not None
    assert [
        s["release_action"] for s in _hold_states(team.app, first["report_id"])
    ] == ["restart"]


def test_replayed_withdraw_returns_the_same_result(team):
    created = report(team.bob, team.bob_task.id)
    one = act(
        team.bob, created["report_id"], 1, "withdraw", "By mistake", request_id="w-1"
    )
    two = act(
        team.bob, created["report_id"], 1, "withdraw", "By mistake", request_id="w-1"
    )
    assert one == two
