"""Person references in problem reports (F4, D1): names for leads, pseudonyms for others."""

import json

from problem_report_team import act, report
from sqlalchemy import update

from ontocurator.storage.tables import UserRow

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")

NAMES = {"alice": "Alice Lead", "bob": "Bob Berger", "carol": "Carol Clark"}


def _name_everyone(team):
    with team.app.state.repo.db.transaction() as conn:
        for username, name in NAMES.items():
            conn.execute(
                update(UserRow)
                .where(UserRow.username == username)
                .values(display_name=name)
            )


def _scenario(team):
    """Bob reports, resumes his own task; the lead pauses Carol and resolves."""
    _name_everyone(team)
    created = report(team.bob, team.bob_task.id)
    rid = created["report_id"]
    act(team.bob, rid, 1, "resume", "upsi", [team.bob_task.id])
    act(team.lead, rid, 2, "extend_hold", "Wait for Carol", [team.carol_task.id])
    act(team.lead, rid, 3, "extend_hold", "Pause Bob again", [team.bob_task.id])
    act(team.lead, rid, 4, "resolve", "Source fixed")
    return rid


def _ref(pseudonym, name=None, me=False):
    return {"pseudonym": pseudonym, "display_name": name, "is_me": me}


BOB = "ann-0004"
CAROL = "ann-0005"
LEAD = "own-reviewer"


def test_lead_sees_names_for_reporter_holds_candidates_events(team):
    rid = _scenario(team)
    view = team.lead.get(f"/api/v1/problem-reports/{rid}").json()
    assert view["reporter"] == _ref(BOB, "Bob Berger")
    assert view["state_changed_by"] == _ref(LEAD, "Alice Lead", me=True)
    holds = sorted(view["holds"], key=lambda h: h["created_at"])
    assert [h["owner"] for h in holds] == [
        _ref(BOB, "Bob Berger"),
        _ref(CAROL, "Carol Clark"),
        _ref(BOB, "Bob Berger"),
    ]
    assert [h["created_by"] for h in holds] == [
        _ref(BOB, "Bob Berger"),
        _ref(LEAD, "Alice Lead", me=True),
        _ref(LEAD, "Alice Lead", me=True),
    ]
    assert holds[0]["released_by"] == _ref(BOB, "Bob Berger")
    assert holds[1]["released_by"] is None
    assert [e["actor"] for e in view["events"]] == [
        _ref(BOB, "Bob Berger"),
        _ref(LEAD, "Alice Lead", me=True),
        _ref(LEAD, "Alice Lead", me=True),
        _ref(LEAD, "Alice Lead", me=True),
    ]
    rows = team.lead.get(f"/api/v1/problem-reports/{rid}/pause-candidates").json()
    owners = {r["assignment_id"]: r["owner"] for r in rows}
    assert owners[team.bob_task.id]["display_name"] == "Bob Berger"
    assert owners[team.carol_task.id] == _ref(CAROL, "Carol Clark")
    listed = team.lead.get(f"/api/v1/projects/{team.key}/problem-reports").json()
    assert listed[0]["reporter"] == _ref(BOB, "Bob Berger")


def test_reporter_sees_only_pseudonyms_of_others_and_own_name_marked_is_me(team):
    rid = _scenario(team)
    view = team.bob.get(f"/api/v1/problem-reports/{rid}").json()
    assert view["reporter"] == _ref(BOB, "Bob Berger", me=True)
    assert view["state_changed_by"] == _ref(LEAD)
    holds = sorted(view["holds"], key=lambda h: h["created_at"])
    assert [h["owner"] for h in holds] == [_ref(BOB, "Bob Berger", me=True)] * 2
    assert [h["created_by"] for h in holds] == [
        _ref(BOB, "Bob Berger", me=True),
        _ref(LEAD),
    ]
    assert holds[0]["released_by"] == _ref(BOB, "Bob Berger", me=True)
    actors = [e["actor"] for e in view["events"]]
    assert actors[0] == _ref(BOB, "Bob Berger", me=True)
    assert all(a == _ref(LEAD) for a in actors[1:]) and actors[1:]


def test_labels_unchanged(team):
    rid = _scenario(team)
    for client in (team.lead, team.bob):
        view = client.get(f"/api/v1/problem-reports/{rid}").json()
        assert view["reporter_label"] == BOB
        assert view["state_changed_by_label"] == LEAD
        assert view["viewer_label"] == (LEAD if client is team.lead else BOB)
        for hold in view["holds"]:
            assert hold["owner_label"] == hold["owner"]["pseudonym"]
            assert hold["created_by_label"] == hold["created_by"]["pseudonym"]
            released = hold["released_by"]
            assert hold["released_by_label"] == (released and released["pseudonym"])
        for event in view["events"]:
            assert event["actor_label"] == event["actor"]["pseudonym"]
    rows = team.lead.get(f"/api/v1/problem-reports/{rid}/pause-candidates").json()
    assert all(r["owner_label"] == r["owner"]["pseudonym"] for r in rows)


def test_blinding_rules_still_hold(team):
    rid = _scenario(team)
    payloads = [
        team.bob.get(f"/api/v1/problem-reports/{rid}").json(),
        team.bob.get(f"/api/v1/projects/{team.key}/problem-reports").json(),
    ]
    for payload in payloads:
        text = json.dumps(payload)
        assert "Alice Lead" not in text and "Carol Clark" not in text
        assert CAROL not in text
    # Carol (no report of her own) learns nothing; a third annotator sees no names.
    assert team.carol.get(f"/api/v1/problem-reports/{rid}").status_code == 404
