import { useRef, useState } from "react";
import { api, type AssignmentView, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Dialog, InlineMessage, Textarea } from "../ui";
import { ProblemReportForm } from "./ProblemReportForm";
import { ReportHistory } from "./ReportHistory";

export function TaskProblemActions({ assignment, onSaveBeforeReport, onRefresh }: { assignment: AssignmentView; onSaveBeforeReport: () => Promise<void>; onRefresh: (assignment: AssignmentView) => void }): JSX.Element {
  const [open, setOpen] = useState(false), [reports, setReports] = useState<ProblemReportView[] | null>(null);
  const [drafting, setDrafting] = useState(true);
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [reasons, setReasons] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, string>()), writing = useRef(false);
  const refresh = async () => onRefresh(await api.getAssignmentMetadata(assignment.id));
  const load = async () => {
    setBusy(true); setError(undefined);
    try {
      const [values, metadata] = await Promise.all([api.listProblemReports(assignment.project_key, assignment.document_id), api.getAssignmentMetadata(assignment.id)]);
      setReports(values.filter(value => value.assignment_id === assignment.id)); onRefresh(metadata);
    }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  const resume = async (report: ProblemReportView) => {
    const reason = reasons[report.report_id]?.trim();
    if (!reason || writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    const key = JSON.stringify([report.report_id, report.revision, reason]);
    let request_id = requests.current.get(key);
    if (!request_id) { request_id = crypto.randomUUID(); requests.current.set(key, request_id); }
    try {
      const value = await api.actOnProblemReport(report.report_id, { request_id, expected_revision: report.revision, action: "resume", reason, assignment_ids: [assignment.id] });
      setReports(values => values?.map(item => item.report_id === value.report_id ? value : item) ?? null);
      await refresh();
    } catch (failure) { setError(failure); }
    finally { writing.current = false; setBusy(false); }
  };
  return <>
    <Button size="sm" disabled={busy} onClick={() => { setDrafting(true); setOpen(true); }}>Report a problem</Button>
    <Button size="sm" disabled={busy} onClick={() => { setDrafting(false); setOpen(true); void load(); }}>My problem reports</Button>
    {open && <Dialog open title="Task problem reports" onClose={() => { if (!busy) setOpen(false); }} footer={<>
      <Button disabled={busy} onClick={() => { void load(); }}>Reload my reports</Button>
      <Button disabled={busy} onClick={() => setOpen(false)}>Close reports</Button>
    </>}>
      {assignment.held && <InlineMessage tone="warning">Task paused: {assignment.hold_reason ?? "A project problem needs attention."} Your input stays in this editor.</InlineMessage>}
      {drafting && <ProblemReportForm assignment={assignment} onBusyChange={setBusy} onSaveBeforeReport={onSaveBeforeReport} onReported={report => {
        setDrafting(false);
        setReports(values => [report, ...(values ?? []).filter(value => value.report_id !== report.report_id)]);
        onRefresh({ ...assignment, held: true, hold_reason: report.reason, workflow_revision: assignment.workflow_revision + 1 });
        void refresh().catch(setError);
      }} />}
      {error !== undefined && <ErrorNotice error={error} />}
      {reports?.map(report => <section key={report.report_id}><h3>My report · {report.state}</h3><p className="annotation-note-history">{report.reason}</p>
        {report.resolution && <p>Resolution: {report.resolution}</p>}
        <ReportHistory report={report} />
        {(report.held_assignment_ids ?? []).includes(assignment.id) && <form onSubmit={event => { event.preventDefault(); void resume(report); }}>
          <p>Resuming releases this report’s pause on your task. Other active pauses may remain; the report stays open.</p>
          <Textarea id={`resume-${report.report_id}`} label="Reason to resume" required value={reasons[report.report_id] ?? ""} disabled={busy} onChange={event => setReasons(values => ({ ...values, [report.report_id]: event.target.value }))} />
          <Button type="submit" loading={busy} disabled={!reasons[report.report_id]?.trim()}>Resume my task</Button>
        </form>}
      </section>)}
      {reports?.length === 0 && <p>No reports from you for this task. A pause added by a lead is described in the task banner; contact the lead to release it.</p>}
    </Dialog>}
  </>;
}
