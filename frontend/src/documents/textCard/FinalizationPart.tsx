import { useId, useState, type ReactNode } from "react";
import { AssignmentActions } from "../../admin/AssignmentActions";
import type { AssignmentView, DocumentRowView } from "../../api/client";
import { plural } from "../../app/labels";
import { Button, InlineMessage } from "../../ui";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { earlyFinal, openAnnotateWork } from "../finalPanelText";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import { finalizationState, textViewRoute } from "./cardModel";
import { PersonList, useFocusAfterRemoval } from "./PersonRow";
import { assignedLine, workerName, WorkPersonRow } from "./WorkPersonRow";

type WorkItem = DocumentRowView["work"][number];

/** The person of a work item: "you", the short name, else the pseudonym label. */
function workName(item: WorkItem): string {
  if (item.is_me) return "you";
  return item.person ? shortName(item.person) : item.author_label;
}

function nameOf(items: readonly WorkItem[], assignmentId: number): string {
  const item = items.find(entry => entry.assignment_id === assignmentId);
  return item ? workName(item) : String(assignmentId);
}

/**
 * Finalization part of the text card: what happens next, the decision block, the final result. While a consolidation
 * runs: one row per consolidator with the open groups, "Open consolidation" (their task) for the consolidator and, for the
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
  // The round route is always read-only (issue 145): the viewer's own running consolidation opens as their task, where they
  // decide and submit. Without an open consolidation task of theirs the link shows the read-only round.
  const ownTask = running.find(item => item.is_me)?.assignment_id;
  const consolidationLink = (label?: string, assignmentId = ownTask) => openable && <RouteLink route={assignmentId != null ? { name: "task", assignmentId }
    : { name: "projectConsolidation", key: projectKey, roundId: openable.round_id, ...(Object.keys(query).length ? { documents: query } : {}) }}
    onNavigate={onNavigate} className="btn btn-secondary btn-sm" aria-label={label}>Open consolidation</RouteLink>;
  const groups = progress ? `${progress.open} of ${progress.total} groups open` : null;
  // "Annotators per text" is an upper limit (issue 123): with one annotation submitted the lead may decide now; the
  // open annotations are a warning, each with "Remove assignment…", or are left to run.
  const early = earlyFinal(row);
  const open = early ? openAnnotateWork(row) : [];
  const openAssignments = early && canManage ? open.flatMap(item => tools?.assignments.find(entry => entry.id === item.assignment_id && !entry.revoked_at) ?? []) : [];
  const [revoking, setRevoking] = useState<AssignmentView | null>(null);
  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-card-part-title">Finalization</h3>
    {waiting && !early && <p className="text-card-muted">
      {`Starts once an annotation is submitted${target && target > 1 ? ` (up to ${target} per text, fewer is fine)` : ""}: compare the results, consolidate the differences, then accept the result.`}
    </p>}
    {early && <InlineMessage tone="warning" live={false}>
      <p>{`${plural(open.length, "annotation")} still open: ${open.map(workName).join(", ")}. You can accept a result now; open work stays assigned unless you remove it.`}</p>
      {openAssignments.length > 0 && <div className="text-card-actions">
        {openAssignments.map(assignment => <Button key={assignment.id} size="sm" variant="quiet" aria-label={`Remove assignment…, ${nameOf(open, assignment.id)}`}
          onClick={() => setRevoking(assignment)}>Remove assignment…</Button>)}
      </div>}
    </InlineMessage>}
    {running.length > 0 ? <PersonList label="Consolidators">
      {running.map(item => {
        const assigned = assignedLine(item, now, !groups);
        return <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} canManage={canManage} tools={tools} onChanged={() => onChanged?.()}
          onRemoved={focusAfterRemoval} details={groups && assigned ? <>{groups} · {assigned}</> : groups ?? assigned}
          open={item.is_me ? consolidationLink(`Open consolidation of ${workerName(item)}`, item.assignment_id) : undefined} />;
      })}
    </PersonList> : <>
      {/* Without the work items (they name the assignments) the consolidators are a line of text. */}
      {consolidators.length > 0 && <p>{`Consolidating with ${consolidators.map(person => (person.is_me ? "you" : shortName(person))).join(", ")}${groups ? ` · ${groups}` : ""}`}</p>}
      {openable && <div className="text-card-actions">{consolidationLink()}</div>}
    </>}
    {revoking && tools && <AssignmentActions assignment={revoking} members={tools.members} open="revoke"
      onChanged={() => { tools.onAssignmentsChanged(); onChanged?.(); }} onClose={() => setRevoking(null)} />}
    {decision}
    {row.final && <p>
      <RouteLink route={textViewRoute(projectKey, row.case_id, row.final.document_id, query, { show: `final:${row.final.submission_id}` })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Open result</RouteLink>
    </p>}
  </section>;
}
