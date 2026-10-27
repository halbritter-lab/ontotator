"""The reporter never learns about other tasks: IDs, labels, texts or reasons."""

import json

from auth_harness import HARNESS, log_in, logged_in
from pg_harness import tamper
from problem_report_team import act, report

from ontotator.assignments.service import AssignmentService

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")

SECRET = "Lead-only reason for Carol"


def _all_reporter_payloads(team, report_id):
    yield team.bob.get(f"/api/v1/problem-reports/{report_id}").json()
    yield team.bob.get(f"/api/v1/projects/{team.key}/problem-reports").json()
    yield team.bob.get(
        f"/api/v1/projects/{team.key}/problem-reports",
        params={"assignment_id": team.bob_task.id},
    ).json()


def _task_ids(value):
    """Every task ID anywhere in a payload (keys assignment_id, *_assignment_ids, assignment_ids)."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "assignment_id" and isinstance(item, int):
                yield item
            elif key.endswith("assignment_ids") and isinstance(item, list):
                yield from (i for i in item if isinstance(i, int))
            else:
                yield from _task_ids(item)
    elif isinstance(value, list):
        for item in value:
            yield from _task_ids(item)


def _assert_blind(team, payload):
    text = json.dumps(payload)
    assert "ann-0005" not in text
    assert SECRET not in text
    assert team.carol_task.id not in set(_task_ids(payload))


def test_reporter_view_hides_lead_pauses_on_other_tasks_entirely(team):
    created = report(team.bob, team.bob_task.id)
    act(team.lead, created["report_id"], 1, "extend_hold", SECRET, [team.carol_task.id])
    act(
        team.lead,
        created["report_id"],
        2,
        "resume",
        "Carol may go on",
        [team.carol_task.id],
    )
    for payload in _all_reporter_payloads(team, created["report_id"]):
        _assert_blind(team, payload)
    view = team.bob.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    assert view["events"] == []  # both events touched only Carol's task
    assert [h["assignment_id"] for h in view["holds"]] == [team.bob_task.id]
    assert view["held_assignment_ids"] == [team.bob_task.id]


def test_reporter_sees_a_mixed_event_without_the_other_task(team):
    created = report(team.bob, team.bob_task.id)
    act(
        team.lead,
        created["report_id"],
        1,
        "resume",
        "Both continue",
        [team.bob_task.id],
    )
    act(
        team.lead,
        created["report_id"],
        2,
        "extend_hold",
        SECRET,
        [team.bob_task.id, team.carol_task.id],
    )
    view = team.bob.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    paused = view["events"][-1]
    assert (
        paused["action"] == "extend_hold"
        and paused["own_task"] is True
        and paused["affected"] == []
    )
    # The reason is shown to Bob as an affected owner, but Carol is never named.
    _assert_blind(
        team,
        {k: v for k, v in view.items() if k != "events"}
        | {"events": [{**e, "reason": None} for e in view["events"]]},
    )


def test_replayed_reporter_action_is_redacted_too(team):
    created = report(team.bob, team.bob_task.id)
    act(team.lead, created["report_id"], 1, "extend_hold", SECRET, [team.carol_task.id])
    first = act(
        team.bob,
        created["report_id"],
        2,
        "resume",
        "upsi",
        [team.bob_task.id],
        request_id="same",
    )
    again = act(
        team.bob,
        created["report_id"],
        2,
        "resume",
        "upsi",
        [team.bob_task.id],
        request_id="same",
    )
    _assert_blind(team, first)
    _assert_blind(team, again)


def test_unrelated_annotator_gets_report_not_found_for_existing_and_unknown_ids(team):
    created = report(team.bob, team.bob_task.id)
    for report_id in (created["report_id"], "report-does-not-exist"):
        response = team.carol.get(f"/api/v1/problem-reports/{report_id}")
        assert (
            response.status_code == 404
            and response.json()["code"] == "REPORT_NOT_FOUND"
        )
    assert team.carol.get(f"/api/v1/projects/{team.key}/problem-reports").json() == []


def test_unrelated_annotator_cannot_act_and_learns_nothing_about_existence(team):
    created = report(team.bob, team.bob_task.id)
    for report_id in (created["report_id"], "report-does-not-exist"):
        for action in ("resume", "resolve"):
            response = team.carol.post(
                f"/api/v1/problem-reports/{report_id}/actions",
                json={
                    "request_id": f"probe-{action}",
                    "expected_revision": 1,
                    "action": action,
                    "reason": "probe",
                    "assignment_ids": [],
                },
            )
            assert response.status_code == 404, response.text
            assert response.json()["code"] == "REPORT_NOT_FOUND"


def test_demoted_lead_reporter_replay_is_rebuilt_redacted(team):
    dave = logged_in(
        team.app,
        "dave",
        pseudonym="ann-0006",
        projects={team.key: ["lead", "annotator"]},
        assignments=[(team.key, "doc-other", "annotate")],
    )
    dave_task = AssignmentService(team.app.state.repo.db).list(team.key, user="dave")[0]
    created = report(dave, dave_task.id)
    act(dave, created["report_id"], 1, "extend_hold", SECRET, [team.carol_task.id])
    first = act(
        dave, created["report_id"], 2, "resume", "mine", [dave_task.id], request_id="r"
    )
    assert first["viewer_is_lead"] is True and SECRET in json.dumps(first)
    team.app.state.memberships.set_roles(HARNESS, team.key, "dave", ["annotator"])
    log_in(dave, "dave")
    again = act(
        dave, created["report_id"], 2, "resume", "mine", [dave_task.id], request_id="r"
    )
    assert again["viewer_is_lead"] is False
    _assert_blind(team, again)


def test_legacy_shape_receipt_is_rebuilt(team):
    created = report(team.bob, team.bob_task.id)
    act(team.bob, created["report_id"], 1, "resume", "ok", request_id="legacy")
    legacy = {
        "report_id": created["report_id"],
        "reason": "stale",
        "events": [{"details": {"assignment_ids": [team.carol_task.id]}}],
    }
    tamper(
        team.app.state.repo.db,
        "workflow_command_receipts",
        "UPDATE ontotator.workflow_command_receipts"
        " SET response = CAST(:response AS jsonb) WHERE request_id = 'legacy'",
        response=json.dumps(legacy),
    )
    again = act(team.bob, created["report_id"], 1, "resume", "ok", request_id="legacy")
    assert again["viewer_label"] == "ann-0004" and again["viewer_is_lead"] is False
    assert again["reason"] == "Text is cut off after paragraph 2"
    assert again["state"] == "open" and again["revision"] == 2
    _assert_blind(team, again)
