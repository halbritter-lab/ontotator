/**
 * Activity tab of the row panel (acceptance fixes WP-A): the row's history lines newest first, each
 * with its stage tag; the review reason under a rejecting or querying review; the problem report behind
 * a paused task. A stage filter shows "{Stage} ✕" and "Show all stages"; under the list the stage's
 * admin actions (built by the panel).
 */
import type { ReactNode } from "react";
import type { DocumentRowView, RowSubmissionView } from "../api/client";
import type { PanelStage, Route } from "../app/router";
import { FilterChip } from "../ui/FilterChip";
import { Button } from "../ui/Button";
import { historyLines, type HistoryLine } from "./historyLines";
import { reasonDocumentId, ReviewReason, useReviewReason } from "./reviewReason";
import { RouteLink } from "./RowCells";
import { STAGE_TITLES } from "./StageStrip";

export interface RowActivityProps {
  row: DocumentRowView;
  projectKey: string;
  /** Submissions of the row; null while they load (the lines fall back to the work items). */
  submissions: readonly RowSubmissionView[] | null;
  stage?: PanelStage;
  onStage: (stage: PanelStage | undefined) => void;
  /** Route of a problem report ("Open report" on a paused task). */
  reportRoute: (reportId: string) => Route;
  onNavigate: (route: Route) => void;
  /** Admin actions under the list (of the filtered stage, or of every stage). */
  actions?: ReactNode;
  /** Pseudonym of the signed-in lead ("Final: chosen by you"). */
  me?: string | null;
  now?: Date;
}

/** Empty Activity: "Nothing has happened yet." or, filtered, "No annotation activity yet.". */
export function emptyActivityText(stage?: PanelStage): string {
  return stage ? `No ${STAGE_TITLES[stage].toLowerCase()} activity yet.` : "Nothing has happened yet.";
}

/**
 * The line without the stage word its tag already shows ("Review: …" under the Review tag), and the hidden
 * separator after the tag: ": " where the tag replaces the line's own prefix (read as "Review: Ana Weber …").
 */
function lineParts(line: HistoryLine): { separator: string; body: string } {
  const prefix = `${STAGE_TITLES[line.stage]}: `;
  return line.text.startsWith(prefix) ? { separator: ": ", body: line.text.slice(prefix.length) } : { separator: " ", body: line.text };
}

export function RowActivity({ row, projectKey, submissions, stage, onStage, reportRoute, onNavigate, actions, me, now }: RowActivityProps): JSX.Element {
  const reason = useReviewReason(projectKey, reasonDocumentId(row));
  // Newest first: the lines come oldest first (review, annotation, final).
  const lines = historyLines(row, submissions, { me, now }).reverse().filter(line => !stage || line.stage === stage);
  return <div className="row-activity">
    {stage && <p className="row-activity-filter">
      <FilterChip label={STAGE_TITLES[stage]} onRemove={() => onStage(undefined)} />
      <Button size="sm" variant="quiet" onClick={() => onStage(undefined)}>Show all stages</Button>
    </p>}
    {lines.length > 0
      ? <ul className="row-activity-lines" aria-label="Activity">{lines.map(line => <li key={line.key} className="row-activity-line">
        <span className="row-activity-tag">{STAGE_TITLES[line.stage]}</span><span className="visually-hidden">{lineParts(line).separator}</span>
        <span className="row-activity-text">{lineParts(line).body}</span>
        {line.reportId && <>{" · "}<RouteLink route={reportRoute(line.reportId)} onNavigate={onNavigate}>Open report</RouteLink></>}
        {reason && line.key === `work-${reason.assignment_id}` && <ReviewReason record={reason} />}
      </li>)}</ul>
      : <p className="row-activity-empty">{emptyActivityText(stage)}</p>}
    {actions != null && actions !== false && <div className="row-activity-actions">{actions}</div>}
  </div>;
}
