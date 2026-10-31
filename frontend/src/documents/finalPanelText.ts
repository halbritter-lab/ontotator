/**
 * Copy and pure rules of the final-result side panel (documents overview spec "Final-result panel",
 * "Copy › Panel", V6, V9, VD16, VD17).
 */
import type { AgreementView, DecisionBarView, DocumentRowView, DocumentRowsPage, FinalPanelSubmissionView, FinalPanelView, NextStepView } from "../api/client";
import { plural } from "../app/labels";
import { formatTime } from "../app/submissionLabels";
import { versionName } from "./labels";
import { leadSteps } from "./nextStepLabels";
import { rowKeyOf } from "./RowCells";
import { roundName, submissionVersion } from "./SubmissionsTable";
import type { ConsolidationInput, ConsolidationStarted } from "../variants/ConsolidationLauncher";
import type { Route } from "../app/router";

/**
 * Toast after the panel started a consolidation: the lead consolidating themselves gets "Open consolidation"
 * (their new task) and, when it was just granted, the Consolidator role sentence.
 */
export function consolidationStartedToast(name: string, assignmentId: number, started: ConsolidationStarted): { message: string; actionLabel?: string; route?: Route } {
  const message = `Consolidation started for ${name}.`;
  if (!started.self) return { message };
  return {
    message: started.roleGranted ? `${message} You now have the Consolidator role for this project.` : message,
    actionLabel: "Open consolidation",
    route: { name: "task", assignmentId },
  };
}

/** Panel actions of a row: "Accept result…" / "Compare results…" and "Review changes…". */
export const PANEL_ACTIONS: ReadonlySet<string> = new Set(["choose_final", "review_changes"]);

/** The step that opens the panel for a row (choose before review, in the server's order). */
export function panelStep(row: Pick<DocumentRowView, "next_step" | "steps">): NextStepView | null {
  return leadSteps(row).find(step => step.action != null && PANEL_ACTIONS.has(step.action)) ?? null;
}

/** Annotate work of the row's current versions (not moved to a newer one). */
function currentAnnotateWork(row: Pick<DocumentRowView, "work">): DocumentRowView["work"] {
  return (row.work ?? []).filter(item => item.task === "annotate" && item.moved_to_version == null);
}

/** Annotate assignments not submitted yet (open, in progress, reopened or paused). */
export function openAnnotateWork(row: Pick<DocumentRowView, "work">): DocumentRowView["work"] {
  return currentAnnotateWork(row).filter(item => item.status !== "submitted");
}

/**
 * "Annotators per text" is an upper limit (issue 123): once one annotation is submitted the lead may accept a
 * result (or consolidate) while other annotations are still open. True for a row without a final whose annotate
 * work is partly submitted and partly open, outside a running consolidation.
 */
export function earlyFinal(row: Pick<DocumentRowView, "work" | "final" | "stages">): boolean {
  if (row.final || row.stages?.annotation.state === "consolidating") return false;
  const work = currentAnnotateWork(row);
  return work.some(item => item.status === "submitted") && work.some(item => item.status !== "submitted");
}

/** Content of the panel: "review" for "Review changes…", else "choose". */
export function panelMode(row: Pick<DocumentRowView, "next_step" | "steps">): "choose" | "review" {
  return panelStep(row)?.action === "review_changes" ? "review" : "choose";
}

/** The submission's person as copy: the display name, else the pseudonym (no codes beside a name). */
export function personName(submission: Pick<FinalPanelSubmissionView, "author" | "author_label">): string {
  return submission.author?.display_name?.trim() || submission.author?.pseudonym || submission.author_label;
}

/** Consolidation inputs with a visible name "Ana Weber, Round 1, 21 Oct, 11:25" (no submission or round codes). */
export function consolidationInputs(submissions: readonly (Pick<FinalPanelSubmissionView, "submission_id" | "document_id" | "author" | "author_label" | "recorded_at" | "mode" | "round_id" | "round_ordinal" | "kind" | "guideline_version" | "guideline_withdrawn">)[], now?: Date): ConsolidationInput[] {
  return submissions.map(item => ({
    submission_id: item.submission_id, document_id: item.document_id, author_label: item.author_label, created_at: item.recorded_at,
    mode: item.mode, round_id: item.round_id, guideline_version: item.guideline_version ?? null, guideline_withdrawn: item.guideline_withdrawn,
    label: `${personName(item)}, ${roundName(item)}, ${formatTime(item.recorded_at, { now })}`,
  }));
}

