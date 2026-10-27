"""A project whose c1-en text has three tool proposals and c2-en none.

Shared by the proposal-check tests of P3, P4, P5, P6 and P8.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from sqlalchemy import select, update

BASE = "/api/v1/projects/proj"
PEOPLE = (("anno", "Anne Notator"), ("anno2", "Arne Notator"), ("tom", "Tom Reis"))


def doc(case: str) -> str:
    """Document ID of the version-1 English text of ``case``."""
    return f"{case}-en"


def proposal_env(
    tmp_path: Any, *, per_text: int = 2, mode: str = "proposals"
) -> SimpleNamespace:
    from auth_harness import grant, logged_in
    from t1_builders import bundle, native_unit
    from t1_fixtures import TEXT, annotation, create_project, run_import
    from test_auth_api import _app
    from work_plan_support import _user

    from ontotator.domain.work_plans import PlanFlags, RowKey
    from ontotator.storage import work_plan_store as store
    from ontotator.storage.tables import ProjectRow

    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    seizure = TEXT.index("Krampfanfälle")
    second = TEXT.rindex("Krampfanfälle")
    period = TEXT.index("Neonatalzeit")
    proposals = [
        annotation("p1", (seizure, seizure + len("Krampfanfälle")), text=TEXT),
        annotation(
            "p2",
            (period, period + len("Neonatalzeit")),
            text=TEXT,
            term_id="HP:0001250",
        ),
        annotation(
            "p3", (second, second + len("Krampfanfälle")), text=TEXT, assertion="absent"
        ),
    ]
    c1 = native_unit(doc("c1"), "en", TEXT, case_id="c1", annotations=proposals)
    units = [c1, native_unit(doc("c2"), "en", f"{TEXT} c2", case_id="c2")]
    job = run_import(db, bundle(tmp_path, units))
    assert job.status == "succeeded", job.error
    for username, name in PEOPLE:
        _user(app, username, name)
        assert grant(app, username, "proj", ["annotator"])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == pid)
            .values(
                annotations_per_text=per_text,
                tool_proposal_mode=mode,
                annotate_accepted_translations_only=False,
            )
        )
        store.write_rows(
            conn,
            pid,
            {
                RowKey("c1", "en"): PlanFlags(False, True),
                RowKey("c2", "en"): PlanFlags(False, True),
            },
            actor_id=None,
        )
    return SimpleNamespace(
        app=app,
        db=db,
        pid=pid,
        lead=lead,
        c1=doc("c1"),
        c2=doc("c2"),
        c1_unit=c1,
        tmp_path=tmp_path,
    )


def client(env: SimpleNamespace, username: str) -> Any:
    from auth_harness import logged_in

    return logged_in(env.app, username, assignments=[])


def assign_response(
    env: SimpleNamespace, document_id: str, username: str, *, by: Any = None
) -> Any:
    """``POST /projects/proj/assignments`` with one annotate row (the row-list
    path without ``context``: ``AssignmentService.assign``)."""
    return (by or env.lead).post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document_id, "username": username}],
            "task": "annotate",
            "confirm_language": True,
        },
    )


def refused_code(env: SimpleNamespace, document_id: str, username: str) -> str:
    """The refusal code of one assign row (the route answers 200 with it)."""
    response = assign_response(env, document_id, username)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == [], body
    return str(body["refused"][0]["code"])


def assign(env: SimpleNamespace, document_id: str, username: str) -> dict[str, Any]:
    """Assign one annotate row as the lead; the created ``AssignmentView``."""
    response = assign_response(env, document_id, username)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["refused"] == [], body
    return dict(body["created"][0])


def open_task(
    env: SimpleNamespace, username: str, assignment_id: int
) -> dict[str, Any]:
    response = client(env, username).post(f"/api/v1/assignments/{assignment_id}/open")
    assert response.status_code == 200, response.text
    return dict(response.json())
