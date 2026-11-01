import { useEffect, useState } from "react";
import { api, ApiError, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { NotFound } from "../app/NotFound";
import { routeHref, type Route } from "../app/router";
import { Time } from "../app/Time";
import { textLabel } from "../app/identity";
import { InlineMessage } from "../ui";
import { reportStateFact, reportTitle } from "./labels";
import { ReportTimeline } from "./ReportTimeline";
import "./problems.css";

/**
 * A reporter's direct link to their own report (non-leads): the report read-only, opened as seen.
 * Resume and withdraw stay in the task's "Problems with Task n" dialog.
 */
export function ReporterReportPage({ reportId, onNavigate }: { reportId: string; onNavigate: (route: Route) => void }): JSX.Element {
  const [report, setReport] = useState<ProblemReportView | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  useEffect(() => {
    let current = true;
    // Opening the report is what clears "Answer to your report"; the response is the report itself.
    api.markProblemReportSeen(reportId).then(view => { if (current) setReport(view); }, failure => { if (current) setError(failure); });
    return () => { current = false; };
  }, [reportId]);

  if (error !== undefined) {
    return error instanceof ApiError && (error.code === "REPORT_NOT_FOUND" || error.status === 404)
      ? <NotFound title="Problem report not found or no access" onNavigate={onNavigate} /> : <ErrorNotice error={error} />;
  }
  if (!report) return <InlineMessage tone="info">Opening problem report…</InlineMessage>;
  const task: Route = { name: "task", assignmentId: report.assignment_id };
  return <section className="problem-report-detail">
    <a className="btn btn-secondary btn-sm" href={routeHref(task)} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(task);
    }}>{`Open your task on ${textLabel(report)}`}</a>
    <h1>{reportTitle(report.reason)}</h1>
    {report.created_at && <p className="reporter-report-meta">Reported <Time iso={report.created_at} /></p>}
    <p>{reportStateFact(report)}{report.state === "resolved" && report.resolution && <><br />Outcome: {report.resolution}</>}</p>
    <blockquote className="report-text">{report.reason}</blockquote>
    <ReportTimeline report={report} headingLevel={2} />
  </section>;
}
