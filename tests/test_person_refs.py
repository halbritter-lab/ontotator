"""Identity (D1): person references for leads, member workload, My tasks case ID."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from auth_harness import grant, logged_in
from sqlalchemy import insert, update
from work_plan_support import BASE, assign, doc, plan_env, select_final, submit, write

from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage.tables import DocumentRow
from ontocurator.storage.workflow_tables import (
    ProblemReportRow,
    ProblemReportStateRow,
    WorkRoundRow,
    WorkRoundStateRow,
)

BOTH = PlanFlags(True, True)
REVIEW = PlanFlags(True, False)


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _user(env: Any, username: str) -> Any:
    return env.app.state.accounts.get_by_username(username)


def ref(env: Any, username: str, display_name: str, *, is_me: bool = False):
    return {
        "pseudonym": _user(env, username).pseudonym,
        "display_name": display_name,
        "is_me": is_me,
    }


def set_status(env: Any, document_id: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document_id)
            .values(translation_status=status)
        )


def add_round(env: Any, assignment_id: int, document_id: str, username: str) -> None:
    now = datetime.now(UTC)
    with env.db.transaction() as conn:
        conn.execute(
            insert(WorkRoundRow).values(
                round_id=f"round-{assignment_id}",
                project_id=env.pid,
                assignment_id=assignment_id,
                document_id=document_id,
                annotator_id=_user(env, username).pseudonym,
                kind="annotation",
                mode="independent",
                input_manifest_sha256="0" * 64,
                input_submission_ids=[],
                workspace_key=None,
                created_at=now,
            )
        )
        conn.execute(
            insert(WorkRoundStateRow).values(
                round_id=f"round-{assignment_id}", state="editable"
            )
        )


def add_report(env: Any, assignment_id: int, username: str) -> str:
    report_id = f"report-{assignment_id}"
    with env.db.transaction() as conn:
        conn.execute(
            insert(ProblemReportRow).values(
                report_id=report_id,
                project_id=env.pid,
                assignment_id=assignment_id,
                reporter_id=_user(env, username).id,
                reason="The text is cut off",
                created_at=datetime.now(UTC),
            )
        )
        conn.execute(
            insert(ProblemReportStateRow).values(
                report_id=report_id, state="open", revision=1
            )
        )
    return report_id


def rows(client: Any) -> dict[tuple[str, str], dict[str, Any]]:
    response = client.get(f"{BASE}/document-rows")
    assert response.status_code == 200, response.text
    return {
        (row["case_id"], row["language"]): row
        for group in response.json()["groups"]
        for row in group["rows"]
    }


def submissions(client: Any, case_id: str, language: str) -> dict[str, Any]:
    response = client.get(f"{BASE}/document-rows/{case_id}/{language}/submissions")
    assert response.status_code == 200, response.text
    return dict(response.json())


def scenario(env: Any, username: str) -> None:
    """``username`` reviews c1 de, annotates c1 en (final, round) and reports on c2 en."""
    write(env, {RowKey("c1", "de"): REVIEW})
    set_status(env, doc("c1", "de"), "ready_for_review")
    assign(env, doc("c1", "de"), username, "translation_review")
    annotate = assign(env, doc("c1", "en"), username, "annotate")
    add_round(env, annotate, doc("c1", "en"), username)
    submit(env, annotate, f"s-{username}")
    select_final(env, doc("c1", "en"), f"s-{username}")
    reported = assign(env, doc("c2", "en"), username, "annotate")
    add_report(env, reported, username)


def assert_refs(env: Any, client: Any, expected: dict[str, Any]) -> None:
    by_row = rows(client)
    en = by_row[("c1", "en")]
    assert en["work"][0]["person"] == expected
    assert en["final"]["author"] == expected
    assert by_row[("c1", "de")]["work"][0]["person"] == expected
    reported = by_row[("c2", "en")]
    assert reported["problem_reports"][0]["reporter"] == expected
    issue = next(i for i in reported["issues"] if i["code"] == "OPEN_PROBLEM_REPORT")
    assert issue["report"]["reporter"] == expected
    en_subs = submissions(client, "c1", "en")
    assert en_subs["submissions"][0]["author"] == expected
    assert en_subs["rounds"][0]["author"] == expected
    de_subs = submissions(client, "c1", "de")
    assert de_subs["open_translation_reviews"][0]["reviewer"] == expected


def test_lead_sees_display_names_of_others(env):
    scenario(env, "ana")
    expected = ref(env, "ana", "Ana Weber")
    assert_refs(env, env.lead, expected)
    # The existing labels stay (pseudonyms).
    en = rows(env.lead)[("c1", "en")]
    assert en["work"][0]["author_label"] == expected["pseudonym"]


def test_lead_own_items_are_marked_is_me(env):
    assert grant(env.app, "leader", "proj", ["lead", "annotator"])
    lead = logged_in(env.app, "leader", assignments=[])
    env.lead = lead
    scenario(env, "leader")
    name = _user(env, "leader").display_name
    assert_refs(env, lead, ref(env, "leader", name, is_me=True))


def members(client: Any) -> dict[str, dict[str, Any]]:
    response = client.get(f"{BASE}/members")
    assert response.status_code == 200, response.text
    return {member["pseudonym"]: member for member in response.json()}


def test_members_hide_other_display_names_from_non_leads(env):
    annotator = logged_in(env.app, "anno", assignments=[])
    seen = members(annotator)
    own = seen.pop(_user(env, "anno").pseudonym)
    assert (own["username"], own["display_name"]) == ("anno", "Anne Notator")
    assert seen and all(
        (m["username"], m["display_name"]) == ("", "") for m in seen.values()
    )
    ana = _user(env, "ana").pseudonym
    assert ana in seen
    by_lead = members(env.lead)
    assert (by_lead[ana]["username"], by_lead[ana]["display_name"]) == (
        "ana",
        "Ana Weber",
    )
    assert all(m["username"] for m in by_lead.values())


def test_members_carry_open_tasks(tmp_path):
    env = plan_env(tmp_path, rule_on=False)
    write(
        env,
        {RowKey(c, lang): BOTH for c in ("c1", "c2") for lang in ("de", "fr")},
    )
    set_status(env, doc("c1", "fr"), "ready_for_review")
    assign(env, doc("c1", "fr"), "ana", "translation_review")
    assign(env, doc("c1", "en"), "ana", "annotate")
    assign(env, doc("c2", "en"), "ana", "annotate")
    submitted = assign(env, doc("c1", "de"), "ana", "annotate")
    submit(env, submitted, "s-ana-c1-de")
    revoked = assign(env, doc("c2", "de"), "ana", "annotate")
    lead = _user(env, "leader")
    AssignmentService(env.db).revoke(Actor(lead.id, "user:leader"), revoked)
    by_lead = members(env.lead)
    assert by_lead[_user(env, "ana").pseudonym]["open_tasks"] == {
        "translation_review": 1,
        "annotate": 2,
        "review": 0,
    }
    assert by_lead[_user(env, "ben").pseudonym]["open_tasks"] == {
        "translation_review": 0,
        "annotate": 0,
        "review": 0,
    }


def test_my_tasks_carry_case_id(env):
    aid = assign(env, doc("c2", "en"), "anno", "annotate")
    client = logged_in(env.app, "anno", assignments=[])
    response = client.get("/api/v1/me/tasks")
    assert response.status_code == 200, response.text
    task = next(t for t in response.json() if t["assignment_id"] == aid)
    assert task["case_id"] == "c2"
