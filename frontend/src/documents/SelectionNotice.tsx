import type { DocumentRowView, RowItemView, RowRoundView, RowSubmissions } from "../api/client";
import { formatTime, personLabel, roundCell } from "../app/submissionLabels";
import { statusBadgeText, versionName } from "./labels";
import { pendingRounds, roundName, submissionVersion } from "./SubmissionsTable";

/** Causes the lead acknowledges with "Keep final on v1" (final-result panel). */
export const ACKNOWLEDGEABLE_CODES: ReadonlySet<string> = new Set([
  "SELECTED_ROUND_ABANDONED",
  "SELECTED_ROUND_SUPERSEDED",
  "SELECTED_RESULT_REVISED",
  "SELECTED_TEXT_CORRECTED",
  "SELECTED_NEWER_RESULT",
  "PLAN_RESTORED",
]);

/** Reason shown when the consolidator may not be an annotator and the final result is the lead's own. */
export const OWN_RESULT_REASON = "In this project the consolidator of a text may not be one of its annotators. Another lead must choose this result.";

/** Stored review decisions (`translation_reviews.decision`) that did not accept a correction. */
const NOT_ACCEPTED_DECISIONS: Readonly<Record<string, string>> = { rejected: "rejected", query: "queried" };

/** Acknowledgeable cause items of a row, in server order. */
export function acknowledgeableItems(row: DocumentRowView): RowItemView[] {
  return [...row.issues, ...row.notes].filter(item => ACKNOWLEDGEABLE_CODES.has(item.code));
}

/** A non-actionable line of the cause list (a correction that was rejected or queried). */
export interface NoticeLine { key: string; text: string }

/** A cause line part: plain text or a timestamp shown as a local time label. */
export type CauseSegment = string | { time: string };

/** One acknowledgeable cause line of the selection notice. */
export interface NoticeCauseLine {
  causeId: string;
  segments: CauseSegment[];
  /** The line as plain text, timestamps formatted as the notice shows them. */
  text: string;
  hint?: string;
}

function suffix(causeId: string, code: string): string {
  return causeId.startsWith(`${code}:`) ? causeId.slice(code.length + 1) : causeId;
}

function chainNameOf(row: DocumentRowView, documentId: string | null): string {
  return row.versions.find(version => version.document_id === documentId)?.chain_name ?? "";
}

/** "Round 2 (ann-0004)", "Consolidation (ann-0004)"; with a display name "Round 2, Ana Weber (ann-0004)". */
function roundLabelOf(round: RowRoundView): string {
  const name = round.round_ordinal != null ? undefined : roundName({ round_ordinal: null, round_id: round.round_id, kind: round.kind });
  return roundCell({ ordinal: round.round_ordinal, author: round.author_label, isMe: round.is_me, person: round.author, name });
}

