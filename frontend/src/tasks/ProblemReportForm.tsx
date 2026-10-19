import { useEffect, useRef, useState } from "react";
import { api, type AssignmentView, type ProblemReportRequest, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Textarea } from "../ui";

export function ProblemReportForm({ assignment, onSaveBeforeReport, onReported, onBusyChange }: {
  assignment: AssignmentView; onSaveBeforeReport: () => Promise<void>; onReported: (report: ProblemReportView) => void; onBusyChange?: (busy: boolean) => void;
}): JSX.Element {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(), [saveFailed, setSaveFailed] = useState(false), [keepUnsaved, setKeepUnsaved] = useState(false), [busy, setBusy] = useState(false);
  const active = useRef(false), writing = useRef(false), requests = useRef(new Map<string, ProblemReportRequest>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const submit = async () => {
    if (writing.current || !reason.trim()) return;
    writing.current = true; setBusy(true); onBusyChange?.(true); setError(undefined);
    try {
      if (!(saveFailed && keepUnsaved)) {
        try { await onSaveBeforeReport(); }
        catch (failure) { if (active.current) { setSaveFailed(true); setKeepUnsaved(false); } throw failure; }
      }
      const key = JSON.stringify([assignment.id, assignment.workflow_revision, assignment.active_round_id, assignment.last_submission_id, reason.trim()]);
      let request = requests.current.get(key);
      if (!request) {
        request = { request_id: crypto.randomUUID(), expected_workflow_revision: assignment.workflow_revision, round_id: assignment.active_round_id ?? null, submission_id: assignment.last_submission_id ?? null, reason: reason.trim() };
        requests.current.set(key, request);
      }
      const report = await api.createProblemReport(assignment.id, request);
      if (active.current) onReported(report);
    } catch (failure) { if (active.current) setError(failure); }
    finally { writing.current = false; if (active.current) setBusy(false); onBusyChange?.(false); }
  };
  return <form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <p>Describe the problem for project leads. Reporting pauses this personal task, including saves and submission. Your saved work and submitted history remain available.</p>
    <p>Only you and project leads can read this report. Leads can pause related tasks with a separate reason.</p>
    <Textarea id="problem-description" label="Problem description" value={reason} required disabled={busy} onChange={event => setReason(event.target.value)} />
    {error !== undefined && <ErrorNotice error={error} />}
    {saveFailed && <Checkbox id="report-keep-unsaved" label="Keep my unsaved input in this session and report the last saved work" checked={keepUnsaved} disabled={busy} onChange={event => setKeepUnsaved(event.target.checked)} />}
    {saveFailed && <p>Unsaved input stays in this open editor. Keep this session open until you resume and save it.</p>}
    <Button type="submit" loading={busy} disabled={!reason.trim()}>Report and pause my task</Button>
  </form>;
}
