"""Progress (D9): lede, stage cards and workload from the Documents derivation."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import update
from t1_builders import bundle, native_unit
from t1_fixtures import run_import
from tests_support_reviews import insert_review
from work_plan_support import BASE, assign, doc, plan_env, select_final, submit, write

from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage.tables import AssignmentRow, DocumentRow

BOTH = PlanFlags(True, True)
REVIEW = PlanFlags(True, False)
OFF = PlanFlags(False, False)


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def set_status(env: Any, document_id: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document_id)
            .values(translation_status=status)
        )


def progress(client: Any) -> dict[str, Any]:
    response = client.get(f"{BASE}/progress")
    assert response.status_code == 200, response.text
    return dict(response.json())


def scenario(env: Any, tmp_path: Any) -> None:
    """Rows of three cases in every stage the cards count.

    c1 de (both): check failed, no reviewer; c1 fr (review): accepted;
    c2 de (both): check failed, review by ben; c2 fr (review): rejected;
    c1 en: annotated, final; c2 en: annotation paused; c3 en: not in plan.
    """
    folder = tmp_path / "c3"
    folder.mkdir()
    imported = run_import(
        env.db, bundle(folder, [native_unit("c3-en", "en", "More text", case_id="c3")])
    )
    assert imported.status == "succeeded", imported.error
    write(
        env,
        {
            RowKey("c1", "de"): BOTH,
            RowKey("c1", "fr"): REVIEW,
            RowKey("c2", "de"): BOTH,
            RowKey("c2", "fr"): REVIEW,
            RowKey("c3", "en"): OFF,
        },
    )
    set_status(env, doc("c1", "de"), "automatic_check_failed")
    set_status(env, doc("c1", "fr"), "accepted")
    set_status(env, doc("c2", "de"), "ready_for_review")
    assign(env, doc("c2", "de"), "ben", "translation_review")
    set_status(env, doc("c2", "de"), "automatic_check_failed")
    annotate = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, annotate, "s-anno")
    select_final(env, doc("c1", "en"), "s-anno")
    paused = assign(env, doc("c2", "en"), "anno2", "annotate")
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow).where(AssignmentRow.id == paused).values(held=True)
        )
    set_status(env, doc("c2", "fr"), "reviewed")
    insert_review(env.db, "proj", doc("c2", "fr"), "rejected")


def test_progress_lede_counts(env, tmp_path):
    scenario(env, tmp_path)
    data = progress(env.lead)
    lede = data["lede"]
    bar = env.lead.get(f"{BASE}/document-rows").json()["bar"]
    assert {k: lede[k] for k in ("cases", "translations_to_review")} == {
        "cases": 3,
        "translations_to_review": 3,  # c1 de, c2 de, c2 fr
    }
    assert lede["versions_to_annotate"] == 4  # c1/c2 en, c1/c2 de
    assert lede["not_in_plan"] == 1  # c3 en
    assert lede["needs_decision"] == bar["needs_decision"] >= 1
    assert lede["to_assign"] == bar["to_assign"] >= 1


def test_stage_cards_count_rows_per_state(env, tmp_path):
    scenario(env, tmp_path)
    stages = progress(env.lead)["stages"]
    review = stages["translation_review"]
    assert (review["scope"], review["done"], review["total"]) == ("review", 1, 4)
    assert review["counts"] == {
        "to_assign": 1,
        "in_review": 1,
        "check_failed": 2,
        "check_failed_with_reviewer": 1,
        "rejected_or_queried": 1,
        "accepted": 1,
    }
    annotation = stages["annotation"]
    assert (annotation["scope"], annotation["done"], annotation["total"]) == (
        "annotate",
        1,
        4,
    )
    assert annotation["counts"] == {
        "waiting_for_review": 2,
        "to_assign": 0,
        "in_progress": 0,  # c2 en is paused, not in progress
        "paused": 1,
        "submitted": 1,
    }
    final = stages["final"]
    assert (final["scope"], final["done"], final["total"]) == ("annotate", 1, 4)
    assert final["counts"] == {
        "not_ready": 3,
        "to_choose": 0,
        "to_confirm": 0,
        "final": 1,
        "would_be_omitted": 3,
    }


def test_progress_counts_equal_documents_bar(env, tmp_path):
    scenario(env, tmp_path)
    assign(env, doc("c1", "de"), "ana", "translation_review")
    lede = progress(env.lead)["lede"]
    bar = env.lead.get(f"{BASE}/document-rows").json()["bar"]
    assert (lede["needs_decision"], lede["to_assign"]) == (
        bar["needs_decision"],
        bar["to_assign"],
    )


def test_workload_people_sorted_by_open_work(env):
    write(env, {RowKey("c1", "de"): REVIEW})
    set_status(env, doc("c1", "de"), "ready_for_review")
    assign(env, doc("c1", "de"), "ana", "translation_review")
    assign(env, doc("c1", "en"), "ana", "annotate")
    assign(env, doc("c2", "en"), "ben", "annotate")
    done = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, done, "s-anno")
    workload = progress(env.lead)["workload"]
    accounts = env.app.state.accounts
    assert [w["username"] for w in workload] == ["ana", "ben", "anno"]
    ana = workload[0]
    assert ana["person"] == {
        "pseudonym": accounts.get_by_username("ana").pseudonym,
        "display_name": "Ana Weber",
        "is_me": False,
    }
    columns = (
        "translation_reviews_open",
        "annotations_open",
        "reviews_open",
        "paused",
        "submitted",
    )
    assert [tuple(w[c] for c in columns) for w in workload] == [
        (1, 1, 0, 0, 0),
        (0, 1, 0, 0, 0),
        (0, 0, 0, 0, 1),
    ]


def test_annotation_in_progress_excludes_paused_rows(env):
    assign(env, doc("c1", "en"), "ana", "annotate")
    paused = assign(env, doc("c2", "en"), "ben", "annotate")
    counts = progress(env.lead)["stages"]["annotation"]["counts"]
    assert (counts["in_progress"], counts["paused"]) == (2, 0)
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow).where(AssignmentRow.id == paused).values(held=True)
        )
    counts = progress(env.lead)["stages"]["annotation"]["counts"]
    assert (counts["in_progress"], counts["paused"]) == (1, 1)


def test_progress_people_are_lead_only(env):
    annotator = logged_in(env.app, "anno", assignments=[])
    assert annotator.get(f"{BASE}/progress").status_code == 403
