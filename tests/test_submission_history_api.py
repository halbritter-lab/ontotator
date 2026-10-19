"""Exact human submission history, separate from proposal visibility."""

from test_annotation_versions import seed_submission
from test_case_api import BASE, SOURCE, TARGET, path
from test_case_api import case_env as case_env


def test_lead_and_owner_history_are_bounded(case_env):
    env = case_env
    seed_submission(env, "alice", "own-history")
    seed_submission(env, "reviewer", "foreign-history")
    for client, expected in [
        (env.alice, {"own-history"}),
        (env.lead, {"own-history", "foreign-history"}),
    ]:
        response = client.get(path(SOURCE, "submissions"))
        assert response.status_code == 200, response.text
        assert {item["submission_id"] for item in response.json()} == expected
    assert env.alice.get(path(SOURCE, "submissions/foreign-history")).status_code == 404
    assert env.reviewer.get(path(SOURCE, "submissions/own-history")).status_code == 404
    result = env.lead.get(path(SOURCE, "submissions/own-history"))
    assert result.status_code == 200, result.text
    assert result.json()["summary"]["submission_id"] == "own-history"
    assert result.json()["annotations"] == []
    assert env.lead.get(path(TARGET, "submissions/own-history")).status_code == 404
    assert (
        env.alice.get(
            f"{BASE.replace('proj', 'other')}/documents/{SOURCE}/submissions"
        ).status_code
        == 404
    )
