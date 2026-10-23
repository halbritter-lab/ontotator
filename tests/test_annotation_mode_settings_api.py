"""Project setting "Texts with tool proposals" (spec 2026-10-23 §1 Q3)."""

from proposal_check_support import BASE, proposal_env


def test_setting_reads_and_writes(tmp_path):
    env = proposal_env(tmp_path)
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "proposals"
    response = env.lead.patch(
        f"{BASE}/settings", json={"tool_proposal_mode": "scratch"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["tool_proposal_mode"] == "scratch"
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "scratch"


def test_omitted_setting_keeps_the_value(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    response = env.lead.patch(f"{BASE}/settings", json={"annotations_per_text": 3})
    assert response.status_code == 200, response.text
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "scratch"
    explicit_none = env.lead.patch(
        f"{BASE}/settings", json={"tool_proposal_mode": None}
    )
    assert explicit_none.status_code == 200, explicit_none.text
    assert explicit_none.json()["tool_proposal_mode"] == "scratch"


def test_invalid_value_is_refused(tmp_path):
    env = proposal_env(tmp_path)
    response = env.lead.patch(
        f"{BASE}/settings", json={"tool_proposal_mode": "assisted"}
    )
    assert response.status_code == 422
