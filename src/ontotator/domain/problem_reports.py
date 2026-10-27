"""Pure lifecycle rules of problem reports and their task pauses (no I/O)."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from ontotator.domain.errors import AccessDenied, DomainError

ReportState = Literal["open", "resolved", "withdrawn"]
ReportAction = Literal[
    "resume", "resolve", "extend_hold", "restart", "withdraw", "reopen"
]
ReleaseAction = Literal["resume", "restart", "withdraw"]
CLOSED_STATES: frozenset[str] = frozenset({"resolved", "withdrawn"})
LEAD_ONLY: frozenset[str] = frozenset({"resolve", "extend_hold", "restart", "reopen"})


@dataclass(frozen=True)
class EventFact:
    actor_id: int
    action: str


def withdrawable(state: str, reporter_id: int, events: Iterable[EventFact]) -> bool:
    """Open and nobody but the reporter has acted (only own resumes so far)."""
    return state == "open" and all(
        event.actor_id == reporter_id and event.action == "resume" for event in events
    )


def check_permission(action: str, *, lead: bool, reporter: bool) -> None:
    if action == "withdraw":
        allowed = reporter
    elif action == "resume":
        allowed = lead or reporter
    else:
        allowed = lead and action in LEAD_ONLY
    if not allowed:
        raise AccessDenied("NOT_ALLOWED")


def _conflict(reason: str) -> DomainError:
    return DomainError("WORKFLOW_REVISION_CONFLICT", {"reason": reason})


def check_state(action: str, state: str, *, withdrawable_now: bool) -> None:
    if action == "reopen":
        if state not in CLOSED_STATES:
            raise _conflict("REPORT_OPEN")
        return
    if state in CLOSED_STATES and action != "resume":
        raise _conflict(
            "REPORT_RESOLVED" if state == "resolved" else "REPORT_WITHDRAWN"
        )
    if action == "withdraw" and not withdrawable_now:
        raise _conflict("REPORT_LEAD_ACTED")


def next_state(action: str, state: str) -> str:
    if action in {"resolve", "restart"}:
        return "resolved"
    if action == "withdraw":
        return "withdrawn"
    if action == "reopen":
        return "open"
    return state


def next_resolution(action: str, current: str | None, reason: str) -> str | None:
    if action in {"resolve", "restart"}:
        return reason
    if action == "reopen":
        return None
    return current
