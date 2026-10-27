import type { FinalSelectionSummary, ProblemReportView, ReportHoldView } from "../api/client";
import { personLabel, submissionLabel } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { StatusBadge } from "../ui";
import { reportStateFact, taskOwnerText } from "./labels";
import "./problems.css";

/** "Annotation, Round 2, Ana Weber (ann-0004), 18 Oct, 10:00" (leads; else the pseudonym): the row's final result without language. */
export function finalResultLabel(final: FinalSelectionSummary | null): string {
  if (!final) return "None";
  const kind = final.kind ?? "annotation";
  const author = final.author_label ?? "Unknown";
  if (final.recorded_at) {
    return submissionLabel({ kind, ordinal: final.round_ordinal, author, isMe: final.is_mine, language: final.language, version: null, recordedAt: final.recorded_at, person: final.author }, { withLanguage: false });
  }
  return [kind === "consolidation" ? null : final.round_ordinal == null ? "Initial submission" : `Round ${final.round_ordinal}`, personLabel(author, final.is_mine, final.author)]
    .filter(Boolean).join(", ");
}

export type ReportLink = (reportId: string, text: string) => JSX.Element;

function eventOf(report: ProblemReportView, eventId: string | null | undefined) {
  return eventId ? (report.events ?? []).find(e => e.event_id === eventId) : undefined;
}

function ReleasedHold({ report, hold }: { report: ProblemReportView; hold: ReportHoldView }): JSX.Element {
  const by = hold.released_by_label;
  const at = hold.released_at ? <>, <Time iso={hold.released_at} /></> : null;
  const event = eventOf(report, hold.release_event_id);
  if (hold.release_action === "restart") {
    const ordinal = event?.round_ordinal;
    return <><StatusBadge tone="neutral">Restarted</StatusBadge> {ordinal == null ? "An empty round started" : `Round ${ordinal} started empty`}{at}</>;
  }
  if ((hold.release_action === "resume" || hold.release_action === "withdraw") && by) {
    const name = personLabel(by, by === report.viewer_label, hold.released_by);
    if (by === report.reporter_label) {
      const reason = event?.reason;
      // "by reporter (ann-0004)"; with a display name "by reporter Ana Weber (ann-0004)" (no nested parentheses).
      return <><StatusBadge tone="neutral">Resumed</StatusBadge> by reporter {name === by ? `(${by})` : name}{at}{reason ? <>, "{reason}"</> : null}</>;
    }
    return <><StatusBadge tone="neutral">Resumed</StatusBadge> by {name}{at}</>;
  }
  return <>Released (no record of who released it)</>;
}

/** The facts at the head of the decision card: the report (once decided), each task it paused, the final result. */
export function LeadStatePanel({ report, final, reportLink }: {
  report: ProblemReportView;
  /** Final result of the report's text and language; undefined while loading, "error" when it could not be read. */
  final: FinalSelectionSummary | null | undefined | "error";
  reportLink: ReportLink;
}): JSX.Element {
  const holds = report.holds ?? [];
  const decided = report.state !== "open" && !holds.some(h => h.active);
  return <>
    <dl className="report-facts lead-state">
      {report.state !== "open" && <div><dt>Report</dt><dd>{reportStateFact(report)}</dd></div>}
      {holds.map(hold => <div key={hold.hold_id}>
        <dt>Task {hold.assignment_id}</dt>
        <dd>
          {hold.active ? <><StatusBadge tone="warning">Paused</StatusBadge> since <Time iso={hold.created_at} /></> : <ReleasedHold report={report} hold={hold} />}
          {hold.assignment_id !== report.assignment_id && <span className="lead-fact-note"> · {taskOwnerText(hold)}</span>}
          {(hold.other_active_holds ?? []).map(other => <p key={other.report_id} className="lead-other-pause">
            Also paused by another report {reportLink(other.report_id, "Open report")}
          </p>)}
        </dd>
      </div>)}
      <div>
        <dt>Final result</dt>
        <dd>
          {final === undefined ? "Loading…" : final === "error" ? "Could not load the final result." : finalResultLabel(final)}
          <span className="lead-fact-note"> · never changed here</span>
        </dd>
      </div>
    </dl>
    {decided && <p className="lead-fact-note">Nothing left to decide.</p>}
  </>;
}
