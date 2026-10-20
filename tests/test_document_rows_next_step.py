"""Documents rows: server-derived next step, bar segments, plan filters, sort,
filtered case IDs (lead workflow, spec "Next step" and "Bar (D21)")."""

from __future__ import annotations

from typing import Any

import pytest
from document_rows_support import rows_of
from document_rows_support import service as rows_service
from sqlalchemy import update
from t1_builders import bundle, native_unit
from t1_fixtures import run_import
from work_plan_support import BASE, assign, doc, plan_env, revision_of, submit, write

from ontocurator.application import document_row_page
from ontocurator.application.document_row_page import cases_not_shown, sorted_case_ids
from ontocurator.application.document_rows import RowFacts, RowQuery, load_facts
from ontocurator.application.final_causes import authorize_final_results
from ontocurator.domain.next_steps import Segment
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage.tables import DocumentRow, ProjectRow

BOTH = PlanFlags(True, True)
REVIEW = PlanFlags(True, False)
ANNOTATE = PlanFlags(False, True)
OFF = PlanFlags(False, False)
KINDS: dict[str, Segment] = {
    "decision": "decision",
    "assign": "assign",
    "in_progress": "progress",
}


@pytest.fixture
def env(tmp_path):
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    return env


def set_status(env: Any, document_id: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document_id)
            .values(translation_status=status)
        )


def plan(env: Any, **flags: PlanFlags) -> None:
    """``plan(env, c1_de=BOTH)`` writes the row flags of (c1, de)."""
    write(
        env,
        {
            RowKey(*name.split("_", 1)): value  # type: ignore[call-arg]
            for name, value in flags.items()
        },
    )


def page(env: Any, **query: Any) -> dict[str, Any]:
    return rows_service(env).page("proj", RowQuery(**query))


def rows(env: Any, **query: Any) -> dict[tuple[str, str], dict[str, Any]]:
    return rows_of(page(env, **query))


def group(result: dict[str, Any], case_id: str) -> dict[str, Any]:
    return next(g for g in result["groups"] if g["case_id"] == case_id)


def pseudonym(env: Any, username: str) -> str:
    return str(env.app.state.accounts.get_by_username(username).pseudonym)


def import_case(env: Any, tmp_path: Any, case_id: str) -> None:
    folder = tmp_path / f"more-{case_id}"
    folder.mkdir()
    unit = native_unit(f"{case_id}-en", "en", "More text", case_id=case_id)
    result = run_import(env.db, bundle(folder, [unit]))
    assert result.status == "succeeded", result.error


def facts_of(env: Any) -> RowFacts:
    svc = rows_service(env)
    with env.db.transaction() as conn:
        pid = authorize_final_results(conn, svc.actor, "proj", exclusive=False)
        return load_facts(conn, svc.repo, "proj", pid, svc.access.user_id)


def segment(row: dict[str, Any]) -> Segment | None:
    step = row["next_step"]
    return KINDS.get(step["kind"]) if step else None


def test_rows_carry_next_step_plan_row_and_group_revision(env):
    plan(env, c1_de=BOTH)
    result = page(env)
    de = rows_of(result)[("c1", "de")]
    assert de["next_step"]["code"] == "assign_translation_review"
    assert [s["code"] for s in de["steps"]] == [
        "assign_translation_review",
        "waiting_for_translation_review",
    ]
    assert de["plan_row"] == {
        "review": True,
        "annotate": True,
        "review_applicable": True,
        "discarded": False,
    }
    assert de["in_plan"] is True
    en = rows_of(result)[("c1", "en")]
    assert en["plan_row"]["review_applicable"] is False
    assert group(result, "c1")["plan_revision"] == revision_of(env, "c1") > 1


def test_not_in_plan_rows_are_listed_on_the_group(env):
    result = page(env)
    de = rows_of(result)[("c1", "de")]
    assert de["in_plan"] is False and de["next_step"] is None and de["steps"] == []
    assert group(result, "c1")["not_in_plan_languages"] == ["de", "fr"]
    assert rows_of(result)[("c1", "en")]["in_plan"] is True


def test_annotate_only_row_with_unaccepted_translation_stays_in_plan(env):
    plan(env, c1_de=ANNOTATE)  # written directly: rule on, review off (D24)
    result = page(env)
    de = rows_of(result)[("c1", "de")]
    assert de["in_plan"] is True
    assert de["next_step"]["code"] == "translation_not_accepted"
    assert de["next_step"]["action"] == "accept_or_review"
    assert de["next_step"]["kind"] == "decision"
    assert result["bar"]["needs_decision"] == 1
    assert result["bar"]["decision_categories"]["translation"] == 1
    assert group(result, "c1")["not_in_plan_languages"] == ["fr"]


