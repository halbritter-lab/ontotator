"""Annotation assigned while the translation review is open (issue 213).

The task exists from the start and is closed by derivation: the rule is on and
its version is not accepted. Accepting the version opens it with no further
step; a correction takes it along to the new version.
"""

from types import SimpleNamespace

import pytest
from auth_harness import HARNESS, logged_in
from sqlalchemy import select, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all, revision_of, set_rule

from ontotator.storage.tables import AssignmentRow, AuditEventRow, ProjectRow

BASE = "/api/v1/projects/proj"
SOURCE = "wait-en"
TARGET = "wait-de"
WAITING = "TASK_WAITING_FOR_TRANSLATION_REVIEW"


@pytest.fixture
def env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit(SOURCE, "en", "Source text", case_id="case")
    target = translation_unit(TARGET, "de", "Zieltext", source=source)
    result = run_import(db, bundle(tmp_path, [source, target]))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    set_rule(db, True)
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
    alice = logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
    reviewer = logged_in(app, "rev", projects={"proj": ["annotator"]}, assignments=[])
    logged_in(app, "bob", projects={"proj": ["annotator"]}, assignments=[])
    for name in ("alice", "rev", "bob"):
        app.state.accounts.set_languages(HARNESS, name, ["en", "de"])
        app.state.accounts.update_profile(HARNESS, name, qualification="Physician")
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    return SimpleNamespace(
        app=app,
        db=db,
        pid=pid,
        alice=alice,
        reviewer=reviewer,
        lead=lead,
        target=target,
        tmp_path=tmp_path,
    )


def assign(env, task, username="alice", document=TARGET):
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document, "username": username}],
            "task": task,
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def assigned(env, task, username="alice", document=TARGET):
    result = assign(env, task, username, document)
    assert result["refused"] == [], result
    return result["created"][0]


def with_open_review(env):
    review = assigned(env, "translation_review", "rev")
    task = assigned(env, "annotate")
    return review["id"], task["id"]


def decide(env, review_id, decision, text="Zieltext"):
    form = {
        "decision": decision,
        "clinical_change": decision in ("query", "rejected"),
        "categories": ["omission"] if decision in ("query", "rejected") else [],
        "rationale": "Missing" if decision in ("query", "rejected") else None,
    }
    url = f"/api/v1/translation-reviews/{review_id}"
    opened = env.reviewer.get(url)
    assert opened.status_code == 200, opened.text
    saved = env.reviewer.put(
        f"{url}/draft",
        json={
            "expected_revision": opened.json()["draft"]["revision"],
            "text": text,
            "form": form,
        },
    )
    assert saved.status_code == 200, saved.text
    submitted = env.reviewer.post(
        f"{url}/submit", json={"expected_revision": saved.json()["revision"]}
    )
    assert submitted.status_code == 200, submitted.text
    return submitted.json()


def my_task(client, assignment_id):
    tasks = client.get("/api/v1/me/tasks").json()
    return next(item for item in tasks if item["assignment_id"] == assignment_id)


def open_task(env, assignment_id):
    return env.alice.post(f"/api/v1/assignments/{assignment_id}/open", json={})


def rows(env):
    response = env.lead.get(f"{BASE}/document-rows")
    assert response.status_code == 200, response.text
    return {
        (row["case_id"], row["language"]): row
        for group in response.json()["groups"]
        for row in group["rows"]
    }


def de_row(env):
    return rows(env)[("case", "de")]


def assert_closed(env, assignment_id):
    refused = open_task(env, assignment_id)
    assert refused.status_code == 409 and refused.json()["code"] == WAITING
    assert my_task(env.alice, assignment_id)["waiting_for_translation_review"] is True


def assert_opens(env, assignment_id):
    assert my_task(env.alice, assignment_id)["waiting_for_translation_review"] is False
    opened = open_task(env, assignment_id)
    assert opened.status_code == 200, opened.text
    return opened.json()


