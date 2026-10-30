"""Annotate assignments from proposals (spec 2026-10-23 §1, §2)."""

from __future__ import annotations

from typing import Any

import pytest
from proposal_check_support import (
    BASE,
    assign,
    assign_response,
    client,
    open_task,
    proposal_env,
    refused_code,
)
from sqlalchemy import select, update

from ontotator.storage.tables import (
    DocumentRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)


@pytest.fixture
def env(tmp_path):
    return proposal_env(tmp_path)


def _set_project_mode(env, mode):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(tool_proposal_mode=mode)
        )


def _revoke(env, assignment_id):
    response = env.lead.post(f"/api/v1/assignments/{assignment_id}/revoke", json={})
    assert response.status_code == 200, response.text


def test_text_with_proposals_gets_proposals_and_opens_the_proposal_check(env):
    assignment = assign(env, env.c1, "anno")
    assert assignment["annotation_mode"] == "proposals"
    opened = open_task(env, "anno", assignment["id"])
    assert opened["view"]["key"]["mode"] == "proposal_check"
    assert len(opened["view"]["targets"]["targets"]) == 3


def test_text_without_proposals_gets_scratch(env):
    assignment = assign(env, env.c2, "anno")
    assert assignment["annotation_mode"] == "scratch"
    assert (
        open_task(env, "anno", assignment["id"])["view"]["key"]["mode"] == "independent"
    )


def test_project_setting_scratch_gives_scratch(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    assert assign(env, env.c1, "anno")["annotation_mode"] == "scratch"


def test_first_assignment_locks_the_mode(env):
    assign(env, env.c1, "anno")
    _set_project_mode(env, "scratch")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "proposals"


def test_revoked_submitted_work_keeps_the_lock(env):
    """Plan review R1: submitted work counts even after its assignment is revoked."""
    from work_plan_support import submit

    first = assign(env, env.c1, "anno")
    submit(env, first["id"], "sub-anno")
    _revoke(env, first["id"])
    _set_project_mode(env, "scratch")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "proposals"


@pytest.mark.parametrize(
    ("document", "wrong_mode"), [("c1", "independent"), ("c2", "proposal_check")]
)
def test_an_annotate_assignment_opens_only_its_own_mode(env, document, wrong_mode):
    """Plan review R8 guard (``assisted`` is gone, the rule stays)."""
    document_id = getattr(env, document)
    assign(env, document_id, "anno")
    response = client(env, "anno").post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": document_id, "mode": wrong_mode},
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "MODE_NOT_ALLOWED"


def test_a_scratch_assignment_cannot_open_the_proposals_of_its_text(tmp_path):
    """c1 has proposals, but its assignment is from scratch (project setting):
    ``/workspaces/open`` in ``proposal_check`` is refused (require_workable)."""
    env = proposal_env(tmp_path, mode="scratch")
    assert assign(env, env.c1, "anno")["annotation_mode"] == "scratch"
    response = client(env, "anno").post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": env.c1, "mode": "proposal_check"},
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "MODE_NOT_ALLOWED"


def test_remove_an_open_assignment_unlocks_the_mode(env):
    first = assign(env, env.c1, "anno")
    removed = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert removed.status_code == 200, removed.text
    assert removed.json()["revoked_at"] is not None
    _set_project_mode(env, "scratch")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "scratch"


def test_remove_discards_the_draft(env):
    """Plan review R12: remove, assign the same person again, the draft is empty."""
    first = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", first["id"])
    target = opened["view"]["targets"]["targets"][0]
    decided = client(env, "anno").post(
        f"/api/v1/workspaces/{opened['workspace_id']}/decisions",
        json={
            "mutation_id": "d1",
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": {"target": target, "outcome": "confirmed"},
        },
    )
    assert decided.status_code == 200, decided.text
    removed = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert removed.status_code == 200, removed.text
    again = assign(env, env.c1, "anno")
    view = open_task(env, "anno", again["id"])["view"]
    assert view["draft"]["decisions"] == []
    assert view["draft"]["revision"] == 0


def test_remove_is_refused_for_submitted_work(env):
    from work_plan_support import submit

    first = assign(env, env.c1, "anno")
    submit(env, first["id"], "sub-anno")
    response = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert response.json()["code"] == "ASSIGNMENT_SUBMITTED"


def test_remove_needs_the_lead(env):
    first = assign(env, env.c1, "anno")
    response = client(env, "anno").post(f"/api/v1/assignments/{first['id']}/remove")
    assert response.status_code == 403


def _lead_roles(env):
    with env.db.transaction() as conn:
        return set(
            conn.execute(
                select(ProjectMembershipRow.role)
                .join(UserRow, UserRow.id == ProjectMembershipRow.user_id)
                .where(
                    ProjectMembershipRow.project_id == env.pid,
                    UserRow.username == "leader",
                )
            ).scalars()
        )


def test_myself_grants_annotator_and_assigns(env):
    """The existing assign route, the lead's own username (plan P3 "myself")."""
    assert "annotator" not in _lead_roles(env)
    body = assign(env, env.c1, "leader")
    assert body["task"] == "annotate"
    assert body["annotation_mode"] == "proposals"
    assert "annotator" in _lead_roles(env)
    assert assign(env, env.c1, "leader")["id"] == body["id"]


def test_myself_counts_towards_the_limit(env):
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    assert refused_code(env, env.c1, "leader") == "ANNOTATIONS_PER_TEXT_REACHED"


def test_myself_follows_the_mode_rule(env):
    assert assign(env, env.c2, "leader")["annotation_mode"] == "scratch"


def test_self_assign_needs_the_lead(env):
    response = assign_response(env, env.c1, "anno", by=client(env, "anno"))
    assert response.status_code == 403


def _may_read_proposals(env, username):
    from ontotator.authz.policy import Access
    from ontotator.authz.versions import may_read_proposals

    user = env.app.state.accounts.get_by_username(username)
    with env.db.transaction() as conn:
        return may_read_proposals(
            conn, Access(user.id, user.pseudonym, False, {}), env.pid, "proj", env.c1
        )


@pytest.mark.parametrize(("mode", "visible"), [("proposals", True), ("scratch", False)])
def test_proposals_readable_only_when_annotating_from_proposals(
    tmp_path, mode, visible
):
    """``may_read_proposals``: an annotator from proposals may read them (the
    text view, P8); an annotator from scratch never, also not in the versions
    list."""
    env = proposal_env(tmp_path, mode=mode)
    assert assign(env, env.c1, "anno")["annotation_mode"] == mode
    assert _may_read_proposals(env, "anno") is visible
    versions = client(env, "anno").get(
        f"/api/v1/projects/proj/documents/{env.c1}/annotation-versions"
    )
    assert versions.status_code == 200, versions.text
    if not visible:
        assert all(v["kind"] != "proposals" for v in versions.json())


def _correction_of_c1(env: Any) -> str:
    """Import a correction (v2) of c1-en; its re-anchor child job stays queued,
    so v2 has no proposals yet. Returns v2's document ID."""
    from t1_builders import bundle, correction_unit
    from t1_fixtures import TEXT, run_import

    from ontotator.auth.audit import Actor

    child = correction_unit(env.c1_unit, "Prefix " + TEXT)
    (env.tmp_path / "v2").mkdir()
    # The CLI actor, as tests/test_reanchor_job.py imports: its re-anchor
    # child may then write the proposals of v2.
    job = run_import(
        env.db, bundle(env.tmp_path / "v2", [env.c1_unit, child]), actor=Actor.cli()
    )
    assert job.status == "succeeded", job.error
    with env.db.transaction() as conn:
        return str(
            conn.execute(
                select(DocumentRow.document_id).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.case_id == "c1",
                    DocumentRow.language == "en",
                    DocumentRow.version == 2,
                )
            ).scalar_one()
        )


