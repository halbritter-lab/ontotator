"""Final-result panel of one Documents row and the Final cell's agreement.

Documents overview spec V6, V9, VD16, "Final-result panel" and "Agreement and
panel data (WP O3)". Runs on the caller's connection: the caller
(``DocumentRowsService``) has authorized the lead under the shared project
lock and loaded the row facts. Nothing is stored; the agreement is computed
per request from the submission snapshots with the pure ``domain/agreement``.

*Eligible* (VD16) is ``document_row_stages.eligible_by_target``, the one
derivation the Final cell's "{n} submissions" also counts: the last
submission of each submitted annotate assignment on the row's target version
that was not carried, moved or handed over, and the latest submission of each
submitted consolidation round on the target. The panel compares the eligible
submissions of one target version (the *compared version*, the target with
the most eligible submissions; the Final cell counts the same one). The panel's
per-submission ``eligible`` flag instead says whether the lead may use the
submission as final (``OWN_RESULT_NOT_SELECTABLE``); submissions on other
versions stay selectable.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import Connection, select

from ontotator.application.document_row_page import build_row, page_context
from ontotator.application.document_row_stages import (
    NOT_ELIGIBLE,
    Candidate,
    compared_target,
    eligible_by_target,
)
from ontotator.application.document_row_submissions import (
    build_submissions,
    consolidation_summaries,
    stored_decisions,
)
from ontotator.application.text_changes import (
    editable_findings,
    findings_in_changed_passages,
    unplaced_findings,
)
from ontotator.domain import document_rows as rules
from ontotator.domain.agreement import (
    Agreement,
    Finding,
    compare,
    groups,
    with_defaults,
)
from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.consolidation_origins import finding_origins, origin_counts
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.project_rules import ModifierRoles
from ontotator.domain.review import ReviewDecision
from ontotator.domain.workspace import Submission
from ontotator.ontology.modifiers import NO_TERM_ROLES, TermRoles, term_roles
from ontotator.projects.service import axis_defaults
from ontotator.storage.repository import Repository
from ontotator.storage.tables import DocumentRow, ProjectRow, SubmissionRow
from ontotator.storage.workflow_tables import RoundInputRow

if TYPE_CHECKING:  # document_rows imports this module
    from ontotator.application.document_row_page import _Context
    from ontotator.application.document_rows import RowFacts

__all__ = [
    "NOT_ELIGIBLE",
    "Candidate",
    "fill_agreement",
    "final_panel",
    "finding_of",
    "findings_of",
    "project_profile",
    "project_roles",
    "unresolved_notes",
]

LabelRule = Literal["accept", "compare"]
AxisDefaults = Mapping[str, Mapping[str, str]]


@dataclass(frozen=True)
class RowComparison:
    """Targets, eligible submissions and the compared version of one row."""

    targets: tuple[rules.Version, ...]
    # Live version -> the target version of its root.
    target_of: Mapping[str, rules.Version]
    eligible: tuple[Candidate, ...]
    compared: rules.Version | None
    # The compared version's eligible submissions.
    comparable: tuple[Candidate, ...]


def row_comparison(ctx: _Context, case_id: str, language: str) -> RowComparison:
    """The row's live targets and their eligible submissions (as the page)."""
    live = [
        chain
        for chain in rules.build_chains(ctx.by_row.get((case_id, language), []))
        if not any(v.document_id in ctx.dropped for v in chain.versions)
    ]
    target_of: dict[str, rules.Version] = {}
    targets: list[rules.Version] = []
    for chain in live:
        target = [v for v in chain.versions if not v.not_newer][-1]
        targets.append(target)
        for version in chain.versions:
            target_of[version.document_id] = target
    per_target = eligible_by_target(ctx, targets)
    index = compared_target(per_target)
    return RowComparison(
        targets=tuple(targets),
        target_of=target_of,
        eligible=tuple(item for found in per_target for item in found),
        compared=targets[index] if index is not None else None,
        comparable=per_target[index] if index is not None else (),
    )


