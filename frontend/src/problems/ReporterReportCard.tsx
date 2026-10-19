import { useEffect, useId, useRef, useState, type Ref } from "react";
import { api, ApiError, type AssignmentView, type ProblemReportView } from "../api/client";
import { Time } from "../app/Time";
import { Button, InlineConfirm, InlineMessage, Textarea, type InlineConfirmOutcome } from "../ui";
import { reportStateFact, reportTitle, yourTaskFact } from "./labels";
import { ReportTimeline } from "./ReportTimeline";

export type ReporterConfirmKind = "resume" | "withdraw";
/** The one open confirmation of the reporter dialog (kept by the dialog so Escape can ask first). */
export interface ReporterConfirm { reportId: string; kind: ReporterConfirmKind; reason: string; error?: string; askDiscard?: boolean }

/** Whether this report's pause on the reporter's own task is active. */
export function ownPauseActive(report: ProblemReportView): boolean {
  if (report.holds) return report.holds.some(h => h.assignment_id === report.assignment_id && h.active);
  return (report.held_assignment_ids ?? []).includes(report.assignment_id);
}

function withdrawReason(report: ProblemReportView): string | null {
  const events = (report.events ?? []).filter(e => e.action === "withdraw");
  return events[events.length - 1]?.reason ?? null;
}

const isConflict = (failure: unknown) => failure instanceof ApiError && (failure.code === "WORKFLOW_REVISION_CONFLICT" || failure.status === 409);
const isSession = (failure: unknown) => failure instanceof ApiError && failure.status === 401;

