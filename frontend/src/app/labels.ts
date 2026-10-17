/** Plain-English presentation of workflow codes outside the editor. Codes stay the data; these are display only. */

/** Readable fallback for codes without an explicit label: "ready_for_review" -> "Ready for review". */
export function humanize(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : code;
}

/** Looks up a code's label and falls back to a humanized code for values added later on the server. */
export function labelFor(labels: Readonly<Record<string, string>>, code: string): string {
  return Object.hasOwn(labels, code) ? labels[code] : humanize(code);
}

export const taskLabels: Readonly<Record<"annotate" | "review" | "translation_review", string>> = {
  annotate: "Annotation",
  review: "Review",
  translation_review: "Translation review",
};

export const assignmentStatusLabels: Readonly<Record<"unassigned" | "open" | "in_progress" | "submitted" | "reopened", string>> = {
  unassigned: "Unassigned",
  open: "Open",
  in_progress: "In progress",
  submitted: "Submitted",
  reopened: "Reopened",
};

export const roleLabels: Readonly<Record<"lead" | "annotator" | "adjudicator", string>> = {
  lead: "Project lead",
  annotator: "Annotator",
  adjudicator: "Adjudicator",
};

export const jobStatusLabels: Readonly<Record<"queued" | "running" | "succeeded" | "failed", string>> = {
  queued: "Waiting to start",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
};

export const uploadStatusLabels: Readonly<Record<string, string>> = {
  previewing: "Checking files",
  ready: "Ready to import",
  invalid: "Problems found",
  committing: "Importing",
  committed: "Imported",
  failed: "Failed",
  discarded: "Discarded",
};

export const uploadKindLabels: Readonly<Record<"t1" | "text", string>> = {
  t1: "Ontospan bundle (T1)",
  text: "Plain text",
};

/** "1 document", "3 documents"; pass the plural for irregular nouns. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** One English date format for workflow pages, e.g. "16 Oct 2026, 19:17". Invalid input is returned unchanged. */
export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateTime.format(date);
}