/** Segments and hint of one acknowledgeable cause, worded as in the spec ("Selection notice"). */
function causeSegments(row: DocumentRowView, data: RowSubmissions | null, item: RowItemView): { segments: CauseSegment[]; hint?: string } | null {
  const rounds = data?.rounds ?? [];
  const submissions = data?.submissions ?? [];
  const roundLabel = (roundId: string | null | undefined) => {
    const round = rounds.find(entry => entry.round_id === roundId);
    if (!round) return "The selected round";
    return roundLabelOf(round);
  };
  switch (item.code) {
    case "SELECTED_ROUND_ABANDONED":
      return { segments: [`${roundLabel(suffix(item.cause_id, item.code))} is abandoned.`] };
    case "SELECTED_ROUND_SUPERSEDED": {
      const roundId = suffix(item.cause_id, item.code);
      const successor = rounds.find(entry => entry.predecessor_round_id === roundId);
      const by = successor ? ` by ${roundName({ round_ordinal: successor.round_ordinal, round_id: successor.round_id, kind: successor.kind })}` : "";
      return { segments: [`${roundLabel(roundId)} has been superseded${by}.`] };
    }
    case "SELECTED_RESULT_REVISED": {
      const newer = submissions.find(entry => entry.submission_id === suffix(item.cause_id, item.code));
      const roundId = newer?.round_id ?? submissions.find(entry => entry.submission_id === row.final?.submission_id)?.round_id;
      return { segments: newer
        ? [`${roundLabel(roundId)} has a newer submission (`, { time: newer.recorded_at }, ")."]
        : [`${roundLabel(roundId)} has a newer submission.`] };
    }
    case "SELECTED_NEWER_RESULT": {
      const newer = submissions.find(entry => entry.submission_id === suffix(item.cause_id, item.code));
      const subject = newer
        ? [roundName(newer), personLabel(newer.author_label, newer.is_me, newer.author), submissionVersion(newer.version, newer.chain_name, row.parallel_roots)].join(", ")
        : "A newer result";
      const selectedAt = row.final?.selected_at;
      return { segments: selectedAt
        ? [`${subject} was submitted after the final result was chosen (`, { time: selectedAt }, ")."]
        : [`${subject} was submitted after the final result was chosen.`] };
    }
    case "SELECTED_TEXT_CORRECTED": {
      const corrected = row.versions.find(version => version.document_id === item.document_id);
      const name = versionName(item.version ?? corrected?.version ?? 0, chainNameOf(row, item.document_id), row.parallel_roots);
      const status = corrected ? statusBadgeText(corrected.translation_status, corrected.latest_review_decision, corrected.accepted_without_review) : null;
      const accepted = corrected?.translation_status === "accepted";
      const finalName = row.final?.version != null ? versionName(row.final.version, row.final.chain_name ?? "", row.parallel_roots) : "the final result";
      return {
        segments: [`${name}${status ? ` (${status})` : ""} corrects the text of the final result.`],
        hint: accepted ? `Keep ${finalName}, or choose a result on ${name} once one exists (assign work in Text versions).` : undefined,
      };
    }
    case "PLAN_RESTORED":
      return { segments: ["This language version returned to the plan. Confirm its earlier final result."] };
    default:
      return null;
  }
}

/**
 * The acknowledgeable cause lines of a row, in server order, exactly as the selection notice
 * shows them. `now` is the reference for the current-year rule of the time labels.
 */
export function causeLines(row: DocumentRowView, data: RowSubmissions | null, now?: Date): NoticeCauseLine[] {
  return acknowledgeableItems(row).flatMap(item => {
    const line = causeSegments(row, data, item);
    if (!line) return [];
    const text = line.segments.map(part => (typeof part === "string" ? part : formatTime(part.time, { now }))).join("");
    return [{ causeId: item.cause_id, segments: line.segments, text, ...(line.hint ? { hint: line.hint } : {}) }];
  });
}

/** Corrections of the final result's chain whose latest review rejected or queried them. */
export function notAcceptedLines(row: DocumentRowView): NoticeLine[] {
  if (!row.final) return [];
  const finalChain = row.versions.find(version => version.document_id === row.final?.document_id)?.chain_id;
  return row.versions
    .filter(version => version.origin === "correction" && version.chain_id === finalChain && version.translation_status === "reviewed"
      && NOT_ACCEPTED_DECISIONS[version.latest_review_decision ?? ""] !== undefined)
    .map(version => ({
      key: `not-accepted:${version.document_id}`,
      text: `${versionName(version.version, version.chain_name, row.parallel_roots)} was ${NOT_ACCEPTED_DECISIONS[version.latest_review_decision ?? ""]} in review. No action needed.`,
    }));
}

/** Waiting lines for every unsubmitted round and open translation review of the row. */
export function waitingLines(row: DocumentRowView, data: RowSubmissions | null): string[] {
  if (!data) return [];
  const rounds = pendingRounds(data.rounds).map(round => {
    return `Waiting: ${roundLabelOf(round)} is in progress. You can choose again once it is submitted.`;
  });
  const reviews = data.open_translation_reviews.map(review =>
    `Waiting: translation review of ${submissionVersion(review.version, review.chain_name, row.parallel_roots)} by ${personLabel(review.reviewer_label, review.is_me, review.reviewer)} is open. You can choose again once it is submitted.`);
  return [...rounds, ...reviews];
}
