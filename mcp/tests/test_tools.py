from __future__ import annotations

import hashlib
import io
import os
import zipfile
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi, refusal, token_view
from mcp import Client
from shapes import build, page, panel, row, submission, work

from ontotator_mcp.config import ConfigError, Settings
from ontotator_mcp.server import build_server

P = "/api/v1/projects/{key}"
ROWS = f"{P}/document-rows"
PANEL = "/api/v1/projects/{key}/document-rows/{case_id}/{language}/final-panel"
pytestmark = pytest.mark.anyio


async def test_whoami_drops_the_csrf_token(fake: FakeApi, mcp_client: Client) -> None:
    fake.on(
        "GET",
        "/api/v1/auth/me",
        build("CurrentUser", username="lead", csrf_token="secret-csrf"),
    )
    result = await call(mcp_client, "whoami", {})
    assert result["user"]["username"] == "lead"
    assert "csrf_token" not in result["user"]
    assert result["url"] == "https://ontotator.test"
    assert result["token"]["kind"] == "personal"
    assert "warning" not in result["token"]


async def test_whoami_with_a_project_token_names_its_project(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        "/api/v1/auth/token",
        token_view(kind="project", project_key="ward-7", scopes=["read", "export"]),
    )
    result = await call(mcp_client, "whoami", {})
    assert result["user"] is None
    assert result["token"]["project_key"] == "ward-7"
    assert "ward-7" in result["note"]
    # A project token cannot read /auth/me; whoami does not try.
    assert fake.templates() == [("GET", "/api/v1/auth/token")]


async def test_whoami_reports_the_token_and_warns_before_it_expires(
    fake: FakeApi, mcp_client: Client
) -> None:
    soon = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    fake.on("GET", "/api/v1/auth/token", token_view(expires_at=soon, scopes=["export"]))
    result = await call(mcp_client, "whoami", {})
    token = result["token"]
    assert token["scopes"] == ["export"]
    assert 2 < token["expires_in_days"] <= 3
    assert "expires soon" in token["warning"]
    assert "secret" not in token
    # Without the read scope only the token itself is read.
    assert result["user"] is None
    assert fake.templates() == [("GET", "/api/v1/auth/token")]


async def test_upload_texts_streams_files_and_returns_the_check(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    bundle = tmp_path / "phentrieve.zip"
    bundle.write_bytes(b"PK-bundle-bytes")
    fake.on("POST", f"{P}/uploads", {"upload_id": 7, "job_id": 70})
    plan = build(
        "ImportPlan",
        counts={"cases": 2, "proposals": 5},
        committable=True,
        warnings=[build("Issue", code="W", unit="u", message="note")],
    )
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build(
            "UploadView",
            id=7,
            kind="t1",
            status="ready",
            preview=plan,
            plan_sha256="a" * 64,
            files=[build("UploadFileInfo", filename="phentrieve.zip")],
        ),
    )
    result = await call(
        mcp_client,
        "upload_texts",
        {"project": "ward-7", "paths": [str(bundle)], "format": "ontospan"},
    )
    assert result["upload_id"] == 7
    assert result["kind"] == "ontospan"
    assert result["committable"] is True
    assert result["counts"] == {"cases": 2, "proposals": 5}
    assert result["local_files"] == [str(bundle.resolve())]
    [upload] = fake.calls_to("POST", f"{P}/uploads")
    body = upload.request.content
    assert b'name="kind"\r\n\r\nt1' in body
    assert b'name="files[]"; filename="phentrieve.zip"' in body
    assert b"PK-bundle-bytes" in body
    assert fake.calls_to("GET", "/api/v1/jobs/{job_id}")


async def test_plain_text_needs_a_language(mcp_client: Client, tmp_path: Path) -> None:
    text = tmp_path / "case-1.txt"
    text.write_text("Ataxia.")
    with pytest.raises(ToolFailed, match="language"):
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": [str(text)], "format": "text"},
        )


async def test_a_missing_file_is_named(mcp_client: Client, tmp_path: Path) -> None:
    with pytest.raises(ToolFailed, match="No such file"):
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": [str(tmp_path / "x.zip")], "format": "ontospan"},
        )