def test_missing_final_respects_annotations_per_text(env):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotations_per_text=2)
        )
    aid = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, aid, "s-c1-en")
    en = rows(env)[("c1", "en")]
    step = en["next_step"]
    assert (step["code"], step["assigned"], step["target"]) == (
        "assign_annotation",
        1,
        2,
    )
    assert en["missing_final"]["counts"] is False
    assert not any(i["code"] == "MISSING_FINAL" for i in en["issues"])


def test_bar_segments_equal_row_step_kinds(env):
    plan(env, c1_de=REVIEW, c1_fr=ANNOTATE, c2_de=BOTH)
    assign(env, doc("c2", "de"), "ana", "translation_review")
    assign(env, doc("c2", "en"), "anno", "annotate")
    result = page(env)
    all_rows = rows_of(result).values()
    bar = result["bar"]
    for name in ("decision", "assign", "progress"):
        field = {
            "decision": "needs_decision",
            "assign": "to_assign",
            "progress": "in_progress",
        }[name]
        assert bar[field] == sum(1 for r in all_rows if segment(r) == name), name
    assert bar["in_plan"] == sum(1 for r in all_rows if r["in_plan"])
    assert (bar["needs_decision"], bar["to_assign"], bar["in_progress"]) == (1, 2, 2)
    assert bar["in_plan"] == 5  # c1 en/de/fr, c2 en/de; c2 fr not in plan
    assert sum(bar["decision_categories"].values()) == bar["needs_decision"]


def test_translation_category_excludes_chains_with_open_review(env):
    plan(env, c1_de=REVIEW)
    assign(env, doc("c1", "de"), "ana", "translation_review")
    set_status(env, doc("c1", "de"), "automatic_check_failed")
    result = page(env)
    de = rows_of(result)[("c1", "de")]
    assert segment(de) == "progress"
    assert de["next_step"]["code"] == "translation_review_in_progress"
    assert "translation" not in de["categories"]
    assert result["bar"]["translation"] == 0
    assert result["bar"]["needs_decision"] == 0
    # Without the open review the failed check is "to assign" with its badge.
    plan(env, c2_de=REVIEW)
    set_status(env, doc("c2", "de"), "automatic_check_failed")
    c2 = rows(env)[("c2", "de")]
    assert c2["next_step"]["code"] == "assign_translation_review"
    assert c2["next_step"]["badges"] == ["check_failed"]
    assert segment(c2) == "assign"


def test_missing_final_only_for_annotate_rows(env):
    aid = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, aid, "s-c1-en")
    assert rows(env)[("c1", "en")]["missing_final"]["counts"] is True
    plan(env, c1_en=OFF)
    en = rows(env)[("c1", "en")]
    assert en["in_plan"] is False
    assert en["missing_final"]["counts"] is False
    assert "missing-final" not in en["categories"]
    assert not any(i["code"] == "MISSING_FINAL" for i in en["issues"])
    assert set(rows(env, final="none")) == {("c2", "en")}


def test_filters_segment_step_stage_owner_plan(env):
    plan(env, c1_de=REVIEW, c1_fr=ANNOTATE, c2_de=BOTH)
    assign(env, doc("c2", "de"), "ana", "translation_review")
    assign(env, doc("c2", "en"), "anno", "annotate")
    assert set(rows(env, segment="decision")) == {("c1", "fr")}
    assert set(rows(env, segment="assign")) == {("c1", "de"), ("c1", "en")}
    assert set(rows(env, segment="progress")) == {("c2", "de"), ("c2", "en")}
    assert set(rows(env, step="waiting_for_translation_review")) == {("c2", "de")}
    assert set(rows(env, step="translation_review_in_progress")) == {("c2", "de")}
    assert set(rows(env, stage="translation_review")) == {
        ("c1", "de"),
        ("c1", "fr"),
        ("c2", "de"),
    }
    assert set(rows(env, owner="me")) == {("c1", "de"), ("c1", "en"), ("c1", "fr")}
    assert set(rows(env, owner=pseudonym(env, "ana"))) == {("c2", "de")}
    assert set(rows(env, owner=pseudonym(env, "anno"))) == {("c2", "en")}
    assert set(rows(env, plan="not_in_plan")) == {("c2", "fr")}
    assert set(rows(env, plan="review")) == {("c1", "de"), ("c2", "de")}
    assert set(rows(env, plan="review_and_annotate")) == {("c2", "de")}
    assert set(rows(env, plan="annotate")) == {
        ("c1", "en"),
        ("c1", "fr"),
        ("c2", "en"),
        ("c2", "de"),
    }
    with pytest.raises(ValueError):
        RowQuery(segment="decision", decision="all")
    refused = env.lead.get(f"{BASE}/document-rows?segment=assign&decision=all")
    assert refused.status_code == 422, refused.text
    response = env.lead.get(
        f"{BASE}/document-rows?segment=decision&plan=annotate&sort=import"
    )
    assert response.status_code == 200, response.text
    assert [
        (r["case_id"], r["language"])
        for g in response.json()["groups"]
        for r in g["rows"]
    ] == [("c1", "fr")]


