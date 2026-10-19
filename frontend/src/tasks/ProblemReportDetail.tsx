import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { api, ApiError, type FinalSelectionSummary, type ProblemReportView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Time } from "../app/Time";
import { ErrorNotice } from "../admin/ErrorNotice";
import { recordDecision } from "../documents/visitState";
import { LeadConfirm, releasePreselection } from "../problems/LeadConfirms";
import { LeadDecide } from "../problems/LeadDecide";
import { finalResultLabel, LeadStatePanel } from "../problems/LeadStatePanel";
import { intentState, leadOutcome, type Intent } from "../problems/labels";
import { ReportTimeline } from "../problems/ReportTimeline";
import { useLeadReport } from "../problems/useLeadReport";
import { Button, EmptyState, IconChevronLeft, InlineMessage } from "../ui";
import { refKey } from "../variants/versionState";

const TASK_TYPES = { annotate: "Annotation", review: "Review", translation_review: "Translation review" } as const;
/** Actions that settle the row the lead came from (Documents shows it as decided). */
const DECIDING: readonly Intent[] = ["close", "release", "restart"];

const isNotFound = (failure: unknown) => failure instanceof ApiError && (failure.code === "REPORT_NOT_FOUND" || failure.status === 404);

export function ProblemReportDetail({ projectKey, reportId, canManage, action: routeAction, documents, onNavigate }: {
  projectKey: string; reportId: string; canManage: boolean;
  /** `resume` opens "Release pause" with the paused task preselected; nothing is sent until the lead confirms. */
  action?: "resume";
  /** Documents query the lead came from; the back link returns to exactly this view. */
  documents?: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  const id = useId();
  const lead = useLeadReport(reportId, canManage);
  const { report } = lead;
  const [final, setFinal] = useState<FinalSelectionSummary | null | undefined | "error">(undefined);
  const [open, setOpen] = useState<Intent | null>(null);
  const [preselect, setPreselect] = useState<number[]>([]);
  const [focusTrigger, setFocusTrigger] = useState<{ intent: Intent; n: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const successRef = useRef<HTMLDivElement>(null);
  const routeResumeDone = useRef(false);

  const caseId = report?.case_id, language = report?.language;
  useEffect(() => {
    if (caseId === undefined || language === undefined) return;
    let current = true;
    setFinal(undefined);
    api.listDocumentRows(projectKey, { case: caseId, language }).then(page => {
      if (!current) return;
      const row = page.groups.flatMap(group => group.rows).find(r => r.case_id === caseId && r.language === language);
      setFinal(row?.final ?? null);
    }, () => { if (current) setFinal("error"); });
    return () => { current = false; };
  }, [projectKey, caseId, language]);

  // `action=resume` from Documents: open "Release pause" once, preselected; never submit on its own.
  useEffect(() => {
    if (!report || routeAction !== "resume" || routeResumeDone.current) return;
    routeResumeDone.current = true;
    if (intentState(report).release.unavailable) return;
    setPreselect(releasePreselection(report, true)); setOpen("release");
  }, [report, routeAction]);

  useEffect(() => { if (success) successRef.current?.focus(); }, [success]);

  const back: Route = documents ? { name: "projectDocuments", key: projectKey, ...documents }
    : report ? { name: "projectDocuments", key: projectKey, case: report.case_id, language: report.language }
    : { name: "projectDocuments", key: projectKey };
  const link = (route: Route, text: string, className?: string) => <a className={className} href={routeHref(route)} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(route);
  }}>{text}</a>;
  const backLink = <a className="problem-report-back" href={routeHref(back)} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(back);
  }}><IconChevronLeft aria-hidden /> Back to Documents</a>;
  const reportLink = (otherId: string, text: string) => link({ name: "projectProblemReport", key: projectKey, reportId: otherId, ...(documents ? { documents } : {}) }, text);

  if (!canManage) return <section className="problem-report-detail">{backLink}<EmptyState title="Project lead access is required." /></section>;
  if (!report) {
    if (lead.loading) return <section className="problem-report-detail">{backLink}<InlineMessage tone="info">Opening problem report…</InlineMessage></section>;
    if (isNotFound(lead.error)) return <section className="problem-report-detail">{backLink}<EmptyState title="Problem report not found" /></section>;
    return <section className="problem-report-detail">{backLink}
      <ErrorNotice error={lead.error} />
      <Button onClick={() => { void lead.reload(); }}>Retry</Button>
    </section>;
  }

  const finalText = final === undefined || final === "error" ? "None" : finalResultLabel(final);
  const openIntent = (intent: Intent) => {
    setSuccess(null);
    setPreselect(intent === "release" ? releasePreselection(report, false) : []);
    setOpen(intent);
  };
  const close = () => {
    const was = open;
    setOpen(null);
    if (was) setFocusTrigger(current => ({ intent: was, n: (current?.n ?? 0) + 1 }));
  };
  const done = (intent: Intent, before: ProblemReportView, after: ProblemReportView, released?: number[]) => {
    lead.replace(after);
    setOpen(null);
    setSuccess(leadOutcome(intent, before, after, released));
    // Lets Documents show the row the lead came from as decided.
    if (documents && DECIDING.includes(intent)) recordDecision(projectKey, `${before.case_id}:${before.language}`);
  };

  const viewText: Route = {
    name: "projectCase", key: projectKey, caseId: report.case_id, variant: report.document_id,
    ...(report.submission ? { annotations: refKey({ kind: "submission", id: report.submission.submission_id }) } : {}),
    ...(documents ? { documents } : {}),
  };
  const identity = [report.case_id, report.language, `Task ${report.assignment_id} (${report.reporter_label})`,
    report.task ? TASK_TYPES[report.task] : null, report.round_ordinal != null ? `Round ${report.round_ordinal}` : null].filter(Boolean).join(" · ");
  const stateId = `${id}-state`, decideId = `${id}-decide`, historyId = `${id}-history`;
  const states = intentState(report);

  return <section className="problem-report-detail">
    {backLink}
    <h1>Problem report</h1>
    <p className="problem-report-identity">{identity} · {link(viewText, "View text")}</p>
    <blockquote className="report-text">{report.reason}</blockquote>
    <p className="problem-report-meta">Reported by {report.reporter_label}{report.created_at && <> · <Time iso={report.created_at} /></>}</p>
    {report.submission && <p className="problem-report-meta">About the submitted result {report.submission.round_ordinal != null ? `Round ${report.submission.round_ordinal}` : "Initial submission"} · <Time iso={report.submission.recorded_at} /></p>}

    <section aria-labelledby={stateId}>
      <h2 id={stateId}>Current state</h2>
      <LeadStatePanel report={report} final={final} reportLink={reportLink} />
    </section>

    <section aria-labelledby={decideId}>
      <h2 id={decideId}>Decide</h2>
      {success && <div ref={successRef} tabIndex={-1} className="lead-outcome">
        <InlineMessage tone="success">{success}</InlineMessage>
        {link(back, "Back to Documents")}
      </div>}
      <LeadDecide report={report} open={open} focusTrigger={focusTrigger}
        onOpen={openIntent}
        onUnavailable={reason => { setAnnouncement(""); requestAnimationFrame(() => setAnnouncement(reason)); }}
        renderConfirm={intent => <LeadConfirm key={intent} intent={intent} report={report} finalText={finalText} preselect={preselect}
          lead={lead} requests={requests.current} unavailable={states[intent].unavailable} reportLink={reportLink}
          onDone={done} onCancel={close} />} />
    </section>

    <section aria-labelledby={historyId}>
      <h2 id={historyId}>History</h2>
      <ReportTimeline report={report} />
    </section>

    <details className="problem-report-technical">
      <summary>Technical details</summary>
      <dl className="report-facts">
        <div><dt>Report ID</dt><dd>{report.report_id}</dd></div>
        <div><dt>Reported round ID</dt><dd>{report.round_id ?? "None"}</dd></div>
        <div><dt>Current round ID</dt><dd>{report.current_round_id ?? "None"}</dd></div>
        <div><dt>Submission ID</dt><dd>{report.submission?.submission_id ?? report.submission_id ?? "None"}</dd></div>
        <div><dt>Document ID</dt><dd>{report.document_id}</dd></div>
        {(report.holds ?? []).map(h => <div key={h.hold_id}><dt>Pause of Task {h.assignment_id}</dt><dd>{h.hold_id}</dd></div>)}
        {(report.events ?? []).map(e => <div key={e.event_id}><dt>Event ({e.action})</dt><dd>{e.event_id}</dd></div>)}
      </dl>
    </details>
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
  </section>;
}
