"""The translation review gate on annotate work (spec 2026-10-25 §2)."""

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from auth_harness import HARNESS, logged_in
from browser_documents_scenarios import (
    add_user,
    finish_round,
    identity,
    import_texts,
    new_project,
    start_round,
)
from browser_documents_scenarios import assign as scenario_assign
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import event, insert, select, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all, set_rule

from ontotator.api.app import create_app
from ontotator.application.text_changes import TextChangeService
from ontotator.application.text_targets import TextRow, text_translation_statuses
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectRow,
)

BASE = "/api/v1/projects/proj"
SOURCE = "gate-en"
DE_A = "gate-de-a"
DE_B = "gate-de-b"


@pytest.fixture
def gate_env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit(SOURCE, "en", "Source text", case_id="case")
    first = translation_unit(DE_A, "de", "Zieltext A", source=source)
    second = translation_unit(
        DE_B, "de", "Zieltext B", source=source, provider="other-mt", run_id="run-2"
    )
    result = run_import(db, bundle(tmp_path, [source, first, second]))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    set_rule(db, False)
    alice = logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
    logged_in(app, "bob", projects={"proj": ["annotator"]}, assignments=[])
    for name in ("alice", "bob"):
        app.state.accounts.set_languages(HARNESS, name, ["en", "de"])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    return SimpleNamespace(app=app, db=db, alice=alice, lead=lead)


def status(env, document, value="accepted"):
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document)
            .values(translation_status=value)
        )


def assign(env, document, username="alice", **extra):
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document, "username": username}],
            "task": "annotate",
            "confirm_language": True,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def acknowledged(env, document=DE_A, username="alice"):
    result = assign(env, document, username, confirm_unreviewed_translation=True)
    assert result["refused"] == [], result
    return result["created"][0]


def audits(env, assignment_id=None):
    query = select(AuditEventRow.target_id, AuditEventRow.actor_label).where(
        AuditEventRow.action == "assignment.unreviewed_translation"
    )
    if assignment_id is not None:
        query = query.where(AuditEventRow.target_id == str(assignment_id))
    with env.db.transaction() as conn:
        return [tuple(row) for row in conn.execute(query)]


def test_rule_on_refuses_when_one_root_is_not_accepted(gate_env):
    set_rule(gate_env.db, True)
    status(gate_env, DE_A)
    refused = assign(gate_env, DE_A)
    assert refused["created"] == []
    assert refused["refused"][0]["code"] == "TRANSLATION_NOT_ACCEPTED"
    status(gate_env, DE_B)
    created = assign(gate_env, DE_A)
    assert created["refused"] == [], created
    assert created["created"][0]["document_id"] == DE_A


def test_single_assign_needs_the_acknowledgement(gate_env):
    refused = assign(gate_env, DE_A)
    assert refused["created"] == []
    assert refused["refused"][0]["code"] == "TRANSLATION_NOT_REVIEWED"
    assert audits(gate_env) == []
    created = acknowledged(gate_env)
    assert audits(gate_env) == [(str(created["id"]), "user:leader")]


def test_lead_assigning_themselves_needs_it_too(gate_env):
    refused = assign(gate_env, DE_A, "leader")
    assert refused["refused"][0]["code"] == "TRANSLATION_NOT_REVIEWED"
    created = acknowledged(gate_env, username="leader")
    assert created["task"] == "annotate"
    assert len(audits(gate_env, created["id"])) == 1


def test_native_source_and_accepted_translation_never_ask(gate_env):
    status(gate_env, DE_A)
    status(gate_env, DE_B)
    for document in (SOURCE, DE_A):
        result = assign(gate_env, document)
        assert result["refused"] == [], result
    assert audits(gate_env) == []


