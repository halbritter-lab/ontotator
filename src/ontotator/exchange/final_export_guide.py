"""Plain-language guide (README.txt) and result table (index.csv) for a final export.

The analysis tables (findings.csv and the others) are in ``final_tables``.

Both are derived only from the frozen snapshot payload and the snapshot row, so
the same snapshot always yields byte-identical files. Nothing inside the
Ontospan bundles is renamed; the README explains the ontospan names instead.
"""

import csv
import io
import textwrap
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from ontotator.domain.work_rounds import CARRY_ROUND_KINDS

INDEX_COLUMNS = (
    "row_type",
    "case_id",
    "language",
    "document_id",
    "text_version",
    "text_origin",
    "submission_id",
    "submission_kind",
    "author",
    "submitted_at",
    "findings",
    "archive_file",
    "bundle_entry",
    "annotation_set_id",
    "source_text_line",
    "warning_codes",
    "guideline_version",
)
_ROW_ORDER = {"selected": 0, "omitted": 1, "compared": 2, "provenance": 3}
_WIDTH = 76


def bundle_file(row_type: str) -> str:
    """The archive file of the Ontospan bundle of ``row_type`` (``selected``,
    ``provenance`` or ``compared``). Until #321 these were ``<row type>.t1.zip``."""
    return f"{row_type}-results.ontospan.zip"


def bundle_entry(index: int) -> str:
    """The entry name ``ontospan.write_bundle`` gives the unit at 0-based ``index``."""
    return f"documents/{index:05d}.json"


def submission_kind(
    submission: Mapping[str, Any], round_kinds: Mapping[str, str]
) -> str:
    kind = round_kinds.get(submission["submission_id"])
    # Text-change and handover rounds keep the submission kind carry_forward.
    if kind in CARRY_ROUND_KINDS:
        return "carry_forward"
    # D1: every review submission is a consolidation (migration 0020).
    if kind == "consolidation" or submission["origin_key"]["mode"] == "review":
        return "consolidation"
    if submission["origin_key"]["mode"] == "proposal_check":
        return "proposal_check"
    return "annotation"


def _warning_codes(payload: Mapping[str, Any]) -> dict[tuple[str, str], list[str]]:
    codes: dict[tuple[str, str], set[str]] = {}
    for warning in payload["state"]["warnings"]:
        codes.setdefault((warning["case_id"], warning["language"]), set()).add(
            warning["code"]
        )
    return {key: sorted(values) for key, values in codes.items()}


def build_index_csv(
    payload: Mapping[str, Any],
    selected_order: Sequence[str],
    provenance_order: Sequence[str],
    compared_order: Sequence[str] = (),
) -> bytes:
    """One row per selection, omission, compared and provenance-only submission."""
    content = payload["content"]
    documents: Mapping[str, Any] = content["documents"]
    submissions = {sub["submission_id"]: sub for sub in content["submissions"]}
    lines = {doc_id: number for number, doc_id in enumerate(documents, start=1)}
    recorded: Mapping[str, str] = payload.get("submission_recorded_at", {})
    round_kinds: Mapping[str, str] = payload["round_kinds"]
    guideline_versions: Mapping[str, int] = content["guideline_versions"]
    codes = _warning_codes(payload)

    def codes_for(case_id: str, language: str) -> str:
        return ";".join(codes.get((case_id, language), []))

    def submission_row(
        row_type: str,
        case_id: str,
        language: str,
        document_id: str,
        sid: str,
        archive: str,
        index: int,
    ) -> dict[str, str]:
        sub = submissions[sid]
        variant = documents[document_id]["variant"] or {}
        return {
            "row_type": row_type,
            "case_id": case_id,
            "language": language,
            "document_id": document_id,
            "text_version": str(variant.get("version", "")),
            "text_origin": variant.get("origin") or "",
            "submission_id": sid,
            "submission_kind": submission_kind(sub, round_kinds),
            "author": sub["origin_key"]["annotator_id"],
            "submitted_at": recorded.get(sid, ""),
            "findings": str(len(sub["snapshots"])),
            "archive_file": archive,
            "bundle_entry": bundle_entry(index),
            "annotation_set_id": f"submission-{sid}",
            "source_text_line": str(lines[document_id]),
            "warning_codes": codes_for(case_id, language),
            "guideline_version": str(guideline_versions.get(sid, "")),
        }

    selected_index = {sid: index for index, sid in enumerate(selected_order)}
    table: list[dict[str, str]] = []
    for selection in payload["state"]["selections"]:
        sid = selection["submission_id"]
        table.append(
            submission_row(
                "selected",
                selection["case_id"],
                selection["language"],
                selection["document_id"],
                sid,
                bundle_file("selected"),
                selected_index[sid],
            )
        )
    for omission in payload["state"]["omissions"]:
        row = dict.fromkeys(INDEX_COLUMNS, "")
        row.update(
            row_type="omitted",
            case_id=omission["case_id"],
            language=omission["language"],
            warning_codes=codes_for(omission["case_id"], omission["language"]),
        )
        table.append(row)
    for row_type, order in (
        ("provenance", provenance_order),
        ("compared", compared_order),
    ):
        for index, sid in enumerate(order):
            document_id = submissions[sid]["origin_key"]["document_id"]
            entry = documents[document_id]
            variant = entry["variant"]
            case_id = variant["case_id"] if variant else document_id
            language = variant["language"] if variant else entry["document"]["language"]
            table.append(
                submission_row(
                    row_type,
                    case_id,
                    language,
                    document_id,
                    sid,
                    bundle_file(row_type),
                    index,
                )
            )
    table.sort(
        key=lambda r: (
            r["case_id"],
            r["language"],
            _ROW_ORDER[r["row_type"]],
            r["submission_id"],
        )
    )
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=INDEX_COLUMNS)
    writer.writeheader()
    writer.writerows(table)
    return out.getvalue().encode("utf-8-sig")


