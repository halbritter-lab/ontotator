import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AssignmentView, type ProblemReportView } from "../api/client";

const newestFirst = (a: ProblemReportView, b: ProblemReportView): number => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "");

/** The fields the reporter dialog, the editor and the guidelines entry read; any difference means the editor's task is stale. */
function assignmentChanged(current: AssignmentView, fresh: AssignmentView): boolean {
  return current.workflow_revision !== fresh.workflow_revision || current.held !== fresh.held
    || (current.hold_reason ?? null) !== (fresh.hold_reason ?? null) || current.status !== fresh.status
    || JSON.stringify(current.active_holds ?? []) !== JSON.stringify(fresh.active_holds ?? [])
    // The guidelines button and the update notice read these.
    || JSON.stringify(current.guideline ?? null) !== JSON.stringify(fresh.guideline ?? null)
    || JSON.stringify(current.guideline_notice ?? null) !== JSON.stringify(fresh.guideline_notice ?? null);
}

export interface TaskReports {
  /** The reporter's reports on this task, newest first; `null` before the first load or after a failed load. */
  reports: ProblemReportView[] | null;
  error: unknown;
  /** Reloads the reports; with `withAssignment` also the task metadata (window focus, dialog open, own actions). */
  reload: (withAssignment?: boolean) => Promise<void>;
  /** Puts one report (fresh from an own action) into the list, first when new. */
  put: (report: ProblemReportView) => void;
}

/**
 * The reporter's reports on one task. Loads on mount and on window focus; the caller reloads when the dialog
 * opens and after each own action. One request counter covers the report list and the task metadata: a
 * response pair older than the newest request is discarded as a whole. A changed task is handed to
 * `onRefresh` (never when nothing changed, so no refresh loop).
 */
export function useTaskReports(assignment: AssignmentView, onRefresh: (assignment: AssignmentView) => void): TaskReports {
  const [reports, setReports] = useState<ProblemReportView[] | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const current = useRef(assignment), refresh = useRef(onRefresh), counter = useRef(0), mounted = useRef(true);
  current.current = assignment;
  refresh.current = onRefresh;

  const reload = useCallback(async (withAssignment = false) => {
    const request = ++counter.current;
    const { id, project_key } = current.current;
    const [list, metadata] = await Promise.allSettled([
      api.listTaskProblemReports(project_key, id),
      withAssignment ? api.getAssignmentMetadata(id) : Promise.resolve(null),
    ]);
    if (!mounted.current || request !== counter.current) return;
    if (list.status === "fulfilled") { setReports([...list.value].sort(newestFirst)); setError(undefined); }
    else { setReports(null); setError(list.reason); }
    // A failed metadata load keeps the previous assignment.
    if (metadata.status === "fulfilled" && metadata.value && assignmentChanged(current.current, metadata.value)) refresh.current(metadata.value);
  }, []);

  const put = useCallback((report: ProblemReportView) => {
    setReports(values => {
      const list = values ?? [];
      return list.some(value => value.report_id === report.report_id)
        ? list.map(value => value.report_id === report.report_id ? report : value)
        : [report, ...list];
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload(false);
    const onFocus = () => { void reload(true); };
    window.addEventListener("focus", onFocus);
    return () => { mounted.current = false; window.removeEventListener("focus", onFocus); };
  }, [reload, assignment.id]);

  return { reports, error, reload, put };
}
