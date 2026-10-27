"""Effects of the work plan on assignment, distribution, warnings and export."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import select
from work_plan_support import (
    BASE,
    assign,
    doc,
    plan_env,
    preflight,
    select_final,
    service,
    set_rule,
    submit,
    write,
)

from ontotator.api.work_plan_routes import AcceptExternalReview, PlanRowPatch
from ontotator.assignments.proposals import DistributionService
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.domain.document_rows import AssignmentFact, missing_final_counts
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage.final_tables import ExportSelectionSnapshotRow


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def lead_actor(env: Any) -> Actor:
    return Actor(env.app.state.accounts.get_by_username("leader").id, "user:leader")


def refusal(call: Any) -> str:
    with pytest.raises(DomainError) as caught:
        call()
    return caught.value.code


def test_assignment_refused_when_not_in_plan(env):
    set_rule(env.db, False)
    write(env, {RowKey("c2", "fr"): PlanFlags(True, True)})
    for document_id, username, task in (
        (doc("c1", "de"), "anno", "annotate"),
        (doc("c1", "de"), "ana", "translation_review"),
        (doc("c1", "de"), "adj", "review"),
    ):
        assert refusal(
            lambda d=document_id, u=username, t=task: assign(env, d, u, t)
        ) == ("NOT_IN_WORK_PLAN"), task
    service(env).discard("proj", doc("c2", "fr"), "Wrong language", True)
    write(env, {RowKey("c2", "fr"): PlanFlags(True, True)})
    for username, task in (("anno", "annotate"), ("ana", "translation_review")):
        assert (
            refusal(lambda u=username, t=task: assign(env, doc("c2", "fr"), u, t))
            == "NOT_IN_WORK_PLAN"
        )
    # The source row is planned for annotation and stays assignable.
    assert assign(env, doc("c1", "en"), "anno", "annotate") > 0


def test_reopen_reassign_and_exact_retry_bypass_plan(env):
    first = assign(env, doc("c1", "en"), "anno", "annotate")
    write(env, {RowKey("c1", "en"): PlanFlags(False, False)})
    assignments = AssignmentService(env.db)
    moved = assignments.reassign(lead_actor(env), first, "anno2", confirm_language=True)
    assert moved.user_id != 0 and moved.document_id == doc("c1", "en")
    assert assign(env, doc("c1", "en"), "anno2", "annotate") == moved.id
    submit(env, moved.id, "s-reopen")
    reopened = assignments.reopen(lead_actor(env), moved.id, "Fix a span")
    assert reopened.status == "reopened"
    assert refusal(lambda: assign(env, doc("c1", "en"), "anno", "annotate")) == (
        "NOT_IN_WORK_PLAN"
    )


def test_missing_final_respects_annotations_per_text():
    done = AssignmentFact(1, "d", "annotate", "submitted", False, False, "a", 1, None)
    open_ = AssignmentFact(2, "d", "annotate", "open", False, False, "b", 2, None)
    assert not missing_final_counts(
        has_selection=False, submission_count=1, assignments=[done, open_], per_text=2
    )
    assert not missing_final_counts(
        has_selection=False, submission_count=1, assignments=[done], per_text=2
    )
    assert missing_final_counts(
        has_selection=False, submission_count=2, assignments=[done], per_text=2
    )
    assert missing_final_counts(
        has_selection=False, submission_count=1, assignments=[done]
    )


def test_distribution_snapshot_skips_rows_out_of_plan(env):
    set_rule(env.db, False)
    prepared = DistributionService(env.db).propose(
        lead_actor(env), "proj", [doc("c1", "de"), doc("c1", "en")], "annotate", seed=1
    )
    reasons = {item.document_id: item.reason for item in prepared.proposal.unassignable}
    assert reasons[doc("c1", "de")] == "NOT_IN_WORK_PLAN"
    # The planned source row is only limited by the members' languages.
    assert reasons.get(doc("c1", "en")) != "NOT_IN_WORK_PLAN"
    response = env.lead.post(
        f"{BASE}/assignments/proposal",
        json={"document_ids": [doc("c1", "de")], "task": "annotate", "seed": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["unassignable"][0]["reason"] == "NOT_IN_WORK_PLAN"


def test_translation_not_accepted_rule_unchanged(env):
    write(env, {RowKey("c1", "de"): PlanFlags(False, True)})
    assert refusal(lambda: assign(env, doc("c1", "de"), "anno", "annotate")) == (
        "TRANSLATION_NOT_ACCEPTED"
    )
    service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(
            annotate=True,
            expected_revision=3,
            accept_external_review=AcceptExternalReview(reason="Reviewed by Dr. X"),
        ),
    )
    assert assign(env, doc("c1", "de"), "anno", "annotate") > 0


def test_preflight_and_export_only_cover_annotate_rows(env):
    for case in ("c1", "c2"):
        aid = assign(env, doc(case, "en"), "anno", "annotate")
        submit(env, aid, f"s-{case}")
        select_final(env, doc(case, "en"), f"s-{case}")
    write(env, {RowKey("c1", "en"): PlanFlags(False, False)})
    state = preflight(env)
    assert [s["submission_id"] for s in state["selections"]] == ["s-c2"]
    assert state["not_in_plan"] == [{"case_id": "c1", "language": "en"}]
    assert {"case_id": "c1", "language": "en"} not in state["omissions"]
    assert not [
        w for w in state["warnings"] if (w["case_id"], w["language"]) == ("c1", "en")
    ]
    # Translations are not planned for annotation in this fixture either.
    assert all(o["language"] == "en" for o in state["omissions"])
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": "plan-scope",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    with env.db.transaction() as conn:
        payload = conn.execute(
            select(ExportSelectionSnapshotRow.payload).where(
                ExportSelectionSnapshotRow.request_id == "plan-scope"
            )
        ).scalar_one()
    assert payload["selected_submission_ids"] == ["s-c2"]
    assert [s["submission_id"] for s in payload["state"]["selections"]] == ["s-c2"]


def test_project_settings_round_trip(env):
    for value in range(1, 6):
        saved = env.lead.patch(f"{BASE}/settings", json={"annotations_per_text": value})
        assert saved.status_code == 200, saved.text
        assert saved.json()["annotations_per_text"] == value
    refused = env.lead.patch(f"{BASE}/settings", json={"annotations_per_text": 6})
    assert refused.status_code == 422, refused.text
    assert env.lead.get(f"{BASE}/settings").json()["annotations_per_text"] == 5
    plan = env.lead.patch(f"{BASE}/settings", json={"import_plan": "nothing"})
    assert plan.status_code == 200, plan.text
    current = env.lead.get(f"{BASE}/settings").json()
    assert current["import_plan"] == "nothing"
    assert current["annotations_per_text"] == 5