def unresolved_notes(
    decisions: Iterable[ReviewDecision],
) -> dict[tuple[str, str], str | None]:
    """(annotation id, version) -> note of the Unresolved decisions on them."""
    return {
        (d.target.annotation_id, d.target.version): d.note
        for d in decisions
        if d.outcome == "uncertain"
    }


def findings_of(
    submission: Submission,
    profile: TaskProfile,
    defaults: AxisDefaults | None = None,
    roles: ModifierRoles = NO_TERM_ROLES,
) -> list[Finding]:
    """The findings of a submission: its snapshots in editable layers.

    Axis values are filled with the layer's defaults (``axis_defaults``);
    modifiers and standalone modifier findings as ``finding_of``. A finding
    without evidence is spanless. A target its author left Unresolved stays a
    finding of the submission, flagged ``unresolved``.
    """
    editable = {
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    }
    notes = unresolved_notes(submission.decisions)
    return [
        finding_of(
            item,
            key=item.annotation.annotation_id,
            order=order,
            defaults=defaults,
            roles=roles,
            unresolved=(item.annotation.annotation_id, item.version) in notes,
            unresolved_note=notes.get((item.annotation.annotation_id, item.version)),
        )
        for order, item in enumerate(submission.snapshots)
        if item.annotation.layer_id in editable
    ]


def finding_of(
    item: AnnotationSnapshot,
    *,
    key: str,
    order: int,
    defaults: AxisDefaults | None = None,
    roles: ModifierRoles = NO_TERM_ROLES,
    unresolved: bool = False,
    unresolved_note: str | None = None,
) -> Finding:
    """One snapshot as a ``Finding`` (the one rule the final panel's agreement
    and the consolidation grouping share).

    Axis values are filled with the layer's defaults; ``type_id``, the note,
    the cue segments, the modifier segments and ``standalone_modifier`` (a
    modifier term used as the finding, by ``roles``) are filled for
    ``groups``; ``compare`` uses only the modifier term ids. The default
    ``roles`` exist for pure tests; production passes ``project_roles``.
    """
    annotation = item.annotation
    refs = {(ref.evidence_id, ref.version) for ref in annotation.evidence_refs}
    mentions = [
        evidence.mention
        for evidence in item.evidence
        if (evidence.mention.evidence_id, evidence.version) in refs
    ]
    return Finding(
        key=key,
        layer_id=annotation.layer_id,
        term_id=annotation.term_id,
        axes=with_defaults(
            annotation.axes_values, (defaults or {}).get(annotation.layer_id, {})
        ),
        modifiers=frozenset(m.term_id for m in annotation.modifiers),
        spans=tuple(sorted((s.start, s.end) for m in mentions for s in m.segments)),
        order=order,
        type_id=annotation.type_id,
        note=annotation.note or None,
        cues=tuple(sorted((s.start, s.end) for m in mentions for s in m.cue_segments)),
        modifier_spans=tuple(
            sorted(
                (m.term_id, tuple(sorted((s.start, s.end) for s in m.segments)))
                for m in annotation.modifiers
            )
        ),
        standalone_modifier=roles.kind(annotation.layer_id, annotation.term_id)
        is not None,
        unresolved=unresolved,
        unresolved_note=unresolved_note,
    )


def label_rule(
    eligible: Sequence[Candidate],
    recorded_at: Mapping[str, datetime],
    inputs: Mapping[str, set[str]],
) -> tuple[LabelRule, str | None]:
    """VD16: accept one eligible submission, or the newest eligible one when
    it is a consolidation of all the other eligible submissions."""
    if len(eligible) == 1:
        return "accept", eligible[0].submission_id
    if eligible:
        newest = max(
            eligible,
            key=lambda item: (recorded_at[item.submission_id], item.submission_id),
        )
        others = {item.submission_id for item in eligible} - {newest.submission_id}
        if newest.consolidation_round is not None and others <= inputs.get(
            newest.consolidation_round, set()
        ):
            return "accept", newest.submission_id
    return "compare", None


