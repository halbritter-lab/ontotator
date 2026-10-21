/**
 * Copy and pure rules of the final-result side panel (documents overview spec "Final-result panel",
 * "Copy › Panel", V6, V9, VD16, VD17).
 */
import type { AgreementView, DecisionBarView, DocumentRowView, DocumentRowsPage, FinalPanelSubmissionView, NextStepView } from "../api/client";
import { plural } from "../app/labels";
import { formatTime } from "../app/submissionLabels";
import { decisionCategoryLabels, versionName } from "./labels";
import { leadSteps } from "./nextStepLabels";
import { rowKeyOf } from "./RowCells";
import { roundName, submissionVersion } from "./SubmissionsTable";
import type { ConsolidationInput } from "../variants/ConsolidationLauncher";

/** Panel actions of a row: "Accept result…" / "Compare results…" and "Review changes…". */
export const PANEL_ACTIONS: ReadonlySet<string> = new Set(["choose_final", "review_changes"]);

/** "Final result · case-107 · de" (the panel's `h2`). */
export function panelTitle(caseId: string, language: string): string {
  return `Final result · ${caseId} · ${language}`;
}

/** The step that opens the panel for a row (choose before review, in the server's order). */
export function panelStep(row: Pick<DocumentRowView, "next_step" | "steps">): NextStepView | null {
  return leadSteps(row).find(step => step.action != null && PANEL_ACTIONS.has(step.action)) ?? null;
}

/** Content of the panel: "review" for "Review changes…", else "choose". */
export function panelMode(row: Pick<DocumentRowView, "next_step" | "steps">): "choose" | "review" {
  return panelStep(row)?.action === "review_changes" ? "review" : "choose";
}

/** The submission's person as copy: the display name, else the pseudonym (no codes beside a name). */
export function personName(submission: Pick<FinalPanelSubmissionView, "author" | "author_label">): string {
  return submission.author?.display_name?.trim() || submission.author?.pseudonym || submission.author_label;
}

/** Consolidation inputs with a visible name "Ana Weber · Round 1 · 21 Oct, 11:25" (no submission or round codes). */
export function consolidationInputs(submissions: readonly (Pick<FinalPanelSubmissionView, "submission_id" | "document_id" | "author" | "author_label" | "recorded_at" | "mode" | "round_id" | "round_ordinal" | "kind" | "guideline_version" | "guideline_withdrawn">)[], now?: Date): ConsolidationInput[] {
  return submissions.map(item => ({
    submission_id: item.submission_id, document_id: item.document_id, author_label: item.author_label, created_at: item.recorded_at,
    mode: item.mode, round_id: item.round_id, guideline_version: item.guideline_version ?? null, guideline_withdrawn: item.guideline_withdrawn,
    label: `${personName(item)} · ${roundName(item)} · ${formatTime(item.recorded_at, { now })}`,
  }));
}

/** "Final · Consolidation · Ana Weber" (the decided panel's line). */
export function decidedLine(submission: Pick<FinalPanelSubmissionView, "kind" | "author" | "author_label" | "is_me">): string {
  return `Final · ${submission.kind === "consolidation" ? "Consolidation" : "Annotation"} · ${submission.is_me ? "You" : personName(submission)}`;
}

/** "Accept Ana Weber’s annotation as final?" / "Accept the consolidation by Luc Martin as final?" */
export function acceptQuestion(submission: FinalPanelSubmissionView): string {
  if (submission.kind === "consolidation") return submission.is_me ? "Accept your consolidation as final?" : `Accept the consolidation by ${personName(submission)} as final?`;
  return submission.is_me ? "Accept your annotation as final?" : `Accept ${personName(submission)}’s annotation as final?`;
}

/** "Round 1 · 3 findings · submitted 20 Oct, 12:01 · on de v1" (the compact choice's line, without the link). */
export function submissionLine(submission: FinalPanelSubmissionView, language: string, parallel: boolean, now?: Date): string {
  return [
    roundName(submission),
    plural(submission.finding_count, "finding"),
    `submitted ${formatTime(submission.recorded_at, { now })}`,
    `on ${language} ${submissionVersion(submission.version, submission.chain_name, parallel)}`,
  ].join(" · ");
}

/** "Round 1 · 20 Oct, 12:01" (second line of a compare row). */
export function submissionWhen(submission: FinalPanelSubmissionView, now?: Date): string {
  return `${roundName(submission)} · ${formatTime(submission.recorded_at, { now })}`;
}

/**
 * Submissions the panel lists: the latest submission of every round (older submissions of a revised
 * round are history), in server order.
 */
export function listedSubmissions(submissions: readonly FinalPanelSubmissionView[]): FinalPanelSubmissionView[] {
  return submissions.filter(item => item.is_latest_in_round !== false);
}

/**
 * "2 annotations submitted on v1 · 6 findings in total". With an agreement the compared submissions
 * and the agreement's finding count (the union of matched and unmatched findings); without one the
 * listed submissions and the sum of their findings on the newest version among them.
 */
