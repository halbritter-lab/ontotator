"""Technical reports (#259): any user sends one, only administrators handle it."""

from pathlib import Path

import pytest
from auth_harness import logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_auth_api import _app

from ontotator.application.technical_reports import (
    MAX_REPORTS_PER_WINDOW,
    TechnicalReportService,
)
from ontotator.auth.audit import Actor
from ontotator.domain.errors import AccessDenied
from ontotator.storage.report_tables import TechnicalReportRow
from ontotator.storage.tables import AuditEventRow

URL = "/api/v1/technical-reports"
ADMIN = "/api/v1/admin/technical-reports"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return _app(tmp_path)


def _body(request_id: str = "r1", **context: object) -> dict[str, object]:
    return {
        "request_id": request_id,
        "description": "The documents page shows an error.",
        "context": context,
    }


def _rows(app: FastAPI) -> list[dict[str, object]]:
    with app.state.repo.db.transaction() as conn:
        return [
            dict(row)
            for row in conn.execute(
                select(TechnicalReportRow.__table__).order_by(TechnicalReportRow.id)
            ).mappings()
        ]


def _audits(app: FastAPI) -> list[tuple[str, str, dict[str, object]]]:
    with app.state.repo.db.transaction() as conn:
        return [
            (row.action, row.target_id, row.details)
            for row in conn.execute(
                select(AuditEventRow)
                .where(AuditEventRow.target_type == "technical_report")
                .order_by(AuditEventRow.id)
            )
        ]


def test_a_user_reports_and_gets_a_reference_with_context(app):
    alice = logged_in(app, "alice")
    response = alice.post(
        URL,
        json=_body(
            route="#/projects/p/documents?q=secret",
            viewport="1280x800",
            last_api_error={
                "status": 500,
                "code": "PROJECT_BUSY",
                "at": "2026-11-01T10:00:00Z",
            },
        ),
        headers={"User-Agent": "TestBrowser/1.0"},
    )
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["reference"] == f"TR-{receipt['id']}"
    [row] = _rows(app)
    assert row["status"] == "open"
    assert row["description"] == "The documents page shows an error."
    # The query (searched text) never reaches the report.
    assert row["route"] == "#/projects/p/documents"
    assert row["viewport"] == "1280x800"
    assert row["user_agent"] == "TestBrowser/1.0"
    assert (row["last_error_status"], row["last_error_code"]) == (500, "PROJECT_BUSY")
    assert row["app_version"]
    # The audit names the reference only, never the description.
    assert _audits(app) == [
        (
            "technical_report.create",
            str(receipt["id"]),
            {"reference": receipt["reference"]},
        )
    ]


def test_a_retried_request_returns_the_first_report(app):
    alice = logged_in(app, "alice")
    first = alice.post(URL, json=_body()).json()
    again = alice.post(URL, json=_body()).json()
    assert again == first
    assert len(_rows(app)) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"request_id": "r", "description": ""},
        {"request_id": "r", "description": "x" * 4001},
        {"request_id": "r", "description": "x", "context": {"viewport": "big"}},
        {"request_id": "r", "description": "x", "context": {"route": "x" * 301}},
        {
            "request_id": "r",
            "description": "x",
            "context": {"crash_message": "x" * 2001},
        },
        {"request_id": "r", "description": "x", "context": {"browser": "mine"}},
        {
            "request_id": "r",
            "description": "x",
            "context": {
                "last_api_error": {
                    "status": 500,
                    "code": "a b",
                    "at": "2026-11-01T10:00:00Z",
                }
            },
        },
        {"request_id": "", "description": "x"},
    ],
)
def test_oversized_or_unknown_fields_are_refused(app, body):
    response = logged_in(app, "alice").post(URL, json=body)
    assert response.status_code == 422, response.text
    assert _rows(app) == []


