"""Dashboard and export share one exact warning projection."""

from ontocurator.application.workflow_warnings import project_warnings


def test_missing_selection_has_explicit_omission_and_stable_shared_warning():
    inventory = [
        {"document_id": "d1", "case_id": "case", "language": "en"},
        {"document_id": "d2", "case_id": "case", "language": "de"},
    ]
    selected = [
        {
            "case_id": "case",
            "language": "en",
            "document_id": "d1",
            "submission_id": "s1",
            "revision": 1,
        }
    ]
    result = project_warnings("proj", inventory, selected, [])
    assert result["omissions"] == [{"case_id": "case", "language": "de"}]
    assert [w["code"] for w in result["warnings"]] == ["MISSING_FINAL_SELECTION"]
    assert result == project_warnings("proj", list(reversed(inventory)), selected, [])
    assert result["selections"] == selected


def test_new_cause_changes_digest_without_dropping_selected_result():
    inventory = [{"document_id": "d1", "case_id": "case", "language": "en"}]
    selected = [
        {
            "case_id": "case",
            "language": "en",
            "document_id": "d1",
            "submission_id": "s1",
            "revision": 1,
        }
    ]
    cause = {
        "code": "OPEN_PROBLEM_REPORT",
        "cause_id": "report1",
        "cause_revision": 1,
        "case_id": "case",
        "language": "en",
        "document_id": "d1",
        "reason": "Source wording needs review",
        "destination": "/tasks/1",
    }
    before = project_warnings("proj", inventory, selected, [])
    after = project_warnings("proj", inventory, selected, [cause])
    assert after["state_digest"] != before["state_digest"]
    assert after["selections"] == selected
    changed = project_warnings(
        "proj", inventory, selected, [{**cause, "cause_revision": 2}]
    )
    assert changed["warnings"][0]["id"] == after["warnings"][0]["id"]
    assert changed["state_digest"] != after["state_digest"]
