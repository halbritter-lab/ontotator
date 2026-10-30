"""Row-level bulk endpoints (documents overview VD4, VD21): plan, selection
summary and batch assignment act on single texts ``(case_id, language)``."""

from __future__ import annotations

import typing
from typing import Any

import pytest
from auth_harness import logged_in
from work_plan_support import BASE, assign, doc, flags_of, plan_env, revision_of, write

from ontotator.api import assignment_batch_routes, document_row_routes
from ontotator.domain.work_plans import PlanFlags, RowKey

ANNOTATE = PlanFlags(False, True)
OFF = PlanFlags(False, False)


@pytest.fixture
def env(tmp_path):
    """Cases c1, c2 with en source and de/fr translations; rule off."""
    return plan_env(tmp_path, rule_on=False)


def ref(case_id: str, language: str) -> dict[str, str]:
    return {"case_id": case_id, "language": language}


def annotate_translations(env: Any) -> None:
    write(
        env,
        {
            RowKey(case, language): ANNOTATE
            for case in ("c1", "c2")
            for language in ("de", "fr")
        },
    )


def batch(task: str, language: str, **selection: Any) -> dict[str, Any]:
    return {"task": task, "language": language, "mode": "one", **selection}


def test_bulk_plan_rows_change_only_those_texts(env):
    before = {case: revision_of(env, case) for case in ("c1", "c2")}
    request = {"rows": [ref("c1", "de")], "preset": "annotate_only"}
    preview = env.lead.post(f"{BASE}/work-plans/bulk/preview", json=request)
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data["cases"] == 1 and data["changes"] == 1
    assert [item["key"] for item in data["languages"]] == ["de"]
    assert data["skipped_rows"] == []
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json={**request, "expected_revisions": data["revisions"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["changed_rows"] == 1
    assert flags_of(env, "c1", "de") == ANNOTATE
    assert flags_of(env, "c1", "fr") == OFF
    assert flags_of(env, "c2", "de") == OFF
    assert revision_of(env, "c1") == before["c1"] + 1
    assert revision_of(env, "c2") == before["c2"]
    # Two texts of one case: one revision bump for the case.
    both = {"rows": [ref("c2", "de"), ref("c2", "fr")], "preset": "annotate_only"}
    saved = env.lead.put(f"{BASE}/work-plans/bulk", json=both)
    assert saved.status_code == 200, saved.text
    assert saved.json()["changed_rows"] == 2
    assert revision_of(env, "c2") == before["c2"] + 1


def test_bulk_plan_requires_exactly_one_of_case_ids_and_rows(env):
    for body in (
        {"preset": "annotate_only"},
        {"case_ids": [], "rows": [], "preset": "annotate_only"},
        {"case_ids": ["c1"], "rows": [ref("c1", "de")], "preset": "annotate_only"},
    ):
        for method, path in (
            ("post", "work-plans/bulk/preview"),
            ("put", "work-plans/bulk"),
        ):
            response = getattr(env.lead, method)(f"{BASE}/{path}", json=body)
            assert response.status_code == 422, (body, response.text)


def test_rows_over_2000_cases_refused(env):
    rows = [ref(f"x{n}", "de") for n in range(2001)]
    calls = (
        ("post", "work-plans/bulk/preview", {"rows": rows, "preset": "annotate_only"}),
        ("put", "work-plans/bulk", {"rows": rows, "preset": "annotate_only"}),
        ("post", "document-rows/selection-summary", {"rows": rows}),
        ("post", "assignments/batch/preview", batch("annotate", "de", rows=rows)),
    )
    for method, path, body in calls:
        response = getattr(env.lead, method)(f"{BASE}/{path}", json=body)
        assert response.status_code == 422, (path, response.text)
        assert response.json()["code"] == "CASE_IDS_TOO_MANY", path
    # 2000 cases with a text in each of 11 languages are fine: the limit
    # counts cases, not texts.
    languages = [f"l{n}" for n in range(11)]
    many = [ref(f"x{n}", lang) for n in range(2000) for lang in languages]
    response = env.lead.post(
        f"{BASE}/document-rows/selection-summary", json={"rows": many}
    )
    assert response.status_code == 200, response.text
    # None of these texts exists, so no case counts.
    assert response.json()["cases"] == 0


def test_row_keys_post_unchanged_as_rows(env):
    annotate_translations(env)
    found = env.lead.post(f"{BASE}/document-rows/keys", json={})
    assert found.status_code == 200, found.text
    rows = found.json()["keys"]
    assert len(rows) == 6
    calls = (
        ("work-plans/bulk/preview", {"rows": rows, "preset": "annotate_only"}),
        ("assignments/batch/preview", batch("annotate", "de", rows=rows)),
        ("document-rows/selection-summary", {"rows": rows}),
    )
    for path, body in calls:
        response = env.lead.post(f"{BASE}/{path}", json=body)
        assert response.status_code == 200, (path, response.text)


def test_row_selection_endpoints_refuse_non_leads(env):
    anno = logged_in(env.app, "anno", assignments=[])
    rows = [ref("c1", "de")]
    for path, body in (
        ("work-plans/bulk/preview", {"rows": rows, "preset": "annotate_only"}),
        ("assignments/batch/preview", batch("annotate", "de", rows=rows)),
    ):
        response = anno.post(f"{BASE}/{path}", json=body)
        assert response.status_code == 403, (path, response.text)


def test_selection_summary_with_rows_counts_texts(env):
    annotate_translations(env)
    response = env.lead.post(
        f"{BASE}/document-rows/selection-summary",
        json={"rows": [ref("c1", "de"), ref("c2", "de"), ref("c2", "fr")]},
    )
    assert response.status_code == 200, response.text
    step = {"task": "annotate", "language": "de", "versions": 2, "cases": 2}
    assert response.json() == {
        "cases": 2,
        "steps": [
            step,
            {"task": "annotate", "language": "fr", "versions": 1, "cases": 1},
        ],
        "skipped": {},
        "skipped_rows": [],
        "common": step,
        "not_shown": 0,
        "not_shown_sources": 0,
    }
    # With case IDs every text of the case counts (unchanged).
    cases = env.lead.post(
        f"{BASE}/document-rows/selection-summary", json={"case_ids": ["c1", "c2"]}
    ).json()
    assert {
        "task": "annotate",
        "language": "fr",
        "versions": 2,
        "cases": 2,
    } in cases["steps"]
    # ``not_shown`` counts selected texts the filters hide.
    hidden = env.lead.post(
        f"{BASE}/document-rows/selection-summary",
        json={
            "rows": [ref("c1", "de"), ref("c2", "de"), ref("c2", "fr")],
            "filters": {"language": "fr"},
        },
    ).json()
    assert hidden["not_shown"] == 2


def test_batch_preview_and_commit_with_rows_target_only_those_texts(env):
    annotate_translations(env)
    rows = [ref("c1", "de"), ref("c2", "fr")]
    response = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json=batch("annotate", "de", rows=rows, usernames=["anno"]),
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert [(t["case_id"], t["language"]) for t in preview["targets"]] == [("c1", "de")]
    assert preview["skipped"] == []
    committed = env.lead.post(
        f"{BASE}/assignments/batch",
        json=batch("annotate", "de", rows=rows, usernames=["anno"])
        | {
            "expected_preview_digest": preview["digest"],
            "confirm_language": True,
            "confirm_unreviewed_translation": True,
        },
    )
    assert committed.status_code == 200, committed.text
    assert [a["document_id"] for a in committed.json()["created"]] == [doc("c1", "de")]
    # fr of c2 is selected but the batch is for de; c2's de is not selected.
    fr = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json=batch("annotate", "fr", rows=rows),
    ).json()
    assert [(t["case_id"], t["language"]) for t in fr["targets"]] == [("c2", "fr")]


def test_skip_reasons_name_texts(env):
    annotate_translations(env)
    assign(env, doc("c2", "de"), "anno", "annotate")
    summary = env.lead.post(
        f"{BASE}/document-rows/selection-summary",
        json={"rows": [ref("c1", "de"), ref("c2", "de")]},
    ).json()
    assert summary["common"] == {
        "task": "annotate",
        "language": "de",
        "versions": 1,
        "cases": 1,
    }
    assert summary["skipped"] == {"already_assigned": 1}
    assert summary["skipped_rows"] == [ref("c2", "de")]
    plan = env.lead.post(
        f"{BASE}/work-plans/bulk/preview",
        json={
            "rows": [ref("c1", "en"), ref("c1", "fr"), ref("c9", "de")],
            "preset": "review_and_annotate_translations",
        },
    ).json()
    # The source is not reached by a translations preset; c9 does not exist.
    assert plan["skipped_rows"] == [ref("c1", "en"), ref("c9", "de")]
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json={
            "rows": [ref("c1", "en"), ref("c1", "fr"), ref("c9", "de")],
            "preset": "review_and_annotate_translations",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["skipped_rows"] == [ref("c1", "en"), ref("c9", "de")]
    assert flags_of(env, "c1", "fr") == PlanFlags(True, True)


def test_case_ids_path_unchanged(env):
    annotate_translations(env)
    summary = env.lead.post(
        f"{BASE}/document-rows/selection-summary", json={"case_ids": ["c1", "c2"]}
    ).json()
    assert summary["skipped_rows"] == []
    assert summary["cases"] == 2
    preview = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json=batch("annotate", "de", case_ids=["c1", "c2"]),
    ).json()
    assert [(t["case_id"], t["language"]) for t in preview["targets"]] == [
        ("c1", "de"),
        ("c2", "de"),
    ]
    plan = env.lead.post(
        f"{BASE}/work-plans/bulk/preview",
        json={"case_ids": ["c1"], "preset": "review_and_annotate_translations"},
    ).json()
    assert plan["changes"] == 2 and plan["skipped_rows"] == []


def _accepted(annotation: Any) -> frozenset[Any]:
    """Literal values and plain types a parameter annotation accepts."""
    if typing.get_origin(annotation) is typing.Annotated:
        return _accepted(typing.get_args(annotation)[0])
    if typing.get_origin(annotation) is typing.Literal:
        return frozenset(typing.get_args(annotation))
    args = typing.get_args(annotation)
    if args:
        return frozenset().union(*(_accepted(arg) for arg in args))
    if annotation is type(None):
        return frozenset()
    return frozenset({annotation})


def _repeatable(annotation: Any) -> bool:
    if typing.get_origin(annotation) is typing.Annotated:
        return _repeatable(typing.get_args(annotation)[0])
    if typing.get_origin(annotation) is list:
        return True
    return any(_repeatable(arg) for arg in typing.get_args(annotation))


def test_document_row_filters_match_rows_query_parameters(env):
    query = typing.get_type_hints(document_row_routes._filters, include_extras=True)
    query.pop("return", None)
    # ``sort`` is a separate field of the batch request and the keys body.
    query.pop("sort")
    body = typing.get_type_hints(
        assignment_batch_routes.DocumentRowFilters, include_extras=True
    )
    body = {
        name: body[name]
        for name in assignment_batch_routes.DocumentRowFilters.model_fields
    }
    assert set(body) == set(query)
    for name, annotation in query.items():
        assert _accepted(body[name]) == _accepted(annotation), name
        assert _repeatable(body[name]) == _repeatable(annotation), name

    # One facet filter per group: hidden selected texts = all - bar.shown.
    annotate_translations(env)
    assign(env, doc("c1", "de"), "anno", "annotate")
    keys = env.lead.post(f"{BASE}/document-rows/keys", json={}).json()["keys"]
    assert len(keys) == 6
    facets = env.lead.get(f"{BASE}/document-rows").json()["bar"]["facets"]
    checked = 0
    for group, values in facets.items():
        value = next((v for v, n in sorted(values.items()) if n), None)
        if value is None:
            continue
        shown = env.lead.get(f"{BASE}/document-rows", params={group: value}).json()
        summary = env.lead.post(
            f"{BASE}/document-rows/selection-summary",
            json={"rows": keys, "filters": {group: [value]}},
        )
        assert summary.status_code == 200, (group, summary.text)
        assert summary.json()["not_shown"] == len(keys) - shown["bar"]["shown"], (
            group,
            value,
        )
        checked += 1
    assert checked >= 5
