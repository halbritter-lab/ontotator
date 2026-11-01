/**
 * Copy of the stage columns Review, Annotation and Final, the Waiting on column and the version
 * marker (documents overview spec "Stage cells", "Waiting on", "Copy"). Pure functions over the
 * server-derived `StageCellView`; the table and the narrow cards share them.
 */
import type { DocumentRowView, PersonRefView, StageCellView } from "../api/client";
import { personLabel } from "../app/identity";
import { plural } from "../app/labels";
import { formatTime } from "../app/submissionLabels";

export type StageName = "review" | "annotation" | "final";

/** Stage titles: the path names of the text card (Translation, Annotation, Finalization). */
export const STAGE_TITLES: Readonly<Record<StageName, string>> = { review: "Translation", annotation: "Annotation", final: "Finalization" };

/** The stage word `historyLines` puts before a line ("Review: …"); a tag replaces it. */
/** How a text is annotated, for "annotated from scratch". */
export const MODE_WORDS: Readonly<Record<"proposals" | "scratch", string>> = { proposals: "from proposals", scratch: "from scratch" };

export const HISTORY_LINE_PREFIX: Readonly<Record<StageName, string>> = { review: "Review", annotation: "Annotation", final: "Final" };
export interface StageText {
  /** Decorative glyph (`aria-hidden`); empty when the word itself is the dash. */
  symbol: string;
  word: string;
  /** Muted second line; empty when there is none. */
  detail: string;
}
export interface StageContext {
  /** Source language of the case ("translation from en v1"). */
  sourceLanguage?: string | null;
}

/** Glyph per tone for states without a fixed glyph. */
const TONE_SYMBOLS: Readonly<Record<StageCellView["tone"], string>> = {
  none: "—", undecided: "?", waiting: "○", todo: "○", running: "◐", decision: "●", rejected: "✕", done: "✓",
};

/** Final "Check changes": cause codes as the short summary of line 2. */
export const FINAL_CAUSE_TEXT: Readonly<Record<string, string>> = {
  SELECTED_NEWER_RESULT: "newer result",
  PLAN_RESTORED: "returned to plan",
  SELECTED_TEXT_CORRECTED: "text corrected",
  SELECTED_RESULT_REVISED: "result revised",
  SELECTED_ROUND_ABANDONED: "round abandoned",
  SELECTED_ROUND_SUPERSEDED: "round replaced",
};

const BLOCKED_TEXT: Readonly<Record<string, string>> = {
  translation_rejected: "translation rejected",
  translation_queried: "queried",
  translation_not_accepted: "not accepted",
};
const RE_REVIEW_TEXT: Readonly<Record<string, string>> = { correction: "correction", new_review: "new review", source_changed: "source changed" };
const ACCEPTED_TEXT: Readonly<Record<string, string>> = { unchanged: "unchanged", in_package: "in package", outside: "outside Ontotator" };

/**
 * Issue 258: how far the open tasks a cell names have got. A task starts with the person's first saved change;
 * opening it does not. "all" also without a count (an older server), so the cell reads as before.
 */
export type Started = "all" | "none" | "some";
export function startedOf(detail: StageCellView["detail"]): Started {
  const started = detail.started;
  const tasks = detail.open_tasks;
  if (started == null || tasks == null || tasks <= 0 || started >= tasks) return "all";
  return started <= 0 ? "none" : "some";
}

/** "Assigned, not started" (cell word) for an assigned task nobody has saved yet. */
export const NOT_STARTED = "Assigned, not started";

/** "not started" / "1 of 2 started" after another part of a line; null when every task has started. */
export function startedPart(detail: StageCellView["detail"]): string | null {
  const state = startedOf(detail);
  if (state === "all") return null;
  return state === "none" ? "not started" : `${detail.started ?? 0} of ${detail.open_tasks ?? 0} started`;
}

/**
 * "2 of 3 submitted": out of "annotators per text", or out of everyone holding the text when more do (the limit was
 * lowered after they were assigned), never "2 of 1 submitted". `open` counts the annotate tasks still open.
 */
export function submittedOf(submitted: number, total: number, open = 0): string {
  return `${submitted} of ${Math.max(total, submitted + open)} submitted`;
}

/**
 * Shorter words for a stage cell of the narrow table (below 1400 px, issue 248), so the cell keeps one line without
 * cutting the state; the title and screen readers keep the full state. Only states longer than the narrow cell
 * have one.
 */