def test_assign_while_the_review_is_open_waits_then_opens_with_no_lead_step(env):
    review, task = with_open_review(env)
    assert_closed(env, task)
    # Every entry point, not only the task route.
    workspace = env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": TARGET, "mode": "independent"},
    )
    assert workspace.status_code == 409 and workspace.json()["code"] == WAITING
    rounds = env.alice.post(
        f"/api/v1/assignments/{task}/rounds",
        json={"request_id": "r1", "expected_workflow_revision": 0},
    )
    assert rounds.status_code == 409 and rounds.json()["code"] == WAITING
    assert_task_status(env, task, "open")

    decide(env, review, "accepted_unchanged")

    assert assert_opens(env, task)["view"]["document"]["document_id"] == TARGET


def assert_task_status(env, assignment_id, expected):
    with env.db.transaction() as conn:
        status = conn.execute(
            select(AssignmentRow.status).where(AssignmentRow.id == assignment_id)
        ).scalar_one()
    assert status == expected


def test_a_translation_without_a_review_in_sight_stays_refused(env):
    result = assign(env, "annotate")
    assert result["created"] == []
    assert result["refused"][0]["code"] == "TRANSLATION_NOT_ACCEPTED"


def test_after_a_revoked_review_a_new_assignment_is_refused_again(env):
    review = assigned(env, "translation_review", "rev")
    assert env.lead.post(
        f"/api/v1/assignments/{review['id']}/revoke", json={}
    ).is_success
    assert assign(env, "annotate")["refused"][0]["code"] == "TRANSLATION_NOT_ACCEPTED"


def test_setting_off_behaves_as_before(env):
    set_rule(env.db, False)
    assigned(env, "translation_review", "rev")
    refused = assign(env, "annotate")
    assert refused["refused"][0]["code"] == "TRANSLATION_NOT_REVIEWED"
    created = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": TARGET, "username": "alice"}],
            "task": "annotate",
            "confirm_language": True,
            "confirm_unreviewed_translation": True,
        },
    ).json()["created"][0]
    assert_opens(env, created["id"])


def test_turning_the_setting_off_opens_a_waiting_task(env):
    _, task = with_open_review(env)
    assert_closed(env, task)
    set_rule(env.db, False)
    assert_opens(env, task)


@pytest.mark.parametrize("decision", ["rejected", "query"])
def test_rejected_or_queried_stays_waiting_and_a_new_review_opens_it(env, decision):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(annotations_per_text=2)
        )
    review, task = with_open_review(env)
    decide(env, review, decision)
    assert_closed(env, task)
    row = de_row(env)
    assert row["work"][-1]["waiting_for_translation_review"] is True
    # The lead's next step stays the review's; the task is not open work.
    assert row["next_step"]["code"] in ("resolve_rejected", "resolve_queried")
    assert "annotation_in_progress" not in {s["code"] for s in row["steps"]}
    # No review in sight: a second annotator is refused.
    assert assign(env, "annotate", "bob")["refused"][0]["code"] == (
        "TRANSLATION_NOT_ACCEPTED"
    )
    second = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": TARGET, "username": "bob"}],
            "task": "translation_review",
            "confirm_language": True,
        },
    )
    assert second.json()["refused"] == [], second.text
    decide_as_bob = logged_in(env.app, "bob", assignments=[])
    env_bob = SimpleNamespace(reviewer=decide_as_bob)
    decide(env_bob, second.json()["created"][0]["id"], "accepted_unchanged")
    assert_opens(env, task)


def test_correction_takes_the_task_to_v2_and_opens_it_there(env):
    review, task = with_open_review(env)
    record = decide(env, review, "accepted_corrected", text="Korrigierter Zieltext")
    corrected = record["created_variant_id"]
    assert corrected and corrected != TARGET
    summary = my_task(env.alice, task)
    assert summary["document_id"] == corrected and summary["version"] == 2
    opened = assert_opens(env, task)
    assert opened["view"]["document"]["document_id"] == corrected
    assert opened["view"]["document"]["text"] == "Korrigierter Zieltext"
    with env.db.transaction() as conn:
        actions = list(
            conn.execute(
                select(AuditEventRow.action).where(
                    AuditEventRow.target_id == str(task),
                    AuditEventRow.action == "assignment.follow_correction",
                )
            ).scalars()
        )
    assert len(actions) == 1
    row = de_row(env)
    assert not any(item["moved_to_version"] for item in row["work"])
    assert "handle_text_change" not in {s["code"] for s in row["steps"]}


