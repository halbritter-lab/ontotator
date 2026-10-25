/**
 * Activity lines of the row panel (acceptance fixes WP-A): one line per review, submission or open
 * task, then pauses and the final choice, oldest first, each with its stage, e.g.
 * "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
 * "Annotation: Tom Reis (ann-0004), Round 1, 1 finding, 22:15", "Final: chosen by you, 20 Oct, 22:20"; a consolidation
 * adds "4 kept automatically (all matched)" (U14).
 */
import type { DocumentRowView, RowSubmissionView } from "../api/client";
import { assignmentStatusLabels, labelFor, plural } from "../app/labels";
import { formatTime, personLabel } from "../app/submissionLabels";
import { decisionLabels } from "../translation/labels";
import { acceptanceLabel, acceptanceOf, isDiscarded } from "./TextVersions";

/** Stage of an activity line (the row panel's stage tag and filter). */
export type HistoryStage = "review" | "annotation" | "final";

export interface HistoryLine {
  key: string;
  /** Stage the line belongs to: translation review, annotation work or the final choice. */
  stage: HistoryStage;
  text: string;
  /** Problem report behind a paused task ("Open report"). */
  reportId?: string | null;
}

export interface HistoryOptions {
  /** Pseudonym of the signed-in lead ("chosen by you"). */
  me?: string | null;
  now?: Date;
}

type WorkItem = DocumentRowView["work"][number];

const join = (...parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(", ");

/** "22:15" on the day of `now`, else "20 Oct, 22:09" (the stage cells' rule). */
function timeText(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (date.toDateString() === now.toDateString()) return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return formatTime(date, { now });
}

const SUBMISSION_PREFIX: Readonly<Record<RowSubmissionView["kind"], string>> = {
  annotation: "Annotation", carry_forward: "Annotation", consolidation: "Consolidation", proposal_check: "Annotation",
};
const workPrefix = (item: WorkItem) => (item.task === "review" ? "Consolidation" : "Annotation");
const who = (item: WorkItem) => personLabel(item.author_label, item.is_me, item.person);

/** U14: "4 kept automatically (all matched)" on a consolidation that took matching findings over; else nothing. */
function keptText(item: RowSubmissionView): string | null {
  const kept = item.kind === "consolidation" ? item.kept_automatically ?? 0 : 0;
  return kept > 0 ? `${kept} kept automatically (all matched)` : null;
}

export function historyLines(row: DocumentRowView, submissions: readonly RowSubmissionView[] | null, options: HistoryOptions = {}): HistoryLine[] {
  const now = options.now ?? new Date();
  const lines: HistoryLine[] = [];
  const versionOf = (documentId: string) => row.versions.find(entry => entry.document_id === documentId);
  // Moved tasks ("moved to v2") come in `moved_work`, outside the row's live work.
  const allWork = [...row.work, ...(row.moved_work ?? [])];

  // Review: every translation review, then the acceptance records of the newest versions.
  const reviews = allWork.filter(item => item.task === "translation_review");
  const lastSubmitted = [...reviews].reverse().find(item => item.status === "submitted" && item.moved_to_version == null);
  for (const item of reviews) {
    let outcome: string;
    if (item.moved_to_version != null) outcome = `moved to v${item.moved_to_version}`;
    else if (item.status === "submitted") {
      const reviewed = versionOf(item.document_id);
      const decision = reviewed?.latest_review_decision;
      const corrected = reviewed && decision === "accepted_corrected" ? row.versions.find(entry => entry.derived_from === reviewed.document_id) : undefined;
      outcome = join(decision ? labelFor(decisionLabels, decision) : "Submitted", corrected && reviewed ? `v${reviewed.version} → v${corrected.version}` : null);
    } else outcome = join(labelFor(assignmentStatusLabels, item.status), item.held && "Paused");
    const at = item === lastSubmitted ? row.stages?.review.detail.at : null;
    lines.push({ key: `work-${item.assignment_id}`, stage: "review", text: `Review: ${join(who(item), outcome, at && timeText(at, now))}` });
  }
  for (const entry of row.versions) {
    const acceptance = entry.is_newest_in_chain && !isDiscarded(row, entry) ? acceptanceOf(entry) : null;
    if (acceptance) lines.push({ key: `acceptance-${entry.document_id}`, stage: "review", text: `Review: ${acceptanceLabel(acceptance, now)}` });
  }

  // Annotation: submissions in time order (once loaded), then the tasks not submitted yet.
  const several = row.versions.length > 1;
  if (submissions) {
    for (const item of [...submissions].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) {
      const round = item.kind === "consolidation" ? null : item.round_ordinal == null ? "Initial submission" : `Round ${item.round_ordinal}`;
      lines.push({
        key: `submission-${item.submission_id}`,
        stage: "annotation",
        text: `${SUBMISSION_PREFIX[item.kind] ?? "Annotation"}: ${join(personLabel(item.author_label, item.is_me, item.author), round,
          plural(item.finding_count, "finding"), keptText(item), several && `v${item.version}`, timeText(item.recorded_at, now))}`,
      });
    }
  }
  for (const item of allWork) {
    if (item.task === "translation_review") continue;
    if (item.task === "annotate" && item.unreviewed_translation) {
      const by = item.assigned_by ? personLabel(item.assigned_by.pseudonym, !!item.assigned_by.is_me, item.assigned_by) : "the lead";
      lines.push({ key: `unreviewed-${item.assignment_id}`, stage: "annotation", text: `Annotation assigned before the translation review was accepted (confirmed by ${by})` });
    }
    if (item.status === "submitted" && submissions && item.moved_to_version == null) continue;
    const status = item.moved_to_version != null ? `moved to v${item.moved_to_version}` : join(labelFor(assignmentStatusLabels, item.status), item.held && "Paused");
    const round = item.moved_to_version == null && item.round_ordinal != null ? `Round ${item.round_ordinal}` : null;
    lines.push({ key: `work-${item.assignment_id}`, stage: "annotation", text: `${workPrefix(item)}: ${join(who(item), round, status)}` });
  }

  // A task on hold stays a history line (spec "Expansion": TASK_ON_HOLD).
  for (const entry of [...row.issues, ...row.notes]) {
    if (entry.code !== "TASK_ON_HOLD") continue;
    lines.push({ key: `hold-${entry.cause_id}`, stage: "annotation", text: `Task paused${entry.author_label ? `: ${entry.author_label}` : ""}`, reportId: entry.report_id ?? null });
  }

  const chosen = row.final;
  if (chosen) {
    const by = chosen.selected_by ? (options.me && chosen.selected_by === options.me ? "you" : chosen.selected_by) : null;
    lines.push({ key: "final", stage: "final", text: `Final: ${join(by ? `chosen by ${by}` : "chosen", chosen.selected_at && timeText(chosen.selected_at, now))}` });
  }
  return lines;
}
