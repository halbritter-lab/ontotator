import { useId, type ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import { AssignmentChip } from "./AssignmentChip";
import { finalizationState, textViewRoute } from "./cardModel";

/**
 * Finalization part of the text card: what happens next, the decision block, the final result. While a consolidation
 * runs: who consolidates with the open groups, "Open consolidation" and the consolidator's chip (the lead's chip
 * removes the assignment, which frees the text for "Consolidate…" with someone else).
 */
export function FinalizationPart({ row, projectKey, query, decision, onNavigate, now, canManage = false, tools, onChanged }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** The decision block (Compare results…, Consolidate…, Accept result…). */
  decision?: ReactNode;
  onNavigate: (route: Route) => void;
  now: Date;
  canManage?: boolean;
  /** Assignments for the consolidator chip's "Remove assignment…". */
  tools?: TextVersionsTools;
  onChanged?: () => void;
}): JSX.Element {
  const id = useId();
  const detail = row.stages?.annotation.detail;
  const target = detail?.target ?? detail?.total;
  const waiting = finalizationState(row, now).state === "waiting";
  const consolidating = row.stages?.annotation.state === "consolidating";
  const consolidators = consolidating ? row.stages!.annotation.detail.people ?? [] : [];
  const progress = consolidating ? row.consolidation_progress : null;
  const chips = consolidating && canManage ? row.work.filter(item => item.task === "review" && item.status !== "submitted" && item.moved_to_version == null) : [];
  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-card-part-title">Finalization</h3>
    {waiting && <p className="text-card-muted">
      {`Starts when all ${target ? `${target} ` : ""}annotations are submitted: compare the results, consolidate the differences, then accept the result.`}
    </p>}
    {consolidators.length > 0 && <p>{`Consolidating with ${consolidators.map(person => (person.is_me ? "you" : shortName(person))).join(", ")}${progress ? ` · ${progress.open} of ${progress.total} groups open` : ""}`}</p>}
    {chips.length > 0 && <div className="text-card-chips">
      {chips.map(item => <AssignmentChip key={item.assignment_id} item={item} caseId={row.case_id} onChanged={() => onChanged?.()} now={now} menu={{ tools, review: true }} />)}
    </div>}
    {progress && <p>
      <RouteLink route={{ name: "projectConsolidation", key: projectKey, roundId: progress.round_id, ...(Object.keys(query).length ? { documents: query } : {}) }}
        onNavigate={onNavigate} className="btn btn-secondary btn-sm">Open consolidation</RouteLink>
    </p>}
    {decision}
    {row.final && <p>
      <RouteLink route={textViewRoute(projectKey, row.case_id, row.final.document_id, query, { show: `final:${row.final.submission_id}` })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Open result</RouteLink>
    </p>}
  </section>;
}