def _recorded_at(
    conn: Connection, pid: int, submission_ids: Iterable[str]
) -> dict[str, datetime]:
    wanted = sorted(set(submission_ids))
    if not wanted:
        return {}
    return {
        row.submission_id: row.recorded_at
        for row in conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.recorded_at).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(wanted),
            )
        )
    }


def _payloads(
    conn: Connection, pid: int, submission_ids: Iterable[str], *, strict: bool = True
) -> dict[str, Submission]:
    """Stored submissions by ID; without ``strict`` a payload that does not
    decode is left out (the table then shows no match count for its row)."""
    wanted = sorted(set(submission_ids))
    if not wanted:
        return {}
    result: dict[str, Submission] = {}
    for row in conn.execute(
        select(SubmissionRow.submission_id, SubmissionRow.payload).where(
            SubmissionRow.project_id == pid,
            SubmissionRow.submission_id.in_(wanted),
        )
    ):
        try:
            result[row.submission_id] = Submission.model_validate(row.payload)
        except (DomainError, ValueError):
            if strict:
                raise
    return result


def _inputs(
    conn: Connection, pid: int, round_ids: Iterable[str]
) -> dict[str, set[str]]:
    """Input submissions per consolidation round (draft sources left out)."""
    wanted = sorted(set(round_ids))
    if not wanted:
        return {}
    result: dict[str, set[str]] = {}
    for row in conn.execute(
        select(RoundInputRow.round_id, RoundInputRow.source_submission_id).where(
            RoundInputRow.project_id == pid,
            RoundInputRow.round_id.in_(wanted),
            RoundInputRow.source_submission_id.is_not(None),
        )
    ):
        result.setdefault(row.round_id, set()).add(row.source_submission_id)
    return result


def project_profile(conn: Connection, pid: int) -> tuple[TaskProfile, AxisDefaults]:
    profile = TaskProfile.model_validate(
        conn.execute(
            select(ProjectRow.task_profile).where(ProjectRow.id == pid)
        ).scalar_one()
    )
    return profile, axis_defaults(
        # The pins on the caller's connection (as ``projects.service``).
        profile,
        Repository._pins(conn, pid),
    )


def project_roles(conn: Connection, pid: int, profile: TaskProfile) -> TermRoles:
    """Modifier roles of the project's ``hpo-phenotype`` layers (pins on the
    caller's connection; ontologies through the installed source, D-a)."""
    return term_roles(profile, Repository._pins(conn, pid))


def _agreement(
    comparable: Sequence[Candidate],
    recorded_at: Mapping[str, datetime],
    payloads: Mapping[str, Submission],
    profile: TaskProfile,
    defaults: AxisDefaults,
) -> Agreement | None:
    """``compare`` over the comparable submissions in submission order; None
    with fewer than two of them or when a payload does not decode."""
    if len(comparable) < 2 or any(
        item.submission_id not in payloads for item in comparable
    ):
        return None
    order = sorted(
        (item.submission_id for item in comparable),
        key=lambda sid: (recorded_at[sid], sid),
    )
    # ``compare`` ignores standalone modifiers: no roles (no ontology load).
    findings = {sid: findings_of(payloads[sid], profile, defaults) for sid in order}
    return compare(findings, order)


