/** Documents-only label rules. Shared submission and time helpers are re-exported for convenience. */
import { labelFor, plural } from "../app/labels";
import { personLabel } from "../app/submissionLabels";
import { originLabels, translationStatusLabels } from "../admin/variantMetadata";

export { formatTime, fullTimestamp, kindLabels, personLabel, roundCell, submissionLabel } from "../app/submissionLabels";
export type { FormatTimeOptions, SubmissionKind, SubmissionLabelInput, SubmissionLabelOptions } from "../app/submissionLabels";

/** Keeps both ends of a long ID: "case-2026-10-19-0211" -> "case-…-0211" (max 12). The full value belongs in `title`. */
export function middleEllipsis(value: string, max: number): string {
  if (value.length <= max) return value;
  const side = Math.max(1, Math.floor((max - 1) / 2));
  return `${value.slice(0, side)}…${value.slice(value.length - side)}`;
}

/** One wording for rows outside the plan everywhere in the row panel and its entries (acceptance fixes X14). */
export const NOT_PLANNED = "Not planned";

/** Latest translation review decision of a version (`translation_reviews.decision`). */
export type ReviewDecision = string;

/** Version badge text: the review decision where relevant, else the translation status. Null for native chains. */
export function statusBadgeText(status: string | null | undefined, decision: ReviewDecision | null | undefined, acceptedWithoutReview: boolean): string | null {
  if (acceptedWithoutReview) return "Accepted without review";
  if (!status) return null;
  if (status === "reviewed" && decision === "rejected") return "Rejected in review";
  if (status === "reviewed" && decision === "query") return "Queried";
  return labelFor(translationStatusLabels, status);
}

export interface VersionTextInput {
  version: number;
  origin: string;
  /** Version number this correction derives from; null for roots. */
  derivedVersion: number | null;
  status: string | null;
  decision: ReviewDecision | null;
  chainName: string;
  /** The row has parallel roots: versions are written "{chain name} v{n}". */
  parallel: boolean;
  acceptedWithoutReview?: boolean;
}

/** "v{n}" for single-chain rows, "{chain name} v{n}" with parallel roots. */
export function versionName(version: number, chainName: string, parallel: boolean): string {
  return parallel ? `${chainName} v${version}` : `v${version}`;
}

/** "v3, Correction of v2, Ready for review"; "DeepL v3 v1, Machine translation, Rejected in review". */
export function versionText(input: VersionTextInput): string {
  const origin = input.origin === "correction" && input.derivedVersion != null
    ? `Correction of ${versionName(input.derivedVersion, input.chainName, input.parallel)}`
    : labelFor(originLabels, input.origin);
  const badge = statusBadgeText(input.status, input.decision, input.acceptedWithoutReview ?? false);
  return [versionName(input.version, input.chainName, input.parallel), origin, badge].filter(Boolean).join(", ");
}

export type DecisionCategory = "report-or-pause" | "confirm-final" | "translation" | "missing-final";

/** Bar categories in display order. */
export const decisionCategoryLabels: Readonly<Record<DecisionCategory, string>> = {
  "report-or-pause": "Problem report or paused task",
  "confirm-final": "Final result to confirm",
  translation: "Translation rejected or queried",
  "missing-final": "Final result missing",
};

const lowerFirst = (text: string): string => (text ? text[0].toLowerCase() + text.slice(1) : text);

/**
 * Accessible label of the Issues cell, grouped by category:
 * "2 issues: problem report or paused task 1; final result to confirm 1. 1 note: source text changed".
 * Notes are keyed by their row wording; a note with count 1 omits the count.
 */
export function issueAriaLabel(issues: Partial<Record<DecisionCategory, number>>, notes: Readonly<Record<string, number>>): string {
  const issueEntries = (Object.keys(decisionCategoryLabels) as DecisionCategory[])
    .map(category => [category, issues[category] ?? 0] as const)
    .filter(([, count]) => count > 0);
  const noteEntries = Object.entries(notes).filter(([, count]) => count > 0);
  const sentences: string[] = [];
  const issueTotal = issueEntries.reduce((sum, [, count]) => sum + count, 0);
  if (issueTotal > 0) {
    sentences.push(`${plural(issueTotal, "issue")}: ${issueEntries.map(([category, count]) => `${lowerFirst(decisionCategoryLabels[category])} ${count}`).join("; ")}`);
  }
  const noteTotal = noteEntries.reduce((sum, [, count]) => sum + count, 0);
  if (noteTotal > 0) {
    sentences.push(`${plural(noteTotal, "note")}: ${noteEntries.map(([label, count]) => (count === 1 ? lowerFirst(label) : `${lowerFirst(label)} ${count}`)).join("; ")}`);
  }
  return sentences.length ? sentences.join(". ") : "No issues";
}

/** Structural shape of a row's work item (non-revoked assignment), matching the Documents rows API. */
export interface WorkItemLike {
  author_label: string;
  is_me: boolean;
  task: string;
  status: string;
  held: boolean;
  round_ordinal: number | null;
  version: number;
}

function workItemText(item: WorkItemLike): string {
  if (item.status === "reopened") return "Reopened";
  const person = personLabel(item.author_label, item.is_me);
  if (item.status === "submitted") return `${person} submitted`;
  if (item.task === "review") return "Consolidation open";
  if (item.task === "translation_review") return `Translation review open (v${item.version})`;
  return item.round_ordinal == null ? `${person} annotating` : `${person} annotating (Round ${item.round_ordinal})`;
}

/**
 * Work column text aggregated over all versions of the row, per "Work wording":
 * "ann-0004 annotating (Round 3)", "Consolidation open", "Translation review open (v3)", "Reopened";
 * more than two assignees become counts ("2 of 3 submitted"). The "Paused" badge is rendered separately (`held`).
 */
export function workText(work: readonly WorkItemLike[]): string {
  if (work.length === 0) return "Unassigned";
  if (work.length > 2) return `${work.filter(item => item.status === "submitted").length} of ${work.length} submitted`;
  return work.map(workItemText).join("; ");
}
