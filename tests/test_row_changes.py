"""History of a text names reassignments and mode changes."""

from typing import Any

from sqlalchemy import insert, select
from work_plan_support import BASE, assign, doc, plan_env

from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.storage.mode_change_tables import AnnotationModeChangeRow
from ontotator.storage.tables import UserRow


def _changes(env: Any) -> list[dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows/c1/en/submissions")
    assert response.status_code == 200, response.text
    return list(response.json()["changes"])


def test_a_reassignment_shows_who_it_went_from_and_to(tmp_path: Any) -> None:
    env = plan_env(tmp_path)
    first = assign(env, doc("c1", "en"), "anno", "annotate")
    lead = env.app.state.accounts.get_by_username("leader")
    AssignmentService(env.db).reassign(
        Actor(lead.id, "user:leader"), first, username="anno2"
    )
    [change] = _changes(env)
    assert change["kind"] == "reassigned" and change["task"] == "annotate"
    assert change["from_person"]["display_name"] == "Anne Notator"
    assert change["to_person"]["display_name"] == "Arne Notator"


def test_a_mode_change_and_its_restore_keep_the_reason(tmp_path: Any) -> None:
    env = plan_env(tmp_path)
    with env.db.transaction() as conn:
        lead = conn.execute(
            select(UserRow.id).where(UserRow.username == "leader")
        ).scalar_one()
        conn.execute(
            insert(AnnotationModeChangeRow).values(
                project_id=env.pid,
                case_id="c1",
                language="en",
                from_mode="proposals",
                to_mode="scratch",
                reason="The proposals were wrong.",
                changed_by=lead,
            )
        )
    [change] = _changes(env)
    assert (change["kind"], change["to_mode"], change["reason"]) == (
        "mode_changed",
        "scratch",
        "The proposals were wrong.",
    )
