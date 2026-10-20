"""Layout of a batch assignment (spec "Assign dialog: many cases", D21), pure.

"One person" gives every case to one person. "Split evenly" cuts the cases,
in the given list order, into contiguous blocks, one per person; the first
``r`` people get one case more. With more than one open slot per case the
slots rotate through the chosen people, so every case gets distinct people.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

__all__ = ["layout"]


def layout(
    case_ids: Sequence[str],
    people: Sequence[str],
    *,
    mode: Literal["one", "split"],
    remaining: Mapping[str, int],
    already: Mapping[str, frozenset[str]],
) -> tuple[dict[str, list[str]], list[str]]:
    """Usernames per case and the cases skipped as already assigned.

    ``remaining`` is the number of open slots per case (target minus
    non-revoked assignments); a case with none is skipped. ``already`` names
    the people who already hold the task on a case: in "split" they are
    replaced by the next person in rotation, in "one" the case is skipped.
    """
    if mode == "one" and len(people) > 1:
        raise ValueError("Choose one person.")
    open_cases = [case for case in case_ids if remaining.get(case, 0) > 0]
    skipped = [case for case in case_ids if remaining.get(case, 0) <= 0]
    got: dict[str, list[str]] = {}
    if not people:
        return got, skipped
    if mode == "one":
        (person,) = people
        for case in open_cases:
            if person in already.get(case, frozenset()):
                skipped.append(case)
            else:
                got[case] = [person]
        return got, _in_order(case_ids, skipped)
    k = len(people)
    needed = max((remaining[case] for case in open_cases), default=0)
    if needed > k:
        raise ValueError(
            f"Choose at least {needed} people for {needed} assignments per text."
        )
    q, r = divmod(len(open_cases), k)
    start = 0
    for block in range(k):
        size = q + 1 if block < r else q
        for case in open_cases[start : start + size]:
            taken = already.get(case, frozenset())
            chosen: list[str] = []
            for step in range(k):
                person = people[(block + step) % k]
                if len(chosen) == remaining[case]:
                    break
                if person not in taken and person not in chosen:
                    chosen.append(person)
            if chosen:
                got[case] = chosen
            else:
                skipped.append(case)
        start += size
    return got, _in_order(case_ids, skipped)


def _in_order(case_ids: Sequence[str], skipped: Sequence[str]) -> list[str]:
    wanted = set(skipped)
    return [case for case in case_ids if case in wanted]
