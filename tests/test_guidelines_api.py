"""Guideline endpoints through real authenticated sessions (G0b)."""

from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from sqlalchemy import select
from starlette.datastructures import UploadFile
from test_auth_api import _app
from test_projects_api import create_project

from ontotator.storage.guideline_tables import GuidelineVersionRow

KEY = "phenotypes"
BASE = f"/api/v1/projects/{KEY}/guidelines"


@pytest.fixture
def team(tmp_path) -> SimpleNamespace:
    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin, KEY)
    return SimpleNamespace(
        app=app,
        admin=admin,
        lead=logged_in(app, "lead", pseudonym="ann-0901", projects={KEY: ["lead"]}),
        annotator=logged_in(
            app, "ann", pseudonym="ann-0902", projects={KEY: ["annotator"]}
        ),
        outsider=logged_in(app, "outsider"),
    )


def publish(
    client,
    body: bytes = b"# Rules",
    *,
    filename: str = "rules.md",
    note: str = "",
    expected: str = "",
):
    return client.post(
        BASE,
        files={"file": (filename, body, "text/markdown")},
        data={"change_note": note, "expected_latest_version": expected},
    )


def versions(app) -> list[int]:
    with app.state.repo.db.transaction() as conn:
        return list(conn.execute(select(GuidelineVersionRow.version)).scalars())


def test_permissions(team) -> None:
    assert publish(team.lead).status_code == 201
    refused = publish(team.annotator, b"Other", expected="1")
    assert refused.status_code == 403
    assert refused.json()["code"] == "NOT_ALLOWED"
    withdraw = team.annotator.post(
        f"{BASE}/1/withdraw", json={"reason": None, "expected_latest_version": 1}
    )
    assert withdraw.status_code == 403
    assert withdraw.json()["code"] == "NOT_ALLOWED"
    invalid_reason = team.annotator.post(
        f"{BASE}/1/withdraw", json={"reason": "a\nb", "expected_latest_version": 1}
    )
    assert invalid_reason.status_code == 403
    for path in (BASE, f"{BASE}/1"):
        hidden = team.outsider.get(path)
        assert hidden.status_code == 404
        assert hidden.json()["code"] == "PROJECT_NOT_FOUND"
    assert (
        team.outsider.post(f"{BASE}/1/reads", json={"event": "opened"}).status_code
        == 404
    )
    lead_view = team.lead.get(BASE).json()["current"]
    # The creating admin holds every role, so two task members.
    assert lead_view["reach"] == {"notified": 0, "opened": 0, "members": 2}
    assert "ann-0902" in [item["person"]["pseudonym"] for item in lead_view["not_seen"]]
    member_view = team.annotator.get(BASE).json()["current"]
    assert member_view["reach"] is None and member_view["not_seen"] is None
    assert team.admin.get(BASE).status_code == 200


def test_multipart_upload_returns_201_summary(team) -> None:
    response = publish(team.lead, b"Plain text", filename="rules.txt", note="Start")
    assert response.status_code == 201, response.text
    summary = response.json()
    assert summary["version"] == 1
    assert summary["kind"] == "text"
    assert summary["filename"] == "rules.txt"
    assert summary["change_note"] == "Start"
    assert summary["size_bytes"] == len(b"Plain text")
    assert summary["created_by"]["pseudonym"] == "ann-0901"
    assert summary["withdrawn"] is None
    listing = team.annotator.get(BASE).json()
    assert listing["latest_version"] == 1
    assert listing["current"]["version"] == 1
    assert [item["version"] for item in listing["versions"]] == [1]
    assert listing["my_latest_seen"] is None
    second = publish(team.lead, b"Plain text 2", filename="rules.txt", expected="1")
    assert second.status_code == 201
    assert second.json()["version"] == 2