def _full_agreement(
    comparable: Sequence[Candidate],
    recorded_at: Mapping[str, datetime],
    payloads: Mapping[str, Submission],
    profile: TaskProfile,
    defaults: AxisDefaults,
    roles: ModifierRoles = NO_TERM_ROLES,
) -> list[str] | None:
    """The compared submissions in order when at least two are compared and
    every consolidation group is ``match`` (zero findings everywhere
    included); else None.

    The caller only asks under the label rule "compare"; a consolidation that
    covers only part of the compared submissions still hides W1 (X4). Without
    ``roles`` the answer stays the same: a standalone modifier only changes
    how groups that are no ``match`` anyway differ.
    """
    if (
        len(comparable) < 2
        or any(item.consolidation_round is not None for item in comparable)
        or any(item.submission_id not in payloads for item in comparable)
    ):
        return None
    order = sorted(
        (item.submission_id for item in comparable),
        key=lambda sid: (recorded_at[sid], sid),
    )
    findings = {
        sid: findings_of(payloads[sid], profile, defaults, roles) for sid in order
    }
    if any(group.kinds != {"match"} for group in groups(findings, order)):
        return None
    return order


# Kinds of a difference that leaves a finding matching in ``compare`` (same
# term, layer and context) but keeps its group from ``match`` (issue 230).
_DETAIL_KINDS: dict[str, str] = {
    "notes_differ": "note",
    "span_differs": "text",
    "modifiers_differ": "modifiers",
}
_CONTEXT_KINDS = frozenset({"partial", "term_differs", "values_differ", "unresolved"})


def _detail_differences(
    comparable: Sequence[Candidate],
    recorded_at: Mapping[str, datetime],
    payloads: Mapping[str, Submission],
    profile: TaskProfile,
    defaults: AxisDefaults,
    roles: ModifierRoles = NO_TERM_ROLES,
) -> list[dict[str, str]]:
    """Matching findings whose note, text span or modifier text still differs
    among the compared submissions (issue 230), one entry per finding and
    kind in reading order: ``{"kind", "layer_id", "term_id"}``. Empty with
    fewer than two compared submissions or a payload that does not decode.

    Groups that also differ in term or values, or that some submission lacks,
    are counted by the agreement already and left out.
    """
    if len(comparable) < 2 or any(
        item.submission_id not in payloads for item in comparable
    ):
        return []
    order = sorted(
        (item.submission_id for item in comparable),
        key=lambda sid: (recorded_at[sid], sid),
    )
    findings = {
        sid: findings_of(payloads[sid], profile, defaults, roles) for sid in order
    }
    by_key = {
        (sid, finding.key): finding for sid, own in findings.items() for finding in own
    }
    result: list[dict[str, str]] = []
    for group in groups(findings, order):
        if group.kinds & _CONTEXT_KINDS:
            continue
        first = by_key[(group.keep, group.members[group.keep])]
        for kind, name in _DETAIL_KINDS.items():
            if kind in group.kinds:
                result.append(
                    {"kind": name, "layer_id": first.layer_id, "term_id": first.term_id}
                )
    return result


def _all_match(
    comparable: Sequence[Candidate],
    recorded_at: Mapping[str, datetime],
    payloads: Mapping[str, Submission],
    profile: TaskProfile,
    defaults: AxisDefaults,
    submissions: Sequence[Mapping[str, Any]],
    roles: ModifierRoles = NO_TERM_ROLES,
) -> str | None:
    """Full agreement (W1, U7): the earliest eligible compared submission."""
    order = _full_agreement(comparable, recorded_at, payloads, profile, defaults, roles)
    eligible = {item["submission_id"] for item in submissions if item["eligible"]}
    return next((sid for sid in order or () if sid in eligible), None)


def _unresolved(
    payloads: Mapping[str, Submission],
    submission_ids: Iterable[str],
    profile: TaskProfile,
) -> list[dict[str, str | None]]:
    """Findings left Unresolved in these submissions (#246), one entry per
    person; the route fills ``term_label``."""
    return [
        {
            "submission_id": sid,
            "layer_id": finding.layer_id,
            "term_id": finding.term_id,
            "note": finding.unresolved_note,
        }
        for sid in submission_ids
        if sid in payloads
        for finding in findings_of(payloads[sid], profile)
        if finding.unresolved
    ]


