"""Documents facts loader: one connection, shared lock, complete facts."""

import pytest
from document_rows_support import service
from test_annotation_versions import seed_submission
from test_case_api import BASE, CASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env

from ontocurator.application import document_rows as rows_module
from ontocurator.application.document_rows import RowQuery, load_facts
from ontocurator.application.final_causes import (
    ACKNOWLEDGEABLE_CODES,
    authorize_final_results,
)
from ontocurator.domain import document_rows as domain_rows

pytest_plugins = ("test_work_rounds",)


def test_acknowledgeable_codes_match_the_domain_copy():
    assert ACKNOWLEDGEABLE_CODES == domain_rows.ACKNOWLEDGEABLE


def test_documents_takes_only_the_shared_project_lock(case_env, monkeypatch):
    calls = []
    original = rows_module.authorize_final_results

    def spy(conn, actor, key, *, exclusive):
        calls.append(exclusive)
        return original(conn, actor, key, exclusive=exclusive)

    monkeypatch.setattr(rows_module, "authorize_final_results", spy)
    monkeypatch.setattr(
        rows_module,
        "build_page_with_context",
        lambda facts, query: ({"groups": []}, None),
    )
    monkeypatch.setattr(rows_module, "build_submissions", lambda *args: {})
    service(case_env).page("proj", RowQuery())
    service(case_env).submissions("proj", CASE, "de")
    assert calls == [False, False]


def test_facts_cover_versions_selection_rule_and_activity(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    selected = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0},
    )
    assert selected.status_code == 200, selected.text
    svc = service(env)
    with env.db.transaction() as conn:
        pid = authorize_final_results(conn, svc.actor, "proj", exclusive=False)
        facts = load_facts(conn, svc.repo, "proj", pid, svc.actor.user_id)
    assert {v.document_id for v in facts.versions} >= {SOURCE, TARGET, CORRECTED}
    assert facts.submission_counts[TARGET] == 1
    assert facts.selected_submissions["german"].document_id == TARGET
    assert facts.adjudicator_not_annotator is False
    assert (
        facts.last_activity[TARGET] >= facts.selected_submissions["german"].recorded_at
    )
    assert (CASE, "de") in facts.selection_activity
    assert facts.selections[(CASE, "de")]["selected_by"] == facts.viewer_pseudonym
    assert {item.document_id for item in facts.assignments} >= {SOURCE, TARGET}
    assert [item["submission_id"] for item in facts.final_state["selections"]] == [
        "german"
    ]


def test_retain_keys_are_bounded_and_mutual_exclusion_holds():
    with pytest.raises(ValueError):
        RowQuery(decision="all", final="missing")
    with pytest.raises(ValueError):
        RowQuery(retain=tuple(f"c{i}:de" for i in range(201)))
    with pytest.raises(ValueError):
        RowQuery(page=0)


def test_facts_carry_reports_rounds_and_report_activity(rounds):
    from ontocurator.application.problem_reports import ProblemReportService
    from ontocurator.auth.audit import Actor

    repo, access, actor, assignment, _ = rounds
    reason = "Unclear passage " + "x" * 200
    report = ProblemReportService(repo.db).report(
        access,
        actor,
        assignment.id,
        request_id="facts-report",
        expected_workflow_revision=assignment.workflow_revision,
        reason=reason,
    )
    with repo.db.transaction() as conn:
        pid = authorize_final_results(
            conn, Actor(None, "test:lead"), "pkg-1", exclusive=False
        )
        facts = load_facts(conn, repo, "pkg-1", pid, access.user_id)
    fact = facts.reports[report.report_id]
    assert fact.excerpt == reason[:120]
    assert fact.reporter_label == "anna"
    assert fact.task_state == "paused"
    assert fact.assignment_id == assignment.id
    (held,) = [
        item for item in facts.assignments if item.assignment_id == assignment.id
    ]
    assert held.held and not held.revoked and held.pseudonym == "anna"
    assert [item.round_id for item in facts.rounds] == [report.round_id]
    assert facts.last_activity["doc-1"] >= fact.created_at
    assert facts.viewer_pseudonym == "anna"
    assert {cause["code"] for cause in facts.final_state["warnings"]} >= {
        "OPEN_PROBLEM_REPORT"
    }
