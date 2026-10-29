"""Lead changes a text's annotation mode after submissions, and restores it (#109).

The change marks the submitted work as discarded (``discarded_submissions``),
revokes the live assignments and sets the new mode; every state reader skips
the marked submissions; a restore removes the marks again.
"""

from __future__ import annotations

from typing import Any

from proposal_check_support import BASE, assign, client, proposal_env
from sqlalchemy import func, select, update
from work_plan_support import revision_of

from ontotator.application.annotation_modes import load_text_mode
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.storage.live_submissions import discarded_ids
from ontotator.storage.mode_change_tables import DiscardedSubmissionRow
from ontotator.storage.repository import _key_str
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    SubmissionRow,
    UserRow,
)

CHANGES = f"{BASE}/annotation-mode-changes"


def submit(env: Any, assignment_id: int, submission_id: str) -> None:
    """Record a submission in the assignment's own workspace mode."""
    with env.db.transaction() as conn:
        row = conn.execute(
            select(
                AssignmentRow.document_id,
                AssignmentRow.annotation_mode,
                UserRow.pseudonym,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    key = WorkspaceKey(
        project_key="proj",
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode="proposal_check" if row.annotation_mode == "proposals" else "independent",
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


def submitted_text(tmp_path: Any) -> Any:
    """c1-en from proposals: anno submitted, anno2 still annotating."""
    env = proposal_env(tmp_path)
    env.first = assign(env, env.c1, "anno")["id"]
    env.second = assign(env, env.c1, "anno2")["id"]
    submit(env, env.first, "sub-anno")
    return env


def preview(env: Any, mode: str = "scratch", who: Any = None) -> Any:
    return (who or env.lead).post(
        f"{CHANGES}/preview", json={"case_id": "c1", "language": "en", "mode": mode}
    )


def change(env: Any, mode: str = "scratch", ids: Any = None, who: Any = None) -> Any:
    if ids is None:
        seen = preview(env, mode).json()
        ids = [item["submission_id"] for item in seen["submissions"]]
    return (who or env.lead).post(
        CHANGES,
        json={
            "case_id": "c1",
            "language": "en",
            "mode": mode,
            "reason": "Proposals were from the wrong model",
            "expected_revision": revision_of(env, "c1"),
            "expected_submission_ids": ids,
        },
    )


def restore(env: Any, change_id: int, who: Any = None) -> Any:
    return (who or env.lead).post(
        f"{CHANGES}/{change_id}/restore",
        json={"expected_revision": revision_of(env, "c1")},
    )


def text_mode(env: Any):
    with env.db.transaction() as conn:
        return load_text_mode(conn, env.pid, env.c1)


def rows(env: Any) -> dict[tuple[str, str], dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows")
    assert response.status_code == 200, response.text
    return {
        (r["case_id"], r["language"]): r
        for g in response.json()["groups"]
        for r in g["rows"]
    }


def audit(env: Any, action: str) -> list[dict[str, Any]]:
    with env.db.transaction() as conn:
        return [
            dict(details)
            for details in conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            ).scalars()
        ]


def test_preview_names_whose_work_is_discarded(tmp_path):
    env = submitted_text(tmp_path)
    response = preview(env)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["from_mode"], body["to_mode"]) == ("proposals", "scratch")
    [submission] = body["submissions"]
    assert submission["submission_id"] == "sub-anno"
    assert submission["author"]["display_name"] == "Anne Notator"
    assert [(a["assignment_id"], a["status"]) for a in body["assignments"]] == [
        (env.first, "submitted"),
        (env.second, "open"),
    ]
    assert body["assignments"][1]["person"]["display_name"] == "Arne Notator"


def test_change_discards_marks_revokes_and_sets_the_new_mode(tmp_path):
    env = submitted_text(tmp_path)
    assert text_mode(env).locked
    before = revision_of(env, "c1")
    response = change(env)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["revision"] == before + 1
    view = body["change"]
    assert view["from_mode"] == "proposals" and view["to_mode"] == "scratch"
    assert [s["submission_id"] for s in view["submissions"]] == ["sub-anno"]
    assert sorted(view["revoked_assignment_ids"]) == [env.first, env.second]
    assert view["restorable"] is True
    with env.db.transaction() as conn:
        # The submission row stays; only a mark is added.
        assert (
            conn.execute(select(func.count()).select_from(SubmissionRow)).scalar_one()
            == 1
        )
        mark = conn.execute(select(DiscardedSubmissionRow)).mappings().one()
        assert mark["submission_id"] == "sub-anno"
        assert mark["reason"] == "Proposals were from the wrong model"
        assert mark["discarded_by"] is not None
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(
                AssignmentRow.id.in_([env.first, env.second])
            )
        ).scalars()
        assert all(at is not None for at in revoked)
    mode = text_mode(env)
    assert (mode.mode, mode.locked, mode.source) == ("scratch", False, "plan")
    assert assign(env, env.c1, "tom")["annotation_mode"] == "scratch"


def test_change_is_audited(tmp_path):
    env = submitted_text(tmp_path)
    change_id = change(env).json()["change"]["change_id"]
    [details] = audit(env, "annotation_mode.change")
    assert details["change_id"] == change_id
    assert details["discarded_submission_ids"] == ["sub-anno"]
    assert sorted(details["revoked_assignment_ids"]) == [env.first, env.second]
    assert (details["from_mode"], details["to_mode"]) == ("proposals", "scratch")
    assert details["reason"] == "Proposals were from the wrong model"
    revokes = audit(env, "assignment.revoke")
    assert {r["reason"] for r in revokes} == {"annotation_mode_change"}
    [plan] = audit(env, "work_plan.update")[-1:]
    assert plan["rows"][0]["annotation_mode"] == {"old": None, "new": "scratch"}


def test_a_stale_warning_changes_nothing(tmp_path):
    env = submitted_text(tmp_path)
    seen = preview(env).json()
    submit(env, env.second, "sub-anno2")  # submitted after the preview
    response = change(env, ids=[s["submission_id"] for s in seen["submissions"]])
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "MODE_CHANGE_STALE"
    names = {s["submission_id"] for s in response.json()["details"]["submissions"]}
    assert names == {"sub-anno", "sub-anno2"}
    assert text_mode(env).locked


def test_refusals(tmp_path):
    env = proposal_env(tmp_path)
    # Not locked: the plan control changes the mode directly.
    assert preview(env).json()["code"] == "ANNOTATION_MODE_NOT_LOCKED"
    first = assign(env, env.c1, "anno")["id"]
    submit(env, first, "sub-anno")
    assert preview(env, "proposals").json()["code"] == "ANNOTATION_MODE_UNCHANGED"
    reason = env.lead.post(
        CHANGES,
        json={
            "case_id": "c1",
            "language": "en",
            "mode": "scratch",
            "reason": "   ",
            "expected_revision": revision_of(env, "c1"),
            "expected_submission_ids": [],
        },
    )
    assert reason.json()["code"] == "MODE_CHANGE_REASON_REQUIRED"


def test_a_chosen_final_result_keeps_the_mode(tmp_path):
    env = submitted_text(tmp_path)
    chosen = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": env.c1,
            "submission_id": "sub-anno",
            "expected_revision": 0,
        },
    )
    assert chosen.status_code == 200, chosen.text
    response = preview(env)
    assert response.status_code == 409
    assert response.json()["code"] == "ANNOTATION_MODE_FINAL_SELECTED"


