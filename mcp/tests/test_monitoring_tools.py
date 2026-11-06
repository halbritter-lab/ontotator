"""The read-only monitoring and QA tools (#352)."""

from __future__ import annotations

import pytest
from conftest import call
from fake_api import FakeApi
from mcp import Client
from shapes import build

P = "/api/v1/projects/{key}"
DOC = "case/1-en-v1"

pytestmark = pytest.mark.anyio


async def test_get_problem_report_reads_one_report(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        "/api/v1/problem-reports/{report_id}",
        build("ProblemReportView", report_id="r7", reason="Text is cut off"),
    )
    report = await call(mcp_client, "get_problem_report", {"report_id": "r7"})
    assert (report["report_id"], report["reason"]) == ("r7", "Text is cut off")
    [request] = fake.calls
    assert request.request.url.path == "/api/v1/problem-reports/r7"


async def test_list_guidelines_gives_versions_and_read_status(
    fake: FakeApi, mcp_client: Client
) -> None:
    reach = build("GuidelineReachView", notified=3, opened=2, members=4)
    version = build("GuidelineSummary", version=2, reach=reach, not_seen=[])
    fake.on(
        "GET",
        f"{P}/guidelines",
        build(
            "GuidelineListing", current=version, latest_version=2, versions=[version]
        ),
    )
    listing = await call(mcp_client, "list_guidelines", {"project": "p"})
    assert listing["versions"][0]["reach"] == {
        "notified": 3,
        "opened": 2,
        "members": 4,
    }


async def test_list_mode_changes_passes_the_filters(
    fake: FakeApi, mcp_client: Client
) -> None:
    await call(mcp_client, "list_mode_changes", {"project": "p"})
    await call(mcp_client, "list_mode_changes", {"project": "p", "case_id": "c1"})
    every, one = fake.calls
    assert "case_id" not in every.request.url.params
    assert dict(one.request.url.params) == {"case_id": "c1"}


async def test_get_text_detail_collects_tasks_rounds_submissions_and_reviews(
    fake: FakeApi, mcp_client: Client
) -> None:
    tasks = [
        build("AssignmentView", id=1, task="annotate", username="ana"),
        build("AssignmentView", id=2, task="translation_review", username="rev"),
    ]
    fake.on("GET", f"{P}/assignments", tasks)
    fake.on(
        "GET",
        "/api/v1/assignments/{assignment_id}/rounds",
        [build("WorkRoundView", round_id="r1", assignment_id=1)],
    )
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/submissions",
        [build("SubmissionHistorySummary", submission_id="s1")],
    )
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/translation-reviews",
        [build("TranslationReviewRecord", id=5)],
    )
    detail = await call(
        mcp_client, "get_text_detail", {"project": "p", "document_id": DOC}
    )
    assert [a["username"] for a in detail["assignments"]] == ["ana", "rev"]
    assert [r["round_id"] for r in detail["rounds"]] == ["r1"]
    assert [s["submission_id"] for s in detail["submissions"]] == ["s1"]
    assert [r["id"] for r in detail["translation_reviews"]] == [5]
    # Only tasks that work in rounds are asked for rounds; the text ID is
    # one path segment.
    rounds = fake.calls_to("GET", "/api/v1/assignments/{assignment_id}/rounds")
    assert [c.request.url.path for c in rounds] == ["/api/v1/assignments/1/rounds"]
    [listed] = fake.calls_to("GET", f"{P}/assignments")
    assert listed.request.url.params["document_id"] == DOC
    [subs] = fake.calls_to("GET", f"{P}/documents/{{doc}}/submissions")
    assert "case%2F1-en-v1" in subs.request.url.raw_path.decode()


async def test_list_translation_reviews_of_the_project_or_one_text(
    fake: FakeApi, mcp_client: Client
) -> None:
    review = build("TranslationReviewRecord", id=5, decision="accepted_unchanged")
    fake.on("GET", f"{P}/translation-reviews", [review])
    found = await call(mcp_client, "list_translation_reviews", {"project": "p"})
    assert [r["id"] for r in found] == [5]
    await call(
        mcp_client, "list_translation_reviews", {"project": "p", "document_id": DOC}
    )
    assert fake.templates() == [
        ("GET", f"{P}/translation-reviews"),
        ("GET", f"{P}/documents/{{doc}}/translation-reviews"),
    ]
