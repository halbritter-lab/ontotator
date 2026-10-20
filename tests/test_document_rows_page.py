"""Documents page: rows, bar, filters, paging, retained rows (service level)."""

from dataclasses import replace
from typing import Any

import pytest
from document_rows_support import rows_of, service
from sqlalchemy import select, update
from t1_builders import bundle, native_unit
from t1_fixtures import run_import
from test_annotation_versions import seed_submission
from test_case_api import BASE, CASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env
from test_translation_review_task import assigned
from tests_support_reviews import insert_review

from ontocurator.application.document_row_page import build_row
from ontocurator.application.document_rows import RowFacts, RowQuery, load_facts
from ontocurator.application.final_causes import authorize_final_results
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
)

# Cause codes the export preflight emits per row (MISSING_FINAL_SELECTION is unconditional
# in the preflight and replaced by the Documents-only MISSING_FINAL rule).
SHARED_CAUSE_CODES = frozenset(
    {
        "OPEN_PROBLEM_REPORT",
        "TASK_ON_HOLD",
        "TASK_PAUSED_WITHOUT_REPORT",
        "SOURCE_UPDATE_UNREVIEWED",
        "ROUND_REVIEW_PENDING",
        "SELECTED_ROUND_ABANDONED",
        "SELECTED_ROUND_SUPERSEDED",
        "SELECTED_RESULT_REVISED",
        "SELECTED_TEXT_CORRECTED",
        "SELECTED_NEWER_RESULT",
    }
)
DOCUMENTS_ONLY_CODES = frozenset(
    {
        "TRANSLATION_CHECK_FAILED",
        "TRANSLATION_NOT_ACCEPTED",
        "REVIEWER_NEEDED",
        "MISSING_FINAL",
    }
)

# "source" in fullwidth letters; NFKC folds it to ASCII.
FULLWIDTH_SOURCE = "".join(chr(ord(c) + 0xFEE0) for c in "source")


def submit_assignments(env: Any, document_id: str) -> None:
    """Mark every assignment on ``document_id`` submitted (no open work)."""
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.document_id == document_id)
            .values(status="submitted")
        )


def test_one_row_per_text_and_language_with_chain_and_final(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0},
    )
    page = service(env).page("proj", RowQuery())
    rows = rows_of(page)
    assert set(rows) >= {(CASE, "en"), (CASE, "de")}
    de = rows[(CASE, "de")]
    assert [v["document_id"] for v in de["versions"]] == [TARGET, CORRECTED]
    assert de["parallel_roots"] is False
    assert de["final"]["submission_id"] == "german" and de["final"]["version"] == 1
    assert (
        de["final"]["author_label"]
        == env.app.state.accounts.get_by_username("alice").pseudonym
    )
    assert any(i["code"] == "SELECTED_TEXT_CORRECTED" for i in de["issues"])
    group = next(g for g in page["groups"] if g["case_id"] == CASE)
    assert group["rows"][0]["language"] == "en"  # source language first


def test_shared_cause_ids_equal_the_preflight_per_row(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0},
    )
    preflight = env.lead.post(f"{BASE}/exports/final/preflight").json()
    emitted = {w["code"] for w in preflight["warnings"]} - {"MISSING_FINAL_SELECTION"}
    assert emitted <= SHARED_CAUSE_CODES, (
        emitted - SHARED_CAUSE_CODES
    )  # extend the set if the preflight grows
    expected: dict = {}
    for w in preflight["warnings"]:
        if w["code"] in SHARED_CAUSE_CODES:
            expected.setdefault((w["case_id"], w["language"]), set()).add(w["cause_id"])
    page = service(env).page("proj", RowQuery())
    actual = {
        key: {
            i["cause_id"]
            for i in row["issues"] + row["notes"]
            if i["code"] in SHARED_CAUSE_CODES
        }
        for key, row in rows_of(page).items()
    }
    assert {k: v for k, v in actual.items() if v} == expected


def test_documents_only_items_are_derived_here_and_absent_from_the_preflight(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    submit_assignments(env, SOURCE)  # en: submission, no final, no open work
    preflight_codes = {
        w["code"]
        for w in env.lead.post(f"{BASE}/exports/final/preflight").json()["warnings"]
    }
    assert not preflight_codes & DOCUMENTS_ONLY_CODES
    en = rows_of(service(env).page("proj", RowQuery()))[(CASE, "en")]
    missing = [i for i in en["issues"] if i["code"] == "MISSING_FINAL"]
    assert [i["cause_id"] for i in missing] == [f"MISSING_FINAL:{CASE}:en"]
    assert missing[0]["category"] == "missing-final"
    # REVIEWER_NEEDED note: CORRECTED is ready_for_review without a translation_review assignment.
    de = rows_of(service(env).page("proj", RowQuery()))[(CASE, "de")]
    assert any(n["code"] == "REVIEWER_NEEDED" for n in de["notes"])


def test_current_rule_is_exposed_separately_from_the_selection_snapshot(case_env):
    env = case_env
    seed_submission(env, "leader", "own", document=TARGET)
    env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "own", "expected_revision": 0},
    )
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(adjudicator_not_annotator=True)
        )
    page = service(env).page("proj", RowQuery())
    assert page["adjudicator_not_annotator"] is True  # rule now
    de = rows_of(page)[(CASE, "de")]
    assert de["final"]["adjudicator_not_annotator"] is False  # rule at selection time
    assert de["final"]["is_mine"] is True


