"""``POST document-rows/keys``: every text key matching the Documents filters
in list order (documents overview VD4: header checkbox, Select by case IDs)."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from work_plan_support import BASE, plan_env

from ontotator.application import document_row_keys


@pytest.fixture
def env(tmp_path):
    """Cases c1, c2 with en source and de/fr translations."""
    return plan_env(tmp_path, rule_on=False)


def keys(env: Any, **body: Any) -> dict[str, Any]:
    response = env.lead.post(f"{BASE}/document-rows/keys", json=body)
    assert response.status_code == 200, response.text
    return dict(response.json())


def pairs(result: dict[str, Any]) -> list[tuple[str, str]]:
    return [(item["case_id"], item["language"]) for item in result["keys"]]


def test_keys_follow_filters_and_list_order(env):
    everything = keys(env)
    assert pairs(everything) == [
        ("c1", "en"),
        ("c1", "de"),
        ("c1", "fr"),
        ("c2", "en"),
        ("c2", "de"),
        ("c2", "fr"),
    ]
    assert everything["cases"] == 2 and everything["total"] == 6
    assert everything["truncated"] is False
    filtered = keys(env, filters={"language": ["fr", "de"]}, sort="-case")
    assert pairs(filtered) == [("c2", "de"), ("c2", "fr"), ("c1", "de"), ("c1", "fr")]
    assert filtered["cases"] == 2 and filtered["total"] == 4
    one = keys(env, filters={"q": "c2", "language": "en"})
    assert pairs(one) == [("c2", "en")]
    ana = logged_in(env.app, "ana", assignments=[])
    assert ana.post(f"{BASE}/document-rows/keys", json={}).status_code == 403
    bad = env.lead.post(
        f"{BASE}/document-rows/keys", json={"filters": {"review_state": ["nope"]}}
    )
    assert bad.status_code == 422, bad.text


def test_keys_for_case_ids_return_every_matching_text(env):
    found = keys(env, case_ids=["c2", "zz"])
    assert pairs(found) == [("c2", "en"), ("c2", "de"), ("c2", "fr")]
    assert found["cases"] == 1 and found["total"] == 3
    filtered = keys(env, case_ids=["c2", "c1"], filters={"language": ["de"]})
    assert pairs(filtered) == [("c1", "de"), ("c2", "de")]


def test_keys_truncate_at_2000_cases(env, monkeypatch):
    assert document_row_keys.MAX_CASES == 2000
    monkeypatch.setattr(document_row_keys, "MAX_CASES", 1)
    result = keys(env)
    assert pairs(result) == [("c1", "en"), ("c1", "de"), ("c1", "fr")]
    assert result["cases"] == 2 and result["total"] == 6
    assert result["truncated"] is True


def test_case_ids_endpoint_still_answers(env):
    response = env.lead.get(
        f"{BASE}/document-rows/case-ids", params={"language": ["de"]}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"case_ids": ["c1", "c2"], "total": 2, "truncated": False}
