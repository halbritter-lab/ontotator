import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { AssignmentView, ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { ownPauseActive, ReporterReportCard, type ReporterConfirm } from "../problems/ReporterReportCard";
import { reportTitle, toolbarEntry } from "../problems/labels";
import { useTaskReports } from "../problems/useTaskReports";
import { Button, Dialog, IconWarning, InlineMessage } from "../ui";
import { ProblemReportForm } from "./ProblemReportForm";
import "../problems/problems.css";

/**
 * The editor's "Report problem" toolbar entry and its dialog: the reporter's own reports on this task,
 * a new report, resume and withdraw. Mounted by the annotation editor and the translation review screen.
 */
export function TaskProblemActions({ assignment, onSaveBeforeReport, onRefresh }: { assignment: AssignmentView; onSaveBeforeReport: () => Promise<void>; onRefresh: (assignment: AssignmentView) => void }): JSX.Element {
  const { reports, error, reload, put } = useTaskReports(assignment, onRefresh);
  const [open, setOpen] = useState(false), [view, setView] = useState<"list" | "form">("list");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ReporterConfirm | null>(null);
  const [focusReport, setFocusReport] = useState<string | null>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const newReport = useRef<HTMLButtonElement>(null);
  const listLabel = useId();
  const entry = toolbarEntry(reports, assignment.held);

  const openDialog = () => {
    setNotice(null); setConfirm(null);
    setView(reports && reports.length === 0 ? "form" : "list");
    setOpen(true);
    void reload(true);
  };
  const close = () => { setOpen(false); setConfirm(null); setNotice(null); };

  // No report (after the load on open): the dialog shows the new report view directly.
  useEffect(() => { if (open && view === "list" && reports?.length === 0 && !busy) setView("form"); }, [open, view, reports, busy]);
  useEffect(() => {
    if (!focusReport) return;
    const target = headings.current.get(focusReport);
    if (target) { target.focus(); setFocusReport(null); }
  }, [focusReport, reports, view, open]);

  // List view: the first report whose own pause is active, else "New report".
  const focusTarget = reports?.find(ownPauseActive)?.report_id ?? null;
  const listFocus = { get current() { return (focusTarget && headings.current.get(focusTarget)) || newReport.current; } } as RefObject<HTMLElement>;

  // Escape / header Close: never while a write is busy; an open confirmation with text asks first.
  const onListClose = busy ? undefined : () => {
    if (confirm?.reason.trim()) setConfirm({ ...confirm, askDiscard: true });
    else if (confirm) setConfirm(null);
    else close();
  };

  const causes = (assignment.active_holds ?? []).map((h, index) => {
    if (h.own_report_id !== null) {
      const own = reports?.find(r => r.report_id === h.own_report_id);
      return <p key={`own-${h.own_report_id}-${index}`}>{`Paused by your report "${reportTitle(own?.reason ?? h.reason)}".`}</p>;
    }
    return <p key={`lead-${index}`}>{`Paused by a project lead: ${h.reason}. Only a project lead can release this pause.`}</p>;
  });
  const leadActed = (reports ?? []).some(r => r.state === "open" && r.withdrawable === false);

  return <>
    <Button size="sm" className="problem-entry" onClick={openDialog}>
      Report problem
      {entry.badge && <> <span className="problem-badge" aria-hidden="true">{entry.paused && <IconWarning />}{entry.badge}</span></>}
      <span className="visually-hidden"> {entry.accessibleSuffix}</span>
    </Button>
    {open && view === "form" && <ProblemReportForm assignment={assignment} onSaveBeforeReport={onSaveBeforeReport} onBusyChange={setBusy}
      onAssignmentReload={onRefresh}
      onCancel={() => { if (reports?.length) setView("list"); else close(); }}
      onClose={close}
      onReported={report => {
        put(report);
        setNotice("Reported. Your task is paused until you or a project lead resume it.");
        setFocusReport(report.report_id);
        setView("list");
        void reload(true);
      }}
      frame={({ body, footer, initialFocus, onClose }) => <Dialog open title="New problem report" size="md" initialFocus={initialFocus} onClose={onClose} footer={footer}>{body}</Dialog>} />}
    {open && view === "list" && <Dialog open title={`Problems with Task ${assignment.id}`} size="md" initialFocus={listFocus} onClose={onListClose} footer={<>
      <Button ref={newReport} onClick={() => { setConfirm(null); setNotice(null); setView("form"); }}>New report</Button>
      <Button variant="quiet" aria-disabled={busy || undefined} onClick={() => { if (!busy) close(); }}>Close</Button>
    </>}>
      <div className="problem-task-status">
        <p>{`Your task: ${assignment.held ? "Paused" : "Active"}`}</p>
        {causes}
        {assignment.status === "submitted" && <p>Your submitted result stays unchanged and readable.</p>}
      </div>
      {notice && <InlineMessage tone="success">{notice}</InlineMessage>}
      {reports === null && error !== undefined && <div className="problem-load-error">
        <ErrorNotice error={error} />
        <Button onClick={() => { void reload(true); }}>Retry</Button>
      </div>}
      {reports && reports.length > 0 && <section aria-labelledby={listLabel} className="reporter-reports">
        <p id={listLabel} className="reporter-reports-heading"><strong>{`Your reports (${reports.length})`}</strong></p>
        {reports.map((report: ProblemReportView) => <ReporterReportCard key={report.report_id} report={report} assignment={assignment}
          confirm={confirm?.reportId === report.report_id ? confirm : null} onConfirmChange={setConfirm}
          busy={busy} onBusyChange={setBusy}
          onUpdated={value => { put(value); void reload(true); }}
          onConflict={() => { void reload(true); }}
          headingRef={element => { if (element) headings.current.set(report.report_id, element); else headings.current.delete(report.report_id); }} />)}
      </section>}
      {leadActed && <p className="field-hint">A project lead has acted on this report. Resume your task with a reason and ask a project lead to close it.</p>}
    </Dialog>}
  </>;
}
