import type { ProblemReportView } from "../api/client";

export function ReportHistory({ report }: { report: ProblemReportView }): JSX.Element | null {
  if (!report.events?.length) return null;
  return <details className="report-history"><summary>Report history</summary><ol>{report.events.map((event, index) => {
    const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
    const abandoned = details.abandoned_translation_draft && typeof details.abandoned_translation_draft === "object" ? details.abandoned_translation_draft as Record<string, unknown> : null;
    return <li key={index}><p>{String(event.action ?? "Report created")}{typeof details.reason === "string" ? `: ${details.reason}` : ""}</p>
      {abandoned && <details><summary>Translation draft preserved before restart</summary>{typeof abandoned.text === "string" && <p className="annotation-note-history">{abandoned.text}</p>}
        {abandoned.form !== null && typeof abandoned.form === "object" && <dl>{Object.entries(abandoned.form).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd className="annotation-note-history">{Array.isArray(value) ? value.join(", ") : String(value ?? "Not specified")}</dd></div>)}</dl>}
      </details>}
    </li>;
  })}</ol></details>;
}
