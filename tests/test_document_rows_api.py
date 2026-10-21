"""Documents read API over HTTP: lead-only access, query validation, encoding."""

from urllib.parse import quote

from sqlalchemy import update
from test_annotation_versions import seed_submission
from test_case_api import BASE, CASE, CORRECTED, TARGET
from test_case_api import case_env as case_env
from test_translation_review_task import assigned

from ontocurator.storage.tables import DocumentRow


def test_routes_are_lead_only_and_validate_query(case_env):
    env = case_env
    assert env.alice.get(f"{BASE}/document-rows").status_code in (403, 404)
    ok = env.lead.get(f"{BASE}/document-rows", params={"decision": "all", "page": 1})
    assert ok.status_code == 200, ok.text
    assert set(ok.json()) >= {
        "groups",
        "page",
        "page_count",
        "group_count",
        "bar",
        "case_found",
        "adjudicator_not_annotator",
    }
    retained = env.lead.get(
        f"{BASE}/document-rows",
        params=[
            ("decision", "all"),
            ("retain", f"{CASE}:de"),
            ("retain", f"{CASE}:en"),
        ],
    )
    assert retained.status_code == 200, retained.text
    assert (
        env.lead.get(
            f"{BASE}/document-rows", params={"decision": "all", "final": "missing"}
        ).status_code
        == 422
    )
    assert (
        env.lead.get(f"{BASE}/document-rows", params={"decision": "nope"}).status_code
        == 422
    )
    sub = env.lead.get(f"{BASE}/document-rows/{quote(CASE, safe='')}/de/submissions")
    assert sub.status_code == 200, sub.text
    assert env.alice.get(
        f"{BASE}/document-rows/{quote(CASE, safe='')}/de/submissions"
    ).status_code in (403, 404)
    assert (
        env.lead.get(f"{BASE}/document-rows/missing-case/de/submissions").status_code
        == 404
    )


def test_bar_uses_underscore_keys_and_rows_carry_retained(case_env):
    env = case_env
    page = env.lead.get(
        f"{BASE}/document-rows", params=[("decision", "all"), ("retain", f"{CASE}:de")]
    )
    assert page.status_code == 200, page.text
    body = page.json()
    assert set(body["bar"]) == {
        "total",
        "report_or_pause",
        "confirm_final",
        "translation",
        "missing_final",
        "no_final",
        "shown",
        "finals",
        "in_plan",
        "needs_decision",
        "to_assign",
        "in_progress",
        "decision_categories",
        "done",
        "all",
        "not_decided",
        "facets",
    }
    for group in body["groups"]:
        for row in group["rows"]:
            assert isinstance(row["retained"], bool)
    sub = env.lead.get(
        f"{BASE}/document-rows/{quote(CASE, safe='')}/de/submissions"
    ).json()
    assert sub["case_id"] == CASE and sub["language"] == "de"
    assert set(sub) == {
        "case_id",
        "language",
        "adjudicator_not_annotator",
        "submissions",
        "rounds",
        "open_translation_reviews",
    }


def test_too_many_retained_rows_and_page_zero_are_rejected(case_env):
    env = case_env
    many = [("retain", f"c{i}:de") for i in range(201)]
    assert env.lead.get(f"{BASE}/document-rows", params=many).status_code == 422
    assert env.lead.get(f"{BASE}/document-rows", params={"page": 0}).status_code == 422


def test_populated_row_validates_against_the_response_models(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    selected = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0},
    )
    assert selected.status_code == 200, selected.text
    assigned(env, document=CORRECTED)
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == CORRECTED)
            .values(translation_status="automatic_check_failed")
        )
    page = env.lead.get(f"{BASE}/document-rows")
    assert page.status_code == 200, page.text
    rows = {
        (row["case_id"], row["language"]): row
        for group in page.json()["groups"]
        for row in group["rows"]
    }
    de = rows[(CASE, "de")]
    assert de["final"]["submission_id"] == "german"
    assert de["final"]["is_mine"] is False
    assert de["work"] and de["versions"]
    # The failed check's chain has an open review: in progress, not a decision.
    assert not any(i["category"] == "translation" for i in de["issues"])
    assert "translation_review_in_progress" in [s["code"] for s in de["steps"]]
    sub = env.lead.get(f"{BASE}/document-rows/{quote(CASE, safe='')}/de/submissions")
    assert sub.status_code == 200, sub.text
    (item,) = sub.json()["submissions"]
    assert item["submission_id"] == "german" and item["kind"] == "annotation"
    assert sub.json()["open_translation_reviews"]
