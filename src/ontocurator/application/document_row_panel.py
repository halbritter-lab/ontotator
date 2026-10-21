"""Final-result panel of one Documents row and the Final cell's agreement.

Documents overview spec V6, V9, VD16, "Final-result panel" and "Agreement and
panel data (WP O3)". Runs on the caller's connection: the caller
(``DocumentRowsService``) has authorized the lead under the shared project
lock and loaded the row facts. Nothing is stored; the agreement is computed
per request from the submission snapshots with the pure ``domain/agreement``.

*Eligible* (VD16; the Final cell's "{n} submissions") is the set the Final
cell counts in ``document_row_stages.stage_facts``: the last submission of
each submitted annotate assignment on the row's target version that was not
carried, moved or handed over, and the latest submission of each submitted
consolidation round on the target. The panel compares the eligible
submissions of one target version (the *compared version*). The panel's
per-submission ``eligible`` flag instead says whether the lead may use the
submission as final (``OWN_RESULT_NOT_SELECTABLE``); submissions on other
versions stay selectable.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import Connection, select

from ontocurator.application.document_row_page import build_row
from ontocurator.application.document_row_stages import (
    _NOT_ELIGIBLE as NOT_ELIGIBLE,
)
from ontocurator.application.document_row_submissions import build_submissions
from ontocurator.domain import document_rows as rules
from ontocurator.domain.agreement import Agreement, Finding, compare, with_defaults
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.reanchor import NeedsReview, reanchor_annotation, text_map
from ontocurator.domain.workspace import Submission
from ontocurator.projects.service import axis_defaults
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import DocumentRow, ProjectRow, SubmissionRow
from ontocurator.storage.workflow_tables import RoundInputRow

if TYPE_CHECKING:  # document_rows imports this module
    from ontocurator.application.document_rows import RowFacts

LabelRule = Literal["accept", "compare"]
# Re-anchoring reasons of a finding in a changed passage (as the text-change
# preview counts "in changed passages").
_CHANGED_REASONS = frozenset({"changed_segment", "changed_cue"})
AxisDefaults = Mapping[str, Mapping[str, str]]


@dataclass(frozen=True)
class Candidate:
    """An eligible submission (VD16) of a row."""

    submission_id: str
    document_id: str
    # The consolidation round the submission belongs to (None: annotation).
    consolidation_round: str | None = None


@dataclass(frozen=True)
class RowComparison:
    """Targets, eligible submissions and the compared version of one row."""

    targets: tuple[rules.Version, ...]
    # Live version -> the target version of its root.
    target_of: Mapping[str, rules.Version]
    eligible: tuple[Candidate, ...]
    compared: rules.Version | None

    @property
    def comparable(self) -> tuple[Candidate, ...]:
        if self.compared is None:
            return ()
        wanted = self.compared.document_id
        return tuple(item for item in self.eligible if item.document_id == wanted)


class _Index:
    """Project-wide lookups of the row facts, built once per request."""

    def __init__(self, facts: RowFacts) -> None:
        self.facts = facts
        self.versions: dict[tuple[str, str], list[rules.Version]] = {}
        for version in facts.versions:
            self.versions.setdefault((version.case_id, version.language), []).append(
                version
            )
        self.assignments: dict[str, list[rules.AssignmentFact]] = {}
        for item in facts.assignments:
            self.assignments.setdefault(item.document_id, []).append(item)
        self.rounds = {item.round_id: item for item in facts.rounds}
        # As ``document_row_page._Context``: the last resolution per
        # assignment, every resolution per submission.
        self.resolution_of: dict[int, str] = {}
        self.submission_resolutions: dict[str, set[str]] = {}
        for resolution in facts.resolutions:
            if resolution.assignment_id is not None:
                self.resolution_of[resolution.assignment_id] = resolution.resolution
            if resolution.submission_id is not None:
                self.submission_resolutions.setdefault(
                    resolution.submission_id, set()
                ).add(resolution.resolution)

    def _annotation(self, item: rules.AssignmentFact) -> Candidate | None:
        if self.resolution_of.get(item.assignment_id) in NOT_ELIGIBLE:
            return None
        submission = self.facts.last_submissions.get(item.assignment_id)
        if submission is None:
            return None
        if self.submission_resolutions.get(submission, set()) & NOT_ELIGIBLE:
            return None
        return Candidate(submission, item.document_id)

    def _consolidation(self, item: rules.AssignmentFact) -> Candidate | None:
        round_fact = self.rounds.get(item.active_round_id or "")
        if (
            round_fact is None
            or round_fact.kind != "consolidation"
            or round_fact.latest_submission_id is None
        ):
            return None
        return Candidate(
            round_fact.latest_submission_id, item.document_id, round_fact.round_id
        )

    def row(self, case_id: str, language: str) -> RowComparison:
        versions = self.versions.get((case_id, language), [])
        live = [
            chain
            for chain in rules.build_chains(versions)
            if not any(v.document_id in self.facts.discarded for v in chain.versions)
        ]
        target_of: dict[str, rules.Version] = {}
        targets: list[rules.Version] = []
        for chain in live:
            target = [v for v in chain.versions if not v.not_newer][-1]
            targets.append(target)
            for version in chain.versions:
                target_of[version.document_id] = target
        per_target: list[list[Candidate]] = []
        for target in targets:
            found: list[Candidate] = []
            for item in self.assignments.get(target.document_id, []):
                if item.revoked or item.status != "submitted" or item.held:
                    continue
                if item.task == "annotate":
                    candidate = self._annotation(item)
                elif item.task == "review":
                    candidate = self._consolidation(item)
                else:
                    candidate = None
                if candidate is not None and all(
                    other.submission_id != candidate.submission_id for other in found
                ):
                    found.append(candidate)
            per_target.append(found)
        # Parallel roots: the target with the most eligible submissions,
        # the first root on a tie.
        compared = None
        best = -1
        for target, found in zip(targets, per_target, strict=True):
            if len(found) > best:
                compared, best = target, len(found)
        return RowComparison(
            targets=tuple(targets),
            target_of=target_of,
            eligible=tuple(item for found in per_target for item in found),
            compared=compared,
        )


def findings_of(
    submission: Submission,
    profile: TaskProfile,
    defaults: AxisDefaults | None = None,
) -> list[Finding]:
    """The findings of a submission: its snapshots in editable layers.

    Axis values are filled with the layer's defaults (``axis_defaults``);
    modifiers are not part of the annotation model, so every finding has an
    empty modifier set. A finding without evidence is spanless.
    """
    editable = {
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    }
    defaults = defaults or {}
    result: list[Finding] = []
    for order, item in enumerate(submission.snapshots):
        annotation = item.annotation
        if annotation.layer_id not in editable:
            continue
        refs = {(ref.evidence_id, ref.version) for ref in annotation.evidence_refs}
        spans = tuple(
            sorted(
                (segment.start, segment.end)
                for evidence in item.evidence
                if (evidence.mention.evidence_id, evidence.version) in refs
                for segment in evidence.mention.segments
            )
        )
        result.append(
            Finding(
                key=annotation.annotation_id,
                layer_id=annotation.layer_id,
                term_id=annotation.term_id,
                axes=with_defaults(
                    annotation.axes_values, defaults.get(annotation.layer_id, {})
                ),
                modifiers=frozenset(),
                spans=spans,
                order=order,
            )
        )
    return result


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


def _profile(
    conn: Connection, repo: Repository, pid: int
) -> tuple[TaskProfile, AxisDefaults]:
    profile = TaskProfile.model_validate(
        conn.execute(
            select(ProjectRow.task_profile).where(ProjectRow.id == pid)
        ).scalar_one()
    )
    return profile, axis_defaults(profile, repo._pins(conn, pid))


def _agreement(
    comparable: Sequence[Candidate],
    recorded_at: Mapping[str, datetime],
    payloads: Mapping[str, Submission],
    profile: TaskProfile,
    defaults: AxisDefaults,
) -> Agreement | None:
    """``compare`` over the comparable submissions in submission order."""
    if len(comparable) < 2:
        return None
    order = sorted(
        (item.submission_id for item in comparable),
        key=lambda sid: (recorded_at[sid], sid),
    )
    findings = {sid: findings_of(payloads[sid], profile, defaults) for sid in order}
    return compare(findings, order)


def fill_agreement(
    conn: Connection,
    repo: Repository,
    pid: int,
    facts: RowFacts,
    page: dict[str, Any],
) -> None:
    """Fill ``matching``/``compared`` of the Final cells of the page's rows in
    state ``choose`` whose label rule is "compare" (one ``compare`` per row).

    Runs after paging, so only the shown rows are compared.
    """
    rows = [
        row
        for group in page["groups"]
        for row in group["rows"]
        if row["stages"]["final"]["state"] == "choose"
        and (row["stages"]["final"]["detail"].get("submitted") or 0) >= 2
    ]
    if not rows:
        return
    index = _Index(facts)
    comparisons = [index.row(row["case_id"], row["language"]) for row in rows]
    candidates = [
        (row, item)
        for row, item in zip(rows, comparisons, strict=True)
        if len(item.comparable) >= 2
    ]
    if not candidates:
        return
    recorded_at = _recorded_at(
        conn,
        pid,
        (c.submission_id for _, item in candidates for c in item.eligible),
    )
    inputs = _inputs(
        conn,
        pid,
        (
            c.consolidation_round
            for _, item in candidates
            for c in item.eligible
            if c.consolidation_round is not None
        ),
    )
    compared = [
        (row, item)
        for row, item in candidates
        if label_rule(item.eligible, recorded_at, inputs)[0] == "compare"
    ]
    if not compared:
        return
    payloads = _payloads(
        conn,
        pid,
        (c.submission_id for _, item in compared for c in item.comparable),
        strict=False,
    )
    profile, defaults = _profile(conn, repo, pid)
    for row, item in compared:
        if any(c.submission_id not in payloads for c in item.comparable):
            continue
        agreement = _agreement(
            item.comparable, recorded_at, payloads, profile, defaults
        )
        if agreement is None:
            continue
        detail = row["stages"]["final"]["detail"]
        detail["matching"] = agreement.matching
        detail["compared"] = agreement.total


def _changed_passages(
    conn: Connection,
    pid: int,
    final: Mapping[str, Any] | None,
    comparison: RowComparison,
    profile: TaskProfile,
) -> int | None:
    """Findings of a final on old text whose evidence lies in changed passages
    of the newer text (the re-anchoring preview of "Carry to v2…")."""
    if final is None:
        return None
    target = comparison.target_of.get(final["document_id"])
    if target is None or target.document_id == final["document_id"]:
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
    submission = _payloads(conn, pid, [final["submission_id"]]).get(
        final["submission_id"]
    )
    if submission is None:
        return None
    old, new = texts[final["document_id"]], texts[target.document_id]
    mapping = text_map(old, new)
    editable = {
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    }
    count = 0
    for item in submission.snapshots:
        if item.annotation.layer_id not in editable:
            continue
        mapped = reanchor_annotation(item, item.evidence, old, new, mapping)
        if isinstance(mapped, NeedsReview) and mapped.reason in _CHANGED_REASONS:
            count += 1
    return count


def final_panel(
    conn: Connection,
    repo: Repository,
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
    comparison = _Index(facts).row(case_id, language)
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
    profile, defaults = _profile(conn, repo, pid)
    agreement = _agreement(
        comparable,
        recorded_at,
        _payloads(conn, pid, (item.submission_id for item in comparable)),
        profile,
        defaults,
    )
    comparable_ids = {item.submission_id for item in comparable}
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
        }
        for item in listing["submissions"]
    ]
    row = build_row(facts, case_id, language)
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
            }
        ),
        "label_rule": rule,
        "accept_submission_id": accept_id,
        "causes": causes,
        "changed_passages": _changed_passages(
            conn, pid, row["final"], comparison, profile
        ),
    }
