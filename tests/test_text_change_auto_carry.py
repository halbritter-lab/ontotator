"""Finish-then-carry on submit (spec V8, "Operations" 3, plan O2c).

"Let X finish on v1" records a ``finish_then_carry`` resolution; when X
submits on v1, the submit transaction gives X a ``carry_forward`` round on
the newest version. The carry never makes the submission fail: when it is
impossible, rule 3b ("Carry to v2…") applies. Each test builds its own
project (``test_text_change_service``); submits go through the HTTP route,
so the request principal and its locks are those of a real submit.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from browser_carry_fixture import CORRECTED_DE, TEXT_DE
from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Scenario,
    accept_translation,
    add_user,
    assign,
    import_texts,
    new_project,
    start_round,
)
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import delete, func, insert, update
from sqlalchemy import select as sa_select
from sqlalchemy.exc import IntegrityError
from test_text_change_service import (
    CASE,
    THIRD_DE,
    Env,
    _audits,
    _draft,
    _env,
    _pid,
    _resolutions,
    _resolve,
    _started,
)

from ontocurator.api.app import create_app
from ontocurator.api.routes import encode_workspace_id
from ontocurator.application.document_rows import DocumentRowsService, RowQuery
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError
from ontocurator.storage.overview_tables import TextChangeResolutionRow
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
)
from ontocurator.storage.workflow_tables import WorkRoundRow

SYSTEM = "system:text_change"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "auto-carry.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    # The context starts the job worker; imports with corrections need it.
    with TestClient(application) as client:
        yield client


@pytest.fixture
def app(client: TestClient) -> Any:
    return client.app


@pytest.fixture
def env(app: Any) -> Env:
    return _env(app)


def _login(client: TestClient, scenario: Scenario, name: str) -> None:
    client.cookies.clear()
    client.headers.pop("X-CSRF-Token", None)
    response = client.post(
        "/api/v1/auth/login",
        json={"username": scenario.users[name], "password": TEST_PASSWORD},
        headers={"Origin": str(client.base_url).rstrip("/")},
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


def _submit(client: TestClient, env: Env, name: str, work: dict[str, Any]) -> str:
    """``name`` submits the round of ``work`` through the route."""
    key = work["round"].workspace_key
    _login(client, env.scenario, name)
    response = client.post(
        f"/api/v1/workspaces/{encode_workspace_id(key)}/submit",
        json={
            "mutation_id": f"submit-{uuid4().hex}",
            "expected_revision": _draft(env, key).revision,
            "payload": {"document_checked": True},
        },
    )
    assert response.status_code == 200, response.text
    return str(response.json()["submission_id"])


def _finishing(env: Env, name: str = "tom") -> dict[str, Any]:
    """``name`` works on v1; the lead lets them finish there."""
    work = _started(env, name)
    _resolve(env, work["assignment_id"], "finish_then_carry")
    return work


def _row(scenario: Scenario) -> dict[str, Any]:
    from browser_documents_scenarios import identity

    access, actor = identity(scenario, "lead")
    page = DocumentRowsService(scenario.db, actor, access).page(
        scenario.key, RowQuery()
    )
    return next(
        row
        for group in page["groups"]
        for row in group["rows"]
        if (row["case_id"], row["language"]) == (CASE, "de")
    )


def _codes(scenario: Scenario) -> list[str]:
    return [step["code"] for step in _row(scenario)["steps"]]


def _assignments(env: Env, document_id: str) -> list[Any]:
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                sa_select(AssignmentRow)
                .where(
                    AssignmentRow.project_id == _pid(env),
                    AssignmentRow.document_id == document_id,
                )
                .order_by(AssignmentRow.id)
            )
        )


def _rounds(env: Env, assignment_id: int) -> list[Any]:
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                sa_select(WorkRoundRow).where(
                    WorkRoundRow.assignment_id == assignment_id
                )
            )
        )


def _submitted(env: Env, submission_id: str) -> bool:
    with env.db.transaction() as conn:
        return (
            conn.execute(
                sa_select(SubmissionRow.submission_id).where(
                    SubmissionRow.submission_id == submission_id
                )
            ).first()
            is not None
        )


def _assert_carried(env: Env, submission_id: str, target: str) -> Any:
    finish, carried = _resolutions(env)
    assert finish.resolution == "finish_then_carry"
    assert (carried.resolution, carried.submission_id) == ("carried", submission_id)
    assert carried.assignment_id is None and carried.decided_by is None
    assert carried.to_document_id == target
    [new] = _assignments(env, target)
    [round_row] = _rounds(env, new.id)
    assert round_row.kind == "carry_forward"
    assert round_row.input_submission_ids == [submission_id]
    assert carried.round_id == round_row.round_id
    return new


def _assert_not_carried(env: Env, submission_id: str) -> None:
    assert _submitted(env, submission_id)
    assert [r.resolution for r in _resolutions(env)] == ["finish_then_carry"]
    assert _audits(env, "text_change.auto_carry") == []


# --- V8 ------------------------------------------------------------------------ #


def test_submit_on_v1_carries_to_newest_in_same_transaction(client, env):
    work = _finishing(env)
    assert _codes(env.scenario) == ["annotation_in_progress"]
    submission_id = _submit(client, env, "tom", work)
    new = _assert_carried(env, submission_id, env.docs[1])
    [audit] = _audits(env, "text_change.auto_carry")
    assert audit.details["submission_id"] == submission_id
    assert audit.details["from_assignment_id"] == work["assignment_id"]
    assert new.user_id == _assignments(env, env.docs[0])[0].user_id
    # Tom continues on v2: nothing waits for the lead.
    codes = _codes(env.scenario)
    assert "carry_text_change" not in codes
    assert "handle_text_change" not in codes


def _translation(app: Any, name: str) -> tuple[Scenario, list[str]]:
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, name)
    source = native_unit(CASE, "en", SYNTHETIC, case_id=CASE)
    current = translation_unit(CASE, "de", SYNTHETIC_DE, source=source)
    corrected = correction_unit(current, f"{SYNTHETIC_DE} Korrektur 2.")
    docs = import_texts(scenario, [source, current, corrected])
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "tom", ["annotator"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    return scenario, [docs[(CASE, "de", 1)], docs[(CASE, "de", 2)]]


def _accepted_only(scenario: Scenario, value: bool) -> None:
    with scenario.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(annotate_accepted_translations_only=value)
        )


def test_auto_carry_skipped_when_target_not_annotatable(client, app):
    # O2a: rule 3b needs an annotatable target, so the row shows "Carry to
    # v2…" only once v2 may be annotated.
    scenario, docs = _translation(app, "not-annotatable")
    accept_translation(scenario, docs[0], "translator")
    env = Env(scenario, docs)
    assignment_id = assign(scenario, docs[0], "tom", "annotate")
    work = {
        "assignment_id": assignment_id,
        "round": start_round(scenario, assignment_id, "tom"),
    }
    _resolve(env, assignment_id, "finish_then_carry")
    # v2 waits for its translation review: not annotatable any more.
    _accepted_only(scenario, True)
    submission_id = _submit(client, env, "tom", work)
    _assert_not_carried(env, submission_id)
    assert _assignments(env, docs[1]) == []
    assert "carry_text_change" not in _codes(scenario)
    _accepted_only(scenario, False)
    assert "carry_text_change" in _codes(scenario)


def test_auto_carry_skipped_when_person_left_project(client, env, monkeypatch):
    work = _finishing(env)
    from ontocurator.assignments import service as assignment_service

    original = assignment_service.AssignmentService._require_target
    # Tom leaves between his last request check and the carry (a member
    # without roles cannot submit at all, so the race is staged in the hook).

    def leave(conn: Any, project: Any, target: int, task: Any) -> None:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == project["id"],
                ProjectMembershipRow.user_id == target,
            )
        )
        original(conn, project, target, task)

    monkeypatch.setattr(
        assignment_service.AssignmentService, "_require_target", staticmethod(leave)
    )
    submission_id = _submit(client, env, "tom", work)
    monkeypatch.undo()
    _assert_not_carried(env, submission_id)
    assert _assignments(env, env.docs[1]) == []
    # The membership removal was the hook's and rolled back with it.
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                sa_select(func.count()).where(
                    ProjectMembershipRow.project_id == _pid(env),
                )
            ).scalar_one()
            > 1
        )


def test_auto_carry_to_v3_when_text_changed_twice(client, env):
    from t1_builders import correction_unit, native_unit

    work = _finishing(env)
    # A second correction arrives while Tom finishes on v1.
    first = native_unit(CASE, "de", TEXT_DE, case_id=CASE)
    second = correction_unit(first, CORRECTED_DE)
    docs = import_texts(
        env.scenario, [first, second, correction_unit(second, THIRD_DE)]
    )
    third = docs[(CASE, "de", 3)]
    submission_id = _submit(client, env, "tom", work)
    _assert_carried(env, submission_id, third)
    assert _assignments(env, env.docs[1]) == []


def _staged_failure(monkeypatch: pytest.MonkeyPatch, failure: str) -> list[str]:
    from ontocurator.application import text_changes

    calls: list[str] = []

    def broken(self: Any, conn: Any, *args: Any, **kwargs: Any) -> Any:
        calls.append(failure)
        if failure == "domain":
            raise DomainError("ASSIGNMENT_EXISTS")
        # A failing SQL statement: the finish_then_carry row is unique per
        # assignment, so a second one violates the constraint.
        row = conn.execute(
            sa_select(TextChangeResolutionRow).where(
                TextChangeResolutionRow.resolution == "finish_then_carry"
            )
        ).one()
        conn.execute(
            insert(TextChangeResolutionRow).values(
                project_id=row.project_id,
                case_id=row.case_id,
                language=row.language,
                from_document_id=row.from_document_id,
                to_document_id=row.to_document_id,
                assignment_id=row.assignment_id,
                resolution="withdrawn",
            )
        )
        raise AssertionError("the insert above must fail")

    monkeypatch.setattr(text_changes.TextChangeService, "_carry_round", broken)
    return calls


@pytest.mark.parametrize("failure", ["domain", "integrity"])
def test_submission_never_fails_because_of_the_hook(
    client, env, monkeypatch, caplog, failure
):
    work = _finishing(env)
    calls = _staged_failure(monkeypatch, failure)
    with caplog.at_level(logging.WARNING, logger="ontocurator.application"):
        submission_id = _submit(client, env, "tom", work)
    assert calls == [failure]
    _assert_not_carried(env, submission_id)
    assert _assignments(env, env.docs[1]) == []
    [logged] = [
        r for r in caplog.records if str(work["assignment_id"]) in r.getMessage()
    ]
    if failure == "integrity":
        assert logged.exc_info is not None
        assert isinstance(logged.exc_info[1], IntegrityError)
    else:
        assert "ASSIGNMENT_EXISTS" in logged.getMessage()
    monkeypatch.undo()
    # Falls back to rule 3b: the lead carries by hand.
    assert "carry_text_change" in _codes(env.scenario)


def _submit_in_thread(
    app: Any, env: Env, name: str, work: dict[str, Any]
) -> tuple[threading.Thread, dict[str, Any]]:
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            # No context: the outer client already runs the app's lifespan.
            own = TestClient(app)
            outcome["submission_id"] = _submit(own, env, name, work)
        except BaseException as error:  # reported by the test
            outcome["error"] = error

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, outcome


def _shared_holder(env: Env) -> Any:
    """Another session holding the project lock shared (as any submit does)."""
    holder = env.db.engine.connect()
    holder.execute(
        sa_select(func.pg_advisory_lock_shared(_lock_id("project", env.key)))
    )
    holder.commit()
    return holder


def _release(env: Env, holder: Any) -> None:
    holder.execute(
        sa_select(func.pg_advisory_unlock_shared(_lock_id("project", env.key)))
    )
    holder.commit()
    holder.close()


def test_submit_takes_exclusive_lock_only_with_finish_then_carry(client, app, env):
    plain = _started(env, "ana")
    flagged = _finishing(env)
    holder = _shared_holder(env)
    try:
        # A submit without the resolution shares the lock: it finishes.
        thread, outcome = _submit_in_thread(app, env, "ana", plain)
        thread.join(30)
        assert not thread.is_alive() and "error" not in outcome, outcome
        # With it the submit waits for the exclusive lock.
        thread, outcome = _submit_in_thread(app, env, "tom", flagged)
        thread.join(1.5)
        assert thread.is_alive()
    finally:
        _release(env, holder)
    thread.join(30)
    assert not thread.is_alive() and "error" not in outcome, outcome
    _assert_carried(env, outcome["submission_id"], env.docs[1])


def test_hook_does_not_deadlock_with_concurrent_submit(client, app, env):
    plain = _started(env, "ana")
    flagged = _finishing(env)
    runs = [
        _submit_in_thread(app, env, "tom", flagged),
        _submit_in_thread(app, env, "ana", plain),
    ]
    for thread, outcome in runs:
        thread.join(60)
        assert not thread.is_alive() and "error" not in outcome, outcome
    _assert_carried(env, runs[0][1]["submission_id"], env.docs[1])
    assert _submitted(env, runs[1][1]["submission_id"])


def test_auto_carry_actor(client, env):
    work = _finishing(env)
    with env.db.transaction() as conn:
        lead_id = conn.execute(
            sa_select(TextChangeResolutionRow.decided_by)
        ).scalar_one()
    assert lead_id is not None
    submission_id = _submit(client, env, "tom", work)
    new = _assert_carried(env, submission_id, env.docs[1])
    assert new.created_by is None
    [round_row] = _rounds(env, new.id)
    assert round_row.created_by is None
    with env.db.transaction() as conn:
        created = conn.execute(
            sa_select(AuditEventRow.actor_label, AuditEventRow.actor_user_id).where(
                AuditEventRow.action == "assignment.create",
                AuditEventRow.target_id == str(new.id),
            )
        ).one()
    assert tuple(created) == (SYSTEM, None)
    [audit] = _audits(env, "text_change.auto_carry")
    assert (audit.actor_label, audit.actor_user_id) == (SYSTEM, None)
    assert audit.details == {
        "from_assignment_id": work["assignment_id"],
        "submission_id": submission_id,
        "round_id": round_row.round_id,
        "finish_then_carry_decided_by": lead_id,
    }


def test_scoped_repository_passes_the_submit_options_through(env, monkeypatch):
    from browser_documents_scenarios import identity

    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.storage.repository import Repository

    seen: dict[str, Any] = {}

    def fake(self: Any, key: Any, envelope: Any, operation: Any, **kwargs: Any):
        seen.update(kwargs)
        return "result"

    work = _started(env)
    monkeypatch.setattr(Repository, "run_mutation", fake)
    access, actor = identity(env.scenario, "tom")
    scoped = ScopedRepository(env.db, access, actor)

    def hook(conn: Any, submission: Any) -> None:
        return None

    assert (
        scoped.run_mutation(
            work["round"].workspace_key,
            None,  # type: ignore[arg-type]
            lambda draft: draft,
            exclusive_project=True,
            after_submit=hook,
        )
        == "result"
    )
    assert seen == {
        "before_operation": None,
        "exclusive_project": True,
        "after_submit": hook,
    }
