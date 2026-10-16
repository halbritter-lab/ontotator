"""Real case/text HTTP reads; sibling text never grants annotation authority."""

import hashlib
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from auth_harness import HARNESS, logged_in
from sqlalchemy import delete, event, func, select, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import TEXT, annotation, create_project, run_import
from test_auth_api import _app

from ontocurator.assignments.service import AssignmentService
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.storage.tables import (
    AssignmentRow,
    DraftRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)

CASE = "EN 1/7 #é"
SOURCE = "source/id #é"
TARGET = "translated/id #é"
CORRECTED = f"{TARGET}~de~v2"
BASE = "/api/v1/projects/proj"


def path(document, suffix):
    return f"{BASE}/documents/{quote(document, safe='')}/{suffix}"


@pytest.fixture
def case_env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    # This fixture isolates read authority; Task6 covers the default-on work gate.
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotate_accepted_translations_only=False)
        )
    source = native_unit(
        SOURCE, "en", TEXT, case_id=CASE, annotations=[annotation("s1", (6, 19))]
    )
    target = translation_unit(TARGET, "de", TEXT + " translated", source=source)
    target = target.model_copy(
        update={
            "annotation_set": target.annotation_set.model_copy(
                update={"annotations": source.annotation_set.annotations}
            )
        }
    )
    corrected = correction_unit(target, TEXT + " corrected")
    other = native_unit("other", "fr", "Unrelated", case_id="other-case")
    result = run_import(db, bundle(tmp_path, [source, target, corrected, other]))
    assert result.status == "succeeded", result.error
    alice = logged_in(
        app,
        "alice",
        projects={"proj": ["annotator"]},
        assignments=[("proj", SOURCE, "annotate")],
    )
    reviewer = logged_in(
        app,
        "reviewer",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", TARGET, "review")],
    )
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    admin = logged_in(app, "root", system_admin=True, assignments=[])
    return SimpleNamespace(
        app=app, db=db, alice=alice, reviewer=reviewer, lead=lead, admin=admin
    )


def test_special_ids_case_metadata_and_typed_immutable_text(case_env):
    env = case_env
    with env.db.transaction() as conn:
        before = conn.execute(select(func.count()).select_from(DraftRow)).scalar_one()
    cases = env.alice.get(f"{BASE}/cases")
    assert cases.status_code == 200, cases.text
    assert [item["case_id"] for item in cases.json()] == [CASE]
    detail = env.alice.get(f"{BASE}/cases/{quote(CASE, safe='')}")
    assert detail.status_code == 200, detail.text
    variants = {item["document_id"]: item for item in detail.json()["variants"]}
    assert set(variants) == {SOURCE, TARGET, CORRECTED}
    assert variants[SOURCE]["assigned_to_me"] is True
    assert variants[TARGET]["assigned_to_me"] is False
    metadata = env.alice.get(path(TARGET, "variant"))
    assert metadata.status_code == 200, metadata.text
    assert metadata.json() == variants[TARGET]
    assert variants[TARGET]["translation"]["provider"] == "test-mt"
    assert variants[TARGET]["translation"]["checks"][0]["code"] == "units_added"
    assert not {"text", "payload", "annotations", "evidence"} & variants[TARGET].keys()
    response = env.alice.get(path(TARGET, "text"))
    assert response.status_code == 200, response.text
    assert response.json() == {
        "document_id": TARGET,
        "text": TEXT + " translated",
        "text_sha256": hashlib.sha256((TEXT + " translated").encode()).hexdigest(),
    }
    assert env.alice.get(path("other", "text")).status_code == 404
    assert env.alice.get(path("other", "variant")).status_code == 404
    assert env.alice.get(path("missing", "variant")).status_code == 404
    assert env.alice.get(f"{BASE}/cases/other-case").status_code == 404
    with env.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(DraftRow)).scalar_one()
            == before
        )
    tasks = env.alice.get("/api/v1/me/tasks").json()
    assert tasks[0]["assignment_id"] > 0 and tasks[0]["document_id"] == SOURCE
    work = env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": TARGET, "mode": "independent"},
    )
    assert work.status_code != 200


@pytest.mark.parametrize("change", ["submitted", "revoked", "role", "inactive"])
def test_current_authority_and_retained_submitted_sibling_text(case_env, change):
    env = case_env
    user = env.app.state.accounts.get_by_username("alice")
    stale = ScopedRepository(
        env.db,
        Access(user.id, user.pseudonym, False, {"proj": frozenset({"annotator"})}),
    )
    with env.db.transaction() as conn:
        if change == "role":
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == user.id
                )
            )
        elif change == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == user.id).values(active=False)
            )
        else:
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.user_id == user.id)
                .values(
                    **(
                        {"status": "submitted"}
                        if change == "submitted"
                        else {"revoked_at": func.now()}
                    )
                )
            )
    if change == "submitted":
        assert stale.get_variant_text("proj", TARGET).text == TEXT + " translated"
        assert env.alice.get(path(TARGET, "text")).status_code == 200
        assert env.alice.get(path(TARGET, "variant")).status_code == 200
    else:
        from ontocurator.domain.errors import DomainError

        with pytest.raises(DomainError):
            stale.get_variant_text("proj", TARGET)
        assert env.alice.get(path(TARGET, "text")).status_code in (401, 404)
        assert env.alice.get(path(TARGET, "variant")).status_code in (401, 404)


