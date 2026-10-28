import { useId, useState, type ReactNode } from "react";
import { AssignmentActions } from "../../admin/AssignmentActions";
import type { AssignmentView, DocumentRowView } from "../../api/client";
import { Button } from "../../ui";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import { finalizationState, textViewRoute } from "./cardModel";

/**
 * Finalization part of the text card: what happens next, the decision block, the final result. While a consolidation
 * runs: who consolidates with the open groups (plain text), "Open consolidation" for the consolidator and, for the lead, "Remove assignment…",
 * which frees the text for "Consolidate…" with someone else.
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
  /** Assignments for "Remove assignment…". */
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
  const removable = consolidating && canManage ? row.work.filter(item => item.task === "review" && item.status !== "submitted" && item.moved_to_version == null)
    .flatMap(item => tools?.assignments.find(entry => entry.id === item.assignment_id && !entry.revoked_at) ?? []) : [];
  const [revoking, setRevoking] = useState<AssignmentView | null>(null);
  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-card-part-title">Finalization</h3>
    {waiting && <p className="text-card-muted">
      {`Starts when all ${target ? `${target} ` : ""}annotations are submitted: compare the results, consolidate the differences, then accept the result.`}
    </p>}
    {consolidators.length > 0 && <p>{`Consolidating with ${consolidators.map(person => (person.is_me ? "you" : shortName(person))).join(", ")}${progress ? ` · ${progress.open} of ${progress.total} groups open` : ""}`}</p>}
    {(openable || removable.length > 0) && <div className="text-card-actions">
      {openable && <RouteLink route={{ name: "projectConsolidation", key: projectKey, roundId: openable.round_id, ...(Object.keys(query).length ? { documents: query } : {}) }}
        onNavigate={onNavigate} className="btn btn-secondary btn-sm">Open consolidation</RouteLink>}
      {removable.map(assignment => <Button key={assignment.id} size="sm" variant="quiet" onClick={() => setRevoking(assignment)}>Remove assignment…</Button>)}
    </div>}
    {revoking && tools && <AssignmentActions assignment={revoking} members={tools.members} open="revoke"
      onChanged={() => { tools.onAssignmentsChanged(); onChanged?.(); }} onClose={() => setRevoking(null)} />}
    {decision}
    {row.final && <p>
      <RouteLink route={textViewRoute(projectKey, row.case_id, row.final.document_id, query, { show: `final:${row.final.submission_id}` })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Open result</RouteLink>
    </p>}
  </section>;
}
