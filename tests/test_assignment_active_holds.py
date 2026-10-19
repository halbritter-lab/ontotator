"""The owner sees each active pause's reason and whether it is their own report."""

from problem_report_team import act, report

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def test_owner_sees_own_report_pause_and_lead_pause_without_other_report_id(team):
    own = report(team.bob, team.bob_task.id, "My problem")
    other = report(team.carol, team.carol_task.id, "Carol problem")
    act(
        team.lead,
        other["report_id"],
        1,
        "extend_hold",
        "Wait for source",
        [team.bob_task.id],
    )
    view = team.bob.get(f"/api/v1/assignments/{team.bob_task.id}").json()
    holds = sorted(view["active_holds"], key=lambda h: h["created_at"])
    assert [(h["reason"], h["own_report_id"]) for h in holds] == [
        ("My problem", own["report_id"]),
        ("Wait for source", None),
    ]
    assert other["report_id"] not in str(view)


def test_lead_listing_does_not_carry_active_holds(team):
    report(team.bob, team.bob_task.id)
    rows = team.lead.get(f"/api/v1/projects/{team.key}/assignments").json()
    assert all(row["active_holds"] == [] for row in rows)