def _run_reanchor_jobs(env: Any) -> None:
    from ontotator.exchange.jobs import HANDLERS
    from ontotator.jobs.queue import JobQueue

    queue = JobQueue(env.db, HANDLERS)
    with env.db.transaction() as conn:
        ids = list(
            conn.execute(
                select(JobRow.id)
                .where(JobRow.kind == "reanchor", JobRow.project_id == env.pid)
                .order_by(JobRow.id)
            ).scalars()
        )
    assert ids
    for job_id in ids:
        job = queue.claim(job_id, "proposal-check-test")
        assert job is not None
        queue.run(job, "proposal-check-test")


def test_new_version_without_proposals_is_refused_while_locked_from_proposals(env):
    """Plan review R10: the first version has submitted work from proposals; a
    new version without proposals cannot be assigned until its proposals are
    re-anchored, and then it is annotated from proposals too."""
    from work_plan_support import submit

    first = assign(env, env.c1, "anno")
    assert first["annotation_mode"] == "proposals"
    submit(env, first["id"], "sub-anno")
    v2 = _correction_of_c1(env)
    assert refused_code(env, v2, "anno2") == "NO_PROPOSALS_ON_VERSION"
    _run_reanchor_jobs(env)
    assert assign(env, v2, "anno2")["annotation_mode"] == "proposals"


def test_batch_skips_a_locked_text_without_proposals_and_assigns_the_rest(env):
    """Plan point (7): the batch planner foresees NO_PROPOSALS_ON_VERSION, so a
    mixed batch save is never rolled back by it."""
    from ontotator.storage.tables import AssignmentRow

    assign(env, env.c2, "anno")
    with env.db.transaction() as conn:  # c2 locked "from proposals", none on it
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.document_id == env.c2)
            .values(annotation_mode="proposals")
        )
    request = {
        "task": "annotate",
        "language": "en",
        "case_ids": ["c1", "c2"],
        "mode": "one",
        "usernames": ["anno2"],
    }
    shown = env.lead.post(f"{BASE}/assignments/batch/preview", json=request)
    assert shown.status_code == 200, shown.text
    preview = shown.json()
    assert [t["case_id"] for t in preview["targets"]] == ["c1"]
    assert preview["skipped"] == [
        {
            "case_id": "c2",
            "language": "en",
            "reason": "no_proposals_on_version",
            "document_id": None,
        }
    ]
    saved = env.lead.post(
        f"{BASE}/assignments/batch",
        json=request
        | {"expected_preview_digest": preview["digest"], "confirm_language": True},
    )
    assert saved.status_code == 200, saved.text
    with env.db.transaction() as conn:
        created = conn.execute(
            select(AssignmentRow.document_id).where(
                AssignmentRow.user_id
                == select(UserRow.id)
                .where(UserRow.username == "anno2")
                .scalar_subquery()
            )
        ).scalars()
        assert list(created) == [env.c1]


def test_a_system_admin_who_is_not_lead_confirms_the_language_on_self_assign(env):
    """Only the lead's own work skips the language confirmation."""
    from auth_harness import logged_in

    admin = logged_in(
        env.app,
        "root",
        system_admin=True,
        projects={"proj": ["annotator"]},
        assignments=[],
    )
    # Listed languages without en; none listed would be unknown (#193).
    from ontotator.auth.audit import Actor

    env.app.state.accounts.set_languages(Actor.cli(), "root", ["fr"])
    response = admin.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": env.c1, "username": "root"}],
            "task": "annotate",
            "confirm_language": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["refused"][0]["code"] == "LANGUAGE_CONFIRMATION_REQUIRED"