def test_rejection_then_a_correction_still_opens_on_the_accepted_version(env):
    review, task = with_open_review(env)
    decide(env, review, "rejected")
    second = assigned(env, "translation_review", "bob")
    bob = logged_in(env.app, "bob", assignments=[])
    record = decide(
        SimpleNamespace(reviewer=bob),
        second["id"],
        "accepted_corrected",
        text="Neu korrigiert",
    )
    assert my_task(env.alice, task)["document_id"] == record["created_variant_id"]
    assert_opens(env, task)


def test_imported_correction_takes_the_task_along_and_it_opens_on_its_acceptance(env):
    review, task = with_open_review(env)
    correction = correction_unit(env.target, "Importierte Korrektur")
    folder = env.tmp_path / "second"
    folder.mkdir()
    result = run_import(env.db, bundle(folder, [correction]))
    assert result.status == "succeeded", result.error
    summary = my_task(env.alice, task)
    assert summary["version"] == 2 and summary["waiting_for_translation_review"]
    assert_closed(env, task)
    revoked = env.lead.post(f"/api/v1/assignments/{review}/revoke", json={})
    assert revoked.is_success, revoked.text
    new_review = assigned(env, "translation_review", "rev", summary["document_id"])
    decide(env, new_review["id"], "accepted_unchanged", text="Importierte Korrektur")
    assert_opens(env, task)


def test_started_or_proposal_work_is_not_moved(env):
    review, task = with_open_review(env)
    with env.db.transaction() as conn:
        conn.execute(
            AssignmentRow.__table__.update()
            .where(AssignmentRow.id == task)
            .values(annotation_mode="proposals")
        )
    decide(env, review, "accepted_corrected", text="Korrigierter Zieltext")
    assert my_task(env.alice, task)["document_id"] == TARGET
    # Not stranded: the lead's text-change step names it.
    assert "handle_text_change" in {s["code"] for s in de_row(env)["steps"]}