def test_withdrawn_document_has_no_body_and_withdrawn_etag(team) -> None:
    publish(team.lead, b"# Secret")
    withdrawn = team.lead.post(
        f"{BASE}/1/withdraw",
        json={"reason": "Wrong file", "expected_latest_version": 1},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["withdrawn"]["reason"] == "Wrong file"
    document = team.annotator.get(f"{BASE}/1")
    assert document.status_code == 200
    assert document.json()["body"] is None
    assert document.json()["filename"] is None
    assert document.headers["etag"].startswith('W/"')
    assert team.annotator.get(BASE).json()["current"] is None


def test_etag_depends_on_the_viewer(team) -> None:
    publish(team.lead, b"# Rules")
    lead = team.lead.get(f"{BASE}/1")
    member = team.annotator.get(f"{BASE}/1")
    # Display names are shown to leads only: the bodies differ, so do the tags.
    assert lead.json() != member.json()
    assert lead.headers["etag"] != member.headers["etag"]
    other = team.annotator.get(
        f"{BASE}/1", headers={"If-None-Match": lead.headers["etag"]}
    )
    assert other.status_code == 200
    assert other.json() == member.json()
    own = team.annotator.get(
        f"{BASE}/1", headers={"If-None-Match": member.headers["etag"]}
    )
    assert own.status_code == 304


def test_etag_and_cache_control(team) -> None:
    publish(team.lead, b"# Rules")
    first = team.annotator.get(f"{BASE}/1")
    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, no-cache"
    assert first.headers["vary"] == "Cookie"
    etag = first.headers["etag"]
    # A weak tag over the viewer's body, not only the file's content.
    assert etag.startswith('W/"') and first.json()["sha256"] not in etag
    assert first.json()["body"] == "# Rules"
    cached = team.annotator.get(f"{BASE}/1", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.headers["etag"] == etag
    assert cached.headers["cache-control"] == "private, no-cache"
    assert cached.headers["vary"] == "Cookie"
    team.lead.post(
        f"{BASE}/1/withdraw", json={"reason": None, "expected_latest_version": 1}
    )
    stale = team.annotator.get(f"{BASE}/1", headers={"If-None-Match": etag})
    assert stale.status_code == 200
    assert stale.json()["body"] is None
    unknown = team.annotator.get(f"{BASE}/5")
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "GUIDELINE_NOT_FOUND"


def test_reads_endpoint_returns_204_and_is_idempotent(team) -> None:
    publish(team.lead)
    for event in ("notified", "notified", "opened", "opened"):
        response = team.annotator.post(f"{BASE}/1/reads", json={"event": event})
        assert response.status_code == 204
        assert response.content == b""
    assert team.annotator.get(BASE).json()["my_latest_seen"] == 1
    reach = team.lead.get(BASE).json()["current"]["reach"]
    assert reach == {"notified": 1, "opened": 1, "members": 2}
    bad = team.annotator.post(f"{BASE}/1/reads", json={"event": "read"})
    assert bad.status_code == 422


def test_error_statuses(team) -> None:
    lead = team.lead
    cases = [
        (publish(lead, filename="rules.pdf"), 422, "GUIDELINE_FILE_TYPE"),
        (publish(lead, b"\xff"), 422, "GUIDELINE_ENCODING"),
        (publish(lead, b"  \n"), 422, "GUIDELINE_EMPTY"),
        (publish(lead, note="a\nb"), 422, "GUIDELINE_NOTE_INVALID"),
        (publish(lead, expected="3"), 409, "GUIDELINE_VERSION_CONFLICT"),
    ]
    assert publish(lead).status_code == 201
    cases += [
        (publish(lead, expected="1"), 409, "GUIDELINE_UNCHANGED"),
        (
            lead.post(
                f"{BASE}/4/withdraw",
                json={"reason": None, "expected_latest_version": 1},
            ),
            404,
            "GUIDELINE_NOT_FOUND",
        ),
    ]
    assert (
        lead.post(
            f"{BASE}/1/withdraw", json={"reason": None, "expected_latest_version": 1}
        ).status_code
        == 200
    )
    cases.append(
        (
            lead.post(
                f"{BASE}/1/withdraw",
                json={"reason": None, "expected_latest_version": 1},
            ),
            409,
            "GUIDELINE_ALREADY_WITHDRAWN",
        )
    )
    for response, status, code in cases:
        assert (response.status_code, response.json()["code"]) == (status, code)
    unchanged = cases[5][0].json()
    assert unchanged["details"] == {"version": 1}
    not_number = publish(lead, b"Next", expected="abc")
    assert not_number.status_code == 422
    assert "code" not in not_number.json()
    extra = lead.post(
        f"{BASE}/1/withdraw",
        json={"reason": None, "expected_latest_version": 1, "other": 1},
    )
    assert extra.status_code == 422


def test_settings_refuse_guideline_url(team) -> None:
    response = team.lead.patch(
        f"/api/v1/projects/{KEY}/settings", json={"guideline_url": "https://x.org"}
    )
    assert response.status_code == 422


def test_oversized_multipart_upload_is_refused_without_reading_it_all(
    team, monkeypatch
) -> None:
    consumed: list[int] = []
    original = UploadFile.read

    async def counting(self, size: int = -1) -> bytes:
        assert size is not None and size >= 0, "the route must bound every read"
        chunk = await original(self, size)
        consumed.append(len(chunk))
        return chunk

    monkeypatch.setattr(UploadFile, "read", counting)
    response = publish(team.lead, b"x" * (1024 * 1024))
    assert response.status_code == 413
    assert response.json()["code"] == "GUIDELINE_TOO_LARGE"
    assert sum(consumed) <= 262_144 + 4
    assert versions(team.app) == []
