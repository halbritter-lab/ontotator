"""Bounded ontology upload and administration visibility."""

from pathlib import Path

from auth_harness import logged_in
from test_auth_api import _app
from test_projects_api import create_project

HP = Path(__file__).parent / "fixtures" / "hp.json"


def test_an_admin_uploads_an_ontology_and_sees_its_projects(tmp_path):
    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    response = admin.post(
        "/api/v1/admin/ontologies/",
        files=[("files[]", ("hp.json", HP.read_bytes(), "application/json"))],
    )
    assert response.status_code == 200, response.text
    create_project(app, admin)
    assert admin.get("/api/v1/admin/ontologies/").json()[0]["projects"] == [
        "phenotypes"
    ]


def test_a_second_upload_of_the_same_file_is_idempotent(tmp_path):
    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    files = [("files[]", ("hp.json", HP.read_bytes(), "application/json"))]
    first = admin.post("/api/v1/admin/ontologies/", files=files)
    second = admin.post("/api/v1/admin/ontologies/", files=files)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(admin.get("/api/v1/admin/ontologies/").json()) == 1


def test_a_lead_cannot_upload_ontologies(tmp_path):
    app = _app(tmp_path)
    lead = logged_in(app, "lead")
    result = lead.post(
        "/api/v1/admin/ontologies/",
        files=[("files[]", ("hp.json", HP.read_bytes(), "application/json"))],
    )
    assert result.status_code == 403


def test_upload_limit_is_aggregate_and_stores_nothing_on_overflow(tmp_path):
    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    app.state.config.max_ontology_bytes = len(HP.read_bytes()) + 1
    result = admin.post(
        "/api/v1/admin/ontologies/",
        files=[
            ("files[]", ("hp.json", HP.read_bytes(), "application/json")),
            ("files[]", ("hp2.json", HP.read_bytes(), "application/json")),
        ],
    )
    assert result.status_code == 413, result.text
    assert app.state.ontology_store.list() == []
