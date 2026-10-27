/**
 * Visit state of the Documents page under a decision filter (open questions 8 and 9).
 *
 * Rows shown as matching the active decision filter are remembered with a snapshot of their
 * categories, work, final result and reports. A remembered row that stops matching stays
 * visible (its key is sent as `retain`, the server returns it with current data and
 * `retained: true`) with a badge: "Resolved" when a decision on the Documents page or the
 * problem report page removed the category, else "Changed: {reason}".
 *
 * The state lives in `sessionStorage` per project and filter, so it survives the remount when
 * the lead returns from the report page. A filter change (`clearVisits`) or a reload
 * (`beforeunload`) clears it.
 */
import type { DocumentRowView } from "../api/client";

export interface RowSnapshot {
  categories: string[];
  work: { assignment_id: number; held: boolean }[];
  final: { submission_id: string; revision: number } | null;
  reports: { report_id: string; state: string; active_hold_count: number }[];
}

export interface RowBadge {
  tone: "success" | "neutral";
  text: string;
}

interface VisitRecord {
  shown: Record<string, RowSnapshot>;
  decided: string[];
}

const PREFIX = "ontotator:documents-visit:";
/** The server accepts at most this many `retain` keys. */
export const MAX_RETAIN = 200;

export const visitStorageKey = (projectKey: string, filterKey: string): string => `${PREFIX}${projectKey}:${filterKey}`;

const rowKey = (row: Pick<DocumentRowView, "case_id" | "language">): string => `${row.case_id}:${row.language}`;

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

function read(key: string): VisitRecord {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(key) ?? "null");
    if (value && typeof value === "object" && "shown" in value && "decided" in value) {
      const record = value as VisitRecord;
      if (record.shown && typeof record.shown === "object" && Array.isArray(record.decided)) return record;
    }
  } catch { /* unreadable state starts over */ }
  return { shown: {}, decided: [] };
}

function write(key: string, record: VisitRecord): void {
  try { storage()?.setItem(key, JSON.stringify(record)); } catch { /* storage full or blocked: no badges */ }
}

/** Storage keys of every visit of the project (filter keys are JSON objects). */
function projectKeys(projectKey: string): string[] {
  const store = storage();
  if (!store) return [];
  const prefix = `${PREFIX}${projectKey}:{`;
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

export function snapshotOf(row: DocumentRowView): RowSnapshot {
  return {
    categories: [...row.categories],
    work: row.work.map(item => ({ assignment_id: item.assignment_id, held: item.held })),
    final: row.final ? { submission_id: row.final.submission_id, revision: row.final.revision } : null,
    reports: (row.problem_reports ?? []).map(report => ({ report_id: report.report_id, state: report.state, active_hold_count: report.active_hold_count })),
  };
}

/**
 * Remember the rows shown as matching the decision filter. A remembered row that matches again
 * gets a fresh snapshot and loses an earlier decision mark; rows that no longer match keep the
 * snapshot from when they last matched.
 */
export function rememberShown(projectKey: string, filterKey: string, rows: readonly DocumentRowView[]): void {
  const key = visitStorageKey(projectKey, filterKey);
  const record = read(key);
  const matching = rows.filter(row => row.matches_decision);
  if (matching.length === 0 && Object.keys(record.shown).length === 0) return;
  const matched = new Set<string>();
  for (const row of matching) {
    record.shown[rowKey(row)] = snapshotOf(row);
    matched.add(rowKey(row));
  }
  record.decided = record.decided.filter(item => !matched.has(item));
  write(key, record);
}

/** Keys to send as `retain`: every remembered row (current matches come back anyway). */
export function retainedKeys(projectKey: string, filterKey: string): string[] {
  return Object.keys(read(visitStorageKey(projectKey, filterKey)).shown).slice(0, MAX_RETAIN);
}

/** A selection, keep, resume or resolve on this row (Documents or the problem report page). */
export function recordDecision(projectKey: string, rowKeyValue: string): void {
  for (const key of projectKeys(projectKey)) {
    const record = read(key);
    if (!(rowKeyValue in record.shown) || record.decided.includes(rowKeyValue)) continue;
    record.decided.push(rowKeyValue);
    write(key, record);
  }
}

/** Open question 8: the first reason that explains why the row stopped matching. */
export function changeReason(snapshot: RowSnapshot, current: DocumentRowView): string {
  const before = new Map(snapshot.work.map(item => [item.assignment_id, item.held]));
  if (current.work.some(item => !before.has(item.assignment_id))) return "Work assigned";
  if (current.work.some(item => item.held && before.get(item.assignment_id) === false)) return "Task paused";
  if (current.work.some(item => !item.held && before.get(item.assignment_id) === true)) return "Task resumed";
  const final = current.final ? { submission_id: current.final.submission_id, revision: current.final.revision } : null;
  if (final?.submission_id !== snapshot.final?.submission_id || final?.revision !== snapshot.final?.revision) return "Final result changed";
  return "Updated elsewhere";
}

export function badgeFor(snapshot: RowSnapshot, current: DocumentRowView, decided: boolean): RowBadge {
  if (decided) return { tone: "success", text: "Resolved" };
  return { tone: "neutral", text: `Changed: ${changeReason(snapshot, current)}` };
}

/** Badges of the shown rows that were remembered and no longer match the decision filter. */
export function rowBadges(projectKey: string, filterKey: string, rows: readonly DocumentRowView[]): Map<string, RowBadge> {
  const record = read(visitStorageKey(projectKey, filterKey));
  const decided = new Set(record.decided);
  const badges = new Map<string, RowBadge>();
  for (const row of rows) {
    const key = rowKey(row);
    const snapshot = record.shown[key];
    if (!snapshot || row.matches_decision) continue;
    badges.set(key, badgeFor(snapshot, row, decided.has(key)));
  }
  return badges;
}

/** Clear the project's visits except `keepFilterKey` (a filter change), or every visit (reload). */
export function clearVisits(projectKey?: string, keepFilterKey?: string): void {
  const store = storage();
  if (!store) return;
  const keep = projectKey !== undefined && keepFilterKey !== undefined ? visitStorageKey(projectKey, keepFilterKey) : null;
  const doomed: string[] = [];
  if (projectKey !== undefined) doomed.push(...projectKeys(projectKey));
  else for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(PREFIX)) doomed.push(key);
  }
  try { for (const key of doomed) if (key !== keep) store.removeItem(key); } catch { /* ignore */ }
}

// A reload starts a new visit.
if (typeof window !== "undefined") window.addEventListener("beforeunload", () => clearVisits());
