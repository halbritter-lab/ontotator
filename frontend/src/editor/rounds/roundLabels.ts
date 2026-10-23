/**
 * Pure round wording (spec section 7): identity line, Work rounds table cells, carry sources and
 * the reasons why a new round cannot start. Structural input types with the B1 round fields.
 */
import { formatTime, type FormatTimeOptions } from "../../app/submissionLabels";

export interface RoundFacts {
  round_id: string;
  kind: "ordinary" | "carry_forward" | "clean_restart" | "consolidation" | "text_change" | "handover";
  state: "editable" | "submitted" | "superseded" | "abandoned";
  round_ordinal?: number | null;
  predecessor_round_id?: string | null;
  input_submission_ids?: readonly string[] | null;
  input_count?: number | null;
  submission_count?: number | null;
  latest_submission_recorded_at?: string | null;
  source_round_ordinal?: number | null;
  source_submission_recorded_at?: string | null;
  document_language?: string | null;
  document_version?: number | null;
}

const roundTitle = (ordinal: number | null | undefined): string => (ordinal ? `Round ${ordinal}` : "This round");
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

function versionText(language: string | null | undefined, version: number | null | undefined): string {
  return [language ?? "", version != null ? `v${version}` : ""].filter(Boolean).join(" ");
}

/** "Round 3, continued from Round 2 submission (19 Oct, 00:57), de v1" and its variants. */
export function roundIdentity(round: RoundFacts, options: FormatTimeOptions = {}): string {
  const title = roundTitle(round.round_ordinal);
  const version = versionText(round.document_language, round.document_version);
  const withVersion = (start: string) => [title, start, version].filter(Boolean).join(", ");
  switch (round.kind) {
    case "clean_restart":
      return `${title}, restarted empty after agreement with the lead`;
    case "consolidation":
      return `${title}, consolidation of ${plural(round.input_submission_ids?.length ?? 0, "submission", "submissions")}`;
    case "carry_forward": {
      const source = round.source_round_ordinal ? `Round ${round.source_round_ordinal} submission` : "an earlier submission";
      const time = round.source_submission_recorded_at ? ` (${formatTime(round.source_submission_recorded_at, options)})` : "";
      return withVersion(`continued from ${source}${time}`);
    }
    // A lead moved the draft to the corrected text (spec V5).
    case "text_change":
      return withVersion("carried after text change");
    // A lead handed another annotator's submission over (VD13).
    case "handover":
      return withVersion("handed over from another annotator");
    default:
      return withVersion("started empty");
  }
}

/** Round state column; superseded rounds name the round that replaced them. */
export function roundStateLabel(round: RoundFacts, rounds: readonly RoundFacts[]): string {
  switch (round.state) {
    case "editable":
      return "Open";
    case "submitted":
      return "Submitted";
    case "abandoned":
      return "Discarded by restart";
    default: {
      const successor = rounds.find(other => other.predecessor_round_id === round.round_id);
      return successor?.round_ordinal ? `Replaced by Round ${successor.round_ordinal}` : "Replaced by a later round";
    }
  }
}

/** Submission column: "Submitted 19 Oct, 00:57", "2 submissions, latest …", "Not submitted yet". */
export function submissionCell(count: number, latestRecordedAt: string | null | undefined, options: FormatTimeOptions = {}): string {
  if (count <= 0) return "Not submitted yet";
  const time = latestRecordedAt ? formatTime(latestRecordedAt, options) : null;
  if (count === 1) return time ? `Submitted ${time}` : "Submitted";
  return time ? `${count} submissions, latest ${time}` : `${count} submissions`;
}

/** Carried column (input count). */
export const carriedCell = (inputCount: number): string => (inputCount > 0 ? plural(inputCount, "finding", "findings") : "None");

/** Why "Start a new round" is unavailable; null when it is available. */
export function carryUnavailableReason(facts: { held: boolean; openRoundOrdinal: number | null; sourceCount: number }): string | null {
  if (facts.held) return "The task is paused. Resume it before starting another round.";
  if (facts.openRoundOrdinal !== null) {
    const open = `Round ${facts.openRoundOrdinal}`;
    return `You can continue from a submission once ${open} is submitted. ${open} is still open.`;
  }
  if (facts.sourceCount <= 0) return "There is no submitted work of yours on this text yet.";
  return null;
}

export interface CarrySourceFacts {
  round_ordinal?: number | null;
  recorded_at?: string | null;
  language?: string | null;
  version?: number | null;
  finding_count: number;
}

/** "Continue from" option: "Round 2 submission, 19 Oct, 00:57, de v1, 1 finding". */
export function sourceOptionLabel(source: CarrySourceFacts, options: FormatTimeOptions = {}): string {
  return [
    source.round_ordinal ? `Round ${source.round_ordinal} submission` : "Earlier submission",
    source.recorded_at ? formatTime(source.recorded_at, options) : "",
    versionText(source.language, source.version),
    plural(source.finding_count, "finding", "findings"),
  ].filter(Boolean).join(", ");
}

/** Starting point in the Work rounds table: "from Round 2 submission", "restarted empty", … */
export function roundStartingPoint(round: Pick<RoundFacts, "kind" | "source_round_ordinal" | "input_submission_ids">): string {
  switch (round.kind) {
    case "carry_forward": return round.source_round_ordinal ? `from Round ${round.source_round_ordinal} submission` : "from an earlier submission";
    case "clean_restart": return "restarted empty";
    case "consolidation": return `consolidation of ${plural(round.input_submission_ids?.length ?? 0, "submission", "submissions")}`;
    case "text_change": return "carried after text change";
    case "handover": return "handed over";
    default: return "started empty";
  }
}

/** Short toolbar badge of a carry-forward round ("Round 3, continued from Round 2"); undefined otherwise. */
export function roundBadge(round: Pick<RoundFacts, "kind" | "round_ordinal" | "source_round_ordinal"> | null | undefined): string | undefined {
  if (round?.kind !== "carry_forward" || !round.round_ordinal) return undefined;
  return `Round ${round.round_ordinal}, continued from ${round.source_round_ordinal ? `Round ${round.source_round_ordinal}` : "an earlier submission"}`;
}
