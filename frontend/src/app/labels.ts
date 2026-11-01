import type { Route } from "./router";
import { taskText } from "./identity";

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
  review: "Consolidation",
  translation_review: "Translation review",
};

type TaskTextFields = Parameters<typeof taskText>[0] & { task: string };

/** Breadcrumb name of a task: the heading's text name and the task, "failed-translation de, Translation review". */
export function taskCrumbLabel(task: TaskTextFields): string {
  // The consolidation view's title names the text already (B5-6): its crumb is the task alone.
  if (task.task === "review") return `${labelFor(taskLabels, task.task)} (${task.language})`;
  return `${taskText(task)}, ${labelFor(taskLabels, task.task)}`;
}

const ROUTE_PAGES: Readonly<Record<Exclude<Route["name"], "task" | "projectCase">, string>> = {
  tasks: "My tasks", me: "Profile", adminUsers: "Users", adminOntologies: "Ontologies", adminReports: "Technical reports", projectNew: "New project",
  projects: "Projects", projectSettings: "Settings", projectDocuments: "Documents", projectProgress: "Progress",
  projectExport: "Export", projectGuidelines: "Guidelines", projectProblemReport: "Problem report",
  projectConsolidation: "Consolidation", help: "Handbook", notFound: "Page not found",
};

/**
 * Browser title parts of a route, most specific first: "Documents", "Ward notes" (#9).
 * `project` is undefined while unknown and null when it is not found or not accessible.
 */
export function routeTitle(route: Route, project?: { name: string } | null, task?: TaskTextFields | null): string[] {
  if (route.name === "task") return task ? [taskText(task), labelFor(taskLabels, task.task)] : ["Task"];
  if ("key" in route && project === null) return ["Project not found"];
  const page = route.name === "projectCase" ? route.caseId : ROUTE_PAGES[route.name];
  return "key" in route ? [page, project?.name ?? route.key] : [page];
}

export const assignmentStatusLabels: Readonly<Record<"unassigned" | "open" | "in_progress" | "submitted" | "reopened", string>> = {
  unassigned: "Unassigned",
  open: "Open",
  in_progress: "In progress",
  submitted: "Submitted",
  reopened: "Reopened",
};

export const roleLabels: Readonly<Record<"lead" | "annotator" | "adjudicator", string>> = {
  lead: "Lead",
  annotator: "Annotator",
  adjudicator: "Consolidator",
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
  t1: "Ontospan bundle",
  text: "Plain text",
};

/** "1 document", "3 documents"; pass the plural for irregular nouns. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

const shortDateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Day, month and time for dense tables, e.g. "27 Oct, 10:18"; pair it with `formatDateTime` in a title. */
export function formatShortDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : shortDateTime.format(date);
}

/** One English date format for workflow pages, e.g. "16 Oct 2026, 19:17". Invalid input is returned unchanged. */
export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateTime.format(date);
}

/** The lead's reason for a consolidation (issue 146), for the consolidator in My tasks and the consolidation header. */
export function consolidationReasonText(reason: string): string {
  return `Reason from the lead: ${reason}`;
}

/** Why and when a reopened task was reopened (My tasks and the editor); null for other statuses. */
export function reopenNotice(task: { status: string; reopened_at?: string | null; reopen_reason?: string | null }): string | null {
  if (task.status !== "reopened") return null;
  const when = task.reopened_at ? ` on ${formatDateTime(task.reopened_at)}` : "";
  return `The project lead reopened this task${when}. ${task.reopen_reason ? `Reason: ${task.reopen_reason}` : "No reason given."}`;
}
