"""W1 "All findings match" and the agreement with modifiers (modifiers plan
M2, R4, R5): W1 compares modifiers with their segments, ``compare`` only
their term ids."""

from __future__ import annotations

from typing import Any

from document_rows_support import service as rows_service
from test_consolidation_modifiers_read import (
    FOCAL,
    RECURRENT,
    SEIZURE,
    SEVERE,
    found,
    mod_env,
    modifier,
    submit_all,
)

from ontotator.application.document_rows import RowQuery


def row_all_match(env: Any, case: str) -> bool:
    """The row's fact, with the rows the page shows the card's answer on."""
    page = rows_service(env).page("proj", RowQuery(case=case, language=("de",)))
    return page["groups"][0]["rows"][0]["stages"]["final"]["detail"]["all_match"]


def test_all_match_needs_identical_modifiers(tmp_path):
    env = mod_env(tmp_path)
    scenarios: dict[str, tuple[list[dict[str, Any]], list[dict[str, Any]], bool]] = {
        "S1": (
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            True,
        ),
        "S2": (
            [
                found(
                    "s", SEIZURE, "Krampfanfälle", modifier(SEVERE), modifier(RECURRENT)
                )
            ],
            [
                found(
                    "s", SEIZURE, "Krampfanfälle", modifier(RECURRENT), modifier(SEVERE)
                )
            ],
            True,
        ),
        "S3": (
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE))],
            [
                found(
                    "s", SEIZURE, "Krampfanfälle", modifier(SEVERE), modifier(RECURRENT)
                )
            ],
            False,
        ),
        "S6": (
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE))],
            False,
        ),
        "S18": (
            [found("x", SEVERE, "schwere")],
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            False,
        ),
        "S19": (
            [found("x", SEVERE, "schwere")],
            [found("x", SEVERE, "schwere")],
            True,  # a unanimous modifier term is a match (A103)
        ),
        "S11": (
            [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            [found("f", FOCAL, "schwere Krampfanfälle", modifier(RECURRENT))],
            False,
        ),
    }
    panels = {}
    for n, (name, (ana, ben, expected)) in enumerate(scenarios.items(), start=1):
        submit_all(env, f"c{n}", {"ana": ana, "ben": ben})
        panels[name] = rows_service(env).final_panel("proj", f"c{n}", "de")
        assert panels[name]["all_match"] is expected, name
        assert row_all_match(env, f"c{n}") is expected, name
    # S6: the term sets are equal, so ``compare`` counts a match (R4).
    assert panels["S6"]["agreement"]["matching"] == 1
    # S11: compare buckets by term, so each finding is only here.
    s11 = panels["S11"]
    assert s11["agreement"]["matching"] == 0
    assert sorted(s["only_here"] for s in s11["submissions"]) == [1, 1]


def test_the_row_compares_when_only_a_note_differs(tmp_path):
    env = mod_env(tmp_path)
    same = found("s", SEIZURE, "Krampfanfälle")
    submit_all(env, "c1", {"ana": [same], "ben": [{**same, "note": "Bitte prüfen"}]})
    panel = rows_service(env).final_panel("proj", "c1", "de")
    assert panel["agreement"]["matching"] == panel["agreement"]["total"] == 1
    assert panel["all_match"] is False
    assert row_all_match(env, "c1") is False
