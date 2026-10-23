import { Fragment, useId, type ReactNode } from "react";
import type { DocumentRowView, RowSubmissions } from "../../api/client";
import { Time } from "../../app/Time";
import type { Route } from "../../app/router";
import { modeBadge } from "../../editor/modes";
import { Button } from "../../ui/Button";
import { versionName } from "../labels";
import { RouteLink } from "../RowCells";
import { acceptanceLabel, acceptanceOf, discardLabel, isDiscarded, type TextVersionsTools } from "../TextVersions";

/** Report state words of the details list (same words as `reportStateBadge`). */
const REPORT_STATE_TEXT = { open: "Open", resolved: "Closed", withdrawn: "Withdrawn" } as const;

/** Footer of the text card: History (n), Text details, Change plan…. No tabs. */
export function CardFooter({ historyCount, onHistory, onDetails, onChangePlan }: {
  /** Null while the history loads. */
  historyCount: number | null;
  onHistory: () => void;
  onDetails: () => void;
  onChangePlan?: () => void;
}): JSX.Element {
  return <div className="text-card-footer">
    <Button size="sm" variant="quiet" onClick={onHistory}>{historyCount == null ? "History" : `History (${historyCount})`}</Button>
    <Button size="sm" variant="quiet" onClick={onDetails}>Text details</Button>
    {onChangePlan && <Button size="sm" variant="quiet" className="text-card-footer-end" onClick={onChangePlan}>Change plan…</Button>}
  </div>;
}

/** Text details (the former Details tab): the row's plan, its problem reports and its technical details. */
export function TextDetails({ row, data, plan, planRevision, reportRoute, onRoute, members, now }: {
  row: DocumentRowView; data: RowSubmissions | null; plan?: ReactNode; planRevision?: number; reportRoute: (reportId: string) => Route;
  onRoute: (route: Route) => void; members?: TextVersionsTools["members"]; now?: Date;
}): JSX.Element {
  const id = useId();
  const reports = row.problem_reports ?? [];
  const personOf = (label: string) => members?.find(member => member.pseudonym === label)?.display_name?.trim() || label;
  return <div className="text-card-details">
    {plan != null && <div className="text-card-plan" role="group" aria-labelledby={`${id}-plan`}>
      <span id={`${id}-plan`} className="text-card-plan-label">Plan</span>{plan}
    </div>}
    {reports.length > 0 && <section aria-labelledby={`${id}-reports`}>
      <h3 id={`${id}-reports`} className="text-card-subheading">{`Problem reports (${reports.length})`}</h3>
      <ul className="row-activity-lines">{reports.map(report => <li key={report.report_id}>
        {report.title}{", "}{personOf(report.reporter_label)}{", "}<Time iso={report.created_at} now={now} />
        {", "}Report: {REPORT_STATE_TEXT[report.state]}{", "}Paused tasks: {report.active_hold_count}{", "}
        <RouteLink route={reportRoute(report.report_id)} onNavigate={onRoute}>Open report</RouteLink>
      </li>)}</ul>
    </section>}
    <section aria-labelledby={`${id}-technical`}>
      <h3 id={`${id}-technical`} className="text-card-subheading">Technical details</h3>
      <dl className="technical-details">
        <dt>Text ID</dt><dd>{row.case_id}</dd>
        {planRevision != null && <><dt>Plan revision</dt><dd>{planRevision}</dd></>}
        {row.versions.map(version => {
          const name = versionName(version.version, version.chain_name, row.parallel_roots);
          const acceptance = acceptanceOf(version);
          return <Fragment key={version.document_id}>
            <dt>{`Document ID, ${name}`}</dt><dd>{version.document_id}</dd>
            {acceptance && <><dt>{`Acceptance, ${name}`}</dt><dd>{acceptanceLabel(acceptance, now)}</dd></>}
            {isDiscarded(row, version) && <><dt>{`Discard, ${name}`}</dt><dd>{discardLabel(version, now)}</dd></>}
          </Fragment>;
        })}
        {(data?.submissions ?? []).map(item => <Fragment key={item.submission_id}>
          <dt>{`Submission ID, ${item.author_label}`}</dt>
          <dd>{`${item.submission_id}${item.round_id ? `, round ${item.round_id}` : ""}, ${modeBadge(item.mode).label}`}</dd>
        </Fragment>)}
        {(data?.rounds ?? []).filter(round => !round.submitted).map(round => <Fragment key={round.round_id}>
          <dt>{`Round ID, ${round.author_label}`}</dt><dd>{`${round.round_id}, ${modeBadge(round.mode).label}`}</dd>
        </Fragment>)}
      </dl>
    </section>
  </div>;
}