def test_bar_counts_are_project_wide_and_ignore_filters(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    all_rows = service(env).page("proj", RowQuery())
    filtered = service(env).page("proj", RowQuery(language="fr"))
    assert all_rows["bar"] == {**filtered["bar"], "shown": all_rows["bar"]["shown"]}
    # Without a segment, "k of n shown" counts filtered rows of the plan.
    assert filtered["bar"]["shown"] <= filtered["bar"]["in_plan"]
    assert all_rows["bar"]["shown"] == all_rows["bar"]["in_plan"]


def test_case_deep_link_keeps_row_visible_and_unknown_case_is_reported(case_env):
    page = service(case_env).page(
        "proj", RowQuery(case=CASE, language="de", decision="confirm-final")
    )
    pinned = rows_of(page)[(CASE, "de")]
    assert pinned["pinned"] is True and pinned["matches_decision"] is False
    assert service(case_env).page("proj", RowQuery(case="nope"))["case_found"] is False


def test_retained_rows_return_with_current_data_when_they_stop_matching(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    submit_assignments(env, SOURCE)
    before = rows_of(service(env).page("proj", RowQuery(decision="missing-final")))
    assert (CASE, "en") in before
    env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": SOURCE,
            "submission_id": "english",
            "expected_revision": 0,
        },
    )
    plain = rows_of(service(env).page("proj", RowQuery(decision="missing-final")))
    assert (CASE, "en") not in plain
    kept = rows_of(
        service(env).page(
            "proj", RowQuery(decision="missing-final", retain=(f"{CASE}:en",))
        )
    )
    row = kept[(CASE, "en")]
    assert row["retained"] is True and row["matches_decision"] is False
    assert row["final"]["submission_id"] == "english" and row["categories"] == []


@pytest.mark.parametrize("q", ["source/id", FULLWIDTH_SOURCE + "/id"])
def test_q_matches_case_external_or_document_prefix_with_nfkc(case_env, q):
    page = service(case_env).page("proj", RowQuery(q=q))
    assert (CASE, "en") in rows_of(page)


def test_missing_final_counts_only_when_all_work_is_submitted(case_env):
    env = case_env
    de = rows_of(service(env).page("proj", RowQuery()))[(CASE, "de")]
    assert de["missing_final"] == {"counts": False, "reason": "no_submission"}
    seed_submission(env, "alice", "english", document=SOURCE)
    en = rows_of(service(env).page("proj", RowQuery()))[(CASE, "en")]
    assert en["missing_final"] == {"counts": False, "reason": "work_open"}
    assert "missing-final" not in en["categories"]
    submit_assignments(env, SOURCE)
    en = rows_of(service(env).page("proj", RowQuery()))[(CASE, "en")]
    assert en["missing_final"] == {"counts": True, "reason": None}
    assert en["categories"] == ["missing-final"]


def test_paging_keeps_groups_whole_and_orders_by_position(case_env, tmp_path):
    env = case_env
    # Two cases exist already; 49 more make 51 text groups.
    units = [
        native_unit(f"many-{index:02d}", "en", "Some text", case_id=f"case-{index:02d}")
        for index in range(49)
    ]
    (tmp_path / "many").mkdir()
    result = run_import(env.db, bundle(tmp_path / "many", units))
    assert result.status == "succeeded", result.error
    first = service(env).page("proj", RowQuery(sort="import"))
    second = service(env).page("proj", RowQuery(page=2, sort="import"))
    assert first["page_count"] == second["page_count"] == 2
    assert first["group_count"] == 51 and len(first["groups"]) == 50
    assert len(second["groups"]) == 1
    groups = first["groups"] + second["groups"]
    order = [
        (
            min(
                (r["position"] for r in g["rows"] if r["position"] is not None),
                default=None,
            ),
            g["case_id"],
        )
        for g in groups
    ]
    assert order == sorted(order, key=lambda o: (o[0] is None, o[0] or 0, o[1]))


