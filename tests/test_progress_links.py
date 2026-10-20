"""Progress counts equal their Documents links (follow-up spec FD11).

Every stage count carries the Documents query that lists exactly its rows:
``count == bar.shown`` of ``GET document-rows`` with that query.
"""

from __future__ import annotations

from typing import Any

import pytest
from test_document_rows_next_step import add_correction
from test_progress_stages import progress, scenario, set_status
from work_plan_support import BASE, doc, plan_env, write

from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store as store

ANNOTATE = PlanFlags(False, True)
REVIEW_ON = ["review", "review_and_annotate"]
ANNOTATE_ON = ["annotate", "review_and_annotate"]


@pytest.fixture
def env(tmp_path):
    """The stage-card scenario (check failed with and without reviewer, an
    accepted row, a rejected row, a final, a held annotation, a row not in
    the plan) plus a corrected v2 of the rejected c2 fr and a Review-off row
    accepted by the package (c1 fr)."""
    env = plan_env(tmp_path)
    scenario(env, tmp_path)
    add_correction(env, doc("c2", "fr"), "c2-fr-v2", "accepted")
    set_status(env, doc("c1", "fr"), "accepted")
    write(env, {RowKey("c1", "fr"): ANNOTATE})
    with env.db.transaction() as conn:
        store.add_acceptance(
            conn,
            env.pid,
            doc("c1", "fr"),
            source="package",
            reason=None,
            accepted_by=None,
        )
    return env


def params_of(link: dict[str, Any]) -> list[tuple[str, str]]:
    """Repeated query parameters of a link (lists repeat, ``None`` is omitted)."""
    params: list[tuple[str, str]] = []
    for name, value in link.items():
        if isinstance(value, list):
            params.extend((name, item) for item in value)
        elif value is not None:
            params.append((name, str(value)))
    return params


def shown(env: Any, link: dict[str, Any]) -> int:
    response = env.lead.get(f"{BASE}/document-rows", params=params_of(link))
    assert response.status_code == 200, response.text
    return int(response.json()["bar"]["shown"])


def test_every_count_equals_its_documents_link(env):
    stages = progress(env.lead)["stages"]
    checked = 0
    for name, card in stages.items():
        assert set(card["links"]) == set(card["counts"]), name
        for count, value in card["counts"].items():
            assert value == shown(env, card["links"][count]), (name, count)
            checked += 1
    assert checked == 16
    # The scenario reaches the interesting counts.
    review = stages["translation_review"]["counts"]
    # The accepted correction v2 resolves c2 fr; its row matches the version
    # filter (before FD11 "Accepted" needed every version accepted).
    assert (review["rejected_or_queried"], review["accepted"]) == (0, 1)
    assert stages["annotation"]["counts"]["paused"] == 1
    assert stages["final"]["counts"]["final"] == 1


def test_links_match_the_spec_table(env):
    stages = progress(env.lead)["stages"]

    def link(card: str, count: str) -> dict[str, Any]:
        value = stages[card]["links"][count]
        return {name: item for name, item in value.items() if item not in (None, [])}

    review = "translation_review"
    assert link(review, "to_assign") == {
        "plan": REVIEW_ON,
        "step": ["assign_translation_review"],
    }
    assert link(review, "in_review") == {
        "plan": REVIEW_ON,
        "step": ["translation_review_in_progress"],
    }
    assert link(review, "check_failed_with_reviewer") == {
        "plan": REVIEW_ON,
        "translation_status": "automatic_check_failed",
        "step": ["translation_review_in_progress"],
    }
    assert link(review, "check_failed") == {
        "plan": REVIEW_ON,
        "translation_status": "automatic_check_failed",
    }
    assert link(review, "rejected_or_queried") == {
        "plan": REVIEW_ON,
        "step": ["resolve_rejected", "resolve_queried"],
    }
    assert link(review, "accepted") == {
        "plan": REVIEW_ON,
        "translation_status": "accepted",
    }
    annotation = "annotation"
    assert link(annotation, "waiting_for_review") == {
        "plan": ANNOTATE_ON,
        "step": ["translation_review_in_progress", "waiting_for_translation_review"],
    }
    assert link(annotation, "to_assign") == {
        "plan": ANNOTATE_ON,
        "step": ["assign_annotation"],
    }
    assert link(annotation, "in_progress") == {
        "plan": ANNOTATE_ON,
        "step": ["annotation_in_progress", "annotation_review_in_progress"],
        "paused": "no",
    }
    assert link(annotation, "paused") == {"plan": ANNOTATE_ON, "paused": "yes"}
    assert link(annotation, "submitted") == {
        "plan": ANNOTATE_ON,
        "stage": ["final", "done"],
        "paused": "no",
    }
    assert link("final", "not_ready") == {
        "plan": ANNOTATE_ON,
        "stage": ["translation_review", "annotation"],
    }
    assert link("final", "to_choose") == {
        "plan": ANNOTATE_ON,
        "step": ["choose_final"],
    }
    assert link("final", "to_confirm") == {
        "plan": ANNOTATE_ON,
        "step": ["confirm_final"],
    }
    assert link("final", "final") == {"plan": ANNOTATE_ON, "final": "any"}
    assert link("final", "would_be_omitted") == {
        "plan": ANNOTATE_ON,
        "final": "none",
    }