def test_a_blank_description_is_refused(app):
    response = logged_in(app, "alice").post(
        URL, json={"request_id": "r", "description": "  \n "}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "TECHNICAL_REPORT_EMPTY"


def test_control_characters_are_stored_safely(app):
    response = logged_in(app, "alice").post(
        URL,
        json={
            "request_id": "r",
            "description": "line 1\nline\x00 2",
            "context": {"crash_message": "boom\x00"},
        },
    )
    assert response.status_code == 200, response.text
    [row] = _rows(app)
    assert row["description"] == "line 1\nline\N{REPLACEMENT CHARACTER} 2"
    assert row["crash_message"] == "boom\N{REPLACEMENT CHARACTER}"


def test_reports_per_hour_are_bounded(app):
    alice = logged_in(app, "alice")
    for index in range(MAX_REPORTS_PER_WINDOW):
        assert alice.post(URL, json=_body(f"r{index}")).status_code == 200
    refused = alice.post(URL, json=_body("one-more"))
    assert refused.status_code == 429
    assert refused.json()["code"] == "TECHNICAL_REPORT_LIMIT"
    # Another user is not affected.
    assert logged_in(app, "bob").post(URL, json=_body("b")).status_code == 200


def test_a_report_needs_a_session(app):
    assert TestClient(app).post(URL, json=_body()).status_code in {401, 403}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", ADMIN, None),
        ("get", f"{ADMIN}?status=open", None),
        ("get", f"{ADMIN}/summary", None),
        ("post", f"{ADMIN}/1/status", {"status": "done"}),
    ],
)
def test_non_admins_cannot_read_or_close_reports(app, method, path, body):
    alice = logged_in(app, "alice")
    alice.post(URL, json=_body())
    response = getattr(alice, method)(path, **({"json": body} if body else {}))
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "ADMIN_REQUIRED"
    assert _rows(app)[0]["status"] == "open"


def test_an_admin_lists_closes_and_reopens_a_report(app):
    alice = logged_in(app, "alice")
    receipt = alice.post(URL, json=_body(crash_message="Cannot read x")).json()
    admin = logged_in(app, "root", system_admin=True)

    listed = admin.get(ADMIN).json()
    assert [item["reference"] for item in listed] == [receipt["reference"]]
    [item] = listed
    assert item["reporter_username"] == "alice"
    assert item["reporter"]["pseudonym"]
    assert item["crash_message"] == "Cannot read x"
    assert admin.get(f"{ADMIN}/summary").json() == {"open": 1}

    closed = admin.post(f"{ADMIN}/{receipt['id']}/status", json={"status": "done"})
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "done"
    assert closed.json()["closed_by"] == "root"
    assert admin.get(f"{ADMIN}?status=open").json() == []
    assert len(admin.get(f"{ADMIN}?status=done").json()) == 1
    assert admin.get(f"{ADMIN}/summary").json() == {"open": 0}
    # The same status again changes nothing and audits nothing.
    admin.post(f"{ADMIN}/{receipt['id']}/status", json={"status": "done"})

    reopened = admin.post(f"{ADMIN}/{receipt['id']}/status", json={"status": "open"})
    assert reopened.json()["status"] == "open"
    assert reopened.json()["closed_at"] is None
    assert [action for action, _id, _details in _audits(app)] == [
        "technical_report.create",
        "technical_report.close",
        "technical_report.reopen",
    ]


def test_an_unknown_report_is_not_found(app):
    admin = logged_in(app, "root", system_admin=True)
    response = admin.post(f"{ADMIN}/999/status", json={"status": "done"})
    assert response.status_code == 404
    assert response.json()["code"] == "TECHNICAL_REPORT_NOT_FOUND"
    assert admin.post(f"{ADMIN}/1/status", json={"status": "closed"}).status_code == 422


def test_a_demoted_admin_cannot_change_a_status(app):
    """The service checks the locked account row, not only the session."""
    logged_in(app, "alice").post(URL, json=_body())
    logged_in(app, "root", system_admin=True)
    other = app.state.accounts.get_by_username("root")
    logged_in(app, "boss", system_admin=True)
    app.state.accounts.set_system_admin(Actor.cli(), "root", False)
    service = TechnicalReportService(app.state.repo.db)
    report_id = _rows(app)[0]["id"]
    with pytest.raises(AccessDenied) as refused:
        service.set_status(Actor.user(other.id, "root"), report_id, "done")
    assert refused.value.code == "ADMIN_REQUIRED"
    assert _rows(app)[0]["status"] == "open"


def test_anonymising_the_reporter_keeps_the_report_but_drops_the_browser(app):
    logged_in(app, "alice").post(
        URL, json=_body(), headers={"User-Agent": "TestBrowser/1.0"}
    )
    app.state.accounts.set_active(Actor.cli(), "alice", False)
    erased = app.state.accounts.anonymise(Actor.cli(), "alice")
    [row] = _rows(app)
    assert row["user_agent"] is None
    assert row["description"] == "The documents page shows an error."
    admin = logged_in(app, "root", system_admin=True)
    [item] = admin.get(ADMIN).json()
    assert item["reporter_username"] == erased.username
    assert item["reporter"]["pseudonym"] == erased.pseudonym
