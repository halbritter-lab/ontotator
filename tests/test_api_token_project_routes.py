"""Project tokens on routes that name a task, round, report or review (issue 351).

These routes have no project in the path. They find the project of the id
they name themselves, so a project token reaches them in its own project and
gets the same 404 as for an unknown id in any other one, even when its owner
may see that project. The server's version and the token's user are open to
every token.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from auth_harness import ORIGIN, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from proposal_check_support import assign, proposal_env
from t1_fixtures import create_project
from test_consolidation_read_api import _access
from test_document_rows_submissions import _submit_consolidation
from test_translation_review_task import assigned

from ontotator.api.token_scopes import requirement
from ontotator.authz.scoped import ScopedRepository

pytest_plugins = ("test_consolidation_read_api", "test_translation_review_task")


def _token(client: TestClient, project: str, scopes: list[str]) -> str:
    response = client.post(
        f"/api/v1/projects/{project}/tokens",
        json={"name": "pipeline", "scopes": scopes},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["secret"])


def _bearer(app: FastAPI, secret: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {secret}", **ORIGIN})


def _tokens(app: FastAPI, scopes: list[str]) -> SimpleNamespace:
    """``leader`` leads ``proj`` (also annotating there) and ``other``.

    ``own`` is a project token of ``proj``, ``foreign`` one of ``other``: the
    owner may see ``proj`` with both, so a 404 for ``foreign`` comes from the
    token alone.
    """
    create_project(app.state.repo.db, key="other")
    lead = logged_in(
        app,
        "leader",
        projects={"proj": ["lead", "annotator"], "other": ["lead"]},
        assignments=[],
    )
    return SimpleNamespace(
        lead=lead,
        own=_bearer(app, _token(lead, "proj", scopes)),
        foreign=_bearer(app, _token(lead, "other", scopes)),
    )


def _hidden(response: Any, code: str) -> None:
    assert response.status_code == 404, response.text
    assert response.json()["code"] == code


def _same_as_session(token: TestClient, session: TestClient, path: str) -> Any:
    """GET ``path`` with the token; it answers 200 exactly as the session does."""
    response = token.get(path)
    assert response.status_code == 200, (path, response.text)
    assert response.json() == session.get(path).json(), path
    return response.json()


def test_the_resolved_routes_are_open_to_project_tokens() -> None:
    for method, path in [
        ("GET", "/api/v1/assignments/7"),
        ("GET", "/api/v1/assignments/7/submissions"),
        ("GET", "/api/v1/assignments/7/rounds"),
        ("POST", "/api/v1/assignments/7/rounds"),
        ("GET", "/api/v1/assignments/7/round-sources"),
        # Issue 345: the text-change routes.
        ("POST", "/api/v1/assignments/7/move-to-version"),
        ("POST", "/api/v1/assignments/7/text-change-resolution"),
        ("GET", "/api/v1/problem-reports/r-1"),
        ("GET", "/api/v1/problem-reports/r-1/pause-candidates"),
        ("POST", "/api/v1/problem-reports/r-1/actions"),
        ("GET", "/api/v1/rounds/r-1/inputs"),
        ("GET", "/api/v1/rounds/r-1/consolidation"),
        ("GET", "/api/v1/translation-reviews/7"),
        ("GET", "/api/v1/translation-reviews/7/source-obligations"),
        ("GET", "/api/v1/about"),
        ("GET", "/api/v1/auth/me"),
    ]:
        needed = requirement(method, path)
        assert needed is not None, path
        assert needed.project_token is True, path
        assert needed.project_key is None, path
    # Annotation work on these ids stays with the browser session.
    for method, path in [
        ("POST", "/api/v1/problem-reports/r-1/seen"),
        ("POST", "/api/v1/rounds/r-1/open"),
        ("PUT", "/api/v1/translation-reviews/7/draft"),
        # Issue 345: a translation review is personal work.
        ("POST", "/api/v1/translation-reviews/7/submit"),
    ]:
        needed = requirement(method, path)
        assert needed is not None and needed.project_token is False, path


def test_every_token_reads_the_version_and_its_user(tmp_path) -> None:
    env = proposal_env(tmp_path)
    for scopes in (["read"], ["import"], ["export"], ["project-admin"]):
        client = _bearer(env.app, _token(env.lead, "proj", scopes))
        about = client.get("/api/v1/about")
        assert about.status_code == 200, (scopes, about.text)
        assert about.json()["version"]
        me = client.get("/api/v1/auth/me")
        assert me.status_code == 200, (scopes, me.text)
        assert me.json()["username"] == "leader"
        assert me.json()["csrf_token"] == ""


def test_a_project_token_reaches_tasks_rounds_and_reports_of_its_project(
    tmp_path,
) -> None:
    env = proposal_env(tmp_path)
    tokens = _tokens(env.app, ["read", "project-admin"])
    task = assign(env, env.c1, "leader")["id"]
    reads = [
        f"/api/v1/assignments/{task}",
        f"/api/v1/assignments/{task}/submissions",
        f"/api/v1/assignments/{task}/rounds",
        f"/api/v1/assignments/{task}/round-sources",
    ]
    for path in reads:
        _hidden(tokens.foreign.get(path), "ASSIGNMENT_NOT_FOUND")
    start = {"request_id": "token-round", "expected_workflow_revision": 0}
    _hidden(
        tokens.foreign.post(f"/api/v1/assignments/{task}/rounds", json=start),
        "ASSIGNMENT_NOT_FOUND",
    )
    created = tokens.own.post(f"/api/v1/assignments/{task}/rounds", json=start)
    assert created.status_code == 200, created.text
    round_id = created.json()["round_id"]
    for path in reads:
        _same_as_session(tokens.own, tokens.lead, path)
    listed = tokens.own.get(f"/api/v1/assignments/{task}/rounds").json()
    assert [item["round_id"] for item in listed] == [round_id]

    inputs = f"/api/v1/rounds/{round_id}/inputs"
    _same_as_session(tokens.own, tokens.lead, inputs)
    _hidden(tokens.foreign.get(inputs), "ROUND_NOT_FOUND")
    _hidden(
        tokens.foreign.get(f"/api/v1/rounds/{round_id}/consolidation"),
        "ROUND_NOT_FOUND",
    )

    task_view = tokens.lead.get(f"/api/v1/assignments/{task}").json()
    reported = tokens.lead.post(
        f"/api/v1/assignments/{task}/problem-reports",
        json={
            "request_id": "report",
            "expected_workflow_revision": task_view["workflow_revision"],
            "round_id": round_id,
            "reason": "The text is cut off",
        },
    )
    assert reported.status_code == 200, reported.text
    report = f"/api/v1/problem-reports/{reported.json()['report_id']}"
    action = {
        "request_id": "resolve",
        "expected_revision": 1,
        "action": "resolve",
        "reason": "Text replaced",
    }
    for response in (
        tokens.foreign.get(report),
        tokens.foreign.get(f"{report}/pause-candidates"),
        tokens.foreign.post(f"{report}/actions", json=action),
    ):
        _hidden(response, "REPORT_NOT_FOUND")
    _same_as_session(tokens.own, tokens.lead, report)
    _same_as_session(tokens.own, tokens.lead, f"{report}/pause-candidates")
    resolved = tokens.own.post(f"{report}/actions", json=action)
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["state"] == "resolved"


def test_a_project_token_reads_a_consolidation_of_its_project(cons) -> None:
    env = cons.env
    tokens = _tokens(env.app, ["read"])
    adj_access, adj_actor = _access(env, "adj", "adjudicator")
    reviewer = ScopedRepository(env.db, adj_access, adj_actor)
    _submit_consolidation(env.app.state.ontology_registry, reviewer, cons.round)
    for path in (
        f"/api/v1/rounds/{cons.round.round_id}/consolidation",
        f"/api/v1/rounds/{cons.round.round_id}/inputs",
    ):
        _hidden(tokens.foreign.get(path), "ROUND_NOT_FOUND")
        body = _same_as_session(tokens.own, tokens.lead, path)
        assert body
    _hidden(tokens.own.get("/api/v1/rounds/no-such-round/inputs"), "ROUND_NOT_FOUND")


def test_a_project_token_reads_a_translation_review_of_its_project(
    case_env,
) -> None:
    env = case_env
    tokens = _tokens(env.app, ["read"])
    # A new role ended the lead's earlier session.
    env.lead = tokens.lead
    row = assigned(env, username="leader")
    for path in (
        f"/api/v1/translation-reviews/{row['id']}",
        f"/api/v1/translation-reviews/{row['id']}/source-obligations",
    ):
        _hidden(tokens.foreign.get(path), "ASSIGNMENT_NOT_FOUND")
        _same_as_session(tokens.own, tokens.lead, path)