def test_revoke_and_reassign_a_waiting_task(env):
    review = assigned(env, "translation_review", "rev")
    first = assigned(env, "annotate")
    decide(env, review["id"], "rejected")
    # The review is gone, the task is not: the lead can still hand it on.
    moved = env.lead.post(
        f"/api/v1/assignments/{first['id']}/reassign",
        json={"username": "bob", "confirm_language": True},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["username"] == "bob"
    revoked = env.lead.post(f"/api/v1/assignments/{moved.json()['id']}/revoke", json={})
    assert revoked.status_code == 200, revoked.text
    assert de_row(env)["work"][-1]["task"] == "translation_review"


def test_revoking_the_review_leaves_the_task_waiting_and_asks_the_lead(env):
    review, task = with_open_review(env)
    env.lead.post(f"/api/v1/assignments/{review}/revoke", json={})
    assert_closed(env, task)
    assert de_row(env)["next_step"]["code"] == "assign_translation_review"


def test_turning_annotate_off_withdraws_the_waiting_task(env):
    _, task = with_open_review(env)
    response = env.lead.patch(
        f"{BASE}/work-plans/case/de",
        json={
            "annotate": False,
            "expected_revision": revision_of(env, "case"),
            "confirm": True,
        },
    )
    assert response.status_code == 200, response.text
    assert all(
        item["assignment_id"] != task
        for item in env.alice.get("/api/v1/me/tasks").json()
    )


def test_discarding_the_version_revokes_the_waiting_task(env):
    _, task = with_open_review(env)
    response = env.lead.post(
        f"{BASE}/variants/{TARGET}/discard",
        json={"reason": "Wrong source", "confirm": True},
    )
    assert response.status_code == 200, response.text
    assert all(
        item["assignment_id"] != task
        for item in env.alice.get("/api/v1/me/tasks").json()
    )


def test_row_and_progress_show_the_task_as_waiting(env):
    with_open_review(env)
    row = de_row(env)
    assert row["next_step"]["code"] == "translation_review_in_progress"
    codes = [step["code"] for step in row["steps"]]
    assert "annotation_in_progress" not in codes
    assert "waiting_for_translation_review" in codes
    cell = row["stages"]["annotation"]
    assert cell["state"] == "after_review"
    assert [person["pseudonym"] for person in cell["detail"]["people"]]
    progress = env.lead.get(f"{BASE}/progress").json()
    annotation = progress["stages"]["annotation"]
    assert annotation["counts"]["waiting_for_review"] == 1
    assert annotation["counts"]["in_progress"] == 0
    workload = {entry["username"]: entry for entry in progress["workload"]}
    assert workload["alice"]["annotations_waiting"] == 1
    assert workload["alice"]["annotations_open"] == 0


def test_a_full_text_with_a_waiting_task_offers_no_further_assignment(env):
    with_open_review(env)
    assert "assign_annotation" not in {s["code"] for s in de_row(env)["steps"]}


def test_a_lead_with_a_waiting_task_gets_no_open_my_task_link(env):
    leader = env.app.state.accounts.get_by_username("leader")
    assert leader is not None
    assigned(env, "translation_review", "rev")
    created = assign(env, "annotate", "leader")
    assert created["refused"] == [], created
    assert de_row(env)["own_open_assignment_id"] is None


def test_bulk_assign_waits_too(env):
    assigned(env, "translation_review", "rev")
    body = {
        "task": "annotate",
        "language": "de",
        "case_ids": ["case"],
        "mode": "one",
        "usernames": ["alice"],
    }
    preview = env.lead.post(f"{BASE}/assignments/batch/preview", json=body)
    assert preview.status_code == 200, preview.text
    (target,) = preview.json()["targets"]
    assert target["waiting_for_translation_review"] is True
    people = {item["username"]: item for item in preview.json()["people"]}
    # A waiting task counts under Open tasks.
    assert people["alice"]["open_after"] == people["alice"]["open_before"] + 1
    done = env.lead.post(
        f"{BASE}/assignments/batch",
        json={
            **body,
            "expected_preview_digest": preview.json()["digest"],
            "confirm_language": True,
        },
    )
    assert done.status_code == 200, done.text
    assert_closed(env, done.json()["created"][0]["id"])


def test_distribute_evenly_splits_waiting_tasks(env):
    assigned(env, "translation_review", "rev")
    body = {
        "task": "annotate",
        "language": "de",
        "case_ids": ["case"],
        "mode": "split",
        "usernames": ["alice", "bob"],
    }
    preview = env.lead.post(f"{BASE}/assignments/batch/preview", json=body)
    assert preview.json()["versions"] == 1, preview.text
    done = env.lead.post(
        f"{BASE}/assignments/batch",
        json={
            **body,
            "expected_preview_digest": preview.json()["digest"],
            "confirm_language": True,
        },
    )
    assert done.status_code == 200, done.text


def test_distribution_proposal_offers_a_text_under_review_only(env):
    def proposal():
        response = env.lead.post(
            f"{BASE}/assignments/proposal",
            json={"document_ids": [TARGET], "task": "annotate", "seed": 31},
        )
        assert response.status_code == 200, response.text
        return response.json()

    assert proposal()["unassignable"][0]["reason"] == "translation_not_accepted"
    assigned(env, "translation_review", "rev")
    result = proposal()
    assert result["unassignable"] == [] and len(result["rows"]) == 1


def test_a_batch_refuses_a_text_with_no_review_with_its_reason(env):
    preview = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json={
            "task": "annotate",
            "language": "de",
            "case_ids": ["case"],
            "mode": "one",
        },
    )
    assert preview.json()["skipped"][0]["reason"] == "waiting_for_review"