def test_only_a_lead_changes_lists_or_restores(tmp_path):
    env = submitted_text(tmp_path)
    annotator = client(env, "anno")
    assert preview(env, who=annotator).status_code == 403
    assert change(env, ids=["sub-anno"], who=annotator).status_code == 403
    listed = annotator.get(CHANGES, params={"case_id": "c1", "language": "en"})
    assert listed.status_code == 403
    change_id = change(env).json()["change"]["change_id"]
    assert restore(env, change_id, who=annotator).status_code == 403
    with env.db.transaction() as conn:
        assert discarded_ids(conn, env.pid) == {"sub-anno"}


def test_discarded_work_leaves_rows_finalization_and_export(tmp_path):
    env = submitted_text(tmp_path)
    assert change(env).status_code == 200
    row = rows(env)[("c1", "en")]
    assert row["annotation_mode"]["locked"] is False
    assert row["annotation_mode"]["mode"] == "scratch"
    assert row["annotation_mode"]["discarded_count"] == 1
    assert not [w for w in row["work"] if w["task"] == "annotate"]
    # The card's submissions skip it.
    listed = env.lead.get(f"{BASE}/document-rows/c1/en/submissions")
    assert listed.status_code == 200, listed.text
    assert listed.json()["submissions"] == []
    # It cannot become the final result.
    chosen = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": env.c1,
            "submission_id": "sub-anno",
            "expected_revision": 0,
        },
    )
    assert chosen.status_code == 404
    assert chosen.json()["code"] == "VERSION_NOT_FOUND"
    # The work export leaves it out.
    content = env.app.state.repo.t1_export_content("proj")
    assert [s.submission_id for s in content.submissions] == []
    # Progress: nobody holds submitted work, the text needs annotators again.
    progress = env.lead.get("/api/v1/projects/proj/progress")
    assert progress.status_code == 200, progress.text
    body = progress.json()
    assert all(person["submitted"] == 0 for person in body["workload"])
    assert body["lede"]["to_assign"] >= 1


