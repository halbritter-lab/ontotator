"""New text versions and work from proposals (spec 2026-10-23 §1 "New text
versions", plan P4 / review R10): work from proposals is never moved or
carried; the new version is assigned anew, from its own proposals."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from proposal_check_support import (
    BASE,
    assign,
    proposal_env,
    refused_code,
)
from sqlalchemy import select, update

from ontotator.storage.tables import AssignmentRow, DocumentRow, JobRow


def _correction_of_c1(env: Any) -> str:
    """Import a correction (v2) of c1-en; its re-anchor job stays queued, so v2
    has no proposals until ``_run_reanchor_jobs``. Returns v2's document ID."""
    from t1_builders import bundle, correction_unit
    from t1_fixtures import TEXT, run_import

    from ontotator.auth.audit import Actor

    child = correction_unit(env.c1_unit, "Prefix " + TEXT)
    (env.tmp_path / "v2").mkdir()
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
        job = queue.claim(job_id, "text-change-test")
        assert job is not None
        queue.run(job, "text-change-test")


def _submit(env: Any, assignment_id: int, mode: str) -> str:
    """Record a submission of ``mode`` for the assignment's user."""
    from ontotator.domain.review import ReviewTargetSet
    from ontotator.domain.workspace import Submission, WorkspaceKey
    from ontotator.storage.repository import _key_str
    from ontotator.storage.tables import UserRow

    submission_id = f"sub-{assignment_id}"
    with env.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    key = WorkspaceKey(
        project_key="proj",
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode=mode,
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=submission_id,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-10-16T10:00:00Z",
    )
    with env.db.transaction() as conn:
        env.app.state.repo._insert_submission(
            conn, env.pid, record, local_key=_key_str(key), imported=False
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted", last_submission_id=submission_id)
        )
    return submission_id


def _assignment(env: Any, assignment_id: int) -> Any:
    with env.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow).where(AssignmentRow.id == assignment_id)
        ).one()


def _move(env: Any, assignment_id: int, target: str) -> Any:
    return env.lead.post(
        f"/api/v1/assignments/{assignment_id}/move-to-version",
        json={
            "target_document_id": target,
            "expected_workflow_revision": _assignment(
                env, assignment_id
            ).workflow_revision,
            "request_id": f"move-{uuid4().hex}",
        },
    )


def _preview_carry(env: Any, submission_id: str, target: str) -> Any:
    return env.lead.post(
        f"{BASE}/text-changes/preview",
        json={"submission_id": submission_id, "target_document_id": target},
    )


def _carry(env: Any, submission_id: str, target: str) -> Any:
    return env.lead.post(
        f"{BASE}/submissions/{submission_id}/carry",
        json={
            "target_document_id": target,
            "mode": "author",
            "request_id": f"carry-{uuid4().hex}",
        },
    )


def _refusal(response: Any) -> dict[str, Any]:
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "TEXT_CHANGE_NOT_APPLICABLE", body
    return dict(body["details"])


def test_open_work_from_proposals_is_not_moved(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    assert work["annotation_mode"] == "proposals"
    v2 = _correction_of_c1(env)
    assert _refusal(_move(env, work["id"], v2)) == {
        "reason": "from_proposals",
        "step": "move",
    }
    preview = env.lead.post(
        f"{BASE}/text-changes/preview",
        json={"assignment_id": work["id"], "target_document_id": v2},
    )
    assert _refusal(preview)["reason"] == "from_proposals"
    # "Let finish, then carry" would carry it later: refused as well.
    resolution = env.lead.post(
        f"/api/v1/assignments/{work['id']}/text-change-resolution",
        json={
            "resolution": "finish_then_carry",
            "target_document_id": v2,
            "expected_workflow_revision": _assignment(
                env, work["id"]
            ).workflow_revision,
        },
    )
    assert _refusal(resolution) == {"reason": "from_proposals", "step": "carry"}
    stays = _assignment(env, work["id"])
    assert stays.revoked_at is None
    assert stays.document_id == env.c1


def test_submitted_work_from_proposals_is_not_carried(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    submission_id = _submit(env, work["id"], "proposal_check")
    v2 = _correction_of_c1(env)
    expected = {"reason": "from_proposals", "step": "carry"}
    assert _refusal(_preview_carry(env, submission_id, v2)) == expected
    assert _refusal(_carry(env, submission_id, v2)) == expected


def test_new_version_with_proposals_is_assigned_from_proposals(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    _submit(env, work["id"], "proposal_check")
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    assert assign(env, v2, "anno2")["annotation_mode"] == "proposals"


def test_new_version_without_proposals_is_refused(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    _submit(env, work["id"], "proposal_check")
    v2 = _correction_of_c1(env)
    assert refused_code(env, v2, "anno2") == "NO_PROPOSALS_ON_VERSION"


def test_work_from_scratch_still_moves_and_carries(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    moving = assign(env, env.c1, "anno")
    carried = assign(env, env.c1, "anno2")
    assert moving["annotation_mode"] == carried["annotation_mode"] == "scratch"
    submission_id = _submit(env, carried["id"], "independent")
    v2 = _correction_of_c1(env)
    moved = _move(env, moving["id"], v2)
    assert moved.status_code == 200, moved.text
    assert moved.json()["assignment"]["document_id"] == v2
    preview = _preview_carry(env, submission_id, v2)
    assert preview.status_code == 200, preview.text
