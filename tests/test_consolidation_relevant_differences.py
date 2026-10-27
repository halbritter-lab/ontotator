"""Only relevant differences are consolidation decisions (acceptance fixes
spec, deviation 2026-10-22): the term and every differing axis always; the
text only when the spans genuinely conflict; notes never. A group with
three people and two terms still resolves to exactly one finding.

Three submissions on c1-en (anno, ana, anno2):

* term group on "Seit 2": anno STATUS present, ana STATUS absent, anno2
  FEBRILE present (same span; the STATUS members differ in assertion).
* shift group: HYPOTONIA on "schwere" (anno, ana) and on "schwere" plus three
  more characters (anno2): overlapping spans with a small shift, no decision.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in
from test_consolidation_resolve_api import (
    FEBRILE,
    STATUS,
    access_of,
    annotation,
    cons_id,
    inputs,
    mutate,
    ok,
    view,
)
from test_consolidation_resolve_validation import refused
from test_final_panel_api import HYPOTONIA, finding, span_of, submit_findings
from work_plan_support import assign, doc, plan_env

from ontotator.application.work_rounds import WorkRoundService

FIRST, SECOND, THIRD = "sub-rel-1", "sub-rel-2", "sub-rel-3"


@pytest.fixture
def cons(tmp_path: Any) -> SimpleNamespace:
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    seit = span_of(env, target, "Seit 2")
    heavy = span_of(env, target, "schwere")
    shifted = (heavy[0], heavy[1] + 3)
    people = ((FIRST, "anno"), (SECOND, "ana"), (THIRD, "anno2"))
    findings = {
        FIRST: [
            finding("t1", STATUS, seit, assertion="present"),
            finding("h1", HYPOTONIA, heavy),
        ],
        SECOND: [
            finding("t2", STATUS, seit, assertion="absent"),
            finding("h2", HYPOTONIA, heavy),
        ],
        THIRD: [
            finding("t3", FEBRILE, seit, assertion="present"),
            finding("h3", HYPOTONIA, shifted),
        ],
    }
    for sid, username in people:
        submit_findings(
            env, assign(env, target, username, "annotate"), sid, findings[sid]
        )
    review = assign(env, target, "adj", "review")
    lead_access, lead_actor = access_of(env, "leader", "lead")
    created = WorkRoundService(env.db).create(
        lead_access,
        lead_actor,
        review,
        request_id="consolidate",
        expected_workflow_revision=0,
        kind="consolidation",
        source_submission_ids=[FIRST, SECOND, THIRD],
    )
    adj = logged_in(env.app, "adj", assignments=[])
    return SimpleNamespace(env=env, round=created, adj=adj, review=review, count=0)


def term_group(ns: Any) -> dict[str, Any]:
    return next(g for g in view(ns)["groups"] if "term_differs" in g["kinds"])


def shift_group(ns: Any) -> dict[str, Any]:
    return next(
        g
        for g in view(ns)["groups"]
        if {m["term_id"] for m in g["members"]} == {HYPOTONIA}
    )


def member(item: dict[str, Any], term: str, assertion: str) -> dict[str, Any]:
    return next(
        m
        for m in item["members"]
        if m["term_id"] == term and m["axes"]["assertion"] == assertion
    )


def test_a_small_span_shift_is_no_decision_and_keep_takes_the_first_member(cons):
    shift = shift_group(cons)
    assert "span_differs" in shift["kinds"]
    assert shift["span_conflict"] is False
    assert shift["state"] == "open"  # not a match: no automatic take-over
    ids = inputs(shift)
    draft = ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    kept = annotation(draft, cons_id(cons, ids, 0)).annotation
    assert kept.term_id == HYPOTONIA
    assert kept.evidence_refs


def test_choose_with_three_people_and_two_terms_writes_one_finding(cons):
    terms = term_group(cons)
    ids = inputs(terms)
    absent = member(terms, STATUS, "absent")
    draft = ok(
        mutate(
            cons,
            "resolve",
            {
                "input_ids": ids,
                "action": "choose",
                "choice": {
                    "term_id": STATUS,
                    "span_from_input_id": absent["input_id"],
                    "axes": {"assertion": "absent"},
                },
            },
        )
    )
    chosen = annotation(draft, cons_id(cons, ids, 0)).annotation
    assert (chosen.term_id, chosen.axes_values["assertion"]) == (STATUS, "absent")
    assert term_group(cons)["annotation_ids"] == [cons_id(cons, ids, 0)]


def test_keep_is_refused_while_terms_or_values_differ(cons):
    refused(cons, {"input_ids": inputs(term_group(cons)), "action": "keep"})