const NARROW_STATES: readonly (readonly [RegExp, string])[] = [
  [/^assigned, not started$/, "not started"],
  [/^(?:after translation review|waiting for review \(.*\))$/, "after review"],
  [/^in review, .+$/, "in review"],
  [/^(\d+) of (\d+) submitted(?:, .+)?$/, "$1/$2 submitted"],
  [/^(\d+) annotators? · max (\d+)$/, "$1 · max $2"],
  [/^not reviewed, optional$/, "not reviewed"],
  [/^(?:Final is|In progress|Submitted|Finishing) on old text$/, "on old text"],
  [/^Submitted on (v\d+)$/, "$1 submitted"],
  [/^Finishing on (v\d+)$/, "finishing $1"],
  [/^ready to compare$/, "to compare"],
  [/^consolidating \(.+\)$/, "consolidating"],
];

/** The narrow table's short state (`NARROW_STATES`); null when the state fits as it is. */
export function narrowStageState(state: string): string | null {
  for (const [pattern, short] of NARROW_STATES) if (pattern.test(state)) return state.replace(pattern, short);
  return null;
}

/** The short form of a person in a cell: the display name, else the pseudonym. */
export function shortName(person: PersonRefView): string {
  return person.display_name?.trim() || person.pseudonym;
}

/** "Ana Weber, Tom Reis" (every person). */
function names(people: readonly PersonRefView[] | undefined): string {
  return (people ?? []).map(shortName).join(", ");
}

/** "10:40" today, "20 Oct, 10:40" on other days. */
function timeText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return formatTime(date);
}