def test_new_work_after_the_change_counts(tmp_path):
    env = submitted_text(tmp_path)
    change(env)
    new = assign(env, env.c1, "tom")["id"]
    submit(env, new, "sub-tom")
    listed = env.lead.get(f"{BASE}/document-rows/c1/en/submissions").json()
    assert [s["submission_id"] for s in listed["submissions"]] == ["sub-tom"]
    content = env.app.state.repo.t1_export_content("proj")
    assert [s.submission_id for s in content.submissions] == ["sub-tom"]
    mode = text_mode(env)
    assert (mode.mode, mode.locked) == ("scratch", True)


def test_restore_removes_the_marks_and_reinstates_the_work(tmp_path):
    env = submitted_text(tmp_path)
    change_id = change(env).json()["change"]["change_id"]
    response = restore(env, change_id)
    assert response.status_code == 200, response.text
    view = response.json()["change"]
    assert view["restored_at"] is not None
    assert view["restored_by"]["display_name"]
    assert view["restorable"] is False and view["restore_blocked"] is None
    with env.db.transaction() as conn:
        assert discarded_ids(conn, env.pid) == set()
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(
                AssignmentRow.id.in_([env.first, env.second])
            )
        ).scalars()
        assert all(at is None for at in revoked)
    mode = text_mode(env)
    assert (mode.mode, mode.locked) == ("proposals", True)
    listed = env.lead.get(f"{BASE}/document-rows/c1/en/submissions").json()
    assert [s["submission_id"] for s in listed["submissions"]] == ["sub-anno"]
    [details] = audit(env, "annotation_mode.restore")
    assert details["restored_submission_ids"] == ["sub-anno"]
    assert sorted(details["reinstated_assignment_ids"]) == [env.first, env.second]
    assert len(audit(env, "assignment.reinstate")) == 2
    # The previous override (the project setting) is back.
    assert audit(env, "work_plan.update")[-1]["rows"][0]["annotation_mode"] == {
        "old": "scratch",
        "new": None,
    }
    again = restore(env, change_id)
    assert again.status_code == 409
    assert again.json()["code"] == "MODE_CHANGE_ALREADY_RESTORED"


def test_restore_is_refused_once_new_work_started(tmp_path):
    env = submitted_text(tmp_path)
    change_id = change(env).json()["change"]["change_id"]
    assign(env, env.c1, "tom")
    listed = env.lead.get(CHANGES, params={"case_id": "c1", "language": "en"})
    assert listed.status_code == 200, listed.text
    [view] = listed.json()["changes"]
    assert view["restorable"] is False
    assert view["restore_blocked"] == "ANNOTATION_MODE_LOCKED"
    response = restore(env, change_id)
    assert response.status_code == 422
    assert response.json()["code"] == "ANNOTATION_MODE_LOCKED"
    with env.db.transaction() as conn:
        assert discarded_ids(conn, env.pid) == {"sub-anno"}


def test_a_stale_plan_revision_is_refused(tmp_path):
    env = submitted_text(tmp_path)
    seen = preview(env).json()
    response = env.lead.post(
        CHANGES,
        json={
            "case_id": "c1",
            "language": "en",
            "mode": "scratch",
            "reason": "x",
            "expected_revision": seen["revision"] - 1,
            "expected_submission_ids": ["sub-anno"],
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "WORK_PLAN_CHANGED"


def test_discarded_work_is_no_consolidation_input(tmp_path):
    env = submitted_text(tmp_path)
    submit(env, env.second, "sub-anno2")
    assert change(env).status_code == 200
    started = env.lead.post(
        f"{BASE}/consolidations",
        json={
            "document_id": env.c1,
            "reviewer": "leader",
            "source_submission_ids": ["sub-anno", "sub-anno2"],
            "reason": None,
            "confirm_language": True,
            "request_id": "start-discarded",
            "expected_workflow_revision": None,
        },
    )
    assert started.status_code == 409, started.text
    assert started.json()["code"] == "ROUND_INPUT_STALE"
