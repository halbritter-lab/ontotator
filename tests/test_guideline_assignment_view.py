"""Task metadata carries the version in force and the owner's notice (G0b)."""

import hashlib
from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from sqlalchemy import insert, select, update
from test_auth_api import _app
from test_projects_api import create_project

from ontotator.api import assignment_routes
from ontotator.assignments.service import AssignmentService
from ontotator.storage.tables import AssignmentRow, DocumentRow, ProjectRow, UserRow

KEY = "phenotypes"
BASE = f"/api/v1/projects/{KEY}/guidelines"


@pytest.fixture
def team(tmp_path) -> SimpleNamespace:
    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin, KEY)
    lead = logged_in(app, "lead", pseudonym="ann-0901", projects={KEY: ["lead"]})
    annotator = logged_in(
        app, "ann", pseudonym="ann-0902", projects={KEY: ["annotator"]}
    )
    with app.state.repo.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == KEY)
        ).scalar_one()
        ann_id = conn.execute(
            select(UserRow.id).where(UserRow.username == "ann")
        ).scalar_one()
        tasks = {}
        for document, status in [("d1", "open"), ("d2", "submitted"), ("d3", "open")]:
            conn.execute(
                insert(DocumentRow).values(
                    project_id=pid,
                    document_id=document,
                    case_id=document,
                    external_id=document,
                    text="Test",
                    text_sha256=hashlib.sha256(b"Test").hexdigest(),
                    language="en",
                )
            )
            tasks[document] = conn.execute(
                insert(AssignmentRow)
                .values(
                    project_id=pid,
                    document_id=document,
                    user_id=ann_id,
                    task="annotate",
                    status=status,
                    annotation_mode="scratch",
                )
                .returning(AssignmentRow.id)
            ).scalar_one()
    return SimpleNamespace(
        app=app, lead=lead, annotator=annotator, tasks=tasks, ann_id=ann_id
    )


def publish(client, body: bytes, expected: str = "", note: str = "") -> None:
    response = client.post(
        BASE,
        files={"file": ("rules.md", body, "text/markdown")},
        data={"change_note": note, "expected_latest_version": expected},
    )
    assert response.status_code == 201, response.text


def metadata(team, document: str) -> dict:
    response = team.annotator.get(f"/api/v1/assignments/{team.tasks[document]}")
    assert response.status_code == 200, response.text
    return response.json()


def test_assignment_view_carries_current_version(team) -> None:
    publish(team.lead, b"# One")
    publish(team.lead, b"# Two", expected="1", note="Clearer")
    view = metadata(team, "d1")
    assert view["guideline"]["version"] == 2
    assert view["guideline"]["kind"] == "markdown"
    assert view["guideline"]["created_at"]
    notice = view["guideline_notice"]
    assert notice["from_version"] is None and notice["to_version"] == 2
    assert [
        (c["version"], c["change_note"], c["withdrawn"]) for c in notice["changes"]
    ] == [
        (2, "Clearer", False),
        (1, None, False),
    ]
    assert notice["more"] == 0
    team.annotator.post(f"{BASE}/2/reads", json={"event": "notified"})
    assert metadata(team, "d1")["guideline_notice"] is None
    assert metadata(team, "d1")["guideline"]["version"] == 2


def test_notice_only_on_editable_tasks_of_the_owner(team) -> None:
    publish(team.lead, b"# One")
    submitted = metadata(team, "d2")
    assert submitted["guideline_notice"] is None
    assert submitted["guideline"]["version"] == 1
    assert metadata(team, "d1")["guideline_notice"] is not None
    rows = team.lead.get(f"/api/v1/projects/{KEY}/assignments").json()
    assert rows and all(row["guideline_notice"] is None for row in rows)
    assert all(row["guideline"]["version"] == 1 for row in rows)


def test_no_notice_on_a_held_task(team) -> None:
    publish(team.lead, b"# One")
    with team.app.state.repo.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == team.tasks["d3"])
            .values(held=True)
        )
    held = metadata(team, "d3")
    assert held["guideline_notice"] is None
    assert held["guideline"]["version"] == 1
    assert metadata(team, "d1")["guideline_notice"] is not None


def test_no_version_in_force_gives_nulls(team) -> None:
    view = metadata(team, "d1")
    assert view["guideline"] is None and view["guideline_notice"] is None
    publish(team.lead, b"# One")
    team.lead.post(
        f"{BASE}/1/withdraw", json={"reason": None, "expected_latest_version": 1}
    )
    view = metadata(team, "d1")
    assert view["guideline"] is None and view["guideline_notice"] is None


def test_list_and_batch_views_query_guidelines_once_per_project(
    team, monkeypatch
) -> None:
    publish(team.lead, b"# One")
    briefs: list[set[int]] = []
    notices: list[tuple[int, int]] = []
    real_briefs = assignment_routes.guideline_briefs
    real_notice = assignment_routes.guideline_notice

    def spy_briefs(conn, project_ids):
        ids = set(project_ids)
        briefs.append(ids)
        return real_briefs(conn, ids)

    def spy_notice(conn, *, project_id, user_id):
        notices.append((project_id, user_id))
        return real_notice(conn, project_id=project_id, user_id=user_id)

    monkeypatch.setattr(assignment_routes, "guideline_briefs", spy_briefs)
    monkeypatch.setattr(assignment_routes, "guideline_notice", spy_notice)
    rows = team.lead.get(f"/api/v1/projects/{KEY}/assignments").json()
    assert len(rows) == 3
    assert len(briefs) == 1 and len(briefs[0]) == 1
    assert notices == []
    # The batch create and the other list paths call ``_views`` without an
    # owner; with an owner several editable rows still need one notice query.
    service = AssignmentService(team.app.state.repo.db)
    owned = service.list(KEY, user="ann")
    request = SimpleNamespace(app=team.app)
    briefs.clear()
    views = assignment_routes._views(request, owned)  # type: ignore[arg-type]
    assert len(briefs) == 1 and notices == []
    assert all(view.guideline_notice is None for view in views)
    briefs.clear()
    views = assignment_routes._views(request, owned, owner_id=team.ann_id)  # type: ignore[arg-type]
    assert len(briefs) == 1
    assert len(notices) == 1
    by_document = {view.document_id: view for view in views}
    assert by_document["d1"].guideline_notice is not None
    assert by_document["d3"].guideline_notice is not None
    assert by_document["d2"].guideline_notice is None
