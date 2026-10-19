"""Round ordinals and submission kinds shared by Documents and the editor history."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal

SubmissionKind = Literal["consolidation", "carry_forward", "annotation", "review"]


def round_ordinals(rounds: Iterable[tuple[str, str | None]]) -> dict[str, int]:
    """Number rounds 1..n along their ``predecessor_round_id`` chains.

    ``rounds`` holds ``(round_id, predecessor_round_id)`` pairs. A predecessor that
    is not in the input starts a new chain at 1.
    """
    predecessor = dict(rounds)
    result: dict[str, int] = {}
    for rid in predecessor:
        path: list[str] = []
        seen: set[str] = set()
        current: str | None = rid
        while (
            current is not None
            and current in predecessor
            and current not in result
            and current not in seen
        ):
            path.append(current)
            seen.add(current)
            current = predecessor[current]
        base = result.get(current, 0) if current is not None else 0
        for offset, item in enumerate(reversed(path), start=1):
            result[item] = base + offset
    return result


def submission_kind(round_kind: str | None, mode: str | None) -> SubmissionKind:
    if round_kind == "consolidation":
        return "consolidation"
    if round_kind == "carry_forward":
        return "carry_forward"
    return "review" if mode == "review" else "annotation"
