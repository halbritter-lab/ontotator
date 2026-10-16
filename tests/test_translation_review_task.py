"""Task6 real assignment, distribution and HTTP work-gate integration."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from auth_harness import HARNESS, grant, logged_in
from sqlalchemy import delete, event, func, insert, select, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from test_case_api import BASE, CORRECTED, SOURCE, TARGET

from ontocurator.assignments.service import AssignmentService
from ontocurator.domain.errors import DomainError
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    DraftRow,
    ProjectMembershipRow,
    ProjectRow,
    TranslationReviewDraftRow,
    UserRow,
)


@pytest.fixture
def case_env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit(SOURCE, "en", "Source text", case_id="case")
    target = translation_unit(TARGET, "de", "Target text", source=source)
    corrected = correction_unit(target, "Corrected text")
    result = run_import(db, bundle(tmp_path, [source, target, corrected]))
    assert result.status == "succeeded", result.error
    alice = logged_in(
        app,
        "alice",
        projects={"proj": ["annotator"]},
        assignments=[("proj", SOURCE, "annotate")],
    )
    reviewer = logged_in(
        app, "reviewer", projects={"proj": ["adjudicator"]}, assignments=[]
    )
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    admin = logged_in(app, "root", system_admin=True, assignments=[])
    return SimpleNamespace(
        app=app, db=db, alice=alice, reviewer=reviewer, lead=lead, admin=admin
    )


def assigned(
    env, document=TARGET, username="alice", task="translation_review", **extra
):
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document, "username": username}],
            "task": task,
            "confirm_language": True,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["refused"] == [], response.text
    return response.json()["created"][0]


def test_translation_review_assignment_and_dedicated_open_are_real(case_env):
    row = assigned(case_env)
    response = case_env.alice.get(f"/api/v1/translation-reviews/{row['id']}")
    assert response.status_code == 200, response.text
    assert response.json()["assignment"]["id"] == row["id"]
    assert response.json()["source"]["variant"]["language"] == "en"
    assert response.json()["read_only"] is False


def status(env, value="accepted", document=TARGET):
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document)
            .values(translation_status=value)
        )


def proposed(env, documents=None, task="translation_review"):
    response = env.lead.post(
        f"{BASE}/assignments/proposal",
        json={"document_ids": documents or [TARGET], "task": task, "seed": 31},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "document,accepted,reason",
    [
        (SOURCE, False, "not_a_translation"),
        (TARGET, True, "translation_already_accepted"),
    ],
)
def test_new_review_refuses_native_or_accepted_targets(
    case_env, document, accepted, reason
):
    if accepted:
        status(case_env)
    response = case_env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document, "username": "alice"}],
            "task": "translation_review",
            "confirm_language": True,
        },
    )
    assert response.json()["created"] == []
    assert response.json()["refused"][0]["code"] == "NOT_A_TRANSLATION"
    blocked = proposed(case_env, [document])["unassignable"]
    assert blocked[0]["reason"] == reason and blocked[0]["eligible_count"] == 0


@pytest.mark.parametrize(
    "username,code", [("reviewer", "ASSIGNEE_ROLE_MISSING"), ("root", "NOT_A_MEMBER")]
)
def test_review_assignment_needs_real_annotator_membership_even_admin(
    case_env, username, code
):
    response = case_env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": TARGET, "username": username}],
            "task": "translation_review",
            "confirm_language": True,
        },
    )
    assert response.json()["refused"][0]["code"] == code


def test_distribution_requires_original_source_and_target_languages_on_correction(
    case_env,
):
    env = case_env
    for name, languages in [
        ("alice", ["en"]),
        ("onlyde", ["de"]),
        ("both", ["en", "de"]),
    ]:
        if name != "alice":
            logged_in(env.app, name, projects={"proj": ["annotator"]}, assignments=[])
        env.app.state.accounts.set_languages(HARNESS, name, languages)
    proposal = proposed(env, [CORRECTED])
    assert [(row["document_id"], row["username"]) for row in proposal["rows"]] == [
        (CORRECTED, "both")
    ]
    env.app.state.accounts.set_languages(HARNESS, "both", ["de"])
    assert proposed(env, [CORRECTED])["unassignable"][0]["reason"] == "NO_READER"


def test_manual_both_language_override_is_explicit_and_audited(case_env):
    env = case_env
    env.app.state.accounts.set_languages(HARNESS, "alice", ["de"])
    body = {
        "rows": [{"document_id": CORRECTED, "username": "alice"}],
        "task": "translation_review",
    }
    response = env.lead.post(f"{BASE}/assignments", json=body)
    assert response.json()["refused"][0]["code"] == "LANGUAGE_CONFIRMATION_REQUIRED"
    row = assigned(env, CORRECTED)
    with env.db.transaction() as conn:
        audit = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "assignment.language_override",
                AuditEventRow.target_id == str(row["id"]),
            )
        ).scalar_one()
    assert audit["required_languages"] == ["de", "en"]
    assert audit["user_languages"] == ["de"] and audit["document_language"] == "de"


def test_disjointness_is_only_annotate_review_not_translation_review(case_env):
    env = case_env
    grant(env.app, "alice", "proj", ["annotator", "adjudicator"])
    env.app.state.accounts.set_languages(HARNESS, "alice", ["en", "de"])
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).values(adjudicator_not_annotator=True))
    tr = assigned(env)
    status(env)
    # Existing identity retry remains legal after acceptance.
    assert assigned(env)["id"] == tr["id"]
    assert proposed(env, task="annotate")["rows"][0]["username"] == "alice"
    annotation = assigned(env, task="annotate")
    refused = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": TARGET, "username": "alice"}],
            "task": "review",
            "confirm_language": True,
        },
    )
    assert refused.json()["refused"][0]["code"] == "ADJUDICATOR_IS_ANNOTATOR"
    env.lead.post(f"/api/v1/assignments/{annotation['id']}/revoke", json={})
    review = assigned(env, task="review")
    assert review["task"] == "review"


@pytest.mark.parametrize("task", ["annotate", "review"])
def test_current_acceptance_gate_assignments_proposals_and_option_false(case_env, task):
    env = case_env
    username = "alice" if task == "annotate" else "reviewer"
    blocked = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": TARGET, "username": username}],
            "task": task,
            "confirm_language": True,
        },
    )
    assert blocked.json()["refused"][0]["code"] == "TRANSLATION_NOT_ACCEPTED"
    proposal = proposed(env, [SOURCE, TARGET], task)
    assert any(
        row["document_id"] == TARGET and row["reason"] == "translation_not_accepted"
        for row in proposal["unassignable"]
    )
    response = env.lead.patch(
        f"{BASE}/settings", json={"annotate_accepted_translations_only": False}
    )
    assert (
        response.status_code == 200
        and response.json()["annotate_accepted_translations_only"] is False
    )
    assert assigned(env, username=username, task=task)["task"] == task
    assert (
        env.lead.get(f"{BASE}/settings").json()["annotate_accepted_translations_only"]
        is False
    )


@pytest.mark.parametrize(
    "changed", ["status", "source_language", "option", "ancestor", "member_language"]
)
def test_distribution_context_rechecks_full_translation_inputs_before_any_write(
    case_env, changed
):
    env = case_env
    env.app.state.accounts.set_languages(HARNESS, "alice", ["en", "de"])
    proposal = proposed(env, [CORRECTED])
    assert proposal["rows"]
    with env.db.transaction() as conn:
        if changed == "status":
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.document_id == CORRECTED)
                .values(translation_status="accepted")
            )
        elif changed == "source_language":
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.document_id == SOURCE)
                .values(language="fr")
            )
        elif changed == "option":
            conn.execute(
                update(ProjectRow).values(annotate_accepted_translations_only=False)
            )
        elif changed == "ancestor":
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.document_id == TARGET)
                .values(derived_from=None)
            )
    if changed == "member_language":
        env.app.state.accounts.set_languages(HARNESS, "alice", ["de"])
    before = len(AssignmentService(env.db).list("proj"))
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": CORRECTED, "username": "alice"}],
            "task": "translation_review",
            "context": proposal["context"],
            "confirm_language": True,
        },
    )
    assert (
        response.status_code == 409 and response.json()["code"] == "DISTRIBUTION_STALE"
    ), response.text
    assert len(AssignmentService(env.db).list("proj")) == before


def test_review_http_round_trip_qualification_history_reopen_and_current_metadata(
    case_env,
):
    env = case_env
    row = assigned(env)
    for client in (env.reviewer, env.lead, env.admin):
        assert client.get(f"/api/v1/assignments/{row['id']}").status_code == 404
        assert client.get(f"/api/v1/translation-reviews/{row['id']}").status_code == 404
    metadata = env.alice.get(f"/api/v1/assignments/{row['id']}")
    assert (
        metadata.status_code == 200 and metadata.json()["task"] == "translation_review"
    )
    assert not {"text", "draft", "workspace_id"} & metadata.json().keys()
    assert (
        env.alice.post(f"/api/v1/assignments/{row['id']}/open", json={}).json()["code"]
        == "TASK_INVALID"
    )
    url = f"/api/v1/translation-reviews/{row['id']}"
    workspace = env.alice.get(url).json()
    body = {
        "expected_revision": 0,
        "text": workspace["text"],
        "form": {"decision": "accepted_unchanged", "clinical_change": False},
    }
    assert env.alice.put(url + "/draft", json=body).json() == {"revision": 1}
    assert (
        env.alice.post(url + "/submit", json={"expected_revision": 1}).json()["code"]
        == "QUALIFICATION_REQUIRED"
    )
    assert (
        env.alice.patch(
            "/api/v1/me/profile", json={"qualification": "Clinical reviewer"}
        ).status_code
        == 200
    )
    submitted = env.alice.post(url + "/submit", json={"expected_revision": 1})
    assert submitted.status_code == 200, submitted.text
    record = submitted.json()
    assert (
        record["reviewer_qualification"] == "Clinical reviewer"
        and record["document_id"] == TARGET
    )
    opened = env.alice.get(url).json()
    assert (
        opened["read_only"] is True and opened["submitted_record"]["id"] == record["id"]
    )
    records = f"{BASE}/documents/{quote(TARGET, safe='')}/translation-reviews"
    assert [item["id"] for item in env.alice.get(records).json()] == [record["id"]]
    assert env.reviewer.get(records).status_code == 404
    assigned(env, username="reviewer", task="review")
    assert env.reviewer.get(records).json() == []
    assert len(env.lead.get(records).json()) == 1
    tasks = env.alice.get("/api/v1/me/tasks").json()
    third = next(item for item in tasks if item["assignment_id"] == row["id"])
    assert (third["source_language"], third["target_language"], third["status"]) == (
        "en",
        "de",
        "submitted",
    )
    assert assigned(env)["id"] == row["id"]
    assert (
        env.lead.post(f"/api/v1/assignments/{row['id']}/reopen", json={}).status_code
        == 200
    )
    assert env.alice.get(url).json()["read_only"] is False
    assert (
        env.alice.post(url + "/submit", json={"expected_revision": 1}).status_code
        == 409
    )


@pytest.mark.parametrize("value", [None, "", "   ", "x" * 200])
def test_nullable_qualification_own_admin_and_omission(case_env, value):
    env = case_env
    assert (
        env.alice.patch("/api/v1/me/profile", json={"qualification": value}).status_code
        == 200
    )
    expected = value.strip() or None if value is not None else None
    assert env.alice.get("/api/v1/me/profile").json()["qualification"] == expected
    assert (
        env.alice.patch("/api/v1/me/profile", json={"display_name": "Updated"}).json()[
            "qualification"
        ]
        == expected
    )
    response = env.admin.patch(
        "/api/v1/admin/users/alice",
        json={"qualification": "Admin supplied", "languages": ["en", "de"]},
    )
    assert (
        response.status_code == 200
        and response.json()["qualification"] == "Admin supplied"
    )
    assert (
        env.alice.get("/api/v1/me/profile").json()["qualification"] == "Admin supplied"
    )
    assert (
        env.alice.patch(
            "/api/v1/me/profile", json={"qualification": "x" * 201}
        ).status_code
        == 422
    )
    with pytest.raises(DomainError, match="QUALIFICATION_INVALID"):
        env.app.state.accounts.update_profile(HARNESS, "alice", qualification="x" * 201)


@pytest.mark.parametrize("change", ["revoke", "role", "inactive"])
def test_task_metadata_and_my_tasks_recheck_current_authority_without_writes(
    case_env, change
):
    env = case_env
    row = assigned(env)
    with env.db.transaction() as conn:
        before = conn.execute(
            select(func.count()).select_from(TranslationReviewDraftRow)
        ).scalar_one()
    assert env.alice.get(f"/api/v1/assignments/{row['id']}").status_code == 200
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(TranslationReviewDraftRow)
            ).scalar_one()
            == before
        )
        if change == "revoke":
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == row["id"])
                .values(revoked_at=func.now())
            )
        elif change == "role":
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == row["user_id"]
                )
            )
        else:
            conn.execute(
                update(UserRow).where(UserRow.id == row["user_id"]).values(active=False)
            )
    assert env.alice.get(f"/api/v1/assignments/{row['id']}").status_code in (401, 404)
    response = env.alice.get("/api/v1/me/tasks")
    assert response.status_code == 401 or all(
        item["assignment_id"] != row["id"] for item in response.json()
    )


def annotation_open(env, mode="independent"):
    return env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": TARGET, "mode": mode},
    )


def command(revision=0, mutation="edit"):
    return {
        "mutation_id": mutation,
        "expected_revision": revision,
        "payload": {"command": "check_layer", "layer_id": "hpo", "checked": True},
    }


@pytest.mark.parametrize("mode", ["independent", "assisted"])
def test_gate_after_receipt_replay_blocks_editable_open_new_commands_and_submit(
    case_env, mode
):
    env = case_env
    status(env)
    assigned(env, task="annotate")
    opened = annotation_open(env, mode)
    assert opened.status_code == 200, opened.text
    workspace = opened.json()["workspace_id"]
    url = f"/api/v1/workspaces/{workspace}"
    envelope = command()
    written = env.alice.post(url + "/commands", json=envelope)
    assert written.status_code == 200, written.text
    status(env, "reviewed")
    replay = env.alice.post(url + "/commands", json=envelope)
    assert replay.status_code == 200 and replay.json() == written.json()
    refused = env.alice.post(url + "/commands", json=command(1, "new-edit"))
    assert (
        refused.status_code == 409
        and refused.json()["code"] == "TRANSLATION_NOT_ACCEPTED"
    )
    submission = env.alice.post(
        url + "/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 1,
            "payload": {"command": "submit_workspace"},
        },
    )
    assert (
        submission.status_code == 409
        and submission.json()["code"] == "TRANSLATION_NOT_ACCEPTED"
    )
    reopened = annotation_open(env, mode)
    assert (
        reopened.status_code == 409
        and reopened.json()["code"] == "TRANSLATION_NOT_ACCEPTED"
    )
    # Text/history visibility is not an acceptance gate.
    from test_case_api import path

    assert env.alice.get(path(TARGET, "text")).status_code == 200
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(DraftRow.revision).where(DraftRow.document_id == TARGET)
            ).scalar_one()
            == 1
        )


def test_submitted_annotation_history_survives_gate_drop_and_option_does_not_reopen(
    case_env,
):
    env = case_env
    status(env)
    row = assigned(env, task="annotate")
    opened = annotation_open(env).json()
    url = f"/api/v1/workspaces/{opened['workspace_id']}"
    assert env.alice.post(url + "/commands", json=command()).status_code == 200
    envelope = {
        "mutation_id": "submit",
        "expected_revision": 1,
        "payload": {"command": "submit_workspace"},
    }
    submitted = env.alice.post(url + "/submit", json=envelope)
    assert submitted.status_code == 200, submitted.text
    status(env, "reviewed")
    readonly = annotation_open(env)
    assert readonly.status_code == 200 and readonly.json()["read_only"] is True
    assert env.alice.post(url + "/submit", json=envelope).json() == submitted.json()
    assert (
        env.lead.patch(
            f"{BASE}/settings", json={"annotate_accepted_translations_only": False}
        ).status_code
        == 200
    )
    blocked = env.alice.post(url + "/commands", json=command(2, "after-submit"))
    assert (
        blocked.status_code == 409 and blocked.json()["code"] == "ASSIGNMENT_SUBMITTED"
    )
    assert (
        env.lead.post(f"/api/v1/assignments/{row['id']}/reopen", json={}).status_code
        == 200
    )
    assert annotation_open(env).json()["read_only"] is False


def test_command_waiter_rechecks_gate_after_current_project_lock(case_env):
    env = case_env
    status(env)
    assigned(env, task="annotate")
    opened = annotation_open(env).json()
    waiting = Event()

    def at_project(_conn, _cursor, statement, parameters, _context, _many):
        if (
            "pg_advisory_xact_lock_shared" in statement
            and _lock_id("project", "proj") in parameters.values()
        ):
            waiting.set()

    event.listen(env.db.engine, "before_cursor_execute", at_project)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with env.db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("project", "proj")))
                )
                future = pool.submit(
                    env.alice.post,
                    f"/api/v1/workspaces/{opened['workspace_id']}/commands",
                    json=command(),
                )
                assert waiting.wait(10)
                conn.execute(
                    update(DocumentRow)
                    .where(DocumentRow.document_id == TARGET)
                    .values(translation_status="reviewed")
                )
            response = future.result(timeout=15)
            assert (
                response.status_code == 409
                and response.json()["code"] == "TRANSLATION_NOT_ACCEPTED"
            ), response.text
    finally:
        event.remove(env.db.engine, "before_cursor_execute", at_project)
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(DraftRow.revision).where(DraftRow.document_id == TARGET)
            ).scalar_one()
            == 0
        )


def test_automatic_confirmation_uses_shared_eligibility_and_original_snapshot(case_env):
    env = case_env
    env.app.state.accounts.set_languages(HARNESS, "alice", ["de", "en"])
    preview = proposed(env, [TARGET, CORRECTED])
    body = {
        "task": "translation_review",
        "context": preview["context"],
        "rows": [
            {"document_id": TARGET, "username": "alice"},
            {"document_id": CORRECTED, "username": "unknown"},
        ],
    }
    response = env.lead.post(f"{BASE}/assignments", json=body)
    assert response.status_code == 200, response.text
    assert (
        len(response.json()["created"]) == 1
        and response.json()["refused"][0]["code"] == "USER_NOT_FOUND"
    )
    with env.db.transaction() as conn:
        audit = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "assignment.distribute"
            )
        ).scalar_one()
    assert audit["input_snapshot"]["annotate_accepted_translations_only"] is True
    assert audit["input_snapshot"]["variants"]
    assert len(audit["original_proposal"]["rows"]) == 2


def test_new_metadata_queries_are_bounded_and_contain_no_text_or_annotation_payload(
    case_env,
):
    env = case_env
    assigned(env)
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement.lower())

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        assert env.alice.get("/api/v1/me/tasks").status_code == 200
        preview = proposed(env, [SOURCE, TARGET, CORRECTED])
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    selects = [sql for sql in statements if sql.lstrip().startswith("select")]
    assert len(selects) <= 38
    assert not any(
        "documents.text," in sql or "documents.text as" in sql or ".payload" in sql
        for sql in selects
    )
    assert len(preview["context"]["document_ids"]) == 3


@pytest.mark.parametrize("origin", ["human_translation", "native_correction"])
def test_human_translation_and_native_correction_have_distinct_eligibility(
    case_env, tmp_path, origin
):
    env = case_env
    source = native_unit(
        "additional-source", "en", "Additional source", case_id="additional"
    )
    if origin == "human_translation":
        target = translation_unit(
            "human/annotation-versions/own/y/translation-reviews",
            "de",
            "Human translation",
            source=source,
            origin=origin,
        )
        document = target.document.document_id
    else:
        target = correction_unit(source, "Additional corrected source")
        document = "additional-source~en~v2"
    directory = tmp_path / "additional"
    directory.mkdir()
    imported = run_import(env.db, bundle(directory, [source, target]))
    assert imported.status == "succeeded", imported.error
    if origin == "human_translation":
        row = assigned(env, document)
        opened = env.alice.get(f"/api/v1/translation-reviews/{row['id']}")
        assert (
            opened.status_code == 200
            and opened.json()["variant"]["document_id"] == document
        )
        history = env.alice.get(
            f"{BASE}/documents/{quote(document, safe='')}/translation-reviews"
        )
        assert history.status_code == 200 and history.json() == []
    else:
        denied = env.lead.post(
            f"{BASE}/assignments",
            json={
                "rows": [{"document_id": document, "username": "alice"}],
                "task": "translation_review",
                "confirm_language": True,
            },
        )
        assert denied.json()["refused"][0]["code"] == "NOT_A_TRANSLATION"
        assert assigned(env, document, task="annotate")["document_id"] == document


def test_corrected_review_opens_only_new_accepted_child_for_annotation(case_env):
    env = case_env
    row = assigned(env, CORRECTED)
    url = f"/api/v1/translation-reviews/{row['id']}"
    assert env.alice.get(url).status_code == 200
    assert (
        env.alice.patch(
            "/api/v1/me/profile", json={"qualification": "Reviewer"}
        ).status_code
        == 200
    )
    draft = {
        "expected_revision": 0,
        "text": "Safely changed text",
        "form": {"decision": "accepted_corrected", "clinical_change": False},
    }
    assert env.alice.put(url + "/draft", json=draft).status_code == 200
    reviewed = env.alice.post(url + "/submit", json={"expected_revision": 1})
    assert reviewed.status_code == 200, reviewed.text
    child = reviewed.json()["created_variant_id"]
    assert child and assigned(env, child, task="annotate")["document_id"] == child
    refused = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": CORRECTED, "username": "alice"}],
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert refused.json()["refused"][0]["code"] == "TRANSLATION_NOT_ACCEPTED"


def test_review_http_body_revision_csrf_and_server_issue_contract(case_env):
    env = case_env
    row = assigned(env)
    url = f"/api/v1/translation-reviews/{row['id']}"
    workspace = env.alice.get(url).json()
    body = {"expected_revision": 0, "text": workspace["text"], "form": {}}
    assert (
        env.alice.put(url + "/draft", json={**body, "unexpected": True}).status_code
        == 422
    )
    assert (
        env.alice.put(
            url + "/draft", json={**body, "expected_revision": True}
        ).status_code
        == 422
    )
    assert (
        env.alice.put(
            url + "/draft", json=body, headers={"X-CSRF-Token": ""}
        ).status_code
        == 403
    )
    assert env.alice.put(url + "/draft", json=body).json() == {"revision": 1}
    assert env.alice.put(url + "/draft", json=body).status_code == 409
    env.alice.patch("/api/v1/me/profile", json={"qualification": "Reviewer"})
    invalid = env.alice.post(url + "/submit", json={"expected_revision": 1})
    assert invalid.status_code == 422 and invalid.json()["code"] == "REVIEW_INVALID"
    assert invalid.json()["details"]["issues"] == ["FORM_INVALID"]


def test_task_list_and_assignment_metadata_return_actual_external_identity(case_env):
    env = case_env
    row = assigned(env, CORRECTED)
    assert CORRECTED != TARGET
    assert row["document_id"] == CORRECTED and row["external_id"] == TARGET
    tasks = env.alice.get("/api/v1/me/tasks")
    assert tasks.status_code == 200, tasks.text
    task = next(item for item in tasks.json() if item["assignment_id"] == row["id"])
    assert (
        task["document_id"],
        task["external_id"],
        task["source_language"],
        task["target_language"],
    ) == (CORRECTED, TARGET, "en", "de")
    metadata = env.alice.get(f"/api/v1/assignments/{row['id']}")
    assert metadata.status_code == 200 and metadata.json()["external_id"] == TARGET
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(TranslationReviewDraftRow)
            ).scalar_one()
            == 0
        )


def unrelated_documents(env, count=7):
    with env.db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        conn.execute(
            insert(DocumentRow),
            [
                {
                    "project_id": project_id,
                    "document_id": f"unrelated-{i}",
                    "case_id": f"unrelated-case-{i}",
                    "external_id": f"unrelated-{i}",
                    "language": "en",
                    "text": "Unrelated text",
                    "text_sha256": "unrelated-hash",
                }
                for i in range(count)
            ],
        )


def observe_eligibility_metadata(env, monkeypatch):
    from ontocurator.domain.variants import VariantInfo

    consumed, query_rows = [], []
    original = VariantInfo.__init__

    def materialize(self, *args, **kwargs):
        original(self, *args, **kwargs)
        consumed.append(self.document_id)

    def capture(_conn, cursor, statement, _params, _context, _many):
        if (
            "documents.case_id" in statement
            and "documents.translation_status" in statement
            and "documents.text," not in statement
        ):
            query_rows.append(cursor.rowcount)

    monkeypatch.setattr(VariantInfo, "__init__", materialize)
    event.listen(env.db.engine, "after_cursor_execute", capture)
    return consumed, query_rows, capture


def test_native_open_and_command_fetch_only_target_metadata(case_env, monkeypatch):
    env = case_env
    unrelated_documents(env)
    consumed, query_rows, capture = observe_eligibility_metadata(env, monkeypatch)
    try:
        opened = env.alice.post(
            "/api/v1/workspaces/open",
            json={"project_key": "proj", "document_id": SOURCE, "mode": "independent"},
        )
        assert opened.status_code == 200, opened.text
        response = env.alice.post(
            f"/api/v1/workspaces/{opened.json()['workspace_id']}/commands",
            json=command(),
        )
        assert response.status_code == 200 and response.json()["revision"] == 1
    finally:
        event.remove(env.db.engine, "after_cursor_execute", capture)
    assert consumed == [SOURCE, SOURCE], consumed
    assert query_rows == [1, 1], query_rows


@pytest.mark.parametrize("count", [1, 2])
def test_context_confirmation_materializes_inventory_once_for_all_new_rows(
    case_env, monkeypatch, count
):
    env = case_env
    unrelated_documents(env)
    status(env)
    status(env, document=CORRECTED)
    env.app.state.accounts.set_languages(HARNESS, "alice", ["en", "de"])
    selected = [TARGET, CORRECTED][:count]
    proposal = proposed(env, [SOURCE, *selected], "annotate")
    consumed, query_rows, capture = observe_eligibility_metadata(env, monkeypatch)
    try:
        response = env.lead.post(
            f"{BASE}/assignments",
            json={
                "task": "annotate",
                "context": proposal["context"],
                "rows": [{"document_id": doc, "username": "alice"} for doc in selected]
                + [{"document_id": SOURCE, "username": "unknown"}],
            },
        )
        assert response.status_code == 200, response.text
        assert [row["document_id"] for row in response.json()["created"]] == selected
        assert response.json()["refused"] == [
            {"document_id": SOURCE, "username": "unknown", "code": "USER_NOT_FOUND"}
        ]
    finally:
        event.remove(env.db.engine, "after_cursor_execute", capture)
    expected = {SOURCE, TARGET, CORRECTED, *(f"unrelated-{i}" for i in range(7))}
    assert len(query_rows) == 1, query_rows
    assert query_rows == [len(expected)], query_rows
    assert len(consumed) == len(expected) and set(consumed) == expected, consumed
    with env.db.transaction() as conn:
        audit = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "assignment.distribute"
            )
        ).scalar_one()
    assert audit["input_snapshot"]["variants"]
    assert len(audit["outcomes"]) == count + 1


@pytest.mark.parametrize(
    "document,expected",
    [(TARGET, {TARGET, SOURCE}), (CORRECTED, {CORRECTED, TARGET, SOURCE})],
)
def test_target_ancestry_loads_exact_translation_source_for_assign_and_editable_open(
    case_env, monkeypatch, document, expected
):
    env = case_env
    unrelated_documents(env)
    env.app.state.accounts.set_languages(HARNESS, "alice", ["en", "de"])
    consumed, query_rows, capture = observe_eligibility_metadata(env, monkeypatch)
    try:
        review = assigned(env, document, confirm_language=False)
        assert review["task"] == "translation_review"
        status(env, document=document)
        assigned(env, document, task="annotate", confirm_language=False)
        opened = env.alice.post(
            "/api/v1/workspaces/open",
            json={
                "project_key": "proj",
                "document_id": document,
                "mode": "independent",
            },
        )
        assert opened.status_code == 200, opened.text
        assert opened.json()["view"]["document"]["document_id"] == document
    finally:
        event.remove(env.db.engine, "after_cursor_execute", capture)
    assert query_rows == [len(expected)] * 3, query_rows
    assert set(consumed) == expected and len(consumed) == len(expected) * 3, consumed
    # Exact original source is English even for the German correction predecessor.
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count())
                .select_from(AuditEventRow)
                .where(
                    AuditEventRow.action == "assignment.language_override",
                    AuditEventRow.target_id == str(review["id"]),
                )
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize("broken", ["cycle", "missing", "foreign_case"])
def test_bounded_ancestry_still_refuses_corrupt_links_without_unrelated_inventory(
    case_env, monkeypatch, broken
):
    env = case_env
    unrelated_documents(env)
    with env.db.transaction() as conn:
        if broken == "cycle":
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.document_id == CORRECTED)
                .values(derived_from=CORRECTED)
            )
        else:
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.document_id == TARGET)
                .values(derived_from=None if broken == "missing" else "unrelated-0")
            )
    consumed, query_rows, capture = observe_eligibility_metadata(env, monkeypatch)
    try:
        response = env.lead.post(
            f"{BASE}/assignments",
            json={
                "rows": [{"document_id": CORRECTED, "username": "alice"}],
                "task": "translation_review",
                "confirm_language": True,
            },
        )
        assert response.status_code == 200, response.text
        assert (
            response.json()["created"] == []
            and response.json()["refused"][0]["code"] == "VARIANT_SOURCE_UNKNOWN"
        )
    finally:
        event.remove(env.db.engine, "after_cursor_execute", capture)
    allowed = (
        {CORRECTED}
        if broken == "cycle"
        else {CORRECTED, TARGET}
        if broken == "missing"
        else {CORRECTED, TARGET, "unrelated-0"}
    )
    assert query_rows == [len(allowed)] and len(consumed) == len(allowed), (
        query_rows,
        consumed,
    )
    assert set(consumed) == allowed


def test_coalesced_snapshot_preserves_selected_stored_and_null_position_order(
    case_env, monkeypatch
):
    env = case_env
    unrelated_documents(env)
    env.app.state.accounts.set_languages(HARNESS, "alice", ["en"])
    consumed, query_rows, capture = observe_eligibility_metadata(env, monkeypatch)
    try:
        proposal = proposed(env, ["unrelated-2", SOURCE, "unrelated-1"], "annotate")
    finally:
        event.remove(env.db.engine, "after_cursor_execute", capture)
    assert proposal["context"]["document_ids"] == [SOURCE, "unrelated-1", "unrelated-2"]
    assert [row["document_id"] for row in proposal["rows"]] == [
        "unrelated-1",
        "unrelated-2",
    ]
    assert proposal["unassignable"][0]["document_id"] == SOURCE
    assert query_rows == [10] and len(consumed) == 10
    assert set(consumed) == {
        SOURCE,
        TARGET,
        CORRECTED,
        *(f"unrelated-{i}" for i in range(7)),
    }
