"""R-26: the reporter sees that a lead answered their report until they open it."""

from problem_report_team import act, report

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def _answered(client, task_id: int) -> bool:
    tasks = client.get("/api/v1/me/tasks").json()
    return next(t for t in tasks if t["assignment_id"] == task_id)["report_answered"]


def test_lead_answer_shows_until_the_reporter_opens_the_report(team):
    created = report(team.bob, team.bob_task.id)
    rid = created["report_id"]
    assert created["answered"] is False
    assert _answered(team.bob, team.bob_task.id) is False
    # A pause of another task stays hidden from the reporter: no answer.
    act(team.lead, rid, 1, "extend_hold", "Wait", [team.carol_task.id])
    assert _answered(team.bob, team.bob_task.id) is False
    # The reporter's own action is no answer either.
    act(team.bob, rid, 2, "resume", "Continue", [team.bob_task.id])
    assert _answered(team.bob, team.bob_task.id) is False
    act(team.lead, rid, 3, "resolve", "Source fixed")
    assert _answered(team.bob, team.bob_task.id) is True
    assert team.bob.get(f"/api/v1/problem-reports/{rid}").json()["answered"] is True
    # The lead's own view never carries the reporter's flag.
    assert team.lead.get(f"/api/v1/problem-reports/{rid}").json()["answered"] is False

    seen = team.bob.post(f"/api/v1/problem-reports/{rid}/seen")
    assert seen.status_code == 200, seen.text
    assert seen.json()["answered"] is False and seen.json()["state"] == "resolved"
    assert _answered(team.bob, team.bob_task.id) is False

    act(team.lead, rid, 4, "reopen", "Not fixed after all")
    assert _answered(team.bob, team.bob_task.id) is True


def test_others_can_neither_read_nor_mark_someone_elses_report(team):
    rid = report(team.bob, team.bob_task.id)["report_id"]
    act(team.lead, rid, 1, "resolve", "Source fixed")
    for client in (team.carol, team.lead):
        response = client.post(f"/api/v1/problem-reports/{rid}/seen")
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "REPORT_NOT_FOUND"
    assert team.carol.get(f"/api/v1/problem-reports/{rid}").status_code == 404
    # Neither attempt marked the report seen, and Carol's tasks carry no flag.
    assert _answered(team.bob, team.bob_task.id) is True
    assert not any(
        t["report_answered"] for t in team.carol.get("/api/v1/me/tasks").json()
    )
