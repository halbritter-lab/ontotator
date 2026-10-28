/** Admin actions of one stage (moved out of the row panel, U3); the cards' stage popover lists them. */
import { useState } from "react";
import type { AssignmentView, DocumentRowView } from "../api/client";
import { AssignmentActions } from "../admin/AssignmentActions";
import type { PanelStage } from "../app/router";
import { Button } from "../ui/Button";
import { acceptanceOf, isDiscarded, type TextVersionsTools } from "./TextVersions";

export type AssignTaskKind = "translation_review" | "annotate";

/** D25: a new review of a translation the lead (or the import override) accepted without one. */
export function canAssignNewReview(row: DocumentRowView): boolean {
  return !row.is_source
    && !row.work.some(item => item.task === "translation_review" && item.status !== "submitted" && item.moved_to_version == null)
    && row.versions.some(version => version.is_newest_in_chain && !isDiscarded(row, version) && version.translation_status === "accepted"
      && (acceptanceOf(version)?.source === "lead" || acceptanceOf(version)?.source === "override"));
}

export interface StageActionsProps {
  row: DocumentRowView;
  /** Only this stage's actions; none means every stage. */
  stage?: PanelStage;
  onAssign?: (row: DocumentRowView, task: AssignTaskKind, options?: { newReviewOfAccepted?: boolean }) => void;
  onRequestCorrection?: (row: DocumentRowView) => void;
  canRequestCorrection?: (row: DocumentRowView) => boolean;
  onChangeFinal?: (row: DocumentRowView) => void;
  canChangeFinal?: (row: DocumentRowView) => boolean;
  textVersionTools?: TextVersionsTools;
  /** The text card: its person rows carry every person's Reassign… / Reopen… / Remove…, its versions Request correction. */
  inCard?: boolean;
}

/**
 * Admin actions of the given stage, or of every stage: Annotation "Reassign…" (one direct button per open
 * task, S3); Translation "Request correction…", "Assign a new review…"; Finalization "Change final…" of a
 * decided row.
 */
export function StageActions({ row, stage, onAssign, onRequestCorrection, canRequestCorrection, onChangeFinal, canChangeFinal, textVersionTools, inCard = false }: StageActionsProps): JSX.Element | null {
  const show = (name: PanelStage) => !stage || stage === name;
  const documents = new Set(row.versions.map(version => version.document_id));
  // Open work of the stage (reviewers under Translation, annotators under Annotation): Reassign… and the assignment actions.
  const workIds = new Set(inCard ? [] : row.work.filter(item => item.status !== "submitted" && item.moved_to_version == null
    && (item.task === "translation_review" ? show("review") : show("annotation"))).map(item => item.assignment_id));
  const reassignable: AssignmentView[] = textVersionTools
    ? textVersionTools.assignments.filter(assignment => workIds.has(assignment.id) && documents.has(assignment.document_id) && !assignment.revoked_at) : [];
  // Submitted annotations: "Reopen…" with the stage (the version list's assignment actions offer it too).
  const reopenable: AssignmentView[] = textVersionTools && show("annotation") && !inCard
    ? textVersionTools.assignments.filter(assignment => assignment.task === "annotate" && assignment.status === "submitted" && documents.has(assignment.document_id) && !assignment.revoked_at) : [];
  const [reopening, setReopening] = useState<number | null>(null);
  const correction = show("review") && !inCard && onRequestCorrection && canRequestCorrection?.(row);
  const newReview = show("review") && onAssign && canAssignNewReview(row);
  const changeFinal = show("final") && onChangeFinal && canChangeFinal?.(row);
  if (!reassignable.length && !reopenable.length && !correction && !newReview && !changeFinal) return null;
  const personOf = (pseudonym: string) => {
    const display = textVersionTools?.members.find(member => member.pseudonym === pseudonym)?.display_name?.trim();
    return display ? `${display} (${pseudonym})` : pseudonym;
  };
  return <>
    {reassignable.map(assignment => <div key={assignment.id} className="stage-actions-reassign">
      <span>{personOf(assignment.pseudonym)}</span>
      {textVersionTools && <AssignmentActions assignment={assignment} members={textVersionTools.members} onChanged={textVersionTools.onAssignmentsChanged} />}
    </div>)}
    {reopenable.map(assignment => <div key={assignment.id} className="stage-actions-reassign">
      <span>{personOf(assignment.pseudonym)}</span>
      <Button size="sm" aria-label={`Reopen…, ${personOf(assignment.pseudonym)}`} onClick={() => setReopening(assignment.id)}>Reopen…</Button>
      {reopening === assignment.id && textVersionTools && <AssignmentActions assignment={assignment} members={textVersionTools.members} open="reopen"
        onChanged={textVersionTools.onAssignmentsChanged} onClose={() => setReopening(null)} />}
    </div>)}
    {correction && <Button size="sm" onClick={() => onRequestCorrection(row)}>Request correction…</Button>}
    {newReview && <Button size="sm" onClick={() => onAssign(row, "translation_review", { newReviewOfAccepted: true })}>Assign a new review…</Button>}
    {changeFinal && <Button size="sm" onClick={() => onChangeFinal(row)}>Change final…</Button>}
  </>;
}