def test_another_qualifying_sibling_restores_only_text(case_env):
    env = case_env
    service = AssignmentService(env.db)
    old = service.list("proj", user="alice")[0]
    service.assign(
        HARNESS, "proj", CORRECTED, "alice", "annotate", confirm_language=True
    )
    service.revoke(HARNESS, old.id)
    assert env.alice.get(path(TARGET, "text")).status_code == 200
    assert env.alice.get(path(TARGET, "annotation-versions")).json() == []


def test_document_list_composes_metadata_filters_without_sibling_expansion(case_env):
    env = case_env
    ordinary = env.alice.get(f"{BASE}/documents").json()
    assert [item["document_id"] for item in ordinary] == [SOURCE]
    rows = env.lead.get(
        f"{BASE}/documents",
        params={
            "origin": "machine_translation",
            "translation_status": "ready_for_review",
            "language": "de",
            "q": "translated/",
        },
    ).json()
    assert [row["document_id"] for row in rows] == [TARGET]
    assert {
        "case_id",
        "external_id",
        "version",
        "origin",
        "translation_status",
        "status_reason",
    } <= rows[0].keys()
    assert not {"text", "payload", "annotations", "evidence"} & rows[0].keys()
    assert (
        env.lead.get(
            f"{BASE}/cases",
            params={"origin": "machine_translation", "status": "ready_for_review"},
        ).json()[0]["variants"][0]["document_id"]
        == TARGET
    )


def test_case_lists_use_bounded_metadata_only_queries(case_env):
    statements = []

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    event.listen(case_env.db.engine, "before_cursor_execute", capture)
    try:
        response = case_env.lead.get(f"{BASE}/cases")
    finally:
        event.remove(case_env.db.engine, "before_cursor_execute", capture)
    assert response.status_code == 200
    selects = [sql for sql in statements if sql.lstrip().startswith("select")]
    assert len(selects) <= 18
    assert not any(
        "documents.text," in sql or "documents.text as" in sql or ".payload" in sql
        for sql in selects
    )


def test_management_cannot_list_versions_or_pending_items_for_a_missing_document(
    case_env,
):
    for suffix in ("annotation-versions", "reanchor-items"):
        response = case_env.lead.get(path("missing/document #é", suffix))
        assert response.status_code == 404, response.text


@pytest.mark.parametrize(
    "document",
    [
        "x/annotation-versions/own/y",
        "x/text/variant #é%",
        "literal%2F/annotation-versions/own/y",
    ],
)
def test_encoded_opaque_document_routes_keep_exact_identity(
    case_env, tmp_path, document
):
    env = case_env
    unit = native_unit(document, "en", "Exact opaque text", case_id=document)
    (tmp_path / "opaque").mkdir()
    result = run_import(env.db, bundle(tmp_path / "opaque", [unit]))
    assert result.status == "succeeded", result.error
    AssignmentService(env.db).assign(
        HARNESS, "proj", document, "alice", "annotate", confirm_language=True
    )
    for suffix in ("text", "variant"):
        response = env.alice.get(path(document, suffix))
        assert response.status_code == 200, response.text
        assert response.json()["document_id"] == document
    assert env.alice.get(path(document, "text")).json()["text"] == "Exact opaque text"
    assert env.alice.get(path(document, "annotation-versions")).json() == []
    detail = env.alice.get(f"{BASE}/cases/{quote(document, safe='')}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["case_id"] == document
    from fastapi.testclient import TestClient

    mounted = TestClient(env.app, root_path="/mount é")
    mounted.cookies.update(env.alice.cookies)
    try:
        mounted_response = mounted.get(path(document, "text"))
        assert mounted_response.status_code == 200, mounted_response.text
        assert mounted_response.json()["document_id"] == document
    finally:
        mounted.close()
    anonymous = TestClient(env.app)
    try:
        assert anonymous.get(path(document, "text")).status_code == 401
    finally:
        anonymous.close()
    assert env.reviewer.get(path(document, "text")).status_code == 404
    assert env.alice.get(path(document + "/missing", "variant")).status_code == 404


@pytest.mark.parametrize("with_raw_path", [False, True])
def test_encoded_route_without_optional_raw_path_retains_normal_stack_behavior(
    with_raw_path,
):
    from fastapi import FastAPI
    from starlette.routing import Match

    from ontocurator.api.encoded_routes import EncodedParameterRoute

    def endpoint(doc: str):
        return doc

    route = EncodedParameterRoute("/documents/{doc:path}/text", endpoint)
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/mount/documents/literal%2F/id/text",
        "root_path": "/mount",
        "app": FastAPI(),
    }
    scope["path_params"] = {"mounted": "literal%2F"}
    if with_raw_path:
        scope["raw_path"] = b"/mount/documents/literal%252F%2Fid/text"
    before = dict(scope)
    match, child = route.matches(scope)
    assert match == Match.FULL
    assert child["path_params"] == {"mounted": "literal%2F", "doc": "literal%2F/id"}
    assert scope == before
