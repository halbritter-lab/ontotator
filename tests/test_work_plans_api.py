"""Work plan HTTP routes: lead only, error bodies, round trips, path encoding."""

from __future__ import annotations

from urllib.parse import quote

from auth_harness import logged_in
from sqlalchemy import update
from test_case_api import BASE, CASE, CORRECTED, TARGET
from test_case_api import case_env as case_env
from test_translation_review_task import assigned

from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import ProjectRow

CASE_PATH = quote(CASE, safe="")


def plan_path(language: str) -> str:
    return f"{BASE}/work-plans/{CASE_PATH}/{language}"


def test_routes_are_lead_only(case_env):
    env = case_env
    calls = [
        ("patch", plan_path("de"), {"review": False, "expected_revision": 2}),
        ("post", f"{BASE}/work-plans/bulk/preview", {"case_ids": [CASE]}),
        ("put", f"{BASE}/work-plans/bulk", {"case_ids": [CASE]}),
        (
            "put",
            f"{BASE}/work-plans/rows",
            {
                "rows": [
                    {
                        "case_id": CASE,
                        "language": "de",
                        "review": True,
                        "annotate": True,
                    }
                ],
                "expected_revisions": {CASE: 2},
            },
        ),
        ("post", f"{BASE}/case-ids/lookup", {"ids": [CASE]}),
        (
            "post",
            f"{BASE}/variants/{quote(TARGET, safe='')}/discard",
            {"reason": "x", "confirm": True},
        ),
    ]
    for method, url, body in calls:
        response = getattr(env.alice, method)(url, json=body)
        assert response.status_code == 403, (url, response.text)
        assert response.json()["code"] == "NOT_ALLOWED"
    preview = env.alice.get(
        f"{BASE}/work-plans/annotation-target-preview",
        params={"annotations_per_text": 1},
    )
    assert preview.status_code == 403, preview.text
    allowed = env.lead.get(
        f"{BASE}/work-plans/annotation-target-preview",
        params={"annotations_per_text": 1},
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json() == {"rows_over_target": 0}


def test_patch_409_body_carries_consequences(case_env):
    env = case_env
    work = assigned(env, document=CORRECTED)
    response = env.lead.patch(
        plan_path("de"), json={"review": False, "expected_revision": 2}
    )
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "WORK_PLAN_CONFIRMATION_REQUIRED"
    (withdrawn,) = body["details"]["withdrawn"]
    assert withdrawn["assignment_id"] == work["id"]
    assert withdrawn["person"]["display_name"] == "alice"
    assert withdrawn["person"]["is_me"] is False
    assert body["details"]["finals_leaving"] == []
    confirmed = env.lead.patch(
        plan_path("de"),
        json={"review": False, "expected_revision": 2, "confirm": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["flags"]["review"] is False
    stale = env.lead.patch(
        plan_path("de"), json={"review": True, "expected_revision": 2}
    )
    assert stale.status_code == 409, stale.text
    assert stale.json() == {
        "code": "WORK_PLAN_CHANGED",
        "details": {"cases": [{"case_id": CASE, "revision": 3}]},
    }


def test_patch_422_body_carries_acceptance_offer(case_env):
    env = case_env
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotate_accepted_translations_only=True)
        )
    body = {"review": False, "annotate": True, "expected_revision": 2}
    response = env.lead.patch(plan_path("de"), json=body)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "WORK_PLAN_INVALID"
    details = response.json()["details"]
    assert details["reason"] == "annotate_not_accepted"
    assert details["rows"] == [
        {
            "case_id": CASE,
            "language": "de",
            "not_accepted": 1,
            "not_acceptable": 0,
            "marked_in_package": 0,
        }
    ]


def test_bulk_preview_then_put_round_trip(case_env):
    env = case_env
    request = {"case_ids": [CASE], "languages": {"de": {"annotate": "off"}}}
    preview = env.lead.post(f"{BASE}/work-plans/bulk/preview", json=request)
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data["cases"] == 1 and data["changes"] == 1
    de = next(item for item in data["languages"] if item["key"] == "de")
    assert de["annotate"] == {"on": 1, "off": 0} and de["will_change"] == 1
    withdrawn = data["consequences"]["withdrawn"]
    assert [w["task"] for w in withdrawn] == ["review"]
    unconfirmed = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json={**request, "expected_revisions": data["revisions"]},
    )
    assert unconfirmed.status_code == 409, unconfirmed.text
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json={**request, "expected_revisions": data["revisions"], "confirm": True},
    )
    assert saved.status_code == 200, saved.text
    result = saved.json()
    assert result["changed_rows"] == 1
    assert result["revisions"] == {CASE: 3}
    assert result["undo"]["rows"] == [
        {
            "case_id": CASE,
            "language": "de",
            "review": True,
            "annotate": True,
            "restored_revision": None,
            "decided": True,
            "annotation_mode": None,
        }
    ]
    assert [w["assignment_id"] for w in result["withdrawn"]] == [
        w["assignment_id"] for w in withdrawn
    ]


