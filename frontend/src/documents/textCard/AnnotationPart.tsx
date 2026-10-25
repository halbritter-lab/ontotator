import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DocumentRowView, RowSubmissionView } from "../../api/client";
import { plural } from "../../app/labels";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { annotationTaskName } from "../../editor/modes";
import { Button } from "../../ui/Button";
import type { TextVersionsTools } from "../TextVersions";
import { AssignmentChip } from "./AssignmentChip";
import { textViewRoute } from "./cardModel";

const NO_PROPOSALS = "This text has no tool proposals, so it is annotated from scratch.";

/**
 * Annotation part of the text card (M1 card mockups v1, v3): the plan control in the header (planned texts), how many
 * annotators the text has of its limit, one chip per person (the lead's chips are menus: Reassign, Remove, Assign
 * another person) and one "Assign annotators…" that opens the assign dialog (the lead can pick themselves there).
 */
export function AnnotationPart({ row, projectKey, query, submissions, canManage, onAssign, onNavigate, onChanged, onHistory, tools, now, planControl }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** The row's submissions (the name of a submitted person links to their layer); null while loading. */
  submissions: readonly RowSubmissionView[] | null;
  canManage: boolean;
  onAssign: (row: DocumentRowView, task: "annotate") => void;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  /** Opens the card's History (submitted chips). */
  onHistory?: () => void;
  /** Assignments and members for the chips' Reassign. */
  tools?: TextVersionsTools;
  now?: Date;
  /** The annotation plan control in the header (planned texts). */
  planControl?: ReactNode;
}): JSX.Element {
  const id = useId();
  // After a removal the chip goes away; focus "Assign annotators…" once the confirm dialog has returned focus (effects run after it).
  const assignButton = useRef<HTMLButtonElement>(null);
  const [removed, setRemoved] = useState(0);
  useEffect(() => { if (removed) assignButton.current?.focus(); }, [removed]);
  const mode = row.annotation_mode ?? null;
  const people = row.work.filter(item => item.task === "annotate" && item.moved_to_version == null);
  const detail = row.stages?.annotation.detail;
  const target = detail?.target ?? 0;
  const assigned = detail?.assigned ?? people.length;
  const full = target > 0 && assigned >= target;
  const layerOf = (authorLabel: string, documentId: string) => submissions?.find(item => item.kind === "annotation" && item.author_label === authorLabel && item.document_id === documentId);
  const annotating = row.stages?.annotation.state !== "not_planned";
  const status = target > 0 ? (assigned === 0 ? `Nobody assigned yet (limit ${target} per text).` : `${assigned} of ${target} annotators assigned.`) : null;
  // Version-aware as `CardPlanSelect`: "no_proposals" means the current version has none.
  const proposals = mode?.source === "no_proposals" ? 0 : mode?.proposal_count ?? row.proposal_count ?? 0;
  const assignAnother = canManage && !full ? () => onAssign(row, "annotate") : undefined;

  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <div className="text-card-part-head">
      <h3 id={`${id}-title`} className="text-card-part-title">Annotation</h3>
      {planControl}
    </div>
    {/* Without the plan control (texts outside the plan, annotators) the mode is a line of its own. */}
    {!planControl && mode && <p>{annotationTaskName(mode.mode)}</p>}
    {!planControl && mode?.source === "no_proposals" && <p className="text-card-muted">{NO_PROPOSALS}</p>}
    {proposals > 0 && <p className="text-card-muted">{plural(proposals, "tool proposal")}</p>}
    {annotating && row.unreviewed_translation && <p className="text-card-muted">Translation not reviewed yet</p>}
    {annotating && status && <p id={`${id}-status`}>{status}</p>}
    {people.length > 0 && <div className="text-card-chips">
      {people.map(item => {
        const layer = item.status === "submitted" ? layerOf(item.author_label, item.document_id) : undefined;
        return <AssignmentChip key={item.assignment_id} item={item} caseId={row.case_id} onChanged={() => { onChanged(); setRemoved(count => count + 1); }} now={now} onNavigate={onNavigate}
          menu={canManage ? { tools, mode: mode?.mode, onAssignAnother: assignAnother, onHistory } : undefined}
          link={layer ? textViewRoute(projectKey, row.case_id, item.document_id, query, { show: `submission:${layer.submission_id}` }) : undefined} />;
      })}
    </div>}
    {canManage && annotating && <div className="text-card-actions">
      <Button ref={assignButton} size="sm" variant="primary" aria-disabled={full ? "true" : undefined} aria-describedby={full ? `${id}-status` : undefined}
        onClick={() => { if (!full) onAssign(row, "annotate"); }}>Assign annotators…</Button>
    </div>}
  </section>;
}
