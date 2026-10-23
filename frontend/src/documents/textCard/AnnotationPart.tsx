import { useEffect, useId, useRef, useState } from "react";
import type { DocumentRowView, RowSubmissionView } from "../../api/client";
import { errorMessage } from "../../admin/errors";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { annotationTaskName } from "../../editor/modes";
import { Button } from "../../ui/Button";
import { InlineMessage } from "../../ui/InlineMessage";
import { RouteLink } from "../RowCells";
import { AssignmentChip } from "./AssignmentChip";
import { textViewRoute } from "./cardModel";

const NO_PROPOSALS = "This text has no tool proposals, so it is annotated from scratch.";
const MYSELF_HINT = "You will then not be able to consolidate this text yourself (project rule).";

/** Annotation part of the text card: mode, tool proposals, one chip per person, + Person, Annotate from proposals myself. */
export function AnnotationPart({ row, projectKey, query, submissions, canManage, adjudicatorNotAnnotator = false, onAssign, onCheckMyself, onNavigate, onChanged, now }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** The row's submissions (the name of a submitted person links to their layer); null while loading. */
  submissions: readonly RowSubmissionView[] | null;
  canManage: boolean;
  /** Project rule "The consolidator of a text may not be one of its annotators". */
  adjudicatorNotAnnotator?: boolean;
  onAssign: (row: DocumentRowView, task: "annotate") => void;
  onCheckMyself: (row: DocumentRowView) => Promise<void>;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  now?: Date;
}): JSX.Element {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a removal the chip goes away; focus "+ Person" once the confirm dialog has returned focus (effects run after it).
  const addButton = useRef<HTMLButtonElement>(null);
  const [removed, setRemoved] = useState(0);
  useEffect(() => { if (removed) addButton.current?.focus(); }, [removed]);
  const mode = row.annotation_mode ?? null;
  const proposals = row.proposal_count ?? mode?.proposal_count ?? 0;
  const people = row.work.filter(item => item.task === "annotate" && item.moved_to_version == null);
  const detail = row.stages?.annotation.detail;
  const target = detail?.target ?? 0;
  const full = target > 0 && (detail?.assigned ?? 0) >= target;
  const myself = canManage && mode?.mode === "proposals" && !people.some(item => item.is_me);
  const layerOf = (authorLabel: string, documentId: string) => submissions?.find(item => item.kind === "annotation" && item.author_label === authorLabel && item.document_id === documentId);

  const checkMyself = async () => {
    setBusy(true);
    setError(null);
    try { await onCheckMyself(row); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };

  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-card-part-title">Annotation</h3>
    {mode && <p>{annotationTaskName(mode.mode)}</p>}
    {mode?.source === "no_proposals" && <p className="text-card-muted">{NO_PROPOSALS}</p>}
    {proposals > 0 && <p>
      <span>{`${proposals} tool proposals`}</span>{" "}
      <RouteLink route={textViewRoute(projectKey, row.case_id, row.open.document_id, query, { show: "proposals" })} onNavigate={onNavigate}>View proposals</RouteLink>
    </p>}
    <div className="text-card-chips">
      {people.map(item => {
        const layer = item.status === "submitted" ? layerOf(item.author_label, item.document_id) : undefined;
        return <AssignmentChip key={item.assignment_id} item={item} caseId={row.case_id} canRemove={canManage} onChanged={() => { onChanged(); setRemoved(count => count + 1); }} now={now} onNavigate={onNavigate}
          link={layer ? textViewRoute(projectKey, row.case_id, item.document_id, query, { show: `submission:${layer.submission_id}` }) : undefined} />;
      })}
      {canManage && <>
        <Button ref={addButton} size="sm" aria-disabled={full ? "true" : undefined} aria-describedby={full ? `${id}-full` : undefined}
          onClick={() => { if (!full) onAssign(row, "annotate"); }}>+ Person</Button>
        {full && <span id={`${id}-full`} className="text-card-muted">{`${target} of ${target} assigned`}</span>}
      </>}
    </div>
    {myself && <div className="text-card-myself">
      <Button size="sm" loading={busy} aria-describedby={adjudicatorNotAnnotator ? `${id}-hint` : undefined} onClick={() => { void checkMyself(); }}>Annotate from proposals myself</Button>
      {adjudicatorNotAnnotator && <p id={`${id}-hint`} className="text-card-muted">{MYSELF_HINT}</p>}
    </div>}
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
  </section>;
}
