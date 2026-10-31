import type { DocumentSummary, TaskSummary } from "../api/client";

/**
 * Whether a case can be opened in the current mode. The server only sets
 * All documents are reviewable, including checked-negative cases with no proposals.
 */
export const canOpenCase = (_doc: DocumentSummary): boolean => true;

/** The nearest case before (-1) or after (1) the current one, in package order, that can be opened. */
export function adjacentCase(
  documents: DocumentSummary[],
  currentDocumentId: string,
  step: 1 | -1,
): DocumentSummary | null {
  const index = documents.findIndex((d) => d.document_id === currentDocumentId);
  if (index < 0) return null;
  for (let i = index + step; i >= 0 && i < documents.length; i += step) {
    if (canOpenCase(documents[i])) return documents[i];
  }
  return null;
}

const ID_SEPARATORS = ":/_.-";

/**
 * The prefix all IDs share, cut back to a separator so no ID loses part of a segment.
 * Returns "" for fewer than two IDs or a prefix shorter than ``minLength``: hiding it
 * would not make the IDs easier to tell apart.
 */
export function sharedIdPrefix(ids: string[], minLength = 8): string {
  if (ids.length < 2) return "";
  let prefix = ids[0];
  for (const id of ids.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < id.length && prefix[i] === id[i]) i++;
    prefix = prefix.slice(0, i);
  }
  let cut = prefix.length;
  while (cut > 0 && !ID_SEPARATORS.includes(prefix[cut - 1])) cut--;
  // Never swallow a whole ID (one ID may be a prefix of another).
  while (cut > 0 && ids.some((id) => id.length <= cut)) {
    cut--;
    while (cut > 0 && !ID_SEPARATORS.includes(prefix[cut - 1])) cut--;
  }
  return cut >= minLength ? prefix.slice(0, cut) : "";
}

/** Adjacent assignments of the same project and task, in the supplied server order. */
export function orderTasks(
  tasks: readonly TaskSummary[],
  current: TaskSummary,
): { previous?: number; next?: number } {
  // A waiting task is no stop on the way (issue 213).
  const matching = tasks.filter((task) => task.project_key === current.project_key && task.task === current.task
    && ((!task.waiting_for_translation_review && !task.waiting_for_lead) || task.assignment_id === current.assignment_id));
  const index = matching.findIndex((task) => task.assignment_id === current.assignment_id);
  if (index < 0) return {};
  const adjacent: { previous?: number; next?: number } = {};
  if (index > 0) adjacent.previous = matching[index - 1].assignment_id;
  if (index + 1 < matching.length) adjacent.next = matching[index + 1].assignment_id;
  return adjacent;
}

/**
 * Unsubmitted tasks of the same project in My tasks (server) order, without the current one (spec A.5), without
 * waiting tasks (issue 213) and without paused ones (nothing can be done in them). The next task is the first one of the current task's type
 * (a translation review leads to the next translation review, issue 198), else the first open one.
 */
export function nextOpenTask(
  tasks: readonly TaskSummary[],
  currentAssignmentId: number,
  projectKey: string,
): { next: TaskSummary | null; remaining: number } {
  const open = tasks.filter((task) =>
    task.project_key === projectKey && task.assignment_id !== currentAssignmentId && task.status !== "submitted"
    && !task.waiting_for_translation_review && !task.waiting_for_lead && !task.held);
  const kind = tasks.find(task => task.assignment_id === currentAssignmentId)?.task;
  const next = (kind !== undefined ? open.find(task => task.task === kind) : undefined) ?? open[0] ?? null;
  return { next, remaining: open.length };
}