def test_sort_case_import_activity(env, tmp_path):
    import_case(env, tmp_path, "a0")  # imported last, sorts first by case ID
    assign(env, doc("c2", "en"), "anno", "annotate")

    def order(sort: str) -> list[str]:
        return [g["case_id"] for g in page(env, sort=sort)["groups"]]

    assert order("case") == ["a0", "c1", "c2"]
    assert order("import") == ["c1", "c2", "a0"]
    assert order("activity")[0] == "c2"
    assert order("activity") == ["c2", "a0", "c1"]
    facts = facts_of(env)
    assert sorted_case_ids(facts, ["c2", "a0", "c1"], "import") == ["c1", "c2", "a0"]
    assert sorted_case_ids(facts, ["c1", "a0"], "case") == ["a0", "c1"]
    assert sorted_case_ids(facts, ["c1", "c2"], "activity") == ["c2", "c1"]
    progress = RowQuery(segment="progress")
    assert cases_not_shown(facts, ["c1", "c2", "a0"], progress) == 2
    assert cases_not_shown(facts, ["c2"], progress) == 0


def test_case_ids_endpoint_returns_filtered_ids_in_order_and_truncates(
    env, tmp_path, monkeypatch
):
    import_case(env, tmp_path, "a0")
    response = env.lead.get(f"{BASE}/document-rows/case-ids")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "case_ids": ["a0", "c1", "c2"],
        "total": 3,
        "truncated": False,
    }
    narrowed = env.lead.get(f"{BASE}/document-rows/case-ids?sort=import&language=fr")
    assert narrowed.json() == {"case_ids": ["c1", "c2"], "total": 2, "truncated": False}
    monkeypatch.setattr(document_row_page, "MAX_CASE_IDS", 2)
    capped = env.lead.get(f"{BASE}/document-rows/case-ids")
    assert capped.json() == {"case_ids": ["a0", "c1"], "total": 3, "truncated": True}


def test_detail_and_owner(env, tmp_path):
    import_case(env, tmp_path, "a0")
    plan(env, c1_de=REVIEW, c2_de=REVIEW, c2_fr=REVIEW)
    assign(env, doc("c1", "en"), "anno", "annotate")
    assign(env, doc("c1", "en"), "anno2", "annotate")
    assign(env, doc("c1", "de"), "ana", "translation_review")
    aid = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, aid, "s-c2-en")
    set_status(env, doc("c2", "fr"), "accepted")
    result = rows(env)

    c1_en = result[("c1", "en")]["next_step"]
    assert c1_en["code"] == "annotation_in_progress"
    assert c1_en["owner"] == {"kind": "people", "person": None, "count": 2}

    c1_de = result[("c1", "de")]["next_step"]
    assert c1_de["code"] == "translation_review_in_progress"
    assert c1_de["owner"]["kind"] == "person" and c1_de["owner"]["count"] == 1
    assert c1_de["owner"]["person"] == {
        "pseudonym": pseudonym(env, "ana"),
        "display_name": "Ana Weber",
        "is_me": False,
    }

    c2_de = result[("c2", "de")]["next_step"]
    assert c2_de["code"] == "assign_translation_review"
    assert c2_de["owner"]["kind"] == "you" and c2_de["owner"]["person"]["is_me"]
    assert c2_de["document_id"] == doc("c2", "de")
    assert c2_de["detail"]["kind"] == "version"
    assert (
        c2_de["detail"]["version"],
        c2_de["detail"]["origin"],
        c2_de["detail"]["translation_status"],
    ) == (1, "machine_translation", "ready_for_review")

    c2_en = result[("c2", "en")]["next_step"]
    assert c2_en["code"] == "choose_final"
    assert c2_en["detail"]["kind"] == "annotations_submitted"
    assert (c2_en["detail"]["submitted"], c2_en["detail"]["total"]) == (1, 1)

    a0 = result[("a0", "en")]["next_step"]
    assert (a0["code"], a0["detail"]["kind"]) == ("assign_annotation", "source_ready")

    c2_fr = result[("c2", "fr")]["next_step"]
    assert (c2_fr["code"], c2_fr["kind"], c2_fr["detail"]["kind"]) == (
        "translation_accepted",
        "done",
        "review_only",
    )
    assert c2_fr["owner"] == {"kind": "none", "person": None, "count": 0}
