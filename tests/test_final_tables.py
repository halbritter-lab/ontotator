"""findings.csv, agreement.csv, agreement-summary.csv and proposals.csv of the
final export (#295, #296, #297)."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from typing import Any

import ontospan
import pytest
from test_consolidation_origins import resolve_and_add, submitted
from test_consolidation_resolve_api import FIRST, SECOND, STATUS, build_round
from test_draft_sourced_inputs import client as client
from test_draft_sourced_inputs import env as env
from work_plan_support import BASE, doc, preflight, select_final

from ontotator.exchange.final_tables import (
    COUNT_COLUMNS,
    F1_COLUMNS,
    AgreementPair,
    ExportedUnit,
    Proposal,
    SubmissionFacts,
    agreement_summary,
    build_proposals_csv,
    finding_origin,
)


def rows(data: bytes) -> list[dict[str, str]]:
    assert data.startswith(b"\xef\xbb\xbf")
    return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline="")))


def final_archive(env: Any, request_id: str) -> zipfile.ZipFile:
    state = preflight(env)
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": request_id,
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(job_id, "tables-test"), "tables-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    return zipfile.ZipFile(io.BytesIO(downloaded.content))


@pytest.fixture
def consolidated(tmp_path):
    ns = build_round(tmp_path)
    ids = resolve_and_add(ns)
    sid = submitted(ns)["submission_id"]
    select_final(ns.env, doc("c1", "en"), sid)
    return ns, ids, sid, final_archive(ns.env, "tables-1")


def test_findings_have_one_row_per_finding_with_origin_and_passages(consolidated):
    _ns, ids, sid, archive = consolidated
    table = rows(archive.read("findings.csv"))
    columns = list(table[0])
    assert columns[:3] == ["row_type", "case_id", "language"]
    assert {"value_assertion", "value_temporality", "term_label"} <= set(columns)
    assert columns[-2:] == ["mentions", "covered_text"]
    by_submission: dict[str, list[dict[str, str]]] = {}
    for row in table:
        by_submission.setdefault(row["submission_id"], []).append(row)
    assert set(by_submission) == {sid, FIRST, SECOND}
    assert {r["row_type"] for r in by_submission[sid]} == {"selected"}
    assert {r["row_type"] for r in by_submission[FIRST]} == {"provenance"}
    origins = {r["annotation_id"]: r["origin"] for r in by_submission[sid]}
    assert origins == {
        ids["auto"]: "matched",
        ids["choose"]: "decided",
        ids["keep"]: "decided",
        ids["added"]: "added",
    }
    assert {r["origin"] for r in by_submission[FIRST]} == {"scratch"}
    a3 = next(r for r in by_submission[FIRST] if r["annotation_id"] == "a3")
    assert (a3["term_label"], a3["value_temporality"], a3["covered_text"]) == (
        "Hypotonia",
        "historical",
        "schwere",
    )
    start, end = (int(n) for n in a3["mentions"].split("-"))
    text = json.loads(archive.read("source-texts.jsonl").splitlines()[0])
    assert text["document"]["text"][start:end] == "schwere"
    assert a3["source_text_line"] == "1"
    # Each row names the bundle entry that holds its finding.
    with zipfile.ZipFile(io.BytesIO(archive.read(a3["archive_file"]))) as bundle:
        unit = json.loads(bundle.read(a3["bundle_entry"]))
    assert "a3" in {a["annotation_id"] for a in unit["annotation_set"]["annotations"]}


def test_agreement_compares_the_two_annotations_behind_the_result(consolidated):
    _ns, _ids, sid, archive = consolidated
    [pair] = rows(archive.read("agreement.csv"))
    assert {pair["submission_a"], pair["submission_b"]} == {FIRST, SECOND}
    assert sid not in pair.values()
    # a1/b1 equal; a2/b2 another term on overlapping text; a3/b3 other values;
    # b4 only in the second annotation.
    assert (
        pair["findings_a"],
        pair["findings_b"],
        pair["equal"],
        pair["compatible"],
        pair["term_conflicts"],
        pair["axis_conflicts"],
    ) == ("3", "4", "1", "0", "1", "1")
    assert pair["a_only"] == "0" and pair["b_only"] == "1"
    assert pair["annotation_strict_f1"] == f"{2 / 7:.4f}"
    summary = {row["scope"]: row for row in rows(archive.read("agreement-summary.csv"))}
    assert set(summary) == {"macro_mean", "pooled"}
    assert summary["pooled"]["texts"] == summary["pooled"]["pairs"] == "1"
    assert summary["pooled"]["annotation_strict_f1"] == f"{2 / 7:.4f}"
    assert summary["macro_mean"]["equal"] == ""


def test_archive_lists_and_hashes_the_tables(consolidated):
    _ns, _ids, _sid, archive = consolidated
    receipt = json.loads(archive.read("receipt.json"))
    tables = {"findings.csv", "agreement.csv", "agreement-summary.csv", "proposals.csv"}
    assert tables <= set(receipt["files"])
    readme = archive.read("README.txt").decode()
    assert all(name in readme for name in tables)
    assert "no kappa" in readme
    # No proposal checks: the table has its header only.
    assert rows(archive.read("proposals.csv")) == []


def test_proposals_count_decisions_per_tool_and_person_and_match_the_result(
    tmp_path,
):
    from proposal_check_support import proposal_env
    from test_proposal_check_export import _proposal_check

    env = proposal_env(tmp_path)
    selected = _proposal_check(env, "anno", ["confirmed", "rejected", "uncertain"])
    other = _proposal_check(env, "anno2", ["confirmed", "confirmed", "confirmed"])
    select_final(env, env.c1, selected)
    archive = final_archive(env, "tables-p")
    index = {r["submission_id"]: r for r in rows(archive.read("index.csv"))}
    first, second = index[selected]["author"], index[other]["author"]
    # The second check was not selected: it is in the archive for comparison.
    assert (index[other]["row_type"], index[other]["archive_file"]) == (
        "compared",
        "compared.t1.zip",
    )

    table = rows(archive.read("proposals.csv"))
    people = {r["pseudonym"]: r for r in table if r["row_type"] == "annotator"}
    assert set(people) == {first, second}
    assert {(r["tool"], r["tool_version"]) for r in table} == {("test-tool", "1")}
    counted = ("submissions", "proposals", "confirmed", "rejected", "changed")
    assert [people[first][k] for k in (*counted, "uncertain", "added")] == [
        "1", "3", "1", "1", "0", "1", "0",
    ]  # fmt: skip
    assert people[second]["confirmed"] == "3"
    assert people[first]["precision"] == ""
    [source] = [r for r in table if r["row_type"] == "source"]
    assert source["pseudonym"] == ""
    # Three proposals; the final result holds the one confirmed (the uncertain
    # proposal is no finding), which matches its proposal.
    assert (
        source["texts"],
        source["proposals"],
        source["final_findings"],
        source["matched"],
        source["precision"],
        source["recall"],
    ) == ("1", "3", "1", "1", "0.3333", "1.0000")

    findings = rows(archive.read("findings.csv"))
    mine = {r["origin"]: r for r in findings if r["submission_id"] == selected}
    assert set(mine) == {"confirmed", "uncertain"}
    assert mine["uncertain"]["unresolved"] == "yes"
    assert mine["confirmed"]["unresolved"] == ""
    assert mine["confirmed"]["submission_kind"] == "proposal_check"
    assert {
        (r["row_type"], r["origin"]) for r in findings if r["submission_id"] == other
    } == {("compared", "confirmed")}
    # The uncertain proposal is no finding of the person: 1 against 3.
    [pair] = rows(archive.read("agreement.csv"))
    assert {pair["findings_a"], pair["findings_b"]} == {"1", "3"}
    assert pair["equal"] == "1"
    assert pair["annotation_strict_f1"] == "0.5000"


def test_agreement_covers_consolidated_and_directly_accepted_texts(tmp_path):
    """c1 is consolidated from two annotations; c2 is accepted directly from
    one of two. Both texts are compared, and the summary counts both."""
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
    archive = final_archive(env, "tables-both")

    receipt = json.loads(archive.read("receipt.json"))
    assert receipt["compared_submission_ids"] == ["sub-c2-ben"]
    assert set(receipt["provenance_only_submission_ids"]) == {FIRST, SECOND}
    index = {r["submission_id"]: r for r in rows(archive.read("index.csv"))}
    assert index["sub-c2-ben"]["row_type"] == "compared"
    with zipfile.ZipFile(io.BytesIO(archive.read("compared.t1.zip"))) as bundle:
        unit = json.loads(bundle.read(index["sub-c2-ben"]["bundle_entry"]))
    assert unit["annotation_set"]["annotation_set_id"] == "submission-sub-c2-ben"
    assert "compared.t1.zip" in archive.read("README.txt").decode()

    pairs = {r["document_id"]: r for r in rows(archive.read("agreement.csv"))}
    assert set(pairs) == {"c1-en", "c2-en"}
    direct = pairs["c2-en"]
    assert {direct["submission_a"], direct["submission_b"]} == {
        "sub-c2-ana",
        "sub-c2-ben",
    }
    assert (direct["equal"], direct["annotation_strict_f1"]) == ("1", f"{2 / 3:.4f}")
    summary = {r["scope"]: r for r in rows(archive.read("agreement-summary.csv"))}
    assert (summary["pooled"]["texts"], summary["pooled"]["pairs"]) == ("2", "2")
    # c1: 1 equal of 3 + 4 findings; c2: 1 equal of 1 + 2.
    assert summary["pooled"]["annotation_strict_f1"] == f"{2 * 2 / 10:.4f}"
    assert summary["macro_mean"]["annotation_strict_f1"] == (
        f"{(2 / 7 + 2 / 3) / 2:.4f}"
    )
    compared = [
        r for r in rows(archive.read("findings.csv")) if r["row_type"] == "compared"
    ]
    assert {r["annotation_id"] for r in compared} == {"y1", "y2"}


def _payload(submissions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "state": {"selections": []},
        "round_kinds": {},
        "content": {
            "documents": {
                "d1": {
                    "document": {"document_id": "d1", "language": "en"},
                    "variant": None,
                }
            },
            "submissions": submissions,
        },
    }


def _check(sid: str, author: str, decisions, own: list[str]) -> dict[str, Any]:
    return {
        "submission_id": sid,
        "origin_key": {
            "document_id": "d1",
            "annotator_id": author,
            "mode": "proposal_check",
        },
        "snapshots": [{"annotation": {"annotation_id": a}} for a in own],
        "decisions": [
            {
                "target": {"annotation_id": target, "version": "v"},
                "outcome": outcome,
                "replacement": {"annotation_id": replacement, "version": "v"}
                if replacement
                else None,
            }
            for target, outcome, replacement in decisions
        ],
    }


def _proposal(sid: str, annotation_id: str, tool: str = "tagger") -> Proposal:
    return Proposal(
        sid,
        tool,
        "2.0",
        ontospan.Annotation(
            annotation_id=annotation_id,
            layer_id="hpo",
            term_id="HP:0001250",
            document_level=True,
            provenance=ontospan.Provenance(
                actor=ontospan.Actor(actor_id="t", kind="tool"), method="tool"
            ),
        ),
    )


def test_changed_and_added_findings_are_counted_per_person():
    decisions = [
        ("p1", "confirmed", None),
        ("p2", "changed", "r2"),
        ("p3", "rejected", None),
        ("p4", "uncertain", None),
    ]
    payload = _payload(
        [
            _check("s1", "reader-0001", decisions, ["p1", "r2", "new"]),
            _check("s2", "reader-0002", [], ["own"]),
        ]
    )
    units = [
        ExportedUnit(
            "s1", "provenance", "provenance.t1.zip", "documents/00000.json", None
        ),  # type: ignore[arg-type]
        ExportedUnit(
            "s2", "provenance", "provenance.t1.zip", "documents/00001.json", None
        ),  # type: ignore[arg-type]
    ]
    proposals = [_proposal("s1", p) for p in ("p1", "p2", "p3", "p4")]
    table = rows(build_proposals_csv(payload, units, proposals))
    people = {r["pseudonym"]: r for r in table if r["row_type"] == "annotator"}
    keys = ("proposals", "confirmed", "rejected", "changed", "uncertain", "added")
    assert [people["reader-0001"][k] for k in keys] == ["4", "1", "1", "1", "1", "1"]
    assert (people["reader-0001"]["tool"], people["reader-0001"]["tool_version"]) == (
        "tagger",
        "2.0",
    )
    # A round without proposals names no tool; its findings are all added.
    assert people["reader-0002"]["tool"] == ""
    assert people["reader-0002"]["added"] == "1"
    # No selected result on the text: the tool's row compares nothing.
    [source] = [r for r in table if r["row_type"] == "source"]
    assert (source["texts"], source["precision"], source["recall"]) == ("0", "", "")

    context = SubmissionFacts(payload)
    origin = {
        a: finding_origin(context, "s1", _proposal("s1", a).annotation, {})
        for a in ("p1", "r2", "new", "p4")
    }
    assert origin == {
        "p1": "confirmed",
        "r2": "changed",
        "new": "added",
        "p4": "uncertain",
    }


def _pair(document_id: str, equal: int, size: int) -> AgreementPair:
    counts = dict.fromkeys(COUNT_COLUMNS, 0)
    counts.update(findings_a=size, findings_b=size, equal=equal)
    values = {name: None for name in F1_COLUMNS}
    values["annotation_strict_f1"] = equal / size
    return AgreementPair(document_id, "a", "b", values, counts)


def test_summary_means_texts_and_pools_counts():
    # Text 1: two pairs (1.0 and 0.5); text 2: one large pair (0.1).
    pairs = [_pair("t1", 2, 2), _pair("t1", 1, 2), _pair("t2", 1, 10)]
    summary = agreement_summary(pairs)
    macro, pooled = summary["macro_mean"], summary["pooled"]
    assert (macro["texts"], macro["pairs"]) == (2, 3)
    assert macro["annotation_strict_f1"] == pytest.approx((0.75 + 0.1) / 2)
    assert macro["term_f1"] is None
    assert pooled["equal"] == 4
    assert pooled["annotation_strict_f1"] == pytest.approx(2 * 4 / 28)


def test_carried_findings_name_their_origin(env):
    """Ana's v1 submission carried to v2 by its author and selected."""
    from browser_documents_scenarios import select
    from test_draft_sourced_inputs import _final_export, _finish
    from test_text_change_service import _carry, _submitted

    ana = _submitted(env, "ana")
    carried = _carry(env, ana["submission_id"])
    ana_v2 = _finish(env, "ana", carried.round)
    select(env.scenario, env.docs[1], ana_v2)
    archive = _final_export(env, "tables-carry")
    findings = rows(archive.read("findings.csv"))
    selected = [r for r in findings if r["row_type"] == "selected"]
    assert selected and {r["submission_kind"] for r in selected} == {"carry_forward"}
    assert {r["origin"] for r in selected} == {"carried"}
    assert {r["text_version"] for r in selected} == {"2"}
    earlier = [r for r in findings if r["row_type"] == "provenance"]
    assert {(r["origin"], r["text_version"]) for r in earlier} == {("scratch", "1")}
    # A carried result is no annotation of its own: nothing to compare.
    assert rows(archive.read("agreement.csv")) == []