def test_filters_select_rows_but_never_narrow_their_content(case_env):
    page = service(case_env).page("proj", RowQuery(origin="correction"))
    rows = rows_of(page)
    assert set(rows) == {(CASE, "de")}
    versions = rows[(CASE, "de")]["versions"]
    assert [v["document_id"] for v in versions] == [TARGET, CORRECTED]
    assert [v["matches_filter"] for v in versions] == [False, True]


def test_last_activity_is_the_latest_event_and_the_group_maximum(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    with env.db.transaction() as conn:
        recorded = conn.execute(
            select(SubmissionRow.recorded_at).where(
                SubmissionRow.submission_id == "english"
            )
        ).scalar_one()
    page = service(env).page("proj", RowQuery())
    en = rows_of(page)[(CASE, "en")]
    assert en["last_activity_at"] == recorded
    group = next(g for g in page["groups"] if g["case_id"] == CASE)
    assert group["last_activity_at"] == max(
        r["last_activity_at"] for r in group["rows"] if r["last_activity_at"]
    )


def test_retained_rows_still_respect_non_decision_filters(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    submit_assignments(env, SOURCE)
    env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": SOURCE,
            "submission_id": "english",
            "expected_revision": 0,
        },
    )
    page = service(env).page(
        "proj",
        RowQuery(decision="missing-final", language="de", retain=(f"{CASE}:en",)),
    )
    assert (CASE, "en") not in rows_of(page)


ROW_KEYS = {
    "case_id",
    "problem_reports",
    "language",
    "is_source",
    "position",
    "versions",
    "parallel_roots",
    "work",
    "final",
    "issues",
    "notes",
    "missing_final",
    "categories",
    "bulk",
    "open",
    "own_open_assignment_id",
    "last_activity_at",
    "pinned",
    "retained",
    "matches_decision",
    "next_step",
    "steps",
    "plan_row",
    "in_plan",
}
VERSION_KEYS = {
    "document_id",
    "external_id",
    "version",
    "origin",
    "derived_from",
    "chain_id",
    "chain_name",
    "translation_status",
    "accepted_without_review",
    "latest_review_decision",
    "is_newest_in_chain",
    "matches_filter",
    "last_activity_at",
}
WORK_KEYS = {
    "person",
    "assignment_id",
    "document_id",
    "version",
    "author_label",
    "is_me",
    "task",
    "status",
    "held",
    "round_ordinal",
    "round_state",
}
FINAL_KEYS = {
    "author",
    "case_id",
    "language",
    "document_id",
    "submission_id",
    "revision",
    "selected_at",
    "updated_at",
    "selected_by",
    "kind",
    "round_ordinal",
    "author_label",
    "is_mine",
    "version",
    "chain_name",
    "recorded_at",
    "is_newest_of_chain",
    "adjudicator_not_annotator",
}
ITEM_KEYS = {
    "code",
    "cause_id",
    "cause_revision",
    "document_id",
    "category",
    "version",
    "review_decision",
    "report",
    "report_id",
    "assignment_id",
    "author_label",
}
GROUP_KEYS = {
    "case_id",
    "rows",
    "language_count",
    "final_count",
    "issue_count",
    "note_count",
    "last_activity_at",
    "has_issue",
    "plan_revision",
    "not_in_plan_languages",
}
PAGE_KEYS = {
    "groups",
    "page",
    "page_count",
    "group_count",
    "bar",
    "case_found",
    "adjudicator_not_annotator",
}


def select_final(env: Any, document: str, submission_id: str) -> None:
    response = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": document,
            "submission_id": submission_id,
            "expected_revision": 0,
        },
    )
    assert response.status_code == 200, response.text


def set_translation_status(env: Any, document: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document)
            .values(translation_status=status)
        )


def de_row(env: Any) -> dict[str, Any]:
    return rows_of(service(env).page("proj", RowQuery()))[(CASE, "de")]


def alice_label(env: Any) -> str:
    return env.app.state.accounts.get_by_username("alice").pseudonym


def facts_of(env: Any) -> RowFacts:
    svc = service(env)
    with env.db.transaction() as conn:
        pid = authorize_final_results(conn, svc.actor, "proj", exclusive=False)
        return load_facts(conn, svc.repo, "proj", pid, svc.access.user_id)