def _heading(title: str, rule: str = "-") -> list[str]:
    return [title, rule * len(title)]


def _wrap(text: str, first: str = "", rest: str = "") -> list[str]:
    return textwrap.wrap(
        text, width=_WIDTH, initial_indent=first, subsequent_indent=rest
    )


def _utc(value: datetime) -> str:
    moment = (
        value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    )
    return moment.strftime("%Y-%m-%d %H:%M:%S UTC")


def _has_draft_inputs(payload: Mapping[str, Any]) -> bool:
    return any(
        entry.get("source_draft_snapshot_id") is not None
        for entries in payload.get("round_inputs", {}).values()
        for entry in entries
    )


def build_readme(
    payload: Mapping[str, Any],
    *,
    snapshot_id: str,
    snapshot_sha256: str,
    snapshot_created_at: datetime,
    provenance_ids: Sequence[str],
    compared_ids: Sequence[str] = (),
) -> bytes:
    key = payload["project"]
    name = payload.get("project_name") or key
    state = payload["state"]
    checks = any(
        sub["origin_key"]["mode"] == "proposal_check"
        for sub in payload["content"]["submissions"]
    )
    consolidations = any(
        submission_kind(sub, payload["round_kinds"]) == "consolidation"
        for sub in payload["content"]["submissions"]
    )
    out: list[str] = [*_heading("Ontotator final export", "="), ""]
    out += [
        f"Project:          {name if name == key else f'{name} ({key})'}",
        f"Snapshot ID:      {snapshot_id}",
        f"Snapshot SHA-256: {snapshot_sha256}",
        f"Snapshot time:    {_utc(snapshot_created_at)}",
        "",
        *_heading("Summary"),
        f"{'Selected final results:':<35}{len(state['selections'])}",
        f"{'Omitted text and language pairs:':<35}{len(state['omissions'])}",
        f"{'Warnings acknowledged at export:':<35}{len(state['warnings'])}",
        f"{'Provenance-only submissions:':<35}{len(provenance_ids)}",
        *(
            [f"{'Compared submissions:':<35}{len(compared_ids)}"]
            if compared_ids
            else []
        ),
        "",
        *_heading("What is in this archive"),
        "README.txt          This guide.",
        "index.csv           One row per selected result, omission and provenance",
        "                    or compared submission, with the file and entry that",
        "                    holds it.",
        bundle_file("selected"),
        "                    The selected final results as an Ontospan bundle.",
    ]
    if provenance_ids:
        out += [
            bundle_file("provenance"),
            "                    Earlier submissions that selected results refer to",
            "                    through carried or merged findings. Not final results.",
        ]
    if compared_ids:
        out += [
            bundle_file("compared"),
            "                    NOT final results: the other annotators' work on",
            "                    texts whose result was accepted directly, kept only",
            "                    to compute agreement.csv.",
        ]
    out += [
        "source-texts.jsonl  The exact text versions the results refer to, one JSON",
        "                    object per line.",
        "findings.csv        One row per finding of every submission in the",
        "                    bundles: term, values, modifiers, origin, passages.",
        "agreement.csv       Agreement of every two annotators on each text version",
        "                    the bundles hold, earlier versions included (F1).",
        "agreement-summary.csv",
        "                    The same for the project: mean over the texts and",
        "                    pooled over all pairs.",
        "proposals.csv       Per tool and annotator what became of the proposals;",
        "                    per tool its precision and recall against the final",
        "                    results.",
        "receipt.json        Audit receipt: selections, warnings, omissions, review",
        "                    decisions and the SHA-256 of every other file, including",
        "                    this README and the tables.",
    ]
    if checks:
        out += [
            "  proposal_checks   Per tool proposal of a proposal check: confirmed,",
            "                    rejected, corrected or uncertain, with the proposal's",
            "                    ref; plus the findings the person added.",
        ]
    if consolidations:
        out += [
            "  consolidations    Per consolidation: how each finding came about,",
            "                    matched (taken over automatically), decided or added",
            "                    by the consolidator.",
        ]
    out += [
        "",
        *_heading("How to read it"),
        *_wrap(
            'Start with index.csv. Only rows with row_type "selected" are final '
            "results; the other row types are explained below.",
            "- ",
            "  ",
        ),
        *_wrap(
            "An Ontospan bundle is a ZIP with manifest.json and documents/NNNNN.json, one file "
            'per submission. index.csv names the file in "bundle_entry".',
            "- ",
            "  ",
        ),
        *_wrap(
            "An original text (first version, not a translation) that is the only "
            "text of its case in a bundle has no case_id and no variant in its "
            "document, as in ontospan 1.0: its case ID is then its document_id. "
            "Translations and corrected versions always carry both. index.csv "
            'gives the case of every row in "case_id".',
            "- ",
            "  ",
        ),
        *_wrap(
            "Text positions are Unicode code points into the text of the matching line "
            'of source-texts.jsonl (column "source_text_line").',
            "- ",
            "  ",
        ),
        *_wrap(
            'In findings.csv "mentions" gives each passage of a finding as '
            '"start-end"; the parts of a passage that is interrupted are joined by '
            '"+", passages by ";". "covered_text" quotes them the same way. A '
            'finding of the whole text has both empty. "origin" is scratch, '
            "confirmed, changed, added or uncertain (a proposal left open), "
            "carried, or for a consolidation matched, decided or added.",
            "- ",
            "  ",
        ),
        *_wrap(
            "findings.csv has one row per finding of each submission in the "
            "bundles, so a text with several submissions lists its findings "
            'several times. row_type is that of index.csv: keep "selected" to '
            'analyse the final results only. "pseudonym" is the person ("author" '
            'in index.csv). Each "value_<axis>" column holds one value field, '
            'for example value_assertion; "defaulted_values" names the value '
            'fields nobody chose, "modifiers" the modifier term IDs, both joined '
            'by ";". "unresolved" is "yes" when the finding still carries a '
            "reviewer's uncertain flag.",
            "- ",
            "  ",
        ),
        *_wrap(
            "agreement.csv compares, per text, the annotations of every two "
            "people that the bundles hold, with ontospan's matching: strict needs "
            "the same passage, tolerant an overlapping one; term_f1 compares the "
            "terms with their values. Span annotation has no countable negatives, "
            "so only F1 values are given, no kappa. modifier_agreement is the "
            "share of matched findings with the same modifiers.",
            "- ",
            "  ",
        ),
        *_wrap(
            "The counts behind these values follow in agreement.csv: findings_a "
            "and findings_b (findings of person a and b), equal (same term, "
            "values and passage), compatible (same term and values, overlapping "
            "passage), axis_conflicts (same term, other values), term_conflicts "
            "(other term on overlapping text), a_only and b_only (no partner), "
            "the same per passage (mentions_*) and per term (terms_*), "
            "modifiers_compared (matched findings) with modifiers_agreeing, and "
            "related_term_conflicts: the term_conflicts whose terms are ancestor "
            "and descendant in the ontology (a flag; no F1 value uses it).",
            "- ",
            "  ",
        ),
        *_wrap(
            'agreement-summary.csv has two rows. "macro_mean" averages each value '
            "over the pairs of a text, then over the texts; its count columns are "
            'empty on purpose, since a mean of counts means nothing. "pooled" '
            "computes each value from the counts summed over all pairs and lists "
            'those sums. Without any pair both rows have "pairs" 0 and empty '
            "values.",
            "- ",
            "  ",
        ),
        *_wrap(
            "proposals.csv names each tool and version as the imported proposals "
            'recorded them. Rows "annotator" count the decisions of each person\'s '
            'proposal checks; rows "source" compare the tool\'s proposals with the '
            "selected final result of the same text (tolerant matching): "
            "precision = matched / proposals, recall = matched / final_findings. "
            "Recall counts every text with a selected result on which a proposal "
            "set naming the tool was imported, also where the tool proposed "
            "nothing: there all final findings are misses. Columns a row type "
            'does not use stay empty: "annotator" rows fill submissions to '
            'added, "source" rows (one per tool) texts to recall.',
            "- ",
            "  ",
        ),
        *_wrap("Author labels are pseudonyms.", "- ", "  "),
        *(
            _wrap(
                'submission_kind "proposal_check" is annotation from proposals: the '
                "person went through the tool's proposals one by one. Their decisions "
                'are under "proposal_checks" in receipt.json.',
                "- ",
                "  ",
            )
            if checks
            else []
        ),
        *(
            _wrap(
                'Every finding of a consolidation has provenance method "merged" in '
                'the bundle. "consolidations" in receipt.json tells them apart: '
                'origin "matched" (all annotators agreed, taken over automatically), '
                '"decided" (the consolidator resolved the group or changed the '
                'finding; "decision" is auto, keep or choose, "edited" marks a '
                'change after the decision) or "added" (the '
                "consolidator added it outside the groups).",
                "- ",
                "  ",
            )
            if consolidations
            else []
        ),
        *_wrap(
            "submitted_at is the time the server recorded the submission, in UTC. "
            "It is empty for exports prepared before this column existed.",
            "- ",
            "  ",
        ),
        *_wrap(
            '"provenance" rows are earlier submissions referenced by carried or merged '
            "findings, not final results.",
            "- ",
            "  ",
        ),
        *(
            _wrap(
                '"compared" rows are not final results. They are the other '
                "annotators' work on a text whose result was accepted directly, "
                f"without consolidation, kept in {bundle_file('compared')} only to "
                "compute agreement.csv. Leave them out when you analyse the final "
                "results.",
                "- ",
                "  ",
            )
            if compared_ids
            else []
        ),
        *_wrap(
            "guideline_ref in each annotation set names the project guideline version "
            "the result was made under, as urn:ontotator:{project}:guidelines:v{n}"
            "#sha256={hash}; guideline_version in index.csv gives the number. When no "
            "version was recorded, guideline_ref is null and guideline_version is "
            "empty. The guideline texts are not part of "
            "this archive; read them in Ontotator.",
            "- ",
            "  ",
        ),
        *(
            _wrap(
                "Findings carried from a draft frozen at a text change name "
                '"source_draft_snapshot_id" in receipt.json instead of '
                '"source_submission_id"; that draft is not part of this archive.',
                "- ",
                "  ",
            )
            if _has_draft_inputs(payload)
            else []
        ),
        *_wrap(
            "Names inside the bundles (bundle_id, set ids, field names) follow the "
            "ontospan format and are kept unchanged on purpose.",
            "- ",
            "  ",
        ),
        "",
        *_heading("Omitted"),
    ]
    omissions = sorted(state["omissions"], key=lambda o: (o["case_id"], o["language"]))
    out += [
        line
        for o in omissions
        for line in _wrap(
            f"{o['case_id']} ({o['language']}): no final result was selected. "
            "No other submission was substituted."
        )
    ] or ["None."]
    out += ["", *_heading("Warnings acknowledged at export")]
    groups: dict[tuple[str, str], list[Mapping[str, Any]]] = {}
    for warning in state["warnings"]:
        groups.setdefault((warning["case_id"], warning["language"]), []).append(warning)
    if not groups:
        out.append("None.")
    for (case_id, language), items in sorted(groups.items()):
        out.append(f"{case_id} ({language})")
        for warning in items:
            out += _wrap(f"{warning['reason']} [{warning['code']}]", "  - ", "    ")
    out += [
        "",
        *_heading("Verify"),
        *_wrap(
            'Compute the SHA-256 of each file and compare it with "files" in '
            "receipt.json. receipt.json itself is not listed there."
        ),
    ]
    return ("\n".join(out) + "\n").encode("utf-8")


def guide_files(
    payload: Mapping[str, Any],
    *,
    snapshot_id: str,
    snapshot_sha256: str,
    snapshot_created_at: datetime,
) -> dict[str, bytes]:
    """README.txt and index.csv, ordered exactly as the worker serializes bundles."""
    selected_ids = set(payload["selected_submission_ids"])
    compared_ids = set(payload.get("compared_submission_ids", []))
    ordered = [sub["submission_id"] for sub in payload["content"]["submissions"]]
    selected_order = [sid for sid in ordered if sid in selected_ids]
    compared_order = [sid for sid in ordered if sid in compared_ids]
    provenance_order = [
        sid for sid in ordered if sid not in selected_ids | compared_ids
    ]
    return {
        "README.txt": build_readme(
            payload,
            snapshot_id=snapshot_id,
            snapshot_sha256=snapshot_sha256,
            snapshot_created_at=snapshot_created_at,
            provenance_ids=provenance_order,
            compared_ids=compared_order,
        ),
        "index.csv": build_index_csv(
            payload, selected_order, provenance_order, compared_order
        ),
    }