export function compareSummary(submissions: readonly FinalPanelSubmissionView[], agreement: AgreementView | null): string {
  if (agreement) {
    const compared = submissions.filter(item => item.comparable).length;
    return `${plural(compared, "annotation")} submitted on v${agreement.compared_version} · ${plural(agreement.total, "finding")} in total`;
  }
  const newest = Math.max(0, ...submissions.map(item => item.version));
  const findings = submissions.reduce((sum, item) => sum + item.finding_count, 0);
  return `${plural(submissions.length, "annotation")} submitted on v${newest} · ${plural(findings, "finding")} in total`;
}

/** "Agreement: 4 of 6 findings match" plus " · 1 differs in context only" when any differ. */
export function agreementText(agreement: AgreementView): string {
  const base = `Agreement: ${agreement.matching} of ${agreement.total} findings match`;
  const context = agreement.context_differences;
  if (context <= 0) return base;
  return `${base} · ${context} ${context === 1 ? "differs" : "differ"} in context only`;
}

/** One paragraph on V9 behind "How is this counted?". */
export const AGREEMENT_EXPLANATION = "Two findings match when they are in the same layer, have the same term and the same context "
  + "(every axis value and the set of modifiers), and their evidence overlaps by at least one character or both have no evidence "
  + "in the text. Same term and position with a different context counts as a context difference. Each finding pairs with at most "
  + "one finding of each other submission; only submissions on the same text version are compared.";

/** The Only here cell: the count, "on v1 · not compared" for a submission outside the comparison, else "—". */
export function onlyHereText(submission: FinalPanelSubmissionView, parallel: boolean): string {
  if (!submission.comparable) return `on ${submissionVersion(submission.version, submission.chain_name, parallel)} · not compared`;
  return submission.only_here == null ? "—" : String(submission.only_here);
}

/** "Final result saved for case-107 · de." */
export function savedText(caseId: string, language: string): string {
  return `Final result saved for ${caseId} · ${language}.`;
}

const BAR_COUNTS: readonly (readonly [keyof DecisionBarView, string])[] = [
  ["total", "Needs your decision"],
  ["report_or_pause", decisionCategoryLabels["report-or-pause"]],
  ["confirm_final", decisionCategoryLabels["confirm-final"]],
  ["translation", decisionCategoryLabels.translation],
  ["missing_final", decisionCategoryLabels["missing-final"]],
];

/** Changed bar counts after a decision: "Needs your decision: 3 → 2 · Final result to confirm: 1 → 0". */
export function barArrows(before: DecisionBarView, after: DecisionBarView): string {
  return BAR_COUNTS.filter(([field]) => before[field] !== after[field])
    .map(([field, label]) => `${label}: ${String(before[field])} → ${String(after[field])}`).join(" · ");
}

/** Short kind of a decision for "Next decision: case-109 · de (problem report)". */
export function decisionKind(step: NextStepView): string {
  switch (step.action) {
    case "decide_report":
    case "resume_task": return "problem report";
    case "plan": return "plan";
    case "resolve":
    case "accept_or_review": return "translation";
    case "handle_text_change":
    case "carry_text_change": return "text change";
    case "assign_source_review": return "source change";
    case "assign_translation_review":
    case "assign_annotation": return "assignment";
    default: return "decision";
  }
}

export interface NextRow { row: DocumentRowView; step: NextStepView }

/** Rows of the page in list order, starting after `afterKey` and wrapping around; `afterKey` itself is skipped. */
function rowsAfter(page: DocumentRowsPage, afterKey: string): DocumentRowView[] {
  const rows = page.groups.flatMap(group => group.rows);
  const index = rows.findIndex(row => rowKeyOf(row) === afterKey);
  const ordered = index < 0 ? rows : [...rows.slice(index + 1), ...rows.slice(0, index)];
  return ordered.filter(row => rowKeyOf(row) !== afterKey);
}

/** VD17: the next row in list order whose next decision is choosing or confirming a final result. */
export function nextFinalDecision(page: DocumentRowsPage, afterKey: string): NextRow | null {
  for (const row of rowsAfter(page, afterKey)) {
    const step = panelStep(row);
    if (step) return { row, step };
  }
  return null;
}

/** VD17 with no final decision left: the next row with another lead decision ("Next decision: … (kind)"). */
export function nextOtherDecision(page: DocumentRowsPage, afterKey: string): NextRow | null {
  for (const row of rowsAfter(page, afterKey)) {
    const step = leadSteps(row).find(entry => entry.kind === "decision" && entry.action != null && !PANEL_ACTIONS.has(entry.action));
    if (step) return { row, step };
  }
  return null;
}

/** "Keep final on v1" (the final's version). */
export function keepLabel(row: DocumentRowView): string {
  const final = row.final;
  return `Keep final on ${final ? versionName(final.version ?? 1, final.chain_name ?? "", row.parallel_roots) : "this version"}`;
}

/** "The text changed from v1 to v2 after this final was chosen." */
export function textChangedLine(from: string, to: string): string {
  return `The text changed from ${from} to ${to} after this final was chosen.`;
}

/** "{k} findings are in changed passages" ("1 finding is in changed passages"). */
export function changedPassagesText(count: number): string {
  return count === 1 ? "1 finding is in changed passages" : `${count} findings are in changed passages`;
}
