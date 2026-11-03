"""Analysis tables of a final export: findings, agreement and proposals.

``findings.csv`` (#296) has one row per finding of every exported submission,
``agreement.csv`` and ``agreement-summary.csv`` (#295) the pairwise agreement
of the annotations behind the results, and ``proposals.csv`` (#297) what the
annotators did with each tool's proposals and how well the tool matches the
final results.

The tables read the findings from the T1 units the export writes, so a row
always describes what the bundles hold. Agreement and tool matching use
``ontospan.agreement``, the one comparison Ontotator and the benchmark share.
Span annotation has no countable negatives, so every measure is an F1 (or a
precision and a recall), never a kappa.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, fields
from itertools import combinations
from statistics import fmean
from typing import Any

import ontospan

from ontotator.exchange.final_export_guide import bundle_entry, submission_kind

FINDINGS_COLUMNS = (
    "row_type",
    "case_id",
    "language",
    "document_id",
    "text_version",
    "source_text_line",
    "submission_id",
    "submission_kind",
    "archive_file",
    "bundle_entry",
    "pseudonym",
    "annotation_id",
    "layer_id",
    "term_id",
    "term_label",
    "ontology",
    "ontology_release",
)
"""The fixed columns of findings.csv; one ``value_<axis>`` column per value
field follows, then ``FINDINGS_TAIL``."""
FINDINGS_TAIL = (
    "defaulted_values",
    "modifiers",
    "origin",
    "unresolved",
    "mentions",
    "covered_text",
)
F1_COLUMNS = (
    "annotation_strict_f1",
    "annotation_tolerant_f1",
    "mention_strict_f1",
    "mention_tolerant_f1",
    "term_f1",
    "modifier_agreement",
)
COUNT_COLUMNS = (
    "findings_a",
    "findings_b",
    "equal",
    "compatible",
    "axis_conflicts",
    "term_conflicts",
    "a_only",
    "b_only",
    "mentions_a",
    "mentions_b",
    "mentions_equal",
    "mentions_compatible",
    "terms_a",
    "terms_b",
    "terms_equal",
    "modifiers_compared",
    "modifiers_agreeing",
)
AGREEMENT_COLUMNS = (
    "case_id",
    "language",
    "document_id",
    "text_version",
    "source_text_line",
    "submission_a",
    "pseudonym_a",
    "submission_b",
    "pseudonym_b",
    *F1_COLUMNS,
    *COUNT_COLUMNS,
)
AGREEMENT_SUMMARY_COLUMNS = ("scope", "texts", "pairs", *F1_COLUMNS, *COUNT_COLUMNS)
PROPOSALS_COLUMNS = (
    "row_type",
    "tool",
    "tool_version",
    "pseudonym",
    "submissions",
    "proposals",
    "confirmed",
    "rejected",
    "changed",
    "uncertain",
    "added",
    "texts",
    "final_findings",
    "matched",
    "precision",
    "recall",
)
# Every submission kind whose findings are one person's own annotation.
ANNOTATION_KINDS = frozenset({"annotation", "proposal_check"})
_OLDER_RELEASE = re.compile(r"^(?P<layer>.+)@[0-9a-f]{12}$")

Label = Callable[[ontospan.Layer, str], str | None]


@dataclass(frozen=True)
class ExportedUnit:
    """One submission as a T1 unit of ``selected.t1.zip`` or ``provenance.t1.zip``."""

    submission_id: str
    row_type: str
    archive_file: str
    bundle_entry: str
    unit: ontospan.AnnotatedDocument


@dataclass(frozen=True)
class Proposal:
    """One tool proposal a proposal check worked on, as a T1 annotation.

    ``tool`` and ``tool_version`` are the name and version of the proposal's
    actor as the imported bundle recorded them (the actor id without a name).
    """

    submission_id: str
    tool: str
    tool_version: str
    annotation: ontospan.Annotation


def read_units(
    files: Mapping[str, bytes],
    selected_order: Sequence[str],
    provenance_order: Sequence[str],
) -> list[ExportedUnit]:
    """The units of both bundles, in the order the worker wrote them."""
    units = []
    for row_type, archive, order in (
        ("selected", "selected.t1.zip", selected_order),
        ("provenance", "provenance.t1.zip", provenance_order),
    ):
        if not order:
            continue
        with zipfile.ZipFile(io.BytesIO(files[archive])) as bundle:
            for index, sid in enumerate(order):
                entry = bundle_entry(index)
                unit = ontospan.AnnotatedDocument.model_validate_json(
                    bundle.read(entry)
                )
                if unit.annotation_set.annotation_set_id != f"submission-{sid}":
                    raise ValueError(f"{archive} {entry} is not submission {sid}")
                units.append(ExportedUnit(sid, row_type, archive, entry, unit))
    return units


def _csv(columns: Sequence[str], rows: Iterable[Mapping[str, str]]) -> bytes:
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8-sig")


def _number(value: float | None) -> str:
    return "" if value is None else f"{value:.4f}"


def _ratio(part: int, whole: int) -> float | None:
    return part / whole if whole else None


def _f1(agreeing: int, n_a: int, n_b: int) -> float:
    # As ontospan.matching: two empty sets agree.
    return 1.0 if n_a + n_b == 0 else 2 * agreeing / (n_a + n_b)


def base_layer(layer_id: str) -> str:
    """The profile layer of a bundle layer; an older release is ``<id>@<digest>``."""
    match = _OLDER_RELEASE.match(layer_id)
    return match["layer"] if match else layer_id


def _on_base_layers(
    annotations: Iterable[ontospan.Annotation],
) -> list[ontospan.Annotation]:
    return [
        item.model_copy(update={"layer_id": base_layer(item.layer_id)})
        for item in annotations
    ]


class SubmissionFacts:
    """Facts of a submission shared by every table, from the frozen payload."""

    def __init__(self, payload: Mapping[str, Any]) -> None:
        content = payload["content"]
        self.documents: Mapping[str, Any] = content["documents"]
        self.submissions: dict[str, Mapping[str, Any]] = {
            sub["submission_id"]: sub for sub in content["submissions"]
        }
        self.lines = {
            doc_id: number for number, doc_id in enumerate(self.documents, start=1)
        }
        self.round_kinds: Mapping[str, str] = payload["round_kinds"]
        self.selections = {
            item["submission_id"]: item for item in payload["state"]["selections"]
        }

    def kind(self, sid: str) -> str:
        return submission_kind(self.submissions[sid], self.round_kinds)

    def author(self, sid: str) -> str:
        return str(self.submissions[sid]["origin_key"]["annotator_id"])

    def document_id(self, sid: str) -> str:
        return str(self.submissions[sid]["origin_key"]["document_id"])

    def text(self, document_id: str) -> dict[str, str]:
        """``case_id``, ``language``, ``document_id``, ``text_version`` and
        ``source_text_line`` of a text, as index.csv gives them."""
        entry = self.documents[document_id]
        variant = entry["variant"] or {}
        return {
            "case_id": variant.get("case_id") or document_id,
            "language": variant.get("language") or entry["document"]["language"],
            "document_id": document_id,
            "text_version": str(variant.get("version", "")),
            "source_text_line": str(self.lines[document_id]),
        }

    def of_submission(self, sid: str) -> dict[str, str]:
        facts = self.text(self.document_id(sid))
        selection = self.selections.get(sid)
        if selection is not None:
            facts.update(case_id=selection["case_id"], language=selection["language"])
        return facts

    def own_ids(self, sid: str) -> set[str]:
        """The findings the submission holds (snapshots)."""
        return {
            snap["annotation"]["annotation_id"]
            for snap in self.submissions[sid].get("snapshots", [])
            if "annotation" in snap
        }

    def decisions(self, sid: str) -> list[Mapping[str, Any]]:
        return list(self.submissions[sid].get("decisions", []))


def _uncertain_targets(context: SubmissionFacts, sid: str) -> set[str]:
    """Proposals a proposal check left uncertain: kept in the submission and
    the bundle, but no finding of the person. (In other submissions an
    uncertain decision flags the person's own finding, which stays one.)"""
    if context.kind(sid) != "proposal_check":
        return set()
    return {
        d["target"]["annotation_id"]
        for d in context.decisions(sid)
        if d["outcome"] == "uncertain"
    }


def finding_origin(
    context: SubmissionFacts,
    sid: str,
    annotation: ontospan.Annotation,
    consolidations: Mapping[str, Mapping[str, Any]],
) -> str:
    """How a finding came about; see the scientific workflow guide."""
    kind = context.kind(sid)
    annotation_id = annotation.annotation_id
    if kind == "consolidation":
        record = consolidations.get(sid, {})
        for item in record.get("findings", []):
            if item["annotation_id"] == annotation_id:
                return str(item["origin"])
        return "decided"
    if kind == "proposal_check":
        if annotation_id in _uncertain_targets(context, sid):
            return "uncertain"
        for decision in context.decisions(sid):
            replacement = decision.get("replacement") or {}
            if replacement.get("annotation_id") == annotation_id:
                return "changed"
            if (
                decision["outcome"] == "confirmed"
                and decision["target"]["annotation_id"] == annotation_id
            ):
                return "confirmed"
        return "added"
    if kind == "carry_forward":
        return "carried" if annotation.provenance.source_refs else "added"
    return "scratch"


def _mentions(annotation: ontospan.Annotation) -> tuple[str, str]:
    """``start-end`` segments joined by ``+`` within a mention and ``;`` between
    mentions, and the covered text joined the same way."""
    return (
        ";".join(
            "+".join(f"{s.start}-{s.end}" for s in mention.segments)
            for mention in annotation.mentions
        ),
        ";".join(
            "+".join(s.text for s in mention.segments)
            for mention in annotation.mentions
        ),
    )


def build_findings_csv(
    payload: Mapping[str, Any],
    units: Sequence[ExportedUnit],
    *,
    consolidations: Mapping[str, Mapping[str, Any]],
    label: Label,
) -> bytes:
    """One row per finding of every selected and provenance submission."""
    context = SubmissionFacts(payload)
    axes = sorted(
        {
            axis
            for item in units
            for annotation in item.unit.annotation_set.annotations
            for axis in annotation.axes
        }
    )
    columns = (*FINDINGS_COLUMNS, *(f"value_{axis}" for axis in axes), *FINDINGS_TAIL)
    order = {"selected": 0, "provenance": 1}
    table: list[tuple[tuple[str, ...], int, dict[str, str]]] = []
    for item in units:
        sid = item.submission_id
        facts = context.of_submission(sid)
        layers = {layer.layer_id: layer for layer in item.unit.annotation_set.layers}
        for position, annotation in enumerate(item.unit.annotation_set.annotations):
            layer = layers[annotation.layer_id]
            mentions, covered = _mentions(annotation)
            row = {
                "row_type": item.row_type,
                **facts,
                "submission_id": sid,
                "submission_kind": context.kind(sid),
                "archive_file": item.archive_file,
                "bundle_entry": item.bundle_entry,
                "pseudonym": context.author(sid),
                "annotation_id": annotation.annotation_id,
                "layer_id": annotation.layer_id,
                "term_id": annotation.term_id,
                "term_label": label(layer, annotation.term_id) or "",
                "ontology": layer.ontology.id,
                "ontology_release": layer.ontology.version,
                **{
                    f"value_{axis}": (
                        annotation.axes[axis].value if axis in annotation.axes else ""
                    )
                    for axis in axes
                },
                "defaulted_values": ";".join(
                    axis
                    for axis, value in sorted(annotation.axes.items())
                    if value.basis == "defaulted"
                ),
                "modifiers": ";".join(m.term_id for m in annotation.modifiers),
                "origin": finding_origin(context, sid, annotation, consolidations),
                "unresolved": "yes" if annotation.review_resolution else "",
                "mentions": mentions,
                "covered_text": covered,
            }
            key = (
                facts["case_id"],
                facts["language"],
                str(order[item.row_type]),
                sid,
            )
            table.append((key, position, row))
    table.sort(key=lambda entry: (entry[0], entry[1]))
    return _csv(columns, (row for _, _, row in table))


def own_findings(
    context: SubmissionFacts, item: ExportedUnit
) -> list[ontospan.Annotation]:
    """The unit's findings on their profile layers; proposals a proposal check
    left uncertain are no finding of the person and are left out."""
    skip = _uncertain_targets(context, item.submission_id)
    return _on_base_layers(
        a for a in item.unit.annotation_set.annotations if a.annotation_id not in skip
    )


def _counts(
    found: ontospan.Agreement, findings_a: int, findings_b: int
) -> dict[str, int]:
    compared = found.equal + found.compatible
    return {
        "findings_a": findings_a,
        "findings_b": findings_b,
        "equal": found.equal,
        "compatible": found.compatible,
        "axis_conflicts": found.axis_conflicts,
        "term_conflicts": found.term_conflicts,
        "a_only": found.a_only,
        "b_only": found.b_only,
        "mentions_a": found.mentions_a,
        "mentions_b": found.mentions_b,
        "mentions_equal": found.mentions_equal,
        "mentions_compatible": found.mentions_compatible,
        "terms_a": found.terms_a,
        "terms_b": found.terms_b,
        "terms_equal": found.terms_equal,
        "modifiers_compared": compared,
        "modifiers_agreeing": round((found.modifier_agreement or 0.0) * compared),
    }


def _pooled(counts: Mapping[str, int]) -> dict[str, float | None]:
    """The F1 values of summed counts (micro average)."""
    return {
        "annotation_strict_f1": _f1(
            counts["equal"], counts["findings_a"], counts["findings_b"]
        ),
        "annotation_tolerant_f1": _f1(
            counts["equal"] + counts["compatible"],
            counts["findings_a"],
            counts["findings_b"],
        ),
        "mention_strict_f1": _f1(
            counts["mentions_equal"], counts["mentions_a"], counts["mentions_b"]
        ),
        "mention_tolerant_f1": _f1(
            counts["mentions_equal"] + counts["mentions_compatible"],
            counts["mentions_a"],
            counts["mentions_b"],
        ),
        "term_f1": _f1(counts["terms_equal"], counts["terms_a"], counts["terms_b"]),
        "modifier_agreement": _ratio(
            counts["modifiers_agreeing"], counts["modifiers_compared"]
        ),
    }


@dataclass(frozen=True)
class AgreementPair:
    """The agreement of two annotators' submissions on one text."""

    document_id: str
    submission_a: str
    submission_b: str
    values: Mapping[str, float | None]
    counts: Mapping[str, int]


def agreement_pairs(
    payload: Mapping[str, Any], units: Sequence[ExportedUnit]
) -> list[AgreementPair]:
    """Per text, every pair of annotation submissions by different people.

    The annotations are those the export holds (selected and provenance): the
    work that went into the final results. Consolidations and carried results
    are no annotation of their own and are left out.
    """
    context = SubmissionFacts(payload)
    by_text: dict[str, list[ExportedUnit]] = defaultdict(list)
    for item in units:
        if context.kind(item.submission_id) in ANNOTATION_KINDS:
            by_text[context.document_id(item.submission_id)].append(item)
    pairs = []
    for document_id in sorted(by_text, key=lambda d: context.lines[d]):
        members = sorted(
            by_text[document_id],
            key=lambda u: (context.author(u.submission_id), u.submission_id),
        )
        for left, right in combinations(members, 2):
            if context.author(left.submission_id) == context.author(
                right.submission_id
            ):
                continue
            a, b = own_findings(context, left), own_findings(context, right)
            found = ontospan.agreement(a, b, left.unit.document.text)
            values = {
                f.name: getattr(found, f.name)
                for f in fields(found)
                if f.name in F1_COLUMNS
            }
            pairs.append(
                AgreementPair(
                    document_id,
                    left.submission_id,
                    right.submission_id,
                    values,
                    _counts(found, len(a), len(b)),
                )
            )
    return pairs


def agreement_summary(pairs: Sequence[AgreementPair]) -> dict[str, dict[str, Any]]:
    """``macro_mean`` (mean over texts of each text's mean over its pairs) and
    ``pooled`` (F1 of the counts summed over every pair)."""
    texts: dict[str, list[AgreementPair]] = defaultdict(list)
    for pair in pairs:
        texts[pair.document_id].append(pair)
    per_text = [
        {
            name: (
                fmean(values)
                if (values := [v for p in group if (v := p.values[name]) is not None])
                else None
            )
            for name in F1_COLUMNS
        }
        for group in texts.values()
    ]
    totals = {name: sum(pair.counts[name] for pair in pairs) for name in COUNT_COLUMNS}
    size = {"texts": len(texts), "pairs": len(pairs)}
    return {
        "macro_mean": {
            **size,
            **{
                name: (
                    fmean(values)
                    if (values := [v for t in per_text if (v := t[name]) is not None])
                    else None
                )
                for name in F1_COLUMNS
            },
        },
        "pooled": {**size, **_pooled(totals), **totals},
    }


def build_agreement_csv(
    payload: Mapping[str, Any], units: Sequence[ExportedUnit]
) -> dict[str, bytes]:
    """agreement.csv (one row per text and pair) and agreement-summary.csv."""
    context = SubmissionFacts(payload)
    pairs = agreement_pairs(payload, units)
    rows = [
        {
            **context.text(pair.document_id),
            "submission_a": pair.submission_a,
            "pseudonym_a": context.author(pair.submission_a),
            "submission_b": pair.submission_b,
            "pseudonym_b": context.author(pair.submission_b),
            **{name: _number(pair.values[name]) for name in F1_COLUMNS},
            **{name: str(pair.counts[name]) for name in COUNT_COLUMNS},
        }
        for pair in pairs
    ]
    summary = agreement_summary(pairs)
    summary_rows = [
        {
            "scope": scope,
            **{
                name: _number(value) if name in F1_COLUMNS else str(value)
                for name, value in values.items()
            },
        }
        for scope, values in summary.items()
    ]
    return {
        "agreement.csv": _csv(AGREEMENT_COLUMNS, rows),
        "agreement-summary.csv": _csv(AGREEMENT_SUMMARY_COLUMNS, summary_rows),
    }


def build_proposals_csv(
    payload: Mapping[str, Any],
    units: Sequence[ExportedUnit],
    proposals: Sequence[Proposal],
) -> bytes:
    """Per tool and annotator what the proposal checks did with the proposals;
    per tool its precision and recall against the selected final results."""
    context = SubmissionFacts(payload)
    source_of = {(p.submission_id, p.annotation.annotation_id): p for p in proposals}
    empty = dict.fromkeys(PROPOSALS_COLUMNS[4:11], 0)
    people: dict[tuple[str, str, str], dict[str, int]] = {}
    for item in units:
        sid = item.submission_id
        if context.kind(sid) != "proposal_check":
            continue
        targets = sorted(
            (p for p in proposals if p.submission_id == sid),
            key=lambda p: p.annotation.annotation_id,
        )
        # A round works on one proposal set; its added findings count for
        # the tool of that set (none for a text without proposals).
        main = (targets[0].tool, targets[0].tool_version) if targets else ("", "")
        row = people.setdefault((*main, context.author(sid)), dict(empty))
        row["submissions"] += 1
        replaced = set()
        for decision in context.decisions(sid):
            proposal = source_of.get((sid, decision["target"]["annotation_id"]))
            if decision.get("replacement"):
                replaced.add(decision["replacement"]["annotation_id"])
            if proposal is None:
                continue
            counted = people.setdefault(
                (proposal.tool, proposal.tool_version, context.author(sid)),
                dict(empty),
            )
            counted["proposals"] += 1
            counted[decision["outcome"]] += 1
        target_ids = {p.annotation.annotation_id for p in targets}
        row["added"] += sum(
            1
            for annotation_id in context.own_ids(sid)
            if annotation_id not in replaced and annotation_id not in target_ids
        )
    rows: list[dict[str, str]] = [
        {
            "row_type": "annotator",
            "tool": tool,
            "tool_version": version,
            "pseudonym": person,
            **{name: str(value) for name, value in counts.items()},
        }
        for (tool, version, person), counts in sorted(people.items())
    ]
    finals = {
        context.document_id(item.submission_id): item
        for item in units
        if item.row_type == "selected"
    }
    by_source: dict[tuple[str, str], dict[str, list[ontospan.Annotation]]] = (
        defaultdict(lambda: defaultdict(list))
    )
    seen: set[tuple[str, str, str, str]] = set()
    for proposal in proposals:
        document_id = context.document_id(proposal.submission_id)
        key = (proposal.tool, proposal.tool_version, document_id)
        if (*key, proposal.annotation.annotation_id) in seen:
            continue
        seen.add((*key, proposal.annotation.annotation_id))
        by_source[(proposal.tool, proposal.tool_version)][document_id].append(
            proposal.annotation
        )
    for (tool, version), texts in sorted(by_source.items()):
        total = {"texts": 0, "proposals": 0, "final_findings": 0, "matched": 0}
        for document_id, offered in texts.items():
            final = finals.get(document_id)
            if final is None:
                continue
            found_final = own_findings(context, final)
            found = ontospan.agreement(
                _on_base_layers(offered), found_final, final.unit.document.text
            )
            total["texts"] += 1
            total["proposals"] += len(offered)
            total["final_findings"] += len(found_final)
            total["matched"] += found.equal + found.compatible
        rows.append(
            {
                "row_type": "source",
                "tool": tool,
                "tool_version": version,
                **{name: str(value) for name, value in total.items()},
                "precision": _number(_ratio(total["matched"], total["proposals"])),
                "recall": _number(_ratio(total["matched"], total["final_findings"])),
            }
        )
    return _csv(PROPOSALS_COLUMNS, rows)


def table_files(
    payload: Mapping[str, Any],
    units: Sequence[ExportedUnit],
    *,
    consolidations: Mapping[str, Mapping[str, Any]],
    proposals: Sequence[Proposal],
    label: Label,
) -> dict[str, bytes]:
    """findings.csv, agreement.csv, agreement-summary.csv and proposals.csv."""
    return {
        "findings.csv": build_findings_csv(
            payload, units, consolidations=consolidations, label=label
        ),
        **build_agreement_csv(payload, units),
        "proposals.csv": build_proposals_csv(payload, units, proposals),
    }