const join = (...parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(", ");
const version = (value: number | null | undefined): string | null => (value == null ? null : `v${value}`);
const quoted = (value: string | null | undefined): string | null => (value ? `“${value}”` : null);

function reviewText(cell: StageCellView, context: StageContext): StageText {
  const detail = cell.detail;
  const people = names(detail.people);
  switch (cell.state) {
    case "source": return { symbol: "—", word: "source", detail: "" };
    case "not_planned": return { symbol: "—", word: "not planned", detail: "" };
    case "undecided": return { symbol: "?", word: "not decided", detail: "" };
    case "unassigned":
      return { symbol: "○", word: "Unassigned", detail: [version(detail.version), detail.note === "machine_translation" ? "machine translation" : null].filter(Boolean).join(" ") };
    case "check_failed": return { symbol: "⚠", word: "Check failed", detail: "unassigned" };
    case "in_progress": {
      if (detail.total != null && detail.total > 1) {
        return { symbol: "◐", word: `${detail.assigned ?? 0} of ${detail.total} versions in review`, detail: join(people, startedPart(detail)) };
      }
      const started = startedOf(detail);
      if (started === "none") return { symbol: "○", word: NOT_STARTED, detail: people };
      return { symbol: "◐", word: started === "some" ? startedPart(detail) ?? "In progress" : "In progress", detail: people };
    }
    case "re_review": {
      const reason = detail.reason ? `reason: ${quoted(detail.reason)}` : detail.note ? RE_REVIEW_TEXT[detail.note] : null;
      if (startedOf(detail) === "none") return { symbol: "○", word: "Re-review assigned, not started", detail: join(people, reason) };
      return { symbol: "◐", word: "Re-review in progress", detail: join(people, startedPart(detail), reason) };
    }
    case "paused": return pausedText(cell);
    case "rejected": return { symbol: "✕", word: "Rejected", detail: join(people, detail.at && timeText(detail.at)) };
    case "query": return { symbol: "?", word: "Query", detail: join(people, detail.at && timeText(detail.at)) };
    case "not_accepted": return { symbol: "⚠", word: "Not accepted", detail: "Review off" };
    case "source_changed":
      return { symbol: "⚠", word: "Source changed", detail: `translation from ${[context.sourceLanguage || "source", version(detail.from_version)].filter(Boolean).join(" ")}` };
    case "accepted": {
      const how = detail.note === "with_corrections"
        ? join("with corrections", detail.from_version != null && detail.version != null ? `v${detail.from_version} → v${detail.version}` : null, people)
        : detail.note ? ACCEPTED_TEXT[detail.note] ?? "" : "";
      return { symbol: "✓", word: "Accepted", detail: how };
    }
    default: return fallback(cell);
  }
}

function pausedText(cell: StageCellView): StageText {
  const person = names(cell.detail.people);
  const excerpt = quoted(cell.detail.excerpt);
  return { symbol: "⏸", word: "Paused", detail: person && excerpt ? `${person}: ${excerpt}` : person || excerpt || "" };
}

/**
 * Annotators of a text against the project limit, an upper bound (R-13): "1 annotator · max 2", "2 · full";
 * never "1 of 2", which reads like a required number. Nobody yet reads "Unassigned" like the other stages: the
 * limit is the same for every text and the assign dialog shows it (issue 129, U2).
 */
export function annotatorCount(assigned: number, max: number): string {
  if (assigned >= max) return `${assigned} · full`;
  if (assigned === 0) return "Unassigned";
  return `${plural(assigned, "annotator")} · max ${max}`;
}

function annotationText(cell: StageCellView): StageText {
  const detail = cell.detail;
  const people = names(detail.people);
  const waiting = detail.note === "text_change_waiting" ? "text change waiting for review" : null;
  const counted = (word: string) => (detail.target != null ? annotatorCount(detail.assigned ?? 0, detail.target) : word);
  const several = (detail.people?.length ?? 0) > 1;
  switch (cell.state) {
    case "not_planned": return { symbol: "—", word: "not planned", detail: detail.note === "review_only" ? "Review only" : "" };
    case "undecided": return { symbol: "?", word: "not decided", detail: "" };
    // A person named here holds a task that opens once the review is accepted (issue 213).
    case "after_review": return { symbol: "○", word: people ? "Waiting for review" : "after review", detail: join(people, waiting) };
    case "blocked": return { symbol: "○", word: "blocked", detail: join(detail.note && BLOCKED_TEXT[detail.note], people && `${people} waiting`) };
    case "unassigned":
    case "partly_assigned": {
      const working = !people ? null : startedOf(detail) === "none" ? `${people} assigned, not started` : join(`${people} working`, startedPart(detail));
      return { symbol: "○", word: counted("Unassigned"), detail: join(working, waiting) };
    }
    case "in_progress": {
      if (detail.total != null && detail.submitted != null) {
        return { symbol: "◐", word: submittedOf(detail.submitted, detail.total, detail.open_tasks ?? detail.people?.length), detail: join(people && `waiting: ${people}`, startedPart(detail), waiting) };
      }
      const change = detail.note === "may_change" ? join(version(detail.version), "may change") : null;
      const started = startedOf(detail);
      const word = started === "none" ? NOT_STARTED : started === "some" ? startedPart(detail) ?? "In progress" : "In progress";
      return { symbol: started === "none" ? "○" : "◐", word, detail: join(people, detail.round_ordinal != null ? `Round ${detail.round_ordinal}` : null, change, waiting) };
    }
    case "paused": return pausedText(cell);
    case "consolidating": return { symbol: "◐", word: "Consolidating", detail: people };
    case "old_text_open":
      return { symbol: "⚠", word: "In progress on old text", detail: people ? `${people} ${several ? "work" : "works"} on ${version(detail.from_version) ?? "the old text"}` : "" };
    case "old_text_submitted":
      return { symbol: "⚠", word: `Submitted on ${version(detail.from_version) ?? "old text"}`, detail: join(people, `${version(detail.version) ?? "new text"} not annotated`) };
    case "finishing_on_old":
      return { symbol: "◐", word: `Finishing on ${version(detail.from_version) ?? "old text"}`, detail: join(people, `carried to ${version(detail.version) ?? "the new text"} on submit`) };
    case "submitted": {
      const word = detail.total != null && detail.submitted != null ? submittedOf(detail.submitted, detail.total) : "submitted";
      return { symbol: "✓", word, detail: join(people, detail.findings != null ? plural(detail.findings, "finding") : null, waiting) };
    }
    default: return fallback(cell);
  }
}

/** "Round 1, Ana Weber" / "Consolidation, Luc Martin" (+ ", v1" when not on the newest version). */
function finalKindText(cell: StageCellView): string {
  const detail = cell.detail;
  const people = names(detail.people);
  const kind = detail.note === "consolidation" ? "Consolidation" : detail.round_ordinal != null ? `Round ${detail.round_ordinal}` : null;
  return join(kind, people, version(detail.version));
}

function finalText(cell: StageCellView): StageText {
  const detail = cell.detail;
  switch (cell.state) {
    case "none": return { symbol: "", word: "—", detail: "" };
    case "after_annotation": return { symbol: "○", word: "after annotation", detail: "" };
    case "after_review": return { symbol: "○", word: "after review", detail: "" };
    case "choose": {
      const count = detail.submitted ?? 0;
      const match = detail.matching != null && detail.compared != null ? `${detail.matching} of ${detail.compared} match` : null;
      return { symbol: "●", word: "Your choice", detail: join(plural(count, "submission"), match) };
    }
    case "confirm":
      return { symbol: "⚠", word: "Check changes", detail: [...new Set((detail.causes ?? []).map(code => FINAL_CAUSE_TEXT[code] ?? "changed"))].join(", ") };
    case "old_text": return { symbol: "⚠", word: "Final is on old text", detail: finalKindText(cell) };
    case "may_be_outdated": return { symbol: "⚠", word: "may be outdated", detail: "source changed" };
    case "final": return { symbol: "✓", word: "Final", detail: detail.note === "not_exported" ? "not exported" : finalKindText(cell) };
    default: return fallback(cell);
  }
}

/** An unknown state (a newer server): the tone's glyph and "—" (no state codes in visible copy). */
function fallback(cell: StageCellView): StageText {
  return { symbol: TONE_SYMBOLS[cell.tone] ?? "", word: "—", detail: "" };
}

/** Line 1 (symbol + word) and line 2 of one stage cell. */
export function stageText(stage: StageName, cell: StageCellView, _row: Pick<DocumentRowView, "case_id" | "language">, context: StageContext = {}): StageText {
  if (stage === "review") return reviewText(cell, context);
  if (stage === "annotation") return annotationText(cell);
  return finalText(cell);
}

/** VD3: not in plan, plan written by the system under "Nothing planned". */
export function isUndecided(row: Pick<DocumentRowView, "in_plan" | "plan_row">): boolean {
  return !row.in_plan && row.plan_row?.decided === false;
}

/** Rows the lead works on: in plan, or undecided (V10). Not-in-plan rows are muted. */
export function isActiveRow(row: Pick<DocumentRowView, "in_plan" | "plan_row">): boolean {
  return row.in_plan || isUndecided(row);
}

/** Up to this many names in Waiting on; the rest as "+n" (VD8). */
export const WAITING_ON_NAMES = 2;

/**
 * Waiting on (spec "Waiting on", VD8): "You", one person in identity format, up to two names and
 * "+n", or "—". `title` holds the full list in identity format.
 */
export function waitingOnText(row: Pick<DocumentRowView, "in_plan" | "plan_row" | "next_step">): { text: string; title: string; you: boolean; narrow?: string } {
  const none = { text: "—", title: "", you: false };
  if (isUndecided(row)) return { text: "You", title: "You", you: true };
  const step = row.in_plan ? row.next_step : null;
  if (!step || step.kind === "done") return none;
  const owner = step.owner;
  if (owner.kind === "you") return { text: "You", title: "You", you: true };
  const people = owner.people?.length ? owner.people : owner.person ? [owner.person] : [];
  if (people.length === 0) {
    if (owner.kind === "people" && owner.count > 0) {
      const text = plural(owner.count, step.stage === "translation_review" ? "reviewer" : "annotator");
      return { text, title: text, you: false };
    }
    return none;
  }
  const title = people.map(person => personLabel(person)).join(", ");
  // The short name in the cell; the full "Name (pseudonym)" is the title and the accessible text.
  if (people.length === 1) return { text: shortName(people[0]), title, you: false };
  const shown = people.slice(0, WAITING_ON_NAMES).map(shortName).join(", ");
  const rest = people.length - WAITING_ON_NAMES;
  // Narrow tables (issue 248) show one name and "+n", so the cell is not cut mid-name.
  const narrow = `${shortName(people[0])} +${people.length - 1}`;
  return { text: rest > 0 ? `${shown} +${rest}` : shown, title, you: false, narrow };
}

/** "v2 corrected", "v2" or "2 translations"; null without a marker. */
export function versionMarkerText(row: Pick<DocumentRowView, "version_marker">): string | null {
  const marker = row.version_marker;
  if (!marker) return null;
  switch (marker.kind) {
    case "corrected": return `v${marker.version} corrected`;
    case "parallel": return plural(marker.version, "translation");
    default: return `v${marker.version}`;
  }
}