def fill_agreement(
    conn: Connection, pid: int, ctx: _Context, page: dict[str, Any]
) -> None:
    """Fill ``label_rule`` of the Final cells of the page's rows in state
    ``choose`` and, where the rule is "compare", ``matching``/``compared``
    (one ``compare`` per row) and ``all_match`` (the card's full agreement).

    ``ctx`` is the context the page was built from. Runs after paging, so
    only the shown rows are compared.
    """
    rows = [
        (row, row_comparison(ctx, row["case_id"], row["language"]))
        for group in page["groups"]
        for row in group["rows"]
        if row["stages"]["final"]["state"] == "choose"
    ]
    if not rows:
        return
    # One eligible submission is accepted without a lookup.
    queried = [(row, item) for row, item in rows if len(item.eligible) != 1]
    recorded_at = _recorded_at(
        conn, pid, (c.submission_id for _, item in queried for c in item.eligible)
    )
    inputs = _inputs(
        conn,
        pid,
        (
            c.consolidation_round
            for _, item in queried
            for c in item.eligible
            if c.consolidation_round is not None
        ),
    )
    compared: list[tuple[dict[str, Any], RowComparison]] = []
    for row, item in rows:
        rule = label_rule(item.eligible, recorded_at, inputs)[0]
        detail = row["stages"]["final"]["detail"]
        detail["label_rule"] = rule
        if (
            rule == "compare"
            and len(item.comparable) >= 2
            and (detail.get("submitted") or 0) >= 2
        ):
            compared.append((row, item))
    if not compared:
        return
    payloads = _payloads(
        conn,
        pid,
        (c.submission_id for _, item in compared for c in item.comparable),
        strict=False,
    )
    profile, defaults = project_profile(conn, pid)
    for row, item in compared:
        agreement = _agreement(
            item.comparable, recorded_at, payloads, profile, defaults
        )
        if agreement is None:
            continue
        detail = row["stages"]["final"]["detail"]
        detail["matching"] = agreement.matching
        detail["compared"] = agreement.total
        detail["all_match"] = (
            _full_agreement(item.comparable, recorded_at, payloads, profile, defaults)
            is not None
        )


def _changed_passages(
    conn: Connection,
    pid: int,
    final: Mapping[str, Any] | None,
    comparison: RowComparison,
    profile: TaskProfile,
) -> int | None:
    """Findings of a final on old text whose evidence lies in changed passages
    of the newer text (the re-anchoring preview of "Carry to v2…"); None
    without such a final or when its payload does not decode."""
    if final is None:
        return None
    target = comparison.target_of.get(final["document_id"])
    if target is None or target.document_id == final["document_id"]:
        return None
    submission = _payloads(conn, pid, [final["submission_id"]], strict=False).get(
        final["submission_id"]
    )
    if submission is None:
        return None
    texts = {
        row.document_id: row.text
        for row in conn.execute(
            select(DocumentRow.document_id, DocumentRow.text).where(
                DocumentRow.project_id == pid,
                DocumentRow.document_id.in_([final["document_id"], target.document_id]),
            )
        )
    }
    unplaced = unplaced_findings(
        editable_findings(submission.snapshots, profile),
        texts[final["document_id"]],
        texts[target.document_id],
    )
    return findings_in_changed_passages(unplaced)


def _consolidation_origins(
    conn: Connection, pid: int, listed: Iterable[Mapping[str, Any]]
) -> dict[str, dict[str, int]]:
    """How the findings of each listed consolidation came about (#133):
    matched (taken over automatically), decided or added by the consolidator,
    plus the groups left out of the result (#248). Derived from the stored
    submission; one that does not decode has none."""
    rounds = {
        item["submission_id"]: item.get("round_id")
        for item in listed
        if item["kind"] == "consolidation"
    }
    origins = {
        sid: asdict(origin_counts(finding_origins(sub.snapshots, sub.decisions)))
        for sid, sub in _payloads(conn, pid, rounds, strict=False).items()
    }
    with_round = {sid: rid for sid, rid in rounds.items() if rid and sid in origins}
    decisions = stored_decisions(conn, pid, with_round)
    summaries = consolidation_summaries(
        conn, pid, {sid: (rid, decisions.get(sid)) for sid, rid in with_round.items()}
    )
    for sid, summary in summaries.items():
        origins[sid]["left_out"] = summary.left_out
    return origins


