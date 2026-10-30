"""Documents tabs: Needs your decision, To assign, In progress, Done, All
(documents overview spec "Tabs", V10, VD1, VD7)."""

from __future__ import annotations

from typing import Any

import pytest
from document_rows_support import rows_of
from test_document_rows_stages import (
    ANNOTATE,
    BOTH,
    OFF,
    REVIEW,
    page,
    plan,
    pseudonym,
    rows_service,
    set_status,
    undecide,
)
from work_plan_support import assign, doc, plan_env, submit

from ontotator.api.assignment_batch_routes import DocumentRowFilters
from ontotator.application.document_rows import RowQuery
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor

KIND_FIELDS = {
    "decision": "needs_decision",
    "assign": "to_assign",
    "in_progress": "in_progress",
}
TABS = (None, "decision", "assign", "progress", "done")
TAB_FIELDS = {
    None: "all",
    "decision": "needs_decision",
    "assign": "to_assign",
    "progress": "in_progress",
    "done": "done",
}


@pytest.fixture
def env(tmp_path):
    """c1 de review-only accepted (done); c1 fr Annotate only (decision, rule
    on); c2 de both with a translation review (in progress); c1/c2 en
    annotate (c2 en in progress); c2 fr undecided."""
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    plan(env, c1_de=REVIEW, c1_fr=ANNOTATE, c2_de=BOTH)
    set_status(env, doc("c1", "de"), "accepted")
    assign(env, doc("c2", "de"), "ana", "translation_review")
    assign(env, doc("c2", "en"), "anno", "annotate")
    undecide(env, ("c2", "fr"))
    return env


def listed(result: dict[str, Any]) -> set[tuple[str, str]]:
    return {
        key
        for key, row in rows_of(result).items()
        if not row["retained"] and not row["pinned"]
    }


def test_tab_counts_equal_row_step_kinds(env):
    result = page(env)
    bar = result["bar"]
    all_rows = rows_of(result).values()
    for kind, field in KIND_FIELDS.items():
        assert bar[field] == sum(
            1
            for row in all_rows
            if row["next_step"] and row["next_step"]["kind"] == kind
        ), kind
    assert bar["done"] == sum(
        1 for row in all_rows if row["in_plan"] and row["next_step"]["kind"] == "done"
    )
    assert (
        bar["needs_decision"],
        bar["to_assign"],
        bar["in_progress"],
        bar["done"],
    ) == (2, 1, 2, 1)
    # The undecided row counts as a decision, not in the plan.
    assert bar["not_decided"] == 1 and bar["in_plan"] == 5


def test_all_counts_every_row(env):
    bar = page(env)["bar"]
    assert bar["all"] == 6  # c1, c2 x en, de, fr; incl. the undecided c2 fr


def test_segment_done_lists_done_rows_only(env):
    result = page(env, segment="done")
    assert listed(result) == {("c1", "de")}
    assert result["bar"]["shown"] == result["bar"]["done"] == 1


def test_no_segment_lists_every_row_and_shown_counts_them(env):
    result = page(env)
    assert len(listed(result)) == 6
    assert result["bar"]["shown"] == result["bar"]["all"] == 6


def test_shown_equals_rows_listed_for_each_tab(env):
    for tab in TABS:
        result = page(env, segment=tab)
        bar = result["bar"]
        assert bar["shown"] == len(listed(result)) == bar[TAB_FIELDS[tab]], tab
    decision = listed(page(env, segment="decision"))
    assert ("c2", "fr") in decision  # undecided: Needs your decision (V10)
    assert ("c2", "fr") not in listed(page(env, segment="assign"))
    # Tab counts ignore filters and search (spec open question 4).
    assert page(env, language="de")["bar"]["all"] == 6


def test_every_lead_step_has_an_actionable_cell(env):
    """Contract: a row whose first step is the lead's shows a stage cell in
    an actionable tone (spec "Testing", "Contract")."""
    # "rejected" counts as actionable: scenario 4's Rejected cell carries
    # the lead's "Resolve…" action (resolve_rejected).
    actionable = {"decision", "todo", "undecided", "rejected"}
    for key, row in rows_of(page(env)).items():
        step = row["next_step"]
        if step is None or step["kind"] not in ("decision", "assign"):
            continue
        tones = {cell["tone"] for cell in row["stages"].values()}
        assert tones & actionable, (key, step["code"], tones)


