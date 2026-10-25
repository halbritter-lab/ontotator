"""The translation review gate on annotate work (spec 2026-10-25 §2)."""

from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from sqlalchemy import update
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all, set_rule

from ontocurator.storage.tables import DocumentRow

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
    alice = logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
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