/** A submission's name in the block: the person, or "Consolidated by Ana Weber" for a consolidation (X4). */
export function submissionName(submission: Pick<FinalPanelSubmissionView, "kind" | "author" | "author_label" | "is_me">): string {
  if (submission.kind === "consolidation") return `Consolidated by ${submission.is_me ? "you" : personName(submission)}`;
  return personName(submission);
}

/**
 * How a consolidation came about (#133): "6 matching, 2 decided by Carla", plus "1 added by Carla" for findings
 * added outside the groups; null for other submissions and a consolidation without findings.
 */
export function consolidationBreakdown(submission: Pick<FinalPanelSubmissionView, "kind" | "author" | "author_label" | "is_me" | "consolidation_origins">): string | null {
  const origins = submission.kind === "consolidation" ? submission.consolidation_origins : null;
  if (!origins) return null;
  const who = submission.is_me ? "you" : personName(submission).split(" ")[0];
  const parts = [
    origins.matched > 0 ? `${origins.matched} matching` : null,
    origins.decided > 0 ? `${origins.decided} decided by ${who}` : null,
    origins.added > 0 ? `${origins.added} added by ${who}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(", ") : null;
}

/** Full agreement (W1): "All findings match (4 of 4)"; no findings: "Both submissions have no findings" / "No submission has findings". */
export function allMatchText(submissions: number, findings: number): string {
  if (findings > 0) return `All findings match (${findings} of ${findings})`;
  return submissions === 2 ? "Both submissions have no findings" : "No submission has findings";
}

/**
 * Hint of "Consolidate…": "Resolve the 2 differences together" ("the 1 difference"); without a count none. A note,
 * text span or modifier text that differs on a matching finding counts as one difference each (issue 230).
 */
export function consolidateHint(agreement: AgreementView | null): string | null {
  if (!agreement) return null;
  const differences = agreement.total - agreement.matching + (agreement.detail_differences?.length ?? 0);
  if (differences <= 0) return null;
  return `Resolve the ${differences} ${differences === 1 ? "difference" : "differences"} together`;
}

/** "Final, Consolidation, Ana Weber" (the decided panel's line). */
export function decidedLine(submission: Pick<FinalPanelSubmissionView, "kind" | "author" | "author_label" | "is_me">): string {
  return `Final, ${submission.kind === "consolidation" ? "Consolidation" : "Annotation"}, ${submission.is_me ? "You" : personName(submission)}`;
}

/** "Accept Ana Weber’s annotation as the result?" / "Accept this consolidation as the result?" (under "Consolidated by …"). */
export function acceptQuestion(submission: FinalPanelSubmissionView): string {
  if (submission.kind === "consolidation") return submission.is_me ? "Accept your consolidation as the result?" : "Accept this consolidation as the result?";
  return submission.is_me ? "Accept your annotation as the result?" : `Accept ${personName(submission)}’s annotation as the result?`;
}

/** "Round 1, 3 findings, submitted 20 Oct, 12:01, on de v1" (the compact choice's line, without the link). */
export function submissionLine(submission: FinalPanelSubmissionView, language: string, parallel: boolean, now?: Date): string {
  return [
    roundName(submission),
    plural(submission.finding_count, "finding"),
    `submitted ${formatTime(submission.recorded_at, { now })}`,
    `on ${language} ${submissionVersion(submission.version, submission.chain_name, parallel)}`,
  ].join(", ");
}

/** "Round 1, 20 Oct, 12:01" (second line of a compare row). */
export function submissionWhen(submission: FinalPanelSubmissionView, now?: Date): string {
  return `${roundName(submission)}, ${formatTime(submission.recorded_at, { now })}`;
}

/**
 * Submissions the panel lists: the latest submission of every round (older submissions of a revised
 * round are history), in server order.
 */
export function listedSubmissions(submissions: readonly FinalPanelSubmissionView[]): FinalPanelSubmissionView[] {
  return submissions.filter(item => item.is_latest_in_round !== false);
}

/**
 * "2 annotations submitted on v1, 6 findings in total". With an agreement the compared submissions
 * and the agreement's finding count (the union of matched and unmatched findings); without one the
 * listed submissions and the sum of their findings on the newest version among them.
 */
export function compareSummary(submissions: readonly FinalPanelSubmissionView[], agreement: AgreementView | null): string {
  if (agreement) {
    const compared = submissions.filter(item => item.comparable).length;
    return `${plural(compared, "annotation")} submitted on v${agreement.compared_version}, ${plural(agreement.total, "finding")} in total`;
  }
  const newest = Math.max(0, ...submissions.map(item => item.version));
  const findings = submissions.reduce((sum, item) => sum + item.finding_count, 0);
  return `${plural(submissions.length, "annotation")} submitted on v${newest}, ${plural(findings, "finding")} in total`;
}

/** "Agreement: 4 of 6 findings match" plus ", 1 differs in context only" when any differ. */
export function agreementText(agreement: AgreementView): string {
  const base = `Agreement: ${agreement.matching} of ${agreement.total} findings match`;
  const context = agreement.context_differences;
  if (context <= 0) return base;
  return `${base}, ${context} ${context === 1 ? "differs" : "differ"} in context only`;
}

const DETAIL_TEXT: Record<string, string> = { note: "Notes differ", text: "Text spans differ", modifiers: "Modifier text spans differ" };

/**
 * Issue 230: matching findings that still differ in a detail, one line per kind with the findings' terms:
 * "Notes differ on 1 finding: Ataxia". Empty when nothing differs; then the agreement line says everything.
 */
export function detailDifferenceLines(agreement: AgreementView): string[] {
  const byKind = new Map<string, string[]>();
  for (const item of agreement.detail_differences ?? []) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.term_label]);
  return Object.keys(DETAIL_TEXT).filter(kind => byKind.has(kind)).map(kind => {
    const terms = byKind.get(kind)!;
    return `${DETAIL_TEXT[kind]} on ${plural(terms.length, "finding")}: ${terms.join(", ")}`;
  });
}

/**
 * #246: one line per finding (layer and term) annotators marked Unresolved, with every person's note:
 * "Pallor, Ana Weber: Pale or just tired?; Tom Reis: no note". `submissionId`: only that submission's.
 */
export function unresolvedLines(panel: Pick<FinalPanelView, "submissions" | "unresolved">, submissionId?: string): string[] {
  const byFinding = new Map<string, { term: string; notes: string[] }>();
  for (const item of panel.unresolved ?? []) {
    if (submissionId && item.submission_id !== submissionId) continue;
    const submission = panel.submissions?.find(entry => entry.submission_id === item.submission_id);
    const key = `${item.layer_id} ${item.term_id}`;
    const entry = byFinding.get(key) ?? { term: item.term_label, notes: [] };
    entry.notes.push(`${submission ? personName(submission) : "An annotator"}: ${item.note?.trim() || "no note"}`);
    byFinding.set(key, entry);
  }
  return [...byFinding.values()].map(({ term, notes }) => `${term}, ${notes.join("; ")}`);
}

/** One paragraph on V9 behind "How is this counted?". */
export const AGREEMENT_EXPLANATION = "Two findings match when they are in the same layer, have the same term and the same context "
  + "(every axis value and the set of modifiers), and their evidence overlaps by at least one character or both have no evidence "
  + "in the text. Same term and position with a different context counts as a context difference. Each finding pairs with at most "
  + "one finding of each other submission; only submissions on the same text version are compared. "
  + "Modifier text spans do not count here. “All findings match” also needs the same text spans, notes and modifier text spans. "
  + "A finding an annotator left Unresolved never counts as a match.";

/** The Only here cell: the count, "on v1, not compared" for a submission outside the comparison, else "—". */
export function onlyHereText(submission: FinalPanelSubmissionView, parallel: boolean): string {
  if (!submission.comparable) return `on ${submissionVersion(submission.version, submission.chain_name, parallel)}, not compared`;
  return submission.only_here == null ? "—" : String(submission.only_here);
}

/** "Final result saved for case-107 de." */
export function savedText(caseId: string, language: string): string {
  return `Final result saved for ${caseId} ${language}.`;
}

/** What is left after a decision, as the Needs your decision tab counts it: "2 more need your decision." / "Nothing else needs your decision." */
export function remainingText(after: DecisionBarView): string {
  const left = after.needs_decision ?? 0;
  return left ? `${left} more ${left === 1 ? "needs" : "need"} your decision.` : "Nothing else needs your decision.";
}

/** No next final decision on this page: for the project only if the page shows every row or no decision is left. */
export function noMoreFinalsText(page: DocumentRowsPage): string {
  const shown = page.groups.reduce((sum, group) => sum + group.rows.length, 0);
  return shown < page.bar.all && (page.bar.needs_decision ?? 0) > 0 ? "No more final results to decide in this view." : "No more final results to decide.";
}

/** Short kind of a decision for "Next decision: case-109 de (problem report)". */
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
