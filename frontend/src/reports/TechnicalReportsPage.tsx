import { useEffect, useState } from "react";
import { api, type TechnicalReportStatus, type TechnicalReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { formatDateTime, taskLabels } from "../app/labels";
import { personLabel, taskText } from "../app/identity";
import { annotationTaskName } from "../editor/modes";
import { Button, EmptyState, InlineMessage, Select, Toolbar } from "../ui";
import "./reports.css";

/** Sent after a report changed status: the navigation's open count reloads. */
export const TECHNICAL_REPORTS_CHANGED = "ontotator:technical-reports-changed";

type Filter = TechnicalReportStatus | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "all", label: "All" },
];
const STATUS_LABEL: Record<TechnicalReportStatus, string> = { open: "Open", done: "Done" };

/** The context rows of a report, in the order an administrator reads them. */
export function reportFacts(report: TechnicalReportView): [string, string][] {
  const task = report.task;
  const facts: [string, string][] = [
    ["Sent", formatDateTime(report.created_at)],
    ["By", `${personLabel(report.reporter)}, ${report.reporter_username}`],
    ...(task ? [
      ["Task", task.task === "annotate" ? annotationTaskName(task.annotation_mode) : taskLabels[task.task]],
      ["Project", task.project_key],
      ["Text", taskText(task)],
    ] satisfies [string, string][] : []),
    ["App version", report.app_revision ? `${report.app_version} (commit ${report.app_revision.slice(0, 7)})` : report.app_version],
  ];
  if (report.route) facts.push(["Screen", report.route]);
  if (report.user_agent) facts.push(["Browser", report.user_agent]);
  if (report.viewport) facts.push(["Window size", report.viewport]);
  if (report.last_error_status !== null || report.last_error_code) {
    const what = [report.last_error_code, report.last_error_status ? `HTTP ${report.last_error_status}` : "no answer"].filter(Boolean).join(", ");
    facts.push(["Last error", report.last_error_at ? `${what}, ${formatDateTime(report.last_error_at)}` : what]);
  }
  if (report.crash_message) facts.push(["Error message", report.crash_message]);
  if (report.closed_at) facts.push(["Done", `${formatDateTime(report.closed_at)}${report.closed_by ? `, ${report.closed_by}` : ""}`]);
  return facts;
}

/** Plain text of a report, to paste into an issue by hand. */
export function reportText(report: TechnicalReportView): string {
  return [`${report.reference} (${STATUS_LABEL[report.status]})`, "", report.description, "",
    ...reportFacts(report).map(([label, value]) => `${label}: ${value}`)].join("\n");
}

/** Administration › Technical reports: what users reported, open or done. */
export function TechnicalReportsPage(): JSX.Element {
  const [filter, setFilter] = useState<Filter>("open");
  const [reports, setReports] = useState<TechnicalReportView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped by "Refresh reports"; a change of filter or refresh loads the list again.
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(undefined);
    api.adminListTechnicalReports(filter === "all" ? undefined : filter).then(
      rows => { if (active) setReports(rows); },
      error => { if (active) setLoadError(error); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, refresh]);

  const setStatus = async (report: TechnicalReportView, status: TechnicalReportStatus) => {
    if (busy !== null) return;
    setBusy(report.id); setActionError(undefined); setNotice(null);
    try {
      const updated = await api.adminSetTechnicalReportStatus(report.id, status);
      setNotice(status === "done" ? `${updated.reference} is marked as done.` : `${updated.reference} is open again.`);
      // The report leaves a filtered list; "All" shows it with its new status.
      setReports(current => current && (filter === "all" ? current.map(item => item.id === updated.id ? updated : item)
        : current.filter(item => item.id !== updated.id)));
      window.dispatchEvent(new Event(TECHNICAL_REPORTS_CHANGED));
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (report: TechnicalReportView) => {
    setActionError(undefined); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(reportText(report));
      setNotice(`Copied ${report.reference}.`);
    } catch (error) {
      setActionError(error);
    }
  };

  return <div className="density-compact">
    <section className="detail-section">
      <h1>Technical reports</h1>
      <p>Users report errors, screens that do not load, crashes and general feedback here. Reports stay inside Ontotator. To open an issue, copy a report by hand and leave out clinical content.</p>
      <Toolbar label="Report filters" className="technical-report-filters">
        <Select id="technical-report-filter" label="Show" value={filter} onChange={event => { setNotice(null); setFilter(event.target.value as Filter); }}>
          {FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Button disabled={loading} onClick={() => { setNotice(null); setRefresh(value => value + 1); }}>Refresh reports</Button>
      </Toolbar>
      {loading && <InlineMessage tone="info">Loading reports…</InlineMessage>}
      {loadError !== undefined && <ErrorNotice error={loadError} />}
      {actionError !== undefined && <ErrorNotice error={actionError} />}
      {notice && <InlineMessage tone="success">{notice}</InlineMessage>}
      {reports && reports.length === 0 && <EmptyState title={filter === "open" ? "No open reports." : filter === "done" ? "No reports marked as done." : "No reports yet."} />}
      {reports && reports.length > 0 && <ul className="technical-report-list" aria-label="Technical reports">
        {reports.map(report => <li key={report.id}>
          <article className="technical-report-card" aria-labelledby={`technical-report-${report.id}`}>
            <h2 id={`technical-report-${report.id}`}>{`${report.reference} · ${STATUS_LABEL[report.status]}`}</h2>
            <p className="technical-report-description">{report.description}</p>
            <dl className="technical-report-facts">{reportFacts(report).map(([label, value]) => <div key={label}>
              <dt>{label}</dt><dd>{value}</dd>
            </div>)}</dl>
            <Toolbar label={`Actions for ${report.reference}`}>
              {report.status === "open"
                ? <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => { void setStatus(report, "done"); }}>Mark as done</Button>
                : <Button size="sm" disabled={busy !== null} onClick={() => { void setStatus(report, "open"); }}>Reopen</Button>}
              <Button size="sm" onClick={() => { void copy(report); }}>Copy report</Button>
            </Toolbar>
          </article>
        </li>)}
      </ul>}
    </section>
  </div>;
}
