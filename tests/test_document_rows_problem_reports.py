"""Documents rows list every problem report of the row, open and closed."""

from datetime import datetime

from problem_report_team import act, report

from ontocurator.application.document_row_reports import report_title

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def _row_of(client, key: str, document_id: str) -> dict:
    page = client.get(f"/api/v1/projects/{key}/document-rows")
    assert page.status_code == 200, page.text
    return next(
        row
        for group in page.json()["groups"]
        for row in group["rows"]
        if any(v["document_id"] == document_id for v in row["versions"])
    )


def test_row_lists_closed_and_withdrawn_reports_newest_first(team):
    first = report(team.bob, team.bob_task.id, "Text is cut off\nafter paragraph 2")
    act(team.lead, first["report_id"], 1, "resolve", "Fixed the source text")
    second = report(team.bob, team.bob_task.id, "Wrong language " + "x" * 90)
    act(team.bob, second["report_id"], 1, "withdraw", "Reported by mistake")

    row = _row_of(team.lead, team.key, "doc-1")
    reports = row["problem_reports"]
    assert [item["report_id"] for item in reports] == [
        second["report_id"],
        first["report_id"],
    ]
    assert [item["state"] for item in reports] == ["withdrawn", "resolved"]
    assert set(reports[0]) == {
        "report_id",
        "title",
        "reporter_label",
        "created_at",
        "state",
        "active_hold_count",
        "reporter",
    }
    assert reports[1]["title"] == "Text is cut off"
    assert reports[0]["title"] == "Wrong language…"
    assert {item["reporter_label"] for item in reports} == {"ann-0004"}
    # Closing a report never lifts its pause; withdrawing releases it.
    assert [item["active_hold_count"] for item in reports] == [0, 1]
    assert datetime.fromisoformat(reports[0]["created_at"]) >= datetime.fromisoformat(
        reports[1]["created_at"]
    )
    # Closed reports add no issue: Documents' issue logic is unchanged.
    assert not any(i["code"] == "OPEN_PROBLEM_REPORT" for i in row["issues"])

    other = _row_of(team.lead, team.key, "doc-other")
    assert other["problem_reports"] == []


def test_open_report_counts_its_active_pauses(team):
    created = report(team.bob, team.bob_task.id)
    act(
        team.lead,
        created["report_id"],
        1,
        "extend_hold",
        "Pause too",
        [team.carol_task.id],
    )
    [item] = _row_of(team.lead, team.key, "doc-1")["problem_reports"]
    assert item["state"] == "open" and item["active_hold_count"] == 2
    assert item["title"] == "Text is cut off after paragraph 2"


def test_title_rule_matches_the_client():
    assert report_title("  short line \nsecond") == "short line"
    assert report_title("a" * 80) == "a" * 80
    assert report_title("a" * 80 + " tail") == "a" * 80 + "…"
    assert report_title("word " * 20) == ("word " * 16).strip() + "…"
    assert report_title("b" * 100) == "b" * 80 + "…"
    assert report_title("") == ""