def test_decided_not_in_plan_row_is_listed_under_all_only(env):
    plan(env, c2_fr=OFF)  # the lead decides: not in the plan
    row = rows_of(page(env))[("c2", "fr")]
    assert row["plan_row"]["decided"] is True and row["in_plan"] is False
    assert row["next_step"] is None and row["steps"] == []
    assert ("c2", "fr") in listed(page(env))
    for tab in TABS[1:]:
        assert ("c2", "fr") not in listed(page(env, segment=tab)), tab
    # Nobody is waited on for it.
    assert ("c2", "fr") not in listed(page(env, waiting_on=("me",)))
    assert page(env)["bar"]["not_decided"] == 0


def test_search_ignores_case_and_matches_inside_the_id(env):
    assert listed(page(env, q="C1 de")) == {("c1", "de")}
    assert listed(page(env, q="c1 DE")) == {("c1", "de")}
    assert listed(page(env, q="1 de")) == {("c1", "de")}
    assert {key[0] for key in listed(page(env, q="C2"))} == {"c2"}
    assert listed(page(env, q="exophtalmie")) == set()


def test_empty_search_reports_its_hits_under_all(env):
    hit = page(env, q="C1 DE", segment="assign")
    assert hit["groups"] == []
    assert (hit["bar"]["shown"], hit["bar"]["all_tab_shown"]) == (0, 1)
    # A category filter leaves with the tab too; other filters stay.
    decision = page(env, q="c1 de", decision="all")["bar"]
    assert (decision["shown"], decision["all_tab_shown"]) == (0, 1)
    other = page(env, q="c1 de", segment="assign", language="fr")["bar"]
    assert other["all_tab_shown"] == 0
    none = page(env, q="nope", segment="assign")["bar"]
    assert (none["shown"], none["all_tab_shown"]) == (0, 0)
    assert page(env, segment="assign")["bar"]["all_tab_shown"] == 0


@pytest.fixture
def work(env):
    """anno: c2 en open, c1 en submitted; ana: c2 de review, c1 en revoked."""
    submit(env, assign(env, doc("c1", "en"), "anno", "annotate"), "anno-c1")
    gone = assign(env, doc("c1", "en"), "ana", "annotate")
    lead = env.app.state.accounts.get_by_username("leader")
    AssignmentService(env.db).revoke(Actor(lead.id, "user:leader"), gone)
    return env


def test_assignee_covers_open_and_submitted_work_not_revoked(work):
    anno = pseudonym(work, "anno")
    assert listed(page(work, assignee=anno)) == {("c2", "en"), ("c1", "en")}
    # The review task; the revoked c1 en is left out.
    assert listed(page(work, assignee=pseudonym(work, "ana"))) == {("c2", "de")}
    assert listed(page(work, assignee="nobody")) == set()


def test_assignee_combines_with_other_filters(work):
    anno = pseudonym(work, "anno")
    assert listed(page(work, assignee=anno, q="C1")) == {("c1", "en")}
    assert listed(page(work, assignee=anno, segment="progress")) == {("c2", "en")}
    assert listed(page(work, assignee=anno, language="de")) == set()
    assert listed(page(work, assignee=anno, status="open")) == {("c2", "en")}
    assert listed(page(work, assignee=anno, status="submitted")) == {("c1", "en")}
    assert listed(page(work, assignee=anno, status="unassigned")) == set()


def test_status_looks_at_the_assignees_own_work(work):
    assign(work, doc("c1", "en"), "ana", "annotate")  # open beside anno's submitted
    anno = pseudonym(work, "anno")
    assert ("c1", "en") in listed(page(work, status="open"))
    assert ("c1", "en") not in listed(page(work, assignee=anno, status="open"))


def test_assignee_reaches_the_selection(work):
    anno = pseudonym(work, "anno")
    found = rows_service(work).case_ids("proj", RowQuery(assignee=anno))
    assert sorted(found["case_ids"]) == ["c1", "c2"]
    assert DocumentRowFilters(assignee=anno).query().assignee == anno
