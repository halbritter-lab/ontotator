"""GET /projects/{key}/agreement: the final export's agreement in one call (#353).

The route computes agreement.csv and agreement-summary.csv with the same code
as the final export; for the same selection both give the same figures.
"""

from __future__ import annotations

from typing import Any

from test_consolidation_origins import resolve_and_add, submitted
from test_consolidation_resolve_api import STATUS, build_round
from test_final_tables import final_archive, rows
from work_plan_support import BASE, doc, select_final

from ontotator.exchange.final_tables import COUNT_COLUMNS, F1_COLUMNS

URL = f"{BASE}/agreement"


def as_csv(item: dict[str, Any], columns: tuple[str, ...]) -> dict[str, str]:
    """Values as the CSV writes them: F1 to four places, empty for None."""
    return {
        name: (
            ("" if item[name] is None else f"{item[name]:.4f}")
            if name in F1_COLUMNS
            else str(item[name])
        )
        for name in columns
        if name in item
    }


def two_texts(tmp_path):
    """c1 consolidated from two annotations, c2 accepted directly from one of two."""
    from test_final_panel_api import SEIZURE, finding, span_of, submit_findings
    from work_plan_support import assign

    ns = build_round(tmp_path)
    resolve_and_add(ns)
    consolidated_id = submitted(ns)["submission_id"]
    env = ns.env
    c2 = doc("c2", "en")
    period, since = span_of(env, c2, "Neonatalzeit"), span_of(env, c2, "Seit 2")
    submit_findings(
        env,
        assign(env, c2, "ana", "annotate"),
        "sub-c2-ana",
        [finding("x1", SEIZURE, period, temporality="current")],
    )
    submit_findings(
        env,
        assign(env, c2, "ben", "annotate"),
        "sub-c2-ben",
        [
            finding("y1", SEIZURE, period, temporality="current"),
            finding("y2", STATUS, since, temporality="current"),
        ],
    )
    select_final(env, doc("c1", "en"), consolidated_id)
    select_final(env, c2, "sub-c2-ana")
    return ns


def test_route_gives_the_figures_of_the_final_export(tmp_path):
    env = two_texts(tmp_path).env
    answer = env.lead.get(URL)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    archive = final_archive(env, "agreement-route")

    summary = {r.pop("scope"): r for r in rows(archive.read("agreement-summary.csv"))}
    assert set(summary) == set(body["summary"]) == {"macro_mean", "pooled"}
    for scope, expected in summary.items():
        # The macro mean has no counts: empty cells in the CSV.
        got = as_csv(body["summary"][scope], ("texts", "pairs", *F1_COLUMNS))
        got |= as_csv(body["summary"][scope], COUNT_COLUMNS) or dict.fromkeys(
            COUNT_COLUMNS, ""
        )
        assert got == expected, scope

    table = rows(archive.read("agreement.csv"))
    assert len(table) == len(body["pairs"]) == 2
    columns = tuple(name for name in table[0] if name != "source_text_line")
    for expected, pair in zip(table, body["pairs"], strict=True):
        del expected["source_text_line"]
        assert as_csv(pair, columns) == expected

    assert body["selected_texts"] == 2
    texts = {t["document_id"]: t for t in body["texts"]}
    assert set(texts) == {"c1-en", "c2-en"}
    assert texts["c2-en"]["pooled"]["pairs"] == 1
    assert texts["c2-en"]["macro_mean"]["annotation_strict_f1"] == 2 / 3
    # Per pair of people, over every text both annotated.
    people = {(p["pseudonym_a"], p["pseudonym_b"]) for p in body["pairs"]}
    assert {(p["pseudonym_a"], p["pseudonym_b"]) for p in body["annotator_pairs"]} == (
        people
    )
    assert sum(p["pooled"]["pairs"] for p in body["annotator_pairs"]) == 2


def test_without_final_results_there_is_no_agreement(tmp_path):
    env = build_round(tmp_path).env
    body = env.lead.get(URL).json()
    assert body["selected_texts"] == 0
    assert body["pairs"] == body["texts"] == body["annotator_pairs"] == []
    assert body["summary"]["pooled"]["pairs"] == 0
    assert body["summary"]["pooled"]["annotation_strict_f1"] is None


def test_only_those_who_may_export_see_the_agreement(tmp_path):
    """It names annotators: like the final export, leads only (the consolidator
    of a blinded project must not learn whose work they consolidate)."""
    ns = build_round(tmp_path)
    for client in (ns.adj,):
        assert client.get(URL).status_code in (403, 404)
