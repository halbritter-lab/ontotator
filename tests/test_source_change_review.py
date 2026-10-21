"""Source-change reviews: "Assign review…" for a changed source (plan O2c).

Spec "Assign review… for a changed source", "Operations" 5, VD14: a review
of an accepted translation whose source text changed is assignable only
while its ``SOURCE_UPDATE_UNREVIEWED`` obligation is unresolved; it bypasses
``translation_already_accepted`` and turns Review on (D26 pattern). Each test
builds its own project: an English source v1, its German translation and a
correction of the source (v2).
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Scenario,
    accept_translation,
    add_user,
    identity,
    import_texts,
    new_project,
)
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select as sa_select

from ontocurator.api.app import create_app
from ontocurator.application.document_rows import DocumentRowsService, RowQuery
from ontocurator.auth.audit import Actor
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.tables import AssignmentRow, AuditEventRow, ProjectRow

CASE = "case-0042"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "source-change.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    # The context starts the job worker; imports with corrections need it.
    with TestClient(application) as client:
        yield client


@pytest.fixture
def app(client: TestClient) -> Any:
    return client.app


def _project(app: Any, name: str, *, source_changed: bool = True) -> Scenario:
    """de translates en v1 and is accepted; the source then gets v2."""
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, name)
    source = native_unit(CASE, "en", SYNTHETIC, case_id=CASE)
    units = [source, translation_unit(CASE, "de", SYNTHETIC_DE, source=source)]
    if source_changed:
        units.append(correction_unit(source, f"{SYNTHETIC} She also has a rash."))
    docs = import_texts(scenario, units)
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    add_user(scenario, "reviewer", ["annotator"], qualification="Physician")
    _DE[scenario.key] = docs[(CASE, "de", 1)]
    accept_translation(scenario, _de(scenario), "translator")
    return scenario


# The German translation of each test project, by project key.
_DE: dict[str, str] = {}


def _de(scenario: Scenario) -> str:
    return _DE[scenario.key]


def _pid(scenario: Scenario) -> int:
    with scenario.db.transaction() as conn:
        return int(
            conn.execute(
                sa_select(ProjectRow.id).where(ProjectRow.project_key == scenario.key)
            ).scalar_one()
        )


def _assign(scenario: Scenario, **kwargs: Any) -> Any:
    from ontocurator.assignments.service import AssignmentService

    _access, actor = identity(scenario, "lead")
    return AssignmentService(scenario.db).assign(
        actor,
        scenario.key,
        _de(scenario),
        scenario.users["reviewer"],
        "translation_review",
        **kwargs,
    )


def _row(scenario: Scenario) -> dict[str, Any]:
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


def _codes(row: dict[str, Any]) -> list[str]:
    return [step["code"] for step in row["steps"]]


def _batch(scenario: Scenario, review_reason: str | None) -> tuple[Any, Any]:
    from ontocurator.assignments.batch import BatchAssignmentService, BatchSpec

    access, actor = identity(scenario, "lead")
    service = BatchAssignmentService(scenario.db, actor, access)
    spec = BatchSpec(
        task="translation_review",
        language="de",
        case_ids=(CASE,),
        mode="one",
        usernames=(scenario.users["reviewer"],),
        review_reason=review_reason,  # type: ignore[arg-type]
    )
    return service, spec


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


def test_assign_review_with_source_changed_bypasses_already_accepted(client, app):
    scenario = _project(app, "source-review")
    with pytest.raises(DomainError) as refused:
        _assign(scenario)
    assert refused.value.code == "NOT_A_TRANSLATION"
    created = _assign(scenario, review_reason="source_changed")
    assert (created.task, created.document_id) == ("translation_review", _de(scenario))
    assert "review_source_change" not in _codes(_row(scenario))
    # Single assign through the route: the reason is passed through.
    other = _project(app, "source-review-api")
    _login(client, other, "lead")
    body = {
        "rows": [
            {"document_id": _de(other), "username": other.users["reviewer"]},
        ],
        "task": "translation_review",
    }
    response = client.post(f"/api/v1/projects/{other.key}/assignments", json=body)
    assert response.status_code == 200, response.text
    assert [r["code"] for r in response.json()["refused"]] == ["NOT_A_TRANSLATION"]
    response = client.post(
        f"/api/v1/projects/{other.key}/assignments",
        json=body | {"review_reason": "source_changed"},
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["created"]) == 1
    # The reason belongs to a translation review only: refused as a request.
    response = client.post(
        f"/api/v1/projects/{other.key}/assignments",
        json=body | {"task": "annotate", "review_reason": "source_changed"},
    )
    assert response.status_code == 422, response.text


def test_batch_assign_review_with_source_changed(app):
    scenario = _project(app, "source-batch")
    service, plain = _batch(scenario, None)
    assert service.preview(scenario.key, plain)["targets"] == []
    service, spec = _batch(scenario, "source_changed")
    preview = service.preview(scenario.key, spec)
    assert [t["document_id"] for t in preview["targets"]] == [_de(scenario)]
    created = service.commit(scenario.key, spec, expected_digest=preview["digest"])
    assert [a.document_id for a in created] == [_de(scenario)]
    # The open review now fills the slot: no second target.
    assert service.preview(scenario.key, spec)["targets"] == []


def test_refused_without_obligation(app):
    scenario = _project(app, "no-source-change", source_changed=False)
    with pytest.raises(DomainError) as refused:
        _assign(scenario, review_reason="source_changed")
    assert refused.value.code == "SOURCE_REVIEW_NOT_NEEDED"
    service, spec = _batch(scenario, "source_changed")
    preview = service.preview(scenario.key, spec)
    assert preview["targets"] == []
    assert [s["reason"] for s in preview["skipped"]] == ["step_differs"]


def test_refused_for_a_row_not_in_the_plan(app):
    # Single and batch share the precondition: Review or Annotate on.
    scenario = _project(app, "source-review-out")
    with scenario.db.transaction() as conn:
        store.write_rows(
            conn,
            _pid(scenario),
            {RowKey(CASE, "de"): PlanFlags(False, False)},
            actor_id=None,
        )
    with pytest.raises(DomainError) as refused:
        _assign(scenario, review_reason="source_changed")
    assert refused.value.code == "SOURCE_REVIEW_NOT_NEEDED"
    assert refused.value.details == {"reason": "not_in_plan"}
    service, spec = _batch(scenario, "source_changed")
    preview = service.preview(scenario.key, spec)
    assert preview["targets"] == []
    assert [s["reason"] for s in preview["skipped"]] == ["not_in_plan"]
    with scenario.db.transaction() as conn:
        flags = store.effective_plan(conn, _pid(scenario), [CASE])
    assert flags[RowKey(CASE, "de")] == PlanFlags(False, False)


def test_turns_review_on_with_audit(app):
    scenario = _project(app, "source-review-off")
    pid = _pid(scenario)
    key = RowKey(CASE, "de")
    with scenario.db.transaction() as conn:
        store.write_rows(conn, pid, {key: PlanFlags(False, True)}, actor_id=None)
    _assign(scenario, review_reason="source_changed")
    with scenario.db.transaction() as conn:
        flags = store.effective_plan(conn, pid, [CASE])
        audits = conn.execute(
            sa_select(AuditEventRow.action).where(
                AuditEventRow.project_id == pid,
                AuditEventRow.action == "work_plan.update",
            )
        ).all()
    assert flags[key] == PlanFlags(True, True)
    assert audits


def test_accepting_resolves_the_obligation_and_clears_6a(app):
    from ontocurator.application.translation_workflow import (
        TranslationWorkflowService,
    )

    scenario = _project(app, "source-resolve")
    assert "review_source_change" in _codes(_row(scenario))
    assignment = _assign(scenario, review_reason="source_changed")
    access, _actor = identity(scenario, "reviewer")
    workflow = TranslationWorkflowService(scenario.db, scenario.app.state.jobs)
    [cause] = workflow.obligations(access, assignment.id)
    opened = workflow.reviews.open(access, assignment.id)
    revision = workflow.reviews.save_draft(
        access,
        assignment.id,
        expected_revision=opened.draft.revision,
        text=opened.text,
        form={"decision": "accepted_unchanged", "clinical_change": False},
    )
    workflow.resolve(
        access,
        assignment.id,
        cause["cause_id"],
        expected_revision=revision,
        translation_text_sha256=cause["translation_text_sha256"],
        old_source_text_sha256=cause["old_source_text_sha256"],
        new_source_text_sha256=cause["new_source_text_sha256"],
    )
    row = _row(scenario)
    assert "review_source_change" not in _codes(row)
    assert not [i for i in row["issues"] if i["code"] == "SOURCE_UPDATE_UNREVIEWED"]
    # Resolved: a second source-change review is not needed any more.
    with pytest.raises(DomainError) as refused:
        from ontocurator.assignments.service import AssignmentService

        AssignmentService(scenario.db).assign(
            Actor.cli(),
            scenario.key,
            _de(scenario),
            scenario.users["translator"],
            "translation_review",
            review_reason="source_changed",
        )
    assert refused.value.code == "SOURCE_REVIEW_NOT_NEEDED"
    with scenario.db.transaction() as conn:
        assert (
            conn.execute(
                sa_select(AssignmentRow.status).where(AssignmentRow.id == assignment.id)
            ).scalar_one()
            == "submitted"
        )
