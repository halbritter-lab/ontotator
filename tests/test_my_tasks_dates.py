"""My tasks carry the annotation mode and the assignment date (spec 2026-10-23 §2)."""

from __future__ import annotations

from typing import Any

from proposal_check_support import assign, client, proposal_env
from work_plan_support import assign as assign_task
from work_plan_support import doc, plan_env

from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage import work_plan_store as store


def tasks(test_client: Any) -> dict[str, dict[str, Any]]:
    response = test_client.get("/api/v1/me/tasks")
    assert response.status_code == 200, response.text
    return {item["document_id"]: item for item in response.json()}


def test_my_tasks_show_mode_and_assignment_date(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    assign(env, env.c2, "anno")
    found = tasks(client(env, "anno"))
    assert found[env.c1]["annotation_mode"] == "proposals"
    assert found[env.c2]["annotation_mode"] == "scratch"
    assert found[env.c1]["assigned_at"] is not None
    assert found[env.c2]["assigned_at"] is not None
    # The text name's version and origin (R-11).
    assert found[env.c1]["version"] == 1
    assert found[env.c1]["origin"] == "native"


def test_translation_review_task_has_no_annotation_mode(tmp_path):
    from auth_harness import logged_in

    env = plan_env(tmp_path)
    with env.db.transaction() as conn:
        store.write_rows(
            conn, env.pid, {RowKey("c1", "de"): PlanFlags(True, False)}, actor_id=None
        )
    assign_task(env, doc("c1", "de"), "ana", "translation_review")
    item = tasks(logged_in(env.app, "ana", assignments=[]))[doc("c1", "de")]
    assert item["task"] == "translation_review"
    assert item["annotation_mode"] is None
    assert item["assigned_at"] is not None