def test_row_final_item_group_and_page_have_exactly_the_specified_keys(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    select_final(env, TARGET, "german")
    assigned(env, document=CORRECTED)  # one non-revoked work item on the row
    page = service(env).page("proj", RowQuery())
    assert set(page) == PAGE_KEYS
    group = next(g for g in page["groups"] if g["case_id"] == CASE)
    assert set(group) == GROUP_KEYS
    de = rows_of(page)[(CASE, "de")]
    assert set(de) == ROW_KEYS
    assert set(de["final"]) == FINAL_KEYS
    assert de["versions"] and all(set(v) == VERSION_KEYS for v in de["versions"])
    assert de["work"] and all(set(w) == WORK_KEYS for w in de["work"])
    items = de["issues"] + de["notes"]
    assert items and all(set(i) == ITEM_KEYS for i in items)
    assert set(de["missing_final"]) == {"counts", "reason"}
    assert set(de["bulk"]) == {"document_id", "mode"}
    assert set(de["open"]) == {"document_id", "reason", "label"}


def test_failed_automatic_check_is_a_translation_issue_of_the_newest_version(
    case_env,
):
    set_translation_status(case_env, CORRECTED, "automatic_check_failed")
    de = de_row(case_env)
    (item,) = [i for i in de["issues"] if i["code"] == "TRANSLATION_CHECK_FAILED"]
    assert item["category"] == "translation"
    assert item["cause_id"] == f"TRANSLATION_CHECK_FAILED:{CORRECTED}"
    assert item["document_id"] == CORRECTED and item["version"] == 2
    assert item["review_decision"] is None
    assert "translation" in de["categories"]


@pytest.mark.parametrize("decision", ["rejected", "query"])
def test_rejected_or_queried_review_is_translation_not_accepted(case_env, decision):
    set_translation_status(case_env, CORRECTED, "reviewed")
    insert_review(case_env.db, "proj", CORRECTED, decision)
    de = de_row(case_env)
    (item,) = [i for i in de["issues"] if i["code"] == "TRANSLATION_NOT_ACCEPTED"]
    assert item["category"] == "translation"
    assert item["cause_id"] == f"TRANSLATION_NOT_ACCEPTED:{CORRECTED}"
    assert item["review_decision"] == decision
    assert "translation" in de["categories"]


def test_open_report_carries_its_report_and_a_kept_hold_names_the_author(case_env):
    env = case_env
    work = assigned(env, document=CORRECTED)
    reason = "Text is cut off after the second paragraph"
    created = env.alice.post(
        f"/api/v1/assignments/{work['id']}/problem-reports",
        json={
            "request_id": "report-1",
            "expected_workflow_revision": work["workflow_revision"],
            "reason": reason,
        },
    )
    assert created.status_code == 200, created.text
    report_id = created.json()["report_id"]
    de = de_row(env)
    (item,) = [i for i in de["issues"] if i["code"] == "OPEN_PROBLEM_REPORT"]
    assert item["category"] == "report-or-pause"
    assert item["report_id"] == report_id
    assert item["report"]["report_id"] == report_id
    assert item["report"]["excerpt"] == reason
    assert item["report"]["task_state"] == "paused"
    resolved = env.lead.post(
        f"/api/v1/problem-reports/{report_id}/actions",
        json={
            "request_id": "resolve-1",
            "expected_revision": 1,
            "action": "resolve",
            "reason": "Resolved, hold kept",
            "assignment_ids": [],
        },
    )
    assert resolved.status_code == 200, resolved.text
    de = de_row(env)
    assert not any(i["code"] == "OPEN_PROBLEM_REPORT" for i in de["issues"])
    (paused,) = [i for i in de["issues"] if i["code"] == "TASK_PAUSED_WITHOUT_REPORT"]
    assert paused["category"] == "report-or-pause"
    assert paused["assignment_id"] == work["id"]
    assert paused["author_label"] == alice_label(env)


def test_waiting_line_is_a_note_but_not_counted(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    select_final(env, TARGET, "german")
    assigned(env, document=CORRECTED)  # pending translation review on the chain
    page = service(env).page("proj", RowQuery())
    de = rows_of(page)[(CASE, "de")]
    assert any(n["code"] == "ROUND_REVIEW_PENDING" for n in de["notes"])
    group = next(g for g in page["groups"] if g["case_id"] == CASE)
    shown = [n for row in group["rows"] for n in row["notes"]]
    assert group["note_count"] == len(
        [n for n in shown if n["code"] != "ROUND_REVIEW_PENDING"]
    )
    assert group["note_count"] < len(shown)


@pytest.mark.parametrize(
    "extra", [{"status": "unassigned"}, {"origin": "correction"}, {"q": "nope"}]
)
def test_pinned_deep_link_row_survives_non_decision_filters(case_env, extra):
    # en has alice's assignment and no correction, so each filter excludes it.
    query = RowQuery(case=CASE, language="en", **extra)
    pinned = rows_of(service(case_env).page("proj", query))[(CASE, "en")]
    assert pinned["pinned"] is True


def test_final_kind_is_unknown_when_the_selected_submission_fact_is_missing(
    case_env,
):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    select_final(env, TARGET, "german")
    assert de_row(env)["final"]["kind"] == "annotation"
    facts = replace(facts_of(env), selected_submissions={})
    final = build_row(facts, CASE, "de")["final"]
    assert final["submission_id"] == "german"
    assert final["kind"] is None and final["author_label"] is None