def test_rows_put_restores_undo(case_env):
    env = case_env
    off = env.lead.patch(
        plan_path("de"), json={"review": False, "expected_revision": 2}
    )
    assert off.status_code == 200, off.text
    on = env.lead.patch(plan_path("de"), json={"review": True, "expected_revision": 3})
    assert on.status_code == 200, on.text
    undo = on.json()["undo"]
    work = assigned(env, document=CORRECTED)
    body = {"rows": undo["rows"], "expected_revisions": undo["revisions"], "undo": True}
    refused = env.lead.put(f"{BASE}/work-plans/rows", json=body)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "WORK_PLAN_CONFIRMATION_REQUIRED"
    (withdrawn,) = refused.json()["details"]["withdrawn"]
    assert withdrawn["assignment_id"] == work["id"]
    assert withdrawn["person"]["display_name"] == "alice"
    restored = env.lead.put(f"{BASE}/work-plans/rows", json={**body, "confirm": True})
    assert restored.status_code == 200, restored.text
    assert restored.json()["changed_rows"] == 1
    with env.db.transaction() as conn:
        pid = Repository._project_id(conn, "proj")
        assert pid is not None
        assert work_plan_store.effective_plan(conn, pid, [CASE])[
            RowKey(CASE, "de")
        ] == PlanFlags(False, True)
        assert (
            work_plan_store.revisions(conn, pid, [CASE]) == restored.json()["revisions"]
        )


def test_routes_hide_the_project_from_non_members(case_env):
    env = case_env
    stranger = logged_in(env.app, "stranger", projects={}, assignments=[])
    calls = [
        ("patch", plan_path("de"), {"review": False, "expected_revision": 2}),
        ("post", f"{BASE}/work-plans/bulk/preview", {"case_ids": [CASE]}),
        ("put", f"{BASE}/work-plans/bulk", {"case_ids": [CASE]}),
        ("post", f"{BASE}/case-ids/lookup", {"ids": [CASE]}),
        (
            "post",
            f"{BASE}/variants/{quote(TARGET, safe='')}/discard",
            {"reason": "x", "confirm": True},
        ),
    ]
    for method, url, body in calls:
        response = getattr(stranger, method)(url, json=body)
        assert response.status_code == 404, (url, response.text)
        assert response.json()["code"] == "PROJECT_NOT_FOUND"


def test_lookup_and_discard_routes(case_env):
    env = case_env
    lookup = env.lead.post(
        f"{BASE}/case-ids/lookup", json={"ids": [f" {CASE} ", "nope", CASE]}
    )
    assert lookup.status_code == 200, lookup.text
    assert lookup.json() == {"found": [CASE], "unknown": ["nope"]}
    url = f"{BASE}/variants/{quote(TARGET, safe='')}/discard"
    blank = env.lead.post(url, json={"reason": "", "confirm": True})
    assert blank.status_code == 422, blank.text
    unconfirmed = env.lead.post(url, json={"reason": "Wrong language"})
    assert unconfirmed.status_code == 409, unconfirmed.text
    discarded = env.lead.post(url, json={"reason": "Wrong language", "confirm": True})
    assert discarded.status_code == 200, discarded.text
    result = discarded.json()
    assert result["case_id"] == CASE and result["language"] == "de"
    assert result["discarded_document_ids"] == [TARGET, CORRECTED]
    assert result["flags"] == {
        "review": False,
        "annotate": False,
        "review_applicable": True,
        "discarded": True,
        "decided": True,
        "annotation_mode": None,
    }
    again = env.lead.post(url, json={"reason": "Wrong language", "confirm": True})
    assert again.status_code == 409, again.text
    assert again.json()["code"] == "VARIANT_ALREADY_DISCARDED"


def test_case_id_path_encoding(case_env):
    env = case_env
    assert {"/", "#", "é"} <= set(CASE)
    response = env.lead.patch(
        plan_path("de"),
        json={"annotate": False, "expected_revision": 2, "confirm": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["case_id"] == CASE
    assert response.json()["language"] == "de"
    slash = env.lead.patch(
        f"{BASE}/work-plans/{quote(CASE, safe='/')}/de",
        json={"annotate": True, "expected_revision": 3},
    )
    assert slash.status_code == 200, slash.text
    assert slash.json()["case_id"] == CASE
    missing = env.lead.patch(
        f"{BASE}/work-plans/{quote('no such case', safe='')}/de",
        json={"review": True, "expected_revision": 1},
    )
    assert missing.status_code == 404, missing.text
