"""D1: the assignable "Annotation review" task, the ``assisted`` mode and
ordinary review rounds are gone; consolidation keeps the review machinery."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from pg_harness import owner_engine
from sqlalchemy import func, select
from test_consolidation_start_api import URL, body, review_assignments
from test_consolidation_start_api import env as consolidation_env
from test_legacy_removal_migration import _purge_script
from work_plan_support import BASE, assign, doc

from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access, allowed_modes
from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import AssignmentRow, DraftRow, EditEventRow


@pytest.fixture
def env(tmp_path):
    return consolidation_env.__wrapped__(tmp_path)


def test_review_task_is_not_assignable(env) -> None:
    leader = env.app.state.accounts.get_by_username("leader")
    with pytest.raises(DomainError) as refused:
        AssignmentService(env.db).assign(
            Actor(leader.id, "user:leader"), "proj", env.target, "adj", "review"
        )
    assert refused.value.code == "TASK_NOT_ASSIGNABLE"
    rows = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": env.target, "username": "adj"}],
            "task": "review",
        },
    )
    assert rows.status_code == 422, rows.text
    batch = env.lead.post(
        f"{BASE}/assignments/batch",
        json={
            "task": "review",
            "language": "en",
            "case_ids": ["c1"],
            "mode": "one",
            "usernames": ["adj"],
        },
    )
    assert batch.status_code == 422, batch.text
    assert review_assignments(env, "adj") == []


def test_consolidation_task_is_not_reassignable(env) -> None:
    started = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert started.status_code == 200, started.text
    [assignment] = review_assignments(env, "adj")
    leader = env.app.state.accounts.get_by_username("leader")
    with pytest.raises(DomainError) as refused:
        AssignmentService(env.db).reassign(
            Actor(leader.id, "user:leader"), assignment.id, "adj", confirm_started=True
        )
    assert refused.value.code == "TASK_NOT_ASSIGNABLE"
    assert [a.id for a in review_assignments(env, "adj")] == [assignment.id]


def test_purge_script_keeps_edit_events_of_purged_drafts(env) -> None:
    target = doc("c2", "en")
    aid = assign(env, target, "ana", "annotate")
    ana = logged_in(env.app, "ana", assignments=[])
    opened = ana.post(f"/api/v1/assignments/{aid}/open")
    assert opened.status_code == 200, opened.text
    edited = ana.post(
        f"/api/v1/workspaces/{opened.json()['workspace_id']}/commands",
        json={
            "mutation_id": "edit-1",
            "expected_revision": opened.json()["view"]["draft"]["revision"],
            "payload": {"command": "check_layer", "layer_id": "hpo", "checked": True},
        },
    )
    assert edited.status_code == 200, edited.text
    count = select(func.count()).select_from(EditEventRow)
    with env.db.transaction() as conn:
        events = conn.execute(count).scalar_one()
    assert events >= 1
    url = owner_engine(env.db).url.render_as_string(hide_password=False)
    assert (
        _purge_script().main(["--project", "proj", "--confirm", "--database-url", url])
        == 0
    )
    with env.db.transaction() as conn:
        assert conn.execute(count).scalar_one() == events
        gone = conn.execute(select(AssignmentRow.id).where(AssignmentRow.id == aid))
        assert gone.first() is None
        drafts = conn.execute(select(DraftRow.id).where(DraftRow.document_id == target))
        assert drafts.first() is None


def test_purge_script_accepts_a_plain_postgresql_url(env) -> None:
    aid = assign(env, doc("c2", "en"), "ana", "annotate")
    url = owner_engine(env.db).url.set(drivername="postgresql")
    plain = url.render_as_string(hide_password=False)
    assert plain.startswith("postgresql://")
    assert (
        _purge_script().main(
            ["--project", "proj", "--confirm", "--database-url", plain]
        )
        == 0
    )
    with env.db.transaction() as conn:
        gone = conn.execute(select(AssignmentRow.id).where(AssignmentRow.id == aid))
        assert gone.first() is None


def test_consolidation_start_still_assigns_the_consolidator(env) -> None:
    response = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert response.status_code == 200, response.text
    assert len(review_assignments(env, "adj")) == 1


def _open(client, env, mode: str):
    return client.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": env.target, "mode": mode},
    )


def test_assisted_mode_is_unknown(env) -> None:
    anno = logged_in(env.app, "anno", assignments=[])
    response = _open(anno, env, "assisted")
    assert response.status_code == 422, response.text


def test_review_mode_cannot_be_opened_directly(env) -> None:
    adj = logged_in(env.app, "adj", assignments=[])
    response = _open(adj, env, "review")
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "MODE_NOT_ALLOWED"


def test_ordinary_review_round_is_refused(env) -> None:
    started = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert started.status_code == 200, started.text
    [assignment] = review_assignments(env, "adj")
    for kind, reason in (("ordinary", None), ("clean_restart", "again")):
        response = env.lead.post(
            f"/api/v1/assignments/{assignment.id}/rounds",
            json={
                "kind": kind,
                "reason": reason,
                "request_id": f"round-{kind}",
                "expected_workflow_revision": assignment.workflow_revision,
            },
        )
        assert response.status_code >= 400, response.text
        assert response.json()["code"] == "ROUND_KIND_INVALID"


def test_rows_have_no_annotation_review_state(env) -> None:
    started = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert started.status_code == 200, started.text
    rows = env.lead.get(f"{BASE}/document-rows")
    assert rows.status_code == 200, rows.text
    assert "annotation_review_in_progress" not in rows.text
    assert '"in_review"' not in rows.text
    assert '"consolidating"' in rows.text


def test_allowed_modes_offer_only_from_scratch() -> None:
    every_role = Access(
        1, "p-1", False, {"p": frozenset({"lead", "annotator", "adjudicator"})}
    )
    assert allowed_modes(every_role, "p") == ["independent"]


@pytest.mark.parametrize("note", [None, " \t", "Needs specialist review"])
def test_consolidation_uncertain_requires_reviewer_note(env, note) -> None:
    """The review machinery's note rule over HTTP, now on a consolidation round
    (was test_api_uncertain_requires_reviewer_note on a direct review open)."""
    started = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert started.status_code == 200, started.text
    adj = logged_in(env.app, "adj", assignments=[])
    opened = adj.post(f"/api/v1/rounds/{started.json()['round']['round_id']}/open")
    assert opened.status_code == 200, opened.text
    data = opened.json()
    target = data["view"]["targets"]["targets"][0]
    payload: dict[str, Any] = {"target": target, "outcome": "uncertain"}
    if note is not None:
        payload["note"] = note
    response = adj.post(
        f"/api/v1/workspaces/{data['workspace_id']}/decisions",
        json={
            "mutation_id": "decision",
            "expected_revision": data["view"]["draft"]["revision"],
            "payload": payload,
        },
    )
    if note is None or not note.strip():
        assert response.status_code == 422, response.text
        assert response.json() == {
            "code": "REVIEW_NOTE_REQUIRED",
            "details": {"target": target},
        }
    else:
        assert response.status_code == 200, response.text
        assert response.json()["decisions"][-1]["note"] == note