def test_root_statuses_read_only_the_texts_case(gate_env):
    """Runs per annotate allocation under the project lock: no project-wide scan."""
    with gate_env.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        before = text_translation_statuses(conn, pid, TextRow("case", "de"))
        conn.execute(
            insert(DocumentRow),
            [
                {
                    "project_id": pid,
                    "document_id": f"other-{i}",
                    "case_id": f"other-case-{i}",
                    "external_id": f"other-{i}",
                    "language": "de",
                    "text": "Anderer Text",
                    "text_sha256": "other-hash",
                }
                for i in range(3)
            ],
        )
    statements: list[str] = []

    def capture(_conn, _cursor, statement, *_rest):
        statements.append(statement)

    event.listen(gate_env.db.engine, "before_cursor_execute", capture)
    try:
        with gate_env.db.transaction() as conn:
            after = text_translation_statuses(conn, pid, TextRow("case", "de"))
    finally:
        event.remove(gate_env.db.engine, "before_cursor_execute", capture)
    assert after == before and len(after) == 2
    reviews = [s for s in statements if ".translation_reviews " in s]
    discards = [s for s in statements if ".discarded_variants " in s]
    assert reviews and discards, statements
    assert all("documents.case_id IN" in s for s in reviews), reviews
    assert all("discarded_variants.document_id IN" in s for s in discards), discards


def _batch(env, path, **extra):
    return env.lead.post(
        f"{BASE}/assignments/batch{path}",
        json={
            "task": "annotate",
            "language": "de",
            "rows": [{"case_id": "case", "language": "de"}],
            "mode": "one",
            "usernames": ["alice"],
            **extra,
        },
    )


def test_batch_needs_it(gate_env):
    preview = _batch(gate_env, "/preview")
    assert preview.status_code == 200, preview.text
    targets = preview.json()["targets"]
    assert {t["document_id"] for t in targets} == {DE_A, DE_B}
    assert all(t["unreviewed_translation"] for t in targets)
    digest = preview.json()["digest"]
    refused = _batch(gate_env, "", expected_preview_digest=digest)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "ASSIGNMENT_BATCH_REFUSED"
    codes = {row["code"] for row in refused.json()["details"]["refused"]}
    assert codes == {"TRANSLATION_NOT_REVIEWED"}
    with gate_env.db.transaction() as conn:
        assert conn.execute(select(AssignmentRow.id)).first() is None
    created = _batch(
        gate_env,
        "",
        expected_preview_digest=digest,
        confirm_unreviewed_translation=True,
    )
    assert created.status_code == 200, created.text
    assert len(created.json()["created"]) == 2
    assert len(audits(gate_env)) == 2


def test_confirmed_distribution_needs_it(gate_env):
    proposal = gate_env.lead.post(
        f"{BASE}/assignments/proposal",
        json={"document_ids": [DE_A], "task": "annotate", "seed": 31},
    )
    assert proposal.status_code == 200, proposal.text
    rows = [
        {"document_id": row["document_id"], "username": row["username"]}
        for row in proposal.json()["rows"]
    ]
    assert rows
    body = {"task": "annotate", "context": proposal.json()["context"], "rows": rows}
    refused = gate_env.lead.post(f"{BASE}/assignments", json=body)
    assert refused.status_code == 200, refused.text
    assert refused.json()["created"] == []
    assert {row["code"] for row in refused.json()["refused"]} == {
        "TRANSLATION_NOT_REVIEWED"
    }
    created = gate_env.lead.post(
        f"{BASE}/assignments", json=body | {"confirm_unreviewed_translation": True}
    )
    assert created.status_code == 200, created.text
    assert created.json()["refused"] == []
    assert len(audits(gate_env)) == len(rows)


def test_reassign_needs_it(gate_env):
    first = acknowledged(gate_env)
    url = f"/api/v1/assignments/{first['id']}/reassign"
    body = {"username": "bob"}
    refused = gate_env.lead.post(url, json=body)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "TRANSLATION_NOT_REVIEWED"
    assert refused.json()["details"]["document_ids"] == [DE_A]
    moved = gate_env.lead.post(
        url, json=body | {"confirm_unreviewed_translation": True}
    )
    assert moved.status_code == 200, moved.text
    assert len(audits(gate_env, moved.json()["id"])) == 1


