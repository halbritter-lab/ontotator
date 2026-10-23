/**
 * Shared submission and time labels (Documents, confirmations, case viewer).
 * Must not import from `documents/`: other pages reuse these helpers.
 */
import { personLabel as identityLabel, type PersonRef } from "./identity";

export type SubmissionKind = "annotation" | "proposal_check" | "consolidation" | "carry_forward";

export const kindLabels: Readonly<Record<SubmissionKind, string>> = {
  annotation: "Annotation, from scratch",
  proposal_check: "Annotation, from proposals",
  consolidation: "Consolidation",
  carry_forward: "Carried annotation",
};

/** Short month names, shared with the guideline day labels. */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number): string => String(value).padStart(2, "0");

export interface FormatTimeOptions {
  /** Reference "now" for the current-year rule; defaults to the current time. */
  now?: Date;
  /** Show seconds; only where two otherwise identical labels share a minute. */
  seconds?: boolean;
}

/**
 * Local time, e.g. "19 Oct, 00:57"; the year is added outside the current year ("2 Mar 2025, 08:05").
 * Assembled explicitly so the output is stable across locales and ICU versions. Invalid input is returned unchanged.
 */
export function formatTime(value: string | number | Date, options: FormatTimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return String(value);
  const now = options.now ?? new Date();
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  const seconds = options.seconds ? `:${pad(date.getSeconds())}` : "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}, ${pad(date.getHours())}:${pad(date.getMinutes())}${seconds}`;
}

const fullFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "long" });

/** Full timestamp with time zone for `title` attributes. Invalid input is returned unchanged. */
export function fullTimestamp(value: string | number | Date): string {
  const date = toDate(value);
  return date ? fullFormat.format(date) : String(value);
}

function hasDisplayName(person: PersonRef | null | undefined): boolean {
  return !!person?.display_name?.trim();
}

/**
 * A person in a label. With a display name (spec "Identity (D1)", leads and the viewer's own items):
 * "Ana Weber (ann-0004)", own items "Project Lead (ann-0002, you)". Without one the pseudonym,
 * the viewer's own items marked "(you)". Usernames are never part of it.
 */
export function personLabel(pseudonym: string, isMe: boolean, person?: PersonRef | null): string {
  if (person && hasDisplayName(person)) return identityLabel({ ...person, is_me: !!person.is_me || isMe });
  const name = person?.pseudonym ?? pseudonym;
  return isMe ? `${name} (you)` : name;
}

/**
 * "Round 1 (lead-0002, you)"; a submission without a round is "Initial submission (...)"; `name` replaces the
 * round part (e.g. "Consolidation"). With a display name "Round 1, Ana Weber (ann-0004)". Never nested parentheses.
 */
export function roundCell(input: { ordinal: number | null; author: string; isMe: boolean; person?: PersonRef | null; name?: string }): string {
  const round = input.name ?? (input.ordinal == null ? "Initial submission" : `Round ${input.ordinal}`);
  if (hasDisplayName(input.person)) return `${round}, ${personLabel(input.author, input.isMe, input.person)}`;
  return `${round} (${input.author}${input.isMe ? ", you" : ""})`;
}

export interface SubmissionLabelInput {
  kind: SubmissionKind;
  /** Round number along the assignment's predecessor chain; null = initial submission. */
  ordinal: number | null;
  author: string;
  isMe: boolean;
  /** Server person ref; its display name is shown when present (leads). */
  person?: PersonRef | null;
  language: string;
  /** Version text, e.g. "v1" or "DeepL v3 v1"; null omits it (the Final column appends its own marker). */
  version: string | null;
  /** Server `submissions.recorded_at`. */
  recordedAt: string;
}

export interface SubmissionLabelOptions extends FormatTimeOptions {
  /** Include the language before the version (default true); the Final column omits it. */
  withLanguage?: boolean;
}

/**
 * "{kind}, {Round n | Initial submission}, {author}, {language} {version}, {time}".
 * Consolidations omit the round. IDs are never part of a label.
 */
export function submissionLabel(input: SubmissionLabelInput, options: SubmissionLabelOptions = {}): string {
  const { withLanguage = true, ...timeOptions } = options;
  const parts: string[] = [kindLabels[input.kind]];
  if (input.kind !== "consolidation") parts.push(input.ordinal == null ? "Initial submission" : `Round ${input.ordinal}`);
  parts.push(personLabel(input.author, input.isMe, input.person));
  const version = [withLanguage ? input.language : "", input.version ?? ""].filter(Boolean).join(" ");
  if (version) parts.push(version);
  parts.push(formatTime(input.recordedAt, timeOptions));
  return parts.join(", ");
}
