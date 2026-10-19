import { useId, type ReactNode } from "react";
import type { DocumentRowView, RowItemView, RowSubmissions } from "../api/client";
import { formatTime, personLabel, roundCell } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { Button } from "../ui";
import { statusBadgeText, versionName } from "./labels";
import { pendingRounds, roundName, submissionVersion } from "./SubmissionsTable";

/** Causes the lead acknowledges with "Keep final result…". */
export const ACKNOWLEDGEABLE_CODES: ReadonlySet<string> = new Set([
  "SELECTED_ROUND_ABANDONED",
  "SELECTED_ROUND_SUPERSEDED",
  "SELECTED_RESULT_REVISED",
  "SELECTED_TEXT_CORRECTED",
  "SELECTED_NEWER_RESULT",
]);

/** Reason shown when the project keeps adjudication separate and the final result is the lead's own. */
export const OWN_RESULT_REASON = "This project keeps adjudication separate from annotation. Another lead must choose this result.";

/** Stored review decisions (`translation_reviews.decision`) that did not accept a correction. */
const NOT_ACCEPTED_DECISIONS: Readonly<Record<string, string>> = { rejected: "rejected", query: "queried" };

/** Acknowledgeable cause items of a row, in server order. */
export function acknowledgeableItems(row: DocumentRowView): RowItemView[] {
  return [...row.issues, ...row.notes].filter(item => ACKNOWLEDGEABLE_CODES.has(item.code));
}

interface NoticeLine { key: string; content: ReactNode; hint?: string }

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

/** Segments and hint of one acknowledgeable cause, worded as in the spec ("Selection notice"). */
function causeSegments(row: DocumentRowView, data: RowSubmissions | null, item: RowItemView): { segments: CauseSegment[]; hint?: string } | null {
  const rounds = data?.rounds ?? [];
  const submissions = data?.submissions ?? [];
  const roundLabel = (roundId: string | null | undefined) => {
    const round = rounds.find(entry => entry.round_id === roundId);
    if (!round) return "The selected round";
    return round.round_ordinal != null
      ? roundCell({ ordinal: round.round_ordinal, author: round.author_label, isMe: round.is_me })
      : `${roundName({ round_ordinal: null, round_id: round.round_id, kind: round.kind })} (${round.author_label}${round.is_me ? ", you" : ""})`;
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
        ? [roundName(newer), personLabel(newer.author_label, newer.is_me), submissionVersion(newer.version, newer.chain_name, row.parallel_roots)].join(" · ")
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
function notAcceptedLines(row: DocumentRowView): NoticeLine[] {
  if (!row.final) return [];
  const finalChain = row.versions.find(version => version.document_id === row.final?.document_id)?.chain_id;
  return row.versions
    .filter(version => version.origin === "correction" && version.chain_id === finalChain && version.translation_status === "reviewed"
      && NOT_ACCEPTED_DECISIONS[version.latest_review_decision ?? ""] !== undefined)
    .map(version => ({
      key: `not-accepted:${version.document_id}`,
      content: `${versionName(version.version, version.chain_name, row.parallel_roots)} was ${NOT_ACCEPTED_DECISIONS[version.latest_review_decision ?? ""]} in review. No action needed.`,
    }));
}

/** Waiting lines for every unsubmitted round and open translation review of the row. */
export function waitingLines(row: DocumentRowView, data: RowSubmissions | null): string[] {
  if (!data) return [];
  const rounds = pendingRounds(data.rounds).map(round => {
    const name = round.round_ordinal != null
      ? roundCell({ ordinal: round.round_ordinal, author: round.author_label, isMe: round.is_me })
      : `${roundName({ round_ordinal: null, round_id: round.round_id, kind: round.kind })} (${round.author_label}${round.is_me ? ", you" : ""})`;
    return `Waiting: ${name} is in progress. You can choose again once it is submitted.`;
  });
  const reviews = data.open_translation_reviews.map(review =>
    `Waiting: translation review of ${submissionVersion(review.version, review.chain_name, row.parallel_roots)} by ${personLabel(review.reviewer_label, review.is_me)} is open. You can choose again once it is submitted.`);
  return [...rounds, ...reviews];
}

export interface KeepRequest {
  /** Every acknowledgeable cause id shown at open; never a subset. */
  causeIds: string[];
  triggerId: string;
}

export interface SelectionNoticeProps {
  row: DocumentRowView;
  data: RowSubmissions | null;
  /** Current project rule (`page.adjudicator_not_annotator`), never the final's snapshot. */
  adjudicatorNotAnnotator?: boolean;
  /** Opens the Keep confirmation; without it no Keep action is offered. */
  onKeep?: (request: KeepRequest) => void;
  /** Keep confirmation, rendered directly below the notice. */
  keepConfirm?: ReactNode;
  /** True while submissions load or another confirmation is busy: the Keep trigger is `aria-disabled`. */
  unavailable?: boolean;
  onAnnounce?: (message: string) => void;
  now?: Date;
}

/**
 * Selection notice above the Submissions table: acknowledgeable causes, non-actionable
 * correction lines, waiting lines and "Keep final result…". Renders nothing without lines.
 */
export function SelectionNotice({ row, data, adjudicatorNotAnnotator = false, onKeep, keepConfirm, unavailable = false, onAnnounce, now }: SelectionNoticeProps): JSX.Element | null {
  const id = useId();
  const causes = acknowledgeableItems(row);
  const lines = causeLines(row, data, now);
  const other = notAcceptedLines(row);
  const waiting = row.final ? waitingLines(row, data) : [];
  if (!lines.length && !other.length && !waiting.length && !keepConfirm) return null;
  const ownBlocked = adjudicatorNotAnnotator && !!row.final?.is_mine;
  const triggerId = `${id}-keep`;
  const reasonId = `${id}-keep-reason`;
  const keepAvailable = causes.length > 0 && !!onKeep && !!row.final;
  return <div className="selection-notice">
    <ul className="selection-notice-lines">
      {lines.map(line => <li key={line.causeId}>
        {line.segments.map((part, index) => (typeof part === "string" ? part : <Time key={index} iso={part.time} now={now} />))}
        {line.hint && <span className="selection-notice-hint">{line.hint}</span>}
      </li>)}
      {other.map(line => <li key={line.key}>{line.content}</li>)}
      {waiting.map(line => <li key={line} className="selection-notice-waiting">{line}</li>)}
    </ul>
    {keepAvailable && <div className="selection-notice-actions">
      <Button
        id={triggerId}
        size="sm"
        aria-disabled={ownBlocked || unavailable ? true : undefined}
        aria-describedby={ownBlocked ? reasonId : undefined}
        onClick={() => {
          if (ownBlocked) { onAnnounce?.(OWN_RESULT_REASON); return; }
          if (unavailable) return;
          onKeep?.({ causeIds: causes.map(item => item.cause_id), triggerId });
        }}
      >Keep final result…</Button>
      {ownBlocked && <p id={reasonId} className="action-reason">{OWN_RESULT_REASON}</p>}
    </div>}
    {keepConfirm}
  </div>;
}
