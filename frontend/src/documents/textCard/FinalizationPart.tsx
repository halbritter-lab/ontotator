import { useId, type ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import { finalizationState, textViewRoute } from "./cardModel";
import { PersonList, useFocusAfterRemoval } from "./PersonRow";
import { assignedLine, workerName, WorkPersonRow } from "./WorkPersonRow";

/**
 * Finalization part of the text card: what happens next, the decision block, the final result. While a consolidation
 * runs: one row per consolidator with the open groups, "Open consolidation" for the consolidator and, for the
 * lead, "Remove…", which frees the text for "Consolidate…" with someone else (no Reassign, D1).
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
  /** Assignments for the consolidator's "Remove…". */
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
  // Only its consolidator may open a running round (the server answers ROUND_NOT_FOUND to everyone else, U9); with
  // others consolidating too, the round may be theirs, so "Open my task" in the row is the way in.
  const openable = progress && consolidators.length > 0 && consolidators.every(person => person.is_me) ? progress : null;
  const running = consolidating ? row.work.filter(item => item.task === "review" && item.status !== "submitted" && item.moved_to_version == null) : [];
  const focusAfterRemoval = useFocusAfterRemoval();
  const consolidationLink = (label?: string) => openable && <RouteLink route={{ name: "projectConsolidation", key: projectKey, roundId: openable.round_id, ...(Object.keys(query).length ? { documents: query } : {}) }}
    onNavigate={onNavigate} className="btn btn-secondary btn-sm" aria-label={label}>Open consolidation</RouteLink>;
  const groups = progress ? `${progress.open} of ${progress.total} groups open` : null;
  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-card-part-title">Finalization</h3>
    {waiting && <p className="text-card-muted">
      {`Starts when all ${target ? `${target} ` : ""}annotations are submitted: compare the results, consolidate the differences, then accept the result.`}
    </p>}
    {running.length > 0 ? <PersonList label="Consolidators">
      {running.map(item => {
        const assigned = assignedLine(item, now, !groups);
        return <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} canManage={canManage} tools={tools} onChanged={() => onChanged?.()}
          onRemoved={focusAfterRemoval} details={groups && assigned ? <>{groups} · {assigned}</> : groups ?? assigned}
          open={item.is_me ? consolidationLink(`Open consolidation of ${workerName(item)}`) : undefined} />;
      })}
    </PersonList> : <>
      {/* Without the work items (they name the assignments) the consolidators are a line of text. */}
      {consolidators.length > 0 && <p>{`Consolidating with ${consolidators.map(person => (person.is_me ? "you" : shortName(person))).join(", ")}${groups ? ` · ${groups}` : ""}`}</p>}
      {openable && <div className="text-card-actions">{consolidationLink()}</div>}
    </>}
    {decision}
    {row.final && <p>
      <RouteLink route={textViewRoute(projectKey, row.case_id, row.final.document_id, query, { show: `final:${row.final.submission_id}` })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Open result</RouteLink>
    </p>}
  </section>;
}