def final_panel(
    conn: Connection,
    facts: RowFacts,
    key: str,
    case_id: str,
    language: str,
) -> dict[str, Any]:
    """``FinalPanelView`` fields of row (case_id, language)."""
    pid = Repository._project_id(conn, key)
    if pid is None:  # the caller authorized the project
        raise DomainError("PROJECT_NOT_FOUND")
    listing = build_submissions(conn, key, pid, case_id, language, facts.viewer_user_id)
    ctx = page_context(facts)
    comparison = row_comparison(ctx, case_id, language)
    recorded_at = {
        item["submission_id"]: item["recorded_at"] for item in listing["submissions"]
    }
    inputs = _inputs(
        conn,
        pid,
        (
            item.consolidation_round
            for item in comparison.eligible
            if item.consolidation_round is not None
        ),
    )
    rule, accept_id = label_rule(comparison.eligible, recorded_at, inputs)
    comparable = comparison.comparable
    profile, defaults = project_profile(conn, pid)
    payloads = _payloads(
        conn, pid, (item.submission_id for item in comparable), strict=False
    )
    agreement = _agreement(comparable, recorded_at, payloads, profile, defaults)
    comparable_ids = {item.submission_id for item in comparable}
    origins = _consolidation_origins(conn, pid, listing["submissions"])
    own_not_selectable = bool(listing["adjudicator_not_annotator"])
    submissions = [
        {
            **item,
            "eligible": not (own_not_selectable and item["is_me"]),
            "comparable": item["submission_id"] in comparable_ids,
            "only_here": (
                agreement.only_here.get(item["submission_id"], 0)
                if agreement is not None and item["submission_id"] in comparable_ids
                else None
            ),
            "consolidation_origins": origins.get(item["submission_id"]),
        }
        for item in listing["submissions"]
    ]
    roles = project_roles(conn, pid, profile) if rule == "compare" else None
    all_match_id = (
        _all_match(
            comparable, recorded_at, payloads, profile, defaults, submissions, roles
        )
        if roles is not None
        else None
    )
    details = (
        _detail_differences(comparable, recorded_at, payloads, profile, defaults, roles)
        if roles is not None and agreement is not None
        else []
    )
    # What the panel offers as final, and a consolidation's inputs: the flags
    # stay visible to the lead accepting it.
    listed = [
        item
        for item in listing["submissions"]
        if item["is_latest_in_round"] is not False
    ]
    consolidated = _inputs(
        conn,
        pid,
        (item["round_id"] for item in listed if item["kind"] == "consolidation"),
    )
    flagged = sorted(
        {item["submission_id"] for item in listed}.union(*consolidated.values())
    )
    unresolved = _unresolved(
        {
            **_payloads(conn, pid, set(flagged) - set(payloads), strict=False),
            **payloads,
        },
        flagged,
        profile,
    )
    row = build_row(facts, case_id, language, ctx=ctx)
    causes = [
        item
        for item in [*row["issues"], *row["notes"]]
        if item["code"] in rules.ACKNOWLEDGEABLE
    ]
    return {
        "submissions": submissions,
        "agreement": (
            None
            if agreement is None or comparison.compared is None
            else {
                "compared_version": comparison.compared.version,
                "total": agreement.total,
                "matching": agreement.matching,
                "context_differences": agreement.context_differences,
                "detail_differences": details,
            }
        ),
        "label_rule": rule,
        "accept_submission_id": accept_id,
        "all_match": all_match_id is not None,
        "all_match_submission_id": all_match_id,
        "unresolved": unresolved,
        "causes": causes,
        "changed_passages": _changed_passages(
            conn, pid, row["final"], comparison, profile
        ),
    }
