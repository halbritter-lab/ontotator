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
const ACCEPTED_TEXT: Readonly<Record<string, string>> = { unchanged: "unchanged", in_package: "in package", outside: "outside Ontocurator" };

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

const join = (...parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(" · ");
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
      const word = detail.total != null && detail.total > 1 ? `${detail.assigned ?? 0} of ${detail.total} versions in review` : "In progress";
      return { symbol: "◐", word, detail: people };
    }
    case "re_review": {
      const reason = detail.reason ? `reason: ${quoted(detail.reason)}` : detail.note ? RE_REVIEW_TEXT[detail.note] : null;
      return { symbol: "◐", word: "Re-review in progress", detail: join(people, reason) };
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

function annotationText(cell: StageCellView): StageText {
  const detail = cell.detail;
  const people = names(detail.people);
  const waiting = detail.note === "text_change_waiting" ? "text change waiting for review" : null;
  const counted = (word: string) => (detail.target != null ? `${detail.assigned ?? 0} of ${detail.target} assigned` : word);
  const several = (detail.people?.length ?? 0) > 1;
  switch (cell.state) {
    case "not_planned": return { symbol: "—", word: "not planned", detail: detail.note === "review_only" ? "Review only" : "" };
    case "undecided": return { symbol: "?", word: "not decided", detail: "" };
    case "after_review": return { symbol: "○", word: "after review", detail: waiting ?? "" };
    case "blocked": return { symbol: "○", word: "blocked", detail: (detail.note && BLOCKED_TEXT[detail.note]) || "" };
    case "unassigned": return { symbol: "○", word: counted("Unassigned"), detail: join(people && `${people} working`, waiting) };
    case "partly_assigned": return { symbol: "○", word: counted("Unassigned"), detail: join(people && `${people} working`, waiting) };
    case "in_progress": {
      if (detail.total != null && detail.submitted != null) {
        return { symbol: "◐", word: `${detail.submitted} of ${detail.total} submitted`, detail: join(people && `waiting: ${people}`, waiting) };
      }
      const change = detail.note === "may_change" ? join(version(detail.version), "may change") : null;
      return { symbol: "◐", word: "In progress", detail: join(people, detail.round_ordinal != null ? `Round ${detail.round_ordinal}` : null, change, waiting) };
    }
    case "paused": return pausedText(cell);
    case "in_review": return { symbol: "◐", word: "In review", detail: join(`${detail.submitted ?? 0} submitted`, people && `review: ${people}`, waiting) };
    case "consolidating": return { symbol: "◐", word: "Consolidating", detail: people };
    case "old_text_open":
      return { symbol: "⚠", word: "In progress on old text", detail: people ? `${people} ${several ? "work" : "works"} on ${version(detail.from_version) ?? "the old text"}` : "" };
    case "old_text_submitted":
      return { symbol: "⚠", word: `Submitted on ${version(detail.from_version) ?? "old text"}`, detail: join(people, `${version(detail.version) ?? "new text"} not annotated`) };
    case "finishing_on_old":
      return { symbol: "◐", word: `Finishing on ${version(detail.from_version) ?? "old text"}`, detail: join(people, `carried to ${version(detail.version) ?? "the new text"} on submit`) };
    case "submitted": {
      const word = detail.total != null && detail.submitted != null ? `${detail.submitted} of ${detail.total} submitted` : "submitted";
      return { symbol: "✓", word, detail: join(people, detail.findings != null ? plural(detail.findings, "finding") : null, waiting) };
    }
    default: return fallback(cell);
  }
}

/** "Round 1 · Ana Weber" / "Consolidation · Luc Martin" (+ " · v1" when not on the newest version). */
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
      return { symbol: "⚠", word: "Check changes", detail: [...new Set((detail.causes ?? []).map(code => FINAL_CAUSE_TEXT[code] ?? "changed"))].join(" · ") };
    case "old_text": return { symbol: "⚠", word: "Final is on old text", detail: finalKindText(cell) };
    case "may_be_outdated": return { symbol: "⚠", word: "may be outdated", detail: "source changed" };
    case "final": return { symbol: "✓", word: "Final", detail: detail.note === "not_exported" ? "not exported" : finalKindText(cell) };
    default: return fallback(cell);
  }
}

/** An unknown state (a newer server): the tone's glyph and the state name in words. */
function fallback(cell: StageCellView): StageText {
  return { symbol: TONE_SYMBOLS[cell.tone] ?? "", word: cell.state.replace(/_/g, " "), detail: "" };
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
export function waitingOnText(row: Pick<DocumentRowView, "in_plan" | "plan_row" | "next_step">): { text: string; title: string; you: boolean } {
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
  if (people.length === 1) return { text: personLabel(people[0]), title, you: false };
  const shown = people.slice(0, WAITING_ON_NAMES).map(shortName).join(", ");
  const rest = people.length - WAITING_ON_NAMES;
  return { text: rest > 0 ? `${shown} +${rest}` : shown, title, you: false };
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