def test_cli_assign_needs_the_flag(gate_env):
    from typer.testing import CliRunner

    from ontotator.cli import app as cli

    arguments = [
        "admin",
        "--database-url",
        gate_env.db.engine.url.render_as_string(hide_password=False),
        "assign",
        "proj",
        "alice",
        "--document",
        DE_A,
        "--confirm-language",
    ]
    runner = CliRunner()
    refused = runner.invoke(cli, arguments)
    assert refused.exit_code == 1, refused.output
    assert "TRANSLATION_NOT_REVIEWED" in refused.output
    assert audits(gate_env) == []
    created = runner.invoke(cli, [*arguments, "--confirm-unreviewed-translation"])
    assert created.exit_code == 0, created.output
    assert DE_A in created.output
    assert [label.split(":")[0] for _, label in audits(gate_env)] == ["cli"]


def test_rule_on_is_unchanged(gate_env):
    set_rule(gate_env.db, True)
    result = assign(gate_env, DE_A, confirm_unreviewed_translation=True)
    assert result["refused"][0]["code"] == "TRANSLATION_NOT_ACCEPTED"


def _rows(env):
    response = env.lead.get(f"{BASE}/document-rows")
    assert response.status_code == 200, response.text
    return {
        (row["case_id"], row["language"]): row
        for group in response.json()["groups"]
        for row in group["rows"]
    }


def test_read_model_flags(gate_env):
    rows = _rows(gate_env)
    assert rows[("case", "de")]["unreviewed_translation"] is True
    assert rows[("case", "en")]["unreviewed_translation"] is False
    created = acknowledged(gate_env)
    [item] = _rows(gate_env)[("case", "de")]["work"]
    assert item["assignment_id"] == created["id"]
    assert item["unreviewed_translation"] is True
    set_rule(gate_env.db, True)
    assert _rows(gate_env)[("case", "de")]["unreviewed_translation"] is False


# --- Move to a new version and carry (text changes) ---------------------------- #


@pytest.fixture
def change_app(tmp_path) -> Iterator[Any]:
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "unreviewed.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    # The context starts the job worker; imports with corrections need it.
    with TestClient(application):
        yield application


def test_move_to_version_and_carry_need_it(change_app):
    scenario = new_project(change_app, "unreviewed")
    source = native_unit("case-u", "en", "Source text", case_id="case-u")
    first = translation_unit("case-u", "de", "Zieltext", source=source)
    docs = import_texts(
        scenario, [source, first, correction_unit(first, "Zieltext neu")]
    )
    v1, v2 = docs[("case-u", "de", 1)], docs[("case-u", "de", 2)]
    add_user(scenario, "lead", ["lead"])
    for name in ("tom", "ana"):
        add_user(scenario, name, ["annotator"])
    with scenario.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(annotations_per_text=2)
        )
    moving = scenario_assign(scenario, v1, "tom", "annotate")
    work = scenario_assign(scenario, v1, "ana", "annotate")
    started = start_round(scenario, work, "ana")
    submission = finish_round(scenario, "ana", started.workspace_key)
    access, actor = identity(scenario, "lead")
    service = TextChangeService(scenario.db, Repository(scenario.db))

    def move(**extra: Any) -> Any:
        with scenario.db.transaction() as conn:
            revision = conn.execute(
                select(AssignmentRow.workflow_revision).where(
                    AssignmentRow.id == moving
                )
            ).scalar_one()
        return service.move_to_version(
            access,
            actor,
            moving,
            target_document_id=v2,
            expected_workflow_revision=revision,
            request_id=f"move-{uuid4().hex}",
            **extra,
        )

    def carry(**extra: Any) -> Any:
        return service.carry(
            access,
            actor,
            scenario.key,
            submission,
            target_document_id=v2,
            mode="author",
            username=None,
            confirm_language=False,
            request_id=f"carry-{uuid4().hex}",
            **extra,
        )

    for call in (move, carry):
        with pytest.raises(DomainError) as refused:
            call()
        assert refused.value.code == "TRANSLATION_NOT_REVIEWED"
        assert refused.value.details == {"document_ids": [v2]}
        call(confirm_unreviewed_translation=True)
    with scenario.db.transaction() as conn:
        audited = conn.execute(
            select(AuditEventRow.details["document_id"].as_string()).where(
                AuditEventRow.action == "assignment.unreviewed_translation"
            )
        ).scalars()
        # One for the confirmed move, one for the carry (v1 work audited too).
        assert list(audited).count(v2) == 2
