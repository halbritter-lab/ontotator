"""Pure lifecycle rules of problem reports (no database)."""

import pytest

from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.problem_reports import (
    EventFact,
    check_permission,
    check_state,
    next_resolution,
    next_state,
    withdrawable,
)


def test_withdrawable_only_while_open_and_only_reporter_resumes_happened():
    assert withdrawable("open", 7, [])
    assert withdrawable("open", 7, [EventFact(7, "resume")])
    assert not withdrawable("open", 7, [EventFact(2, "resume")])
    assert not withdrawable("open", 7, [EventFact(7, "extend_hold")])
    assert not withdrawable("resolved", 7, [])
    assert not withdrawable("withdrawn", 7, [])


@pytest.mark.parametrize(
    ("action", "lead", "reporter", "allowed"),
    [
        ("resume", False, True, True),
        ("resume", True, False, True),
        ("resume", False, False, False),
        ("withdraw", False, True, True),
        ("withdraw", True, True, True),
        ("withdraw", True, False, False),
        ("reopen", True, False, True),
        ("reopen", False, True, False),
        ("resolve", False, True, False),
        ("extend_hold", True, False, True),
        ("restart", False, True, False),
    ],
)
def test_permission_matrix(action, lead, reporter, allowed):
    if allowed:
        check_permission(action, lead=lead, reporter=reporter)
    else:
        with pytest.raises(AccessDenied):
            check_permission(action, lead=lead, reporter=reporter)


@pytest.mark.parametrize(
    ("action", "state", "can_withdraw", "reason"),
    [
        ("resolve", "resolved", False, "REPORT_RESOLVED"),
        ("extend_hold", "withdrawn", False, "REPORT_WITHDRAWN"),
        ("withdraw", "resolved", False, "REPORT_RESOLVED"),
        ("withdraw", "open", False, "REPORT_LEAD_ACTED"),
        ("reopen", "open", False, "REPORT_OPEN"),
    ],
)
def test_state_conflicts(action, state, can_withdraw, reason):
    with pytest.raises(DomainError) as raised:
        check_state(action, state, withdrawable_now=can_withdraw)
    assert raised.value.code == "WORKFLOW_REVISION_CONFLICT"
    assert raised.value.details == {"reason": reason}


@pytest.mark.parametrize(
    ("action", "state"),
    [
        ("resume", "resolved"),
        ("resume", "withdrawn"),
        ("reopen", "resolved"),
        ("reopen", "withdrawn"),
        ("withdraw", "open"),
        ("restart", "open"),
    ],
)
def test_state_allows(action, state):
    check_state(action, state, withdrawable_now=True)


def test_transitions():
    assert next_state("resolve", "open") == "resolved"
    assert next_state("restart", "open") == "resolved"
    assert next_state("withdraw", "open") == "withdrawn"
    assert next_state("reopen", "withdrawn") == "open"
    assert next_state("resume", "resolved") == "resolved"
    assert next_state("extend_hold", "open") == "open"
    assert next_resolution("resolve", None, "Fixed text") == "Fixed text"
    assert next_resolution("reopen", "Fixed text", "Needs more") is None
    assert next_resolution("withdraw", None, "By mistake") is None
    assert next_resolution("resume", "Fixed text", "continue") == "Fixed text"