async def test_a_relative_path_is_refused(fake: FakeApi, mcp_client: Client) -> None:
    with pytest.raises(ToolFailed, match="absolute path"):
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": ["texts.zip"], "format": "ontospan"},
        )
    with pytest.raises(ToolFailed, match="absolute path"):
        await call(mcp_client, "download_export", {"job_id": 1, "path": "out.zip"})
    assert not fake.calls_to("POST", f"{P}/uploads")


async def test_files_dir_limits_what_is_read_and_written(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    inside = allowed / "guide.md"
    inside.write_text("# Guide")
    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET")
    (allowed / "link.md").symlink_to(secret)
    fake.on("POST", f"{P}/guidelines", build("GuidelineSummary"))
    _export_job(fake, b"zip-bytes")
    limited = replace(settings, files_dirs=(allowed.resolve(),))
    server = build_server(limited, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        for path in (
            str(secret),
            str(allowed / "link.md"),
            str(allowed / ".." / "secret.txt"),
        ):
            with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
                await call(client, "publish_guideline", {"project": "p", "path": path})
        for name in ("set_task_profile", "create_project"):
            args: dict[str, Any] = {"project": "p", "profile_path": str(secret)}
            if name == "create_project":
                args = {
                    "key": "k",
                    "name": "K",
                    "pins": [],
                    "profile_path": str(secret),
                }
            with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
                await call(client, name, args)
        assert not fake.calls_to("POST", f"{P}/guidelines")
        assert b"SECRET" not in b"".join(c.request.content for c in fake.calls)

        published = await call(
            client, "publish_guideline", {"project": "p", "path": str(inside)}
        )
        assert published["local_files"] == [str(inside.resolve())]

        with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
            await call(
                client,
                "download_export",
                {"job_id": 9, "path": str(tmp_path / "out.zip")},
            )
        assert not (tmp_path / "out.zip").exists()
        done = await call(
            client, "download_export", {"job_id": 9, "path": str(allowed / "out.zip")}
        )
        assert done["path"] == str((allowed / "out.zip").resolve())


async def test_without_files_dir_local_files_are_refused(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    text = tmp_path / "case.zip"
    text.write_bytes(b"PK")
    fake.on("GET", "/api/v1/auth/me", build("CurrentUser", username="lead"))
    _export_job(fake, b"zip-bytes")
    unset = replace(settings, files_dirs=())
    server = build_server(unset, transport=httpx.MockTransport(fake))
    tools: list[tuple[str, dict[str, Any]]] = [
        ("upload_texts", {"project": "p", "paths": [str(text)], "format": "ontospan"}),
        ("upload_ontology_files", {"paths": [str(text)]}),
        ("publish_guideline", {"project": "p", "path": str(text)}),
        ("set_task_profile", {"project": "p", "profile_path": str(text)}),
        (
            "create_project",
            {"key": "k", "name": "K", "pins": [], "profile_path": str(text)},
        ),
        ("download_export", {"job_id": 9, "path": str(tmp_path / "out.zip")}),
    ]
    async with Client(server) as client:
        for name, args in tools:
            with pytest.raises(ToolFailed) as refused:
                await call(client, name, args)
            assert "set ONTOTATOR_MCP_FILES_DIR" in str(refused.value), name
        # Nothing was sent, written or even looked up.
        assert not fake.calls
        assert not (tmp_path / "out.zip").exists()
        # Tools without local files work as before.
        me = await call(client, "whoami", {})
        assert me["user"]["username"] == "lead"


async def test_symbolic_links_never_leave_files_dir(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("SECRET")
    (outside / "keep.zip").write_bytes(b"KEEP")
    # A linked folder, a link to a file and a dangling link, all inside.
    (allowed / "linked").symlink_to(outside, target_is_directory=True)
    (allowed / "out.zip").symlink_to(outside / "keep.zip")
    (allowed / "new.zip").symlink_to(outside / "new.zip")
    fake.on("POST", f"{P}/guidelines", build("GuidelineSummary"))
    _export_job(fake, b"zip-bytes")
    limited = replace(settings, files_dirs=(allowed.resolve(),))
    server = build_server(limited, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        with pytest.raises(ToolFailed, match="outside the folders"):
            await call(
                client,
                "publish_guideline",
                {"project": "p", "path": str(allowed / "linked" / "secret.md")},
            )
        for target in ("linked/new.zip", "out.zip", "new.zip"):
            with pytest.raises(ToolFailed, match="outside the folders"):
                await call(
                    client,
                    "download_export",
                    {"job_id": 9, "path": str(allowed / target), "overwrite": True},
                )
    assert not fake.calls_to("POST", f"{P}/guidelines")
    assert sorted(path.name for path in outside.iterdir()) == ["keep.zip", "secret.md"]
    assert (outside / "keep.zip").read_bytes() == b"KEEP"


@pytest.mark.parametrize("name", [".", ".."])
async def test_dot_segments_stay_one_segment(
    fake: FakeApi, mcp_client: Client, name: str
) -> None:
    # httpx drops dot segments: unencoded, ".." would reach another route.
    fake.on("GET", f"{P}/members", [])
    fake.on("PUT", MEMBER, _member("ann", ["annotator"]))
    await call(mcp_client, "list_people", {"project": name})
    [listed] = fake.calls_to("GET", f"{P}/members")
    encoded = name.replace(".", "%2E").encode()
    assert listed.request.url.raw_path == b"/api/v1/projects/" + encoded + b"/members"
    await call(
        mcp_client,
        "set_member_roles",
        {"project": "p", "username": name, "roles": ["annotator"]},
    )
    [put] = fake.calls_to("PUT", MEMBER)
    assert put.request.url.raw_path == b"/api/v1/projects/p/members/" + encoded


def _member(username: str, roles: list[str]) -> dict[str, Any]:
    return build("Member", username=username, roles=roles)


def _task(task: str, status: str = "open", **extra: Any) -> dict[str, Any]:
    return (
        build(
            "AssignmentView",
            id=len(task) + len(status) + len(extra),
            document_id=f"d-{task}-{status}",
            task=task,
            status=status,
            revoked_at=None,
            lead_correction=False,
        )
        | extra
    )


MEMBER = f"{P}/members/{{username}}"


async def test_adding_roles_needs_no_confirm(fake: FakeApi, mcp_client: Client) -> None:
    fake.on("GET", f"{P}/members", [_member("ann", ["annotator"])])
    fake.on("PUT", MEMBER, _member("ann", ["adjudicator", "annotator"]))
    result = await call(
        mcp_client,
        "set_member_roles",
        {"project": "p", "username": "ann", "roles": ["annotator", "adjudicator"]},
    )
    assert result["applied"] is True
    assert result["plan"]["added_roles"] == ["adjudicator"]
    assert result["plan"]["removed_roles"] == []
    [put] = fake.calls_to("PUT", MEMBER)
    assert put.json()["roles"] == ["annotator", "adjudicator"]
    assert not fake.calls_to("GET", f"{P}/assignments")


async def test_removing_a_person_is_a_dry_run_without_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/members", [_member("ann", ["adjudicator", "annotator"])])
    fake.on(
        "GET",
        f"{P}/assignments",
        [
            _task("annotate"),
            _task("annotate", "submitted"),
            _task("review", "in_progress"),
            _task("annotate", revoked_at="2026-11-01T10:00:00Z"),
            _task("translation_review", lead_correction=True),
        ],
    )
    args: dict[str, Any] = {"project": "p", "username": "ann", "roles": []}
    dry = await call(mcp_client, "set_member_roles", args)
    assert dry["applied"] is False
    plan = dry["plan"]
    assert plan["current_roles"] == ["adjudicator", "annotator"]
    assert plan["removed_roles"] == ["adjudicator", "annotator"]
    assert [t["task"] for t in plan["open_tasks"]] == ["annotate", "review"]
    assert "block the change" in plan["consequences"][1]
    assert "logged out" in plan["consequences"][0]
    assert not fake.calls_to("PUT", MEMBER)
    [listed] = fake.calls_to("GET", f"{P}/assignments")
    assert listed.request.url.params["username"] == "ann"

    fake.on("PUT", MEMBER, _member("ann", []))
    applied = await call(
        mcp_client,
        "set_member_roles",
        args | {"revoke_assignments": True, "confirm": True},
    )
    assert applied["applied"] is True
    assert "2 open task(s) are withdrawn." in applied["plan"]["consequences"]
    [put] = fake.calls_to("PUT", MEMBER)
    assert put.json() == {"roles": [], "revoke_assignments": True}


async def test_unchanged_roles_change_nothing(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/members", [_member("ann", ["annotator"])])
    result = await call(
        mcp_client,
        "set_member_roles",
        {"project": "p", "username": "ann", "roles": ["annotator"]},
    )
    assert result["applied"] is False
    assert not fake.calls_to("PUT", MEMBER)


@pytest.mark.parametrize(
    "error", [httpx.WriteError, httpx.ReadError, httpx.RemoteProtocolError]
)
async def test_a_connection_closed_during_an_upload_names_the_size(
    fake: FakeApi, mcp_client: Client, tmp_path: Path, error: type[Exception]
) -> None:
    big = tmp_path / "big.zip"
    big.write_bytes(b"x" * 2_500_000)

    def cut(request: httpx.Request) -> httpx.Response:
        raise error("connection closed")

    fake.on("POST", f"{P}/uploads", cut)
    with pytest.raises(ToolFailed) as raised:
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": [str(big)], "format": "ontospan"},
        )
    assert "closed the connection during the upload" in str(raised.value)
    assert "2.5 MB" in str(raised.value)
    assert "upload limit" in str(raised.value)
    assert "Cannot reach" not in str(raised.value)


def test_files_dir_comes_from_the_environment(tmp_path: Path) -> None:
    env = {
        "ONTOTATOR_URL": "https://o.test",
        "ONTOTATOR_TOKEN": "t",
        "ONTOTATOR_MCP_FILES_DIR": f"{tmp_path}{os.pathsep}{tmp_path / 'b'}",
    }
    with pytest.raises(ConfigError, match="not a folder"):
        Settings.from_env(env)
    (tmp_path / "b").mkdir()
    assert Settings.from_env(env).files_dirs == (
        tmp_path.resolve(),
        (tmp_path / "b").resolve(),
    )
    with pytest.raises(ConfigError, match="absolute"):
        Settings.from_env(env | {"ONTOTATOR_MCP_FILES_DIR": "relative/dir"})
    assert Settings.from_env(env | {"ONTOTATOR_MCP_FILES_DIR": ""}).files_dirs == ()


async def test_commit_upload_sends_the_checked_plan(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build("UploadView", id=7, status="ready", plan_sha256="b" * 64),
    )
    fake.on("POST", f"{P}/uploads/{{upload_id}}/commit", {"upload_id": 7, "job_id": 71})
    result = await call(
        mcp_client,
        "commit_upload",
        {
            "project": "ward-7",
            "upload_id": 7,
            "plan_languages": {"de": {"review": True, "annotate": True}},
            "accept_external_review": None,
        },
    )
    assert result["job"]["status"] == "succeeded"
    [commit] = fake.calls_to("POST", f"{P}/uploads/{{upload_id}}/commit")
    assert commit.json() == {
        "plan_sha256": "b" * 64,
        "plan_languages": {"de": {"review": True, "annotate": True}},
    }


async def test_commit_refuses_an_upload_that_is_not_ready(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build("UploadView", id=7, status="invalid", plan_sha256=None),
    )
    with pytest.raises(ToolFailed, match="'invalid', not ready"):
        await call(mcp_client, "commit_upload", {"project": "p", "upload_id": 7})
    assert not fake.calls_to("POST", f"{P}/uploads/{{upload_id}}/commit")


async def test_pins_are_only_previewed_without_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    pins = [{"ontology_id": "HP", "sha256": "c" * 64}]
    fake.on("POST", f"{P}/pins/preview", build("RepinReport", report_sha256="r1"))
    dry = await call(mcp_client, "set_ontology_pins", {"project": "p", "pins": pins})
    assert dry["applied"] is False
    assert not fake.calls_to("POST", f"{P}/pins/apply")
    done = await call(
        mcp_client, "set_ontology_pins", {"project": "p", "pins": pins, "confirm": True}
    )
    assert done["applied"] is True
    [apply] = fake.calls_to("POST", f"{P}/pins/apply")
    assert apply.json()["report_sha256"] == "r1"


async def test_distribute_texts_previews_then_assigns_with_the_digest(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/document-rows/case-ids",
        {"case_ids": ["c1", "c2"], "total": 2, "truncated": False},
    )
    fake.on(
        "POST",
        f"{P}/assignments/batch/preview",
        build("BatchPreview", digest="d1", per_text=2),
    )
    args = {
        "project": "p",
        "language": "en",
        "usernames": ["ann1", "ann2"],
        "mode": "each",
    }
    dry = await call(mcp_client, "distribute_texts", args)
    assert dry["assigned"] is False
    assert not fake.calls_to("POST", f"{P}/assignments/batch")
    await call(mcp_client, "distribute_texts", args | {"confirm": True})
    [batch] = fake.calls_to("POST", f"{P}/assignments/batch")
    assert batch.json()["expected_preview_digest"] == "d1"
    assert batch.json()["case_ids"] == ["c1", "c2"]


async def test_work_plan_sets_the_mode_with_the_previewed_revisions(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "POST",
        f"{P}/work-plans/bulk/preview",
        build("BulkPreview", revisions={"c1": 4}),
    )
    args = {
        "project": "p",
        "language": "en",
        "case_ids": ["c1"],
        "annotation_mode": "proposals",
        "confirm": True,
    }
    await call(mcp_client, "update_work_plan", args)
    [saved] = fake.calls_to("PUT", f"{P}/work-plans/bulk")
    assert saved.json()["expected_revisions"] == {"c1": 4}
    assert saved.json()["languages"]["en"]["annotation_mode"] == "proposals"
    assert saved.json()["confirm"] is True


async def test_list_texts_reads_every_page(fake: FakeApi, mcp_client: Client) -> None:
    pages = {
        "1": page([row("c1", work=[work("submitted", "ann-0001")])], 1, 2),
        "2": page([row("c2")], 2, 2),
    }
    fake.on("GET", ROWS, lambda request: pages[request.url.params["page"]])
    result = await call(mcp_client, "list_texts", {"project": "p", "stage": ["final"]})
    assert [t["case_id"] for t in result["texts"]] == ["c1", "c2"]
    assert result["texts"][0]["document_id"] == "c1-en-v1"
    assert result["texts"][0]["work"][0]["person"] == "ann-0001"
    first = fake.calls_to("GET", ROWS)[0].request.url.params
    assert first.get_list("stage") == ["final"]


def _results(fake: FakeApi) -> None:
    """Three texts: one agreeing, one differing, one with an open annotation."""
    rows = [
        row("agree", work=[work("submitted", "a"), work("submitted", "b")]),
        row("differ", work=[work("submitted", "a"), work("submitted", "b")]),
        row("open", work=[work("submitted", "a"), work("in_progress", "b")]),
    ]
    fake.on("GET", ROWS, page(rows))
    panels = {
        "agree": panel(
            [submission("s1", "agree-en-v1"), submission("s2", "agree-en-v1")],
            all_match=True,
        ),
        "differ": panel(
            [submission("s3", "differ-en-v1"), submission("s4", "differ-en-v1")],
            all_match=False,
            matching=1,
        ),
        "open": panel([submission("s5", "open-en-v1")], all_match=False),
    }
    fake.on(
        "GET",
        PANEL,
        lambda request: panels[request.url.raw_path.decode().split("/")[-3]],
    )


async def test_accept_agreeing_texts_dry_run_changes_nothing(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    result = await call(mcp_client, "accept_agreeing_texts", {"project": "p"})
    assert result["applied"] is False
    assert [t["case_id"] for t in result["would_accept"]] == ["agree"]
    reasons = {s["case_id"]: s["reason"] for s in result["skipped"]}
    assert reasons["differ"].startswith("submissions differ")
    assert reasons["open"] == "fewer than two submissions"
    assert not fake.calls_to("PUT", f"{P}/final-selections")


async def test_accept_agreeing_texts_accepts_with_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    fake.on(
        "PUT",
        f"{P}/final-selections",
        build("FinalSelectionView", submission_id="s1", document_id="agree-en-v1"),
    )
    result = await call(
        mcp_client, "accept_agreeing_texts", {"project": "p", "confirm": True}
    )
    assert [t["submission_id"] for t in result["accepted"]] == ["s1"]
    [selection] = fake.calls_to("PUT", f"{P}/final-selections")
    assert selection.json() == {
        "document_id": "agree-en-v1",
        "submission_id": "s1",
        "expected_revision": 0,
    }


async def test_agreement_summary_sums_the_texts(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    result = await call(mcp_client, "agreement_summary", {"project": "p"})
    assert result["texts_compared"] == 2
    assert result["texts_all_match"] == 1
    assert (result["findings_matching"], result["findings_total"]) == (4, 6)


async def test_consolidation_takes_every_eligible_submission(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    await call(
        mcp_client,
        "start_consolidation",
        {"project": "p", "case_id": "differ", "language": "en", "reviewer": "carla"},
    )
    [start] = fake.calls_to("POST", f"{P}/consolidations")
    body = start.json()
    assert body["source_submission_ids"] == ["s3", "s4"]
    assert body["document_id"] == "differ-en-v1"
    assert body["reviewer"] == "carla"
    assert body["request_id"]


async def test_final_export_needs_acknowledged_warnings(
    fake: FakeApi, mcp_client: Client
) -> None:
    warning = build("FinalWarning", id="w1", cause_revision=2)
    omission = build("FinalOmission", case_id="c9", language="de")
    fake.on(
        "POST",
        f"{P}/exports/final/preflight",
        build(
            "FinalPreflight",
            warnings=[warning],
            omissions=[omission],
            state_digest="e" * 64,
        ),
    )
    fake.on("POST", f"{P}/exports/final", {"job_id": 90})
    with pytest.raises(ToolFailed, match="1 warning"):
        await call(mcp_client, "start_export", {"project": "p", "kind": "final"})
    with pytest.raises(ToolFailed, match="no final result"):
        await call(
            mcp_client,
            "start_export",
            {"project": "p", "kind": "final", "acknowledge_warnings": True},
        )
    assert not fake.calls_to("POST", f"{P}/exports/final")
    job = await call(
        mcp_client,
        "start_export",
        {
            "project": "p",
            "kind": "final",
            "acknowledge_warnings": True,
            "accept_omissions": True,
        },
    )
    assert job["id"] == 90
    [export] = fake.calls_to("POST", f"{P}/exports/final")
    body = export.json()
    assert body["state_digest"] == "e" * 64
    assert body["acknowledged_warnings"] == [{"id": "w1", "cause_revision": 2}]
    assert body["accepted_omissions"] == [{"case_id": "c9", "language": "de"}]


@pytest.mark.parametrize(
    ("kind", "body"),
    [
        ("annotations", {"kind": "t1"}),
        ("edit_log", {"kind": "edit_log"}),
        ("work_time", {"kind": "work_time"}),
    ],
)
async def test_other_exports_use_the_export_route(
    fake: FakeApi, mcp_client: Client, kind: str, body: dict[str, str]
) -> None:
    fake.on("POST", f"{P}/exports", {"job_id": 5})
    result = await call(
        mcp_client, "start_export", {"project": "p", "kind": kind, "wait": False}
    )
    assert result == {"job_id": 5, "kind": kind, "status": "queued"}
    assert fake.calls_to("POST", f"{P}/exports")[0].json() == body


async def test_working_time_summary_reads_the_project_sums(
    fake: FakeApi, mcp_client: Client
) -> None:
    sums = {
        "record": True,
        "modes": [
            {
                "mode": "scratch",
                "texts": 2,
                "total_seconds": 600,
                "median_seconds_per_text": 300,
            }
        ],
    }
    fake.on("GET", f"{P}/work-time", sums)
    assert await call(mcp_client, "working_time_summary", {"project": "p"}) == sums


def _export_job(fake: FakeApi, content: bytes, **job: Any) -> None:
    fake.on(
        "GET",
        "/api/v1/jobs/{job_id}",
        {
            "id": 9,
            "kind": "final_t1_export",
            "status": "succeeded",
            "result": {"sha256": hashlib.sha256(content).hexdigest()},
            "error": None,
            "created_at": "2026-11-01T10:00:00Z",
            "finished_at": "2026-11-01T10:00:05Z",
        }
        | job,
    )
    fake.on("GET", "/api/v1/jobs/{job_id}/download", content)


async def test_download_writes_the_file_and_checks_its_digest(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"zip-bytes")
    target = tmp_path / "final.zip"
    result = await call(
        mcp_client, "download_export", {"job_id": 9, "path": str(target)}
    )
    assert target.read_bytes() == b"zip-bytes"
    assert result["bytes"] == 9
    assert result["kind"] == "final"
    with pytest.raises(ToolFailed, match="exists already"):
        await call(mcp_client, "download_export", {"job_id": 9, "path": str(target)})
    await call(
        mcp_client,
        "download_export",
        {"job_id": 9, "path": str(target), "overwrite": True},
    )
    assert [p.name for p in tmp_path.iterdir()] == ["final.zip"]


async def test_a_corrupt_download_is_removed(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"expected", result={"sha256": "0" * 64})
    target = tmp_path / "final.zip"
    with pytest.raises(ToolFailed, match="does not match"):
        await call(mcp_client, "download_export", {"job_id": 9, "path": str(target)})
    assert list(tmp_path.iterdir()) == []


async def test_a_corrupt_download_keeps_the_file_it_would_replace(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"corrupt", result={"sha256": "0" * 64})
    target = tmp_path / "final.zip"
    target.write_bytes(b"the previous good export")
    with pytest.raises(ToolFailed, match="does not match"):
        await call(
            mcp_client,
            "download_export",
            {"job_id": 9, "path": str(target), "overwrite": True},
        )
    assert target.read_bytes() == b"the previous good export"
    assert [p.name for p in tmp_path.iterdir()] == ["final.zip"]


async def test_an_unfinished_job_is_not_downloaded(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"", status="running", finished_at=None)
    with pytest.raises(ToolFailed, match="'running'"):
        await call(
            mcp_client, "download_export", {"job_id": 9, "path": str(tmp_path / "a")}
        )
    assert not fake.calls_to("GET", "/api/v1/jobs/{job_id}/download")


async def test_a_refused_download_leaves_no_partial_file(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"x")
    fake.on(
        "GET",
        "/api/v1/jobs/{job_id}/download",
        refusal(403, "TOKEN_SCOPE_MISSING", "The API token needs the 'export' scope."),
    )
    with pytest.raises(ToolFailed, match="TOKEN_SCOPE_MISSING"):
        await call(
            mcp_client, "download_export", {"job_id": 9, "path": str(tmp_path / "a")}
        )
    assert list(tmp_path.iterdir()) == []


async def test_get_job_waits_until_done(fake: FakeApi, mcp_client: Client) -> None:
    states = iter(["queued", "running", "succeeded"])

    def job(request: httpx.Request) -> dict[str, Any]:
        return build("JobView", id=3, kind="t1_export", status=next(states))

    fake.on("GET", "/api/v1/jobs/{job_id}", job)
    result = await call(mcp_client, "get_job", {"job_id": 3, "wait": True})
    assert result["status"] == "succeeded"
    assert len(fake.calls) == 3


async def test_resources_read_settings_guideline_and_readme(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/settings", build("ProjectSettings", name="Ward 7"))
    current = build("GuidelineSummary", version=3)
    fake.on(
        "GET",
        f"{P}/guidelines",
        build(
            "GuidelineListing", current=current, latest_version=3, versions=[current]
        ),
    )
    fake.on(
        "GET",
        f"{P}/guidelines/{{version}}",
        build("GuidelineDocument", version=3, body="# Annotate every phenotype"),
    )
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("README.txt", "Final export of Ward 7")
    _export_job(fake, archive.getvalue())

    settings = await mcp_client.read_resource("ontotator://projects/ward-7/settings")
    assert '"name": "Ward 7"' in settings.contents[0].text
    guideline = await mcp_client.read_resource("ontotator://projects/ward-7/guideline")
    assert guideline.contents[0].text == "# Annotate every phenotype"
    readme = await mcp_client.read_resource("ontotator://jobs/9/readme")
    assert readme.contents[0].text == "Final export of Ward 7"
    assert fake.calls_to("GET", f"{P}/guidelines/{{version}}")[
        0
    ].request.url.path.endswith("/guidelines/3")


async def test_case_ids_with_slashes_stay_one_segment(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    fake.on("GET", PANEL, panel([], all_match=False))
    with pytest.raises(ToolFailed):
        await call(
            mcp_client,
            "start_consolidation",
            {"project": "p", "case_id": "a/b", "language": "en", "reviewer": "c"},
        )
    [request] = fake.calls_to("GET", PANEL)
    assert b"/document-rows/a%2Fb/en/final-panel" in request.request.url.raw_path
