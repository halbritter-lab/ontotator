"""Removing a role lists and revokes all work that rests on it."""

from typing import Any

import pytest
from auth_harness import HARNESS
from sqlalchemy import select, update
from work_plan_support import assign, doc, plan_all, plan_env

from ontotator.domain.errors import DomainError
from ontotator.storage.tables import AssignmentRow


@pytest.fixture
def env(tmp_path: Any) -> Any:
    env = plan_env(tmp_path)
    plan_all(env.db, "proj")
    return env


def _revoked(env: Any, assignment_id: int) -> bool:
    with env.db.transaction() as conn:
        return (
            conn.execute(
                select(AssignmentRow.revoked_at).where(
                    AssignmentRow.id == assignment_id
                )
            ).scalar_one()
            is not None
        )


def test_removing_a_member_lists_and_revokes_open_translation_reviews(env: Any) -> None:
    review = assign(env, doc("c1", "de"), "anno", "translation_review")
    annotation = assign(env, doc("c1", "en"), "anno", "annotate")
    members = env.app.state.memberships

    with pytest.raises(DomainError) as refused:
        members.set_roles(HARNESS, "proj", "anno", [])
    assert refused.value.code == "MEMBER_HAS_ASSIGNMENTS"
    assert {
        (item["id"], item["task"]) for item in refused.value.details["assignments"]
    } == {(review, "translation_review"), (annotation, "annotate")}

    members.set_roles(HARNESS, "proj", "anno", [], revoke_assignments=True)
    assert _revoked(env, review) and _revoked(env, annotation)


def test_a_lead_correction_does_not_rest_on_the_annotator_role(env: Any) -> None:
    review = assign(env, doc("c1", "de"), "anno", "translation_review")
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == review)
            .values(lead_correction=True)
        )
    members = env.app.state.memberships
    members.set_roles(HARNESS, "proj", "anno", ["adjudicator"])
    assert not _revoked(env, review)
