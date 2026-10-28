import { useEffect, useState } from "react";
import { api, type ProblemReportView } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { InlineMessage } from "../ui";
import { answeredReport, answerNotice } from "./labels";

const dismissedKey = (reportId: string) => `ontotator.reportAnswer.dismissed.v1:${reportId}`;
const isDismissed = (reportId: string): boolean => {
  try { return window.localStorage.getItem(dismissedKey(reportId)) === "1"; } catch { return false; }
};

/**
 * The task's banner for a lead's answer to the reporter's own report on this task (R-26): shown while unread and,
 * once read elsewhere (My tasks badge, report page, problems dialog), for a closed report until dismissed here.
 */
export function ReportAnswerNotice({ projectKey, assignmentId, held, onNavigate }: {
  projectKey: string; assignmentId: number; held: boolean; onNavigate: (route: Route) => void;
}): JSX.Element | null {
  const [report, setReport] = useState<ProblemReportView | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let active = true;
    // A plain read: the banner does not mark the answer as seen. A failed read shows no banner.
    api.listTaskProblemReports(projectKey, assignmentId).then(list => { if (active) setReport(answeredReport(list)); }, () => undefined);
    return () => { active = false; };
  }, [projectKey, assignmentId]);
  if (!report || dismissed || isDismissed(report.report_id)) return null;
  const route: Route = { name: "projectProblemReport", key: projectKey, reportId: report.report_id };
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(dismissedKey(report.report_id), "1"); } catch { /* Blocked storage: hidden for this visit only. */ }
    // Dismissing reads the answer: the My tasks badge clears too.
    if (report.answered) void api.markProblemReportSeen(report.report_id).catch(() => undefined);
  };
  return <InlineMessage tone="info" onDismiss={dismiss}><span>{answerNotice(report, held)}{" "}
    <a href={routeHref(route)} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(route);
    }}>Open the answer</a></span>
  </InlineMessage>;
}
