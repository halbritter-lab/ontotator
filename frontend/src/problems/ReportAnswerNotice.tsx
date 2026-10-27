import { useEffect, useState } from "react";
import { api, type ProblemReportView } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { InlineMessage } from "../ui";
import { answerNotice } from "./labels";

/** The task's banner while a lead's answer to the reporter's report is unread; links the report page (R-26). */
export function ReportAnswerNotice({ projectKey, reportId, held, onNavigate }: {
  projectKey: string; reportId: string; held: boolean; onNavigate: (route: Route) => void;
}): JSX.Element | null {
  const [report, setReport] = useState<ProblemReportView | null>(null);
  useEffect(() => {
    let active = true;
    // A plain read: only opening the report marks the answer as seen. A failed read shows no banner.
    api.getProblemReport(reportId).then(view => { if (active) setReport(view); }, () => undefined);
    return () => { active = false; };
  }, [reportId]);
  if (!report?.answered) return null;
  const route: Route = { name: "projectProblemReport", key: projectKey, reportId };
  return <InlineMessage tone="info"><span>{answerNotice(report, held)}{" "}
    <a href={routeHref(route)} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(route);
    }}>Open the answer</a></span>
  </InlineMessage>;
}