/** One of the reporter's reports in the "Problems with Task n" dialog. Never shows other tasks. */
export function ReporterReportCard({ report, assignment, confirm, onConfirmChange, busy, onBusyChange, onUpdated, onConflict, headingRef }: {
  report: ProblemReportView;
  assignment: AssignmentView;
  confirm: ReporterConfirm | null;
  onConfirmChange: (confirm: ReporterConfirm | null) => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onUpdated: (report: ProblemReportView) => void;
  onConflict: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}): JSX.Element {
  const id = useId();
  const headingId = `${id}-title`;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const discardKeep = useRef<HTMLButtonElement>(null);
  const triggers = { resume: useRef<HTMLButtonElement>(null), withdraw: useRef<HTMLButtonElement>(null) };
  const requests = useRef(new Map<string, string>()), writing = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InlineConfirmOutcome | null>(null);
  const [focusHeading, setFocusHeading] = useState(false);
  const lastKind = useRef<ReporterConfirmKind | null>(null);

  const paused = ownPauseActive(report);
  const open = report.state === "open";
  const otherPauses = (assignment.active_holds ?? []).filter(h => h.own_report_id !== report.report_id);
  const leadPauses = otherPauses.filter(h => h.own_report_id === null);
  const fact = yourTaskFact(report);
  const eventCount = (report.events ?? []).length + 1;
  const withdrawn = report.state === "withdrawn" ? withdrawReason(report) : null;

  // Cancel or Escape returns focus to the trigger; a successful action focuses the heading.
  useEffect(() => {
    if (confirm) { lastKind.current = confirm.kind; return; }
    const kind = lastKind.current;
    lastKind.current = null;
    if (kind && !focusHeading) (triggers[kind].current ?? heading.current)?.focus();
  }, [confirm]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusHeading) { heading.current?.focus(); setFocusHeading(false); } }, [focusHeading]);
  useEffect(() => { if (confirm?.askDiscard) discardKeep.current?.focus(); }, [confirm?.askDiscard]);
  // A reload can take an action away (a lead released or closed meanwhile): close its confirmation.
  useEffect(() => {
    if (!confirm || outcome || busy) return;
    if ((confirm.kind === "resume" && !paused) || (confirm.kind === "withdraw" && !report.withdrawable)) onConfirmChange(null);
  }, [confirm, outcome, busy, paused, report.withdrawable]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (kind: ReporterConfirmKind) => { setMessage(null); setOutcome(null); onConfirmChange({ reportId: report.report_id, kind, reason: "" }); };

  const act = async () => {
    if (!confirm || writing.current) return;
    const { kind } = confirm;
    const reason = confirm.reason.trim();
    if (!reason) { onConfirmChange({ ...confirm, error: "Enter a reason." }); textarea.current?.focus(); return; }
    const key = JSON.stringify([report.report_id, report.revision, kind, reason]);
    let request_id = requests.current.get(key);
    if (!request_id) { request_id = crypto.randomUUID(); requests.current.set(key, request_id); }
    writing.current = true; onBusyChange(true); setOutcome(null);
    try {
      const value = await api.actOnProblemReport(report.report_id, {
        request_id, expected_revision: report.revision, action: kind, reason, assignment_ids: kind === "resume" ? [assignment.id] : [],
      });
      const still = otherPauses.length > 0;
      const stillBy = leadPauses.length > 0 ? "a project lead" : "another of your reports";
      setMessage(kind === "resume"
        ? still ? `Resumed. Your task is still paused by ${stillBy}.` : open ? "Resumed. The report stays open." : "Resumed."
        : still ? `Withdrawn. Your task is still paused by ${stillBy}.` : "Withdrawn. Your task is no longer paused by this report.");
      setFocusHeading(true);
      onConfirmChange(null);
      onUpdated(value);
    } catch (failure) {
      if (isConflict(failure)) { setOutcome({ kind: "conflict", onReview: () => setOutcome(null) }); onConflict(); }
      else if (isSession(failure)) setOutcome({ kind: "session" });
      else setOutcome({ kind: "error", onRetry: () => { void act(); } });
    } finally { writing.current = false; onBusyChange(false); }
  };

  const cancel = () => { setOutcome(null); onConfirmChange(null); };
  const reasonField = (label: string, hint?: string) => confirm && <>
    <Textarea ref={textarea} id={`${id}-reason`} label={label} rows={3} required hint={hint} value={confirm.reason} readOnly={busy}
      error={confirm.error} onChange={event => onConfirmChange({ ...confirm, reason: event.target.value, error: undefined, askDiscard: false })} />
    {confirm.askDiscard && <div role="group" aria-label="Discard your reason?" className="problem-discard">
      <p>Discard your reason? Your text will be lost.</p>
      <Button size="sm" variant="danger" onClick={cancel}>Discard</Button>{" "}
      <Button size="sm" ref={discardKeep} onClick={() => { onConfirmChange({ ...confirm, askDiscard: false }); textarea.current?.focus(); }}>Keep writing</Button>
    </div>}
  </>;
  const conflictMessage = "A project lead changed this report. Nothing was saved.";

  return <article className="reporter-report" aria-labelledby={headingId}>
    <h3 id={headingId} tabIndex={-1} ref={element => {
      heading.current = element;
      if (typeof headingRef === "function") headingRef(element);
      else if (headingRef) (headingRef as { current: HTMLHeadingElement | null }).current = element;
    }}>{reportTitle(report.reason)}</h3>
    {report.created_at && <p className="reporter-report-meta">Reported <Time iso={report.created_at} /></p>}
    <dl className="report-facts">
      <div><dt>Report</dt><dd>{reportStateFact(report)}
        {report.state === "resolved" && report.resolution && <><br />Outcome: {report.resolution}</>}
        {withdrawn && <><br />Reason: {withdrawn}</>}
      </dd></div>
      <div><dt>Your task</dt><dd>{fact.text}{fact.at && <>{fact.kind === "paused" ? " " : " · "}<Time iso={fact.at} /></>}</dd></div>
    </dl>
    {message && <InlineMessage tone="success">{message}</InlineMessage>}
    {(paused || report.withdrawable) && !confirm && <div className="reporter-report-actions">
      {paused && <Button ref={triggers.resume} onClick={() => start("resume")}>Resume my task…</Button>}
      {report.withdrawable && <Button ref={triggers.withdraw} variant="quiet" onClick={() => start("withdraw")}>Withdraw report…</Button>}
    </div>}
    {confirm?.kind === "resume" && <InlineConfirm title={`Resume Task ${assignment.id}`} confirmLabel="Resume my task" busy={busy}
      outcome={outcome} conflictMessage={conflictMessage} onConfirm={() => { void act(); }} onCancel={cancel}
      message={<>
        <p>{open ? "The report stays open. A project lead decides on it." : "The report is already closed. Only the pause is released."}</p>
        {otherPauses.map((h, index) => <p key={`${h.created_at}-${index}`}>{h.own_report_id === null
          ? `Your task stays paused by a project lead: ${h.reason}.`
          : `Your task stays paused by your report "${reportTitle(h.reason)}".`}</p>)}
      </>}>
      {reasonField("Why can you continue?", "Recorded in the report history. Project leads see it.")}
    </InlineConfirm>}
    {confirm?.kind === "withdraw" && <InlineConfirm title="Withdraw report" confirmLabel="Withdraw report" busy={busy}
      outcome={outcome} conflictMessage={conflictMessage} onConfirm={() => { void act(); }} onCancel={cancel}
      message={<>
        <p>The report is marked Withdrawn. Project leads can still read it.</p>
        {paused && <p>Your task&apos;s pause from this report is released.</p>}
      </>}>
      {reasonField("Why are you withdrawing it?")}
    </InlineConfirm>}
    <details className="reporter-report-history">
      <summary>Full report and history ({eventCount} {eventCount === 1 ? "event" : "events"})</summary>
      <blockquote className="report-text">{report.reason}</blockquote>
      <ReportTimeline report={report} />
    </details>
  </article>;
}
