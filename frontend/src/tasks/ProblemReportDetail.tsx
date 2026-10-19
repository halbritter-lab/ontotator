import { useEffect, useRef, useState } from "react";
import { api, type AssignmentView, type ProblemActionRequest, type ProblemReportView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { recordDecision } from "../documents/visitState";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, EmptyState, InlineMessage, Select, StatusBadge, Textarea } from "../ui";
import { ReportHistory } from "./ReportHistory";

/** The paused task to preselect for `action=resume`: the report's own task, else the only paused one. */
function resumePreselection(report: ProblemReportView): number[] {
  const held = report.held_assignment_ids ?? [];
  return held.includes(report.assignment_id) ? [report.assignment_id] : held.length === 1 ? [...held] : [];
}

export function ProblemReportDetail({ projectKey, reportId, canManage, action: routeAction, documents, onNavigate }: {
  projectKey: string; reportId: string; canManage: boolean;
  /** `resume` only preselects the pause release; nothing is submitted until the lead applies. */
  action?: "resume";
  /** Documents query the lead came from; the back link returns to exactly this view. */
  documents?: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  const [report, setReport] = useState<ProblemReportView | null>(null), [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(), [reload, setReload] = useState(0);
  const [action, setAction] = useState<ProblemActionRequest["action"]>("resolve"), [reason, setReason] = useState("");
  const [selected, setSelected] = useState<number[]>([]), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const writing = useRef(false), alive = useRef(false), preselected = useRef(false), requests = useRef(new Map<string, ProblemActionRequest>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!canManage) return;
    let current = true; setLoading(true); setError(undefined);
    Promise.all([api.listProblemReports(projectKey), api.listAssignments(projectKey)]).then(([reports, tasks]) => {
      if (!current) return;
      const found = reports.find(value => value.report_id === reportId) ?? null;
      if (found && routeAction === "resume" && !preselected.current) {
        preselected.current = true; setAction("resume"); setSelected(resumePreselection(found));
      }
      setReport(found); setAssignments(tasks); setLoading(false);
    }, failure => { if (current) { setError(failure); setLoading(false); } });
    return () => { current = false; };
  }, [projectKey, reportId, canManage, reload, routeAction]);
  const effectiveAction = report?.state === "resolved" ? "resume" : action;
  const apply = async () => {
    if (!report || writing.current || !reason.trim()) return;
    const ids = effectiveAction === "restart" ? [report.assignment_id] : effectiveAction === "resolve" ? [] : selected.filter(id => effectiveAction !== "resume" || report.held_assignment_ids?.includes(id));
    if ((effectiveAction === "extend_hold" || effectiveAction === "resume") && !ids.length || effectiveAction === "restart" && !agreed) return;
    const key = JSON.stringify([report.report_id, report.revision, effectiveAction, reason.trim(), ids]);
    let request = requests.current.get(key);
    if (!request) { request = { request_id: crypto.randomUUID(), expected_revision: report.revision, action: effectiveAction, reason: reason.trim(), assignment_ids: ids }; requests.current.set(key, request); }
    writing.current = true; setBusy(true); setError(undefined); setDone(false);
    try {
      const value = await api.actOnProblemReport(report.report_id, request);
      // Lets Documents show "Resolved" for the row the lead came from (open question 9).
      if (documents && (effectiveAction === "resume" || effectiveAction === "resolve")) recordDecision(projectKey, `${report.case_id}:${report.language}`);
      if (alive.current) { setReport(value); setSelected([]); setAgreed(false); setDone(true); }
    }
    catch (failure) { if (alive.current) setError(failure); }
    finally { writing.current = false; if (alive.current) setBusy(false); }
  };
  if (!canManage) return <EmptyState title="Project lead access is required." />;
  if (loading) return <InlineMessage tone="info">Opening problem report...</InlineMessage>;
  if (!report) return <>{error !== undefined ? <ErrorNotice error={error} /> : <EmptyState title="Problem report unavailable." />}<Button onClick={() => setReload(value => value + 1)}>Reload report state</Button></>;
  const choices = assignments.filter(value => effectiveAction === "resume" ? report.held_assignment_ids?.includes(value.id) : !value.revoked_at);
  const backRoute: Route = documents ? { name: "projectDocuments", key: projectKey, ...documents }
    : { name: "projectDocuments", key: projectKey, case: report.case_id, language: report.language };
  const hasActions = report.state === "open" || (report.held_assignment_ids ?? []).length > 0;
  return <section className="problem-report-detail"><h1>Problem report</h1>
    <p><StatusBadge status={report.state}>{report.state}</StatusBadge> · Task {report.assignment_id} · {report.document_id}</p>
    <p className="annotation-note-history">{report.reason}</p>
    {report.resolution && <p>Resolution: {report.resolution}</p>}
    <p>Paused tasks: {(report.held_assignment_ids ?? []).join(", ") || "None"}. Saved work and immutable submissions remain readable.</p>
    {hasActions ? <form onSubmit={event => { event.preventDefault(); void apply(); }}>
      <Select id="problem-action" label="Report action" value={effectiveAction} disabled={busy} onChange={event => { setAction(event.target.value as ProblemActionRequest["action"]); setSelected([]); setAgreed(false); setDone(false); }}>
        {report.state === "open" && <option value="resolve">Resolve report</option>}<option value="resume">Release selected pauses</option>{report.state === "open" && <><option value="extend_hold">Pause related tasks</option><option value="restart">Agree an empty restart</option></>}
      </Select>
      <p>{effectiveAction === "resolve" ? "Resolving records the outcome. Existing task pauses stay in place until explicitly released."
        : effectiveAction === "resume" ? `Release only the selected pauses from this report. ${report.state === "resolved" ? "The report stays resolved." : "The report stays open until resolved."}`
        : effectiveAction === "extend_hold" ? "Select each affected task. Its owner sees your action reason, without access to this private report."
        : "An empty restart abandons the current round, preserves its history and starts with no old or machine findings. Agree this with the task owner first."}</p>
      {(effectiveAction === "extend_hold" || effectiveAction === "resume") && <fieldset><legend>Affected tasks</legend>{choices.map(value => <Checkbox id={`report-task-${value.id}`} key={value.id} label={`Task ${value.id}: ${value.display_name} · ${value.task} · ${value.document_id}`} checked={selected.includes(value.id)} disabled={busy} onChange={event => setSelected(ids => event.target.checked ? [...ids, value.id] : ids.filter(id => id !== value.id))} />)}</fieldset>}
      {effectiveAction === "restart" && <Checkbox id="report-restart-agreed" label="I have agreed with the task owner to start an empty round" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />}
      <Textarea id="problem-action-reason" label="Action reason" required value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
      {error !== undefined && <ErrorNotice error={error} />}
      {done && <InlineMessage tone="success">Report action saved. Final result selection is unchanged.</InlineMessage>}
      <Button type="submit" loading={busy} disabled={!reason.trim() || ((effectiveAction === "extend_hold" || effectiveAction === "resume") && !selected.length) || (effectiveAction === "restart" && !agreed)}>Apply report action</Button>
      <Button variant="secondary" disabled={busy} onClick={() => { setReload(value => value + 1); setDone(false); }}>Reload report state</Button>
    </form> : <InlineMessage tone="info">All pauses from this resolved report have been released.</InlineMessage>}
    {report.new_round && <p>Empty round created. The task owner can open it from Work rounds.</p>}
    <ReportHistory report={report} />
    <a className="btn btn-secondary" href={routeHref(backRoute)} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(backRoute);
    }}>Back to documents</a>
  </section>;
}
