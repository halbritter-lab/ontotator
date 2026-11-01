import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { api, type AssignmentView, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { textLabel } from "../app/identity";
import { ownPauseActive, ReporterReportCard, type ReporterConfirm } from "../problems/ReporterReportCard";
import { reportTitle, toolbarEntry } from "../problems/labels";
import { useTaskReports } from "../problems/useTaskReports";
import { Button, Dialog, IconWarning, InlineMessage, type MenuItem } from "../ui";
import { ProblemReportForm } from "./ProblemReportForm";
import "../problems/problems.css";

/**
 * The editor's "Report a text problem" toolbar entry and its dialog: the reporter's own reports on this task,
 * a new report, resume and withdraw. Mounted by the annotation editor and the translation review screen.
 * On a submitted (read-only) task the entry reads "Text problems" and opens on the reports, the form second.
 */
export function TaskProblemActions({ assignment, textName, onSaveBeforeReport, onRefresh, readOnly = assignment.status === "submitted", renderEntry }: {
  assignment: AssignmentView; onSaveBeforeReport: () => Promise<void>; onRefresh: (assignment: AssignmentView) => void;
  /** The text's name for the dialog title ("Problems with case-107 de"); else the reports' text, never the task number. */
  textName?: string;
  /** The editor's read-only state (the task's status can lag behind a submit in the same editor). */
  readOnly?: boolean;
  /** Places the entry as a menu item (the editor's "More" menu) instead of the toolbar button. */
  renderEntry?: (item: MenuItem) => ReactNode;
}): JSX.Element {
  const { reports, error, reload, put } = useTaskReports(assignment, onRefresh);
  const [open, setOpen] = useState(false), [view, setView] = useState<"list" | "form">("list");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ReporterConfirm | null>(null);
  const [focusReport, setFocusReport] = useState<string | null>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const newReport = useRef<HTMLButtonElement>(null);
  const listLabel = useId();
  const entry = toolbarEntry(reports, assignment.held);
  const marking = useRef(new Set<string>());

  const openDialog = () => {
    setNotice(null); setConfirm(null);
    setView(!readOnly && reports && reports.length === 0 ? "form" : "list");
    setOpen(true);
    void reload(true);
  };
  const close = () => { setOpen(false); setConfirm(null); setNotice(null); };

  // No report (after the load on open): the dialog shows the new report view directly.
  useEffect(() => { if (!readOnly && open && view === "list" && reports?.length === 0 && !busy) setView("form"); }, [readOnly, open, view, reports, busy]);
  // The listed reports are open in front of the reporter: a lead answer counts as seen (My tasks badge).
  useEffect(() => {
    if (!open || view !== "list") return;
    for (const report of reports ?? []) {
      if (!report.answered || marking.current.has(report.report_id)) continue;
      marking.current.add(report.report_id);
      api.markProblemReportSeen(report.report_id).then(put, () => undefined).finally(() => marking.current.delete(report.report_id));
    }
  }, [open, view, reports, put]);
  useEffect(() => {
    if (!focusReport) return;
    const target = headings.current.get(focusReport);
    if (target) { target.focus(); setFocusReport(null); }
  }, [focusReport, reports, view, open]);

  // List view: the first report whose own pause is active, else "New report".
  const focusTarget = reports?.find(ownPauseActive)?.report_id ?? null;
  const listFocus = { get current() { return (focusTarget && headings.current.get(focusTarget)) || newReport.current; } } as RefObject<HTMLElement>;

  // Escape / header and footer Close: never while a write is busy; an open confirmation with text asks first.
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
    {renderEntry ? renderEntry({ id: "problems", label: `${readOnly ? "Text problems" : "Report a text problem…"}${entry.badge ? ` (${entry.badge})` : ""}`, onSelect: openDialog })
    : <Button size="sm" className="problem-entry" onClick={openDialog}>
      {readOnly ? "Text problems" : "Report a text problem"}
      {entry.badge && <> <span className="problem-badge" aria-hidden="true">{entry.paused && <IconWarning />}{entry.badge}</span></>}
      <span className="visually-hidden"> {entry.accessibleSuffix}</span>
    </Button>}
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
    {open && view === "list" && <Dialog open title={`Problems with ${textName ?? (reports?.[0] ? textLabel(reports[0]) : "this text")}`} size="md" initialFocus={listFocus} onClose={onListClose} footer={<>
      <Button ref={newReport} onClick={() => {
        // Typed confirmation text asks to discard first, like Close and Escape.
        if (confirm?.reason.trim()) { setConfirm({ ...confirm, askDiscard: true }); return; }
        setConfirm(null); setNotice(null); setView("form");
      }}>New report</Button>
      <Button aria-disabled={busy || undefined} onClick={() => onListClose?.()}>Close</Button>
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
          // A resume or withdrawal replaces the "Reported. Your task is paused" notice: the card states the outcome.
          onUpdated={value => { setNotice(null); put(value); void reload(true); }}
          onConflict={() => { void reload(true); }}
          headingRef={element => { if (element) headings.current.set(report.report_id, element); else headings.current.delete(report.report_id); }} />)}
      </section>}
      {readOnly && reports?.length === 0 && <p>You have not reported a problem with this text.</p>}
      {leadActed && <p className="field-hint">A project lead has acted on this report. Resume your task with a reason and ask a project lead to close it.</p>}
    </Dialog>}
  </>;
}
