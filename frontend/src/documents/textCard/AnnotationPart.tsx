import { useId, useRef, type ReactNode } from "react";
import type { DocumentRowView, RowSubmissionView } from "../../api/client";
import { plural } from "../../app/labels";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { annotationTaskName } from "../../editor/modes";
import { Button } from "../../ui/Button";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import { dayMonth, textViewRoute, type CardWorkItem } from "./cardModel";
import { PersonList, PersonRow, useFocusAfterRemoval } from "./PersonRow";
import { assignedLine, workerName, WorkPersonRow } from "./WorkPersonRow";

const NO_PROPOSALS = "This text has no tool proposals, so it is annotated from scratch.";
const MODE_TEXT = { proposals: "from proposals", scratch: "from scratch" } as const;

/** Joins the parts of a details line with " · ". */
function joined(parts: readonly ReactNode[]): ReactNode {
  return parts.filter(Boolean).map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>);
}

/** Submissions that are annotation layers (from scratch, or a check of the tool proposals). */
const LAYER_KINDS: ReadonlySet<RowSubmissionView["kind"]> = new Set(["annotation", "proposal_check"]);

/** Order of the rows: unsubmitted first (needs the lead), then submitted; each by assignment date. */
const byAssignment = (a: CardWorkItem, b: CardWorkItem) => (a.assigned_at ?? "").localeCompare(b.assigned_at ?? "") || a.assignment_id - b.assignment_id;
function ordered(people: readonly CardWorkItem[]): CardWorkItem[] {
  return [...people.filter(item => item.status !== "submitted").sort(byAssignment), ...people.filter(item => item.status === "submitted").sort(byAssignment)];
}

/**
 * Annotation part of the text card (M1 card mockups v1, v3; person rows variant A): the plan control in the header (planned
 * texts), how many annotators the text has of its limit, one row per person with their status and their own actions
 * (the lead's Reassign…, Reopen…, Remove…), removed people whose submission stays in the history, and one
 * "Assign annotators…" that opens the assign dialog (also for another person beside the current ones; the lead can
 * pick themselves there).
 */
export function AnnotationPart({ row, projectKey, query, submissions, canManage, onAssign, onNavigate, onChanged, tools, now, planControl }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** The row's submissions ("Open annotation" opens the person's layer); null while loading. */
  submissions: readonly RowSubmissionView[] | null;
  canManage: boolean;
  onAssign: (row: DocumentRowView, task: "annotate") => void;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  /** Assignments and members for the rows' Reassign…, Reopen… and Remove…. */
  tools?: TextVersionsTools;
  now?: Date;
  /** The annotation plan control in the header (planned texts). */
  planControl?: ReactNode;
}): JSX.Element {
  const id = useId();
  // After a removal focus moves to the next person's first button, else "Assign annotators…".
  const assignButton = useRef<HTMLButtonElement>(null);
  const focusAfterRemoval = useFocusAfterRemoval(assignButton);
  const mode = row.annotation_mode ?? null;
  const people = ordered(row.work.filter(item => item.task === "annotate" && item.moved_to_version == null));
  const documents = new Set(row.versions.map(version => version.document_id));
  // The newest annotation layer per person on this text.
  const layers = new Map<string, RowSubmissionView>();
  for (const item of submissions ?? []) {
    if (!LAYER_KINDS.has(item.kind) || !documents.has(item.document_id)) continue;
    const key = `${item.author_label}\u0000${item.document_id}`;
    const seen = layers.get(key);
    if (!seen || seen.recorded_at < item.recorded_at) layers.set(key, item);
  }
  const layerOf = (authorLabel: string, documentId: string) => layers.get(`${authorLabel}\u0000${documentId}`);
  // Removed after submitting: the row's work holds active assignments only, but the submission stays in the history,
  // so its author stays listed as "Removed" (people moved to a newer version are not removed).
  const current = new Set([...row.work, ...(row.moved_work ?? [])].filter(item => item.task === "annotate").map(item => item.author_label));
  const removedPeople = [...layers.values()].filter(item => !current.has(item.author_label)).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const detail = row.stages?.annotation.detail;
  const target = detail?.target ?? 0;
  const assigned = detail?.assigned ?? people.length;
  const full = target > 0 && assigned >= target;
  const annotating = row.stages?.annotation.state !== "not_planned";
  const status = target > 0 ? (assigned === 0 ? `Nobody assigned yet (limit ${target} per text).` : `${assigned} of ${target} annotators assigned.`) : null;
  // Version-aware as `CardPlanSelect`: "no_proposals" means the current version has none.
  const proposals = mode?.source === "no_proposals" ? 0 : mode?.proposal_count ?? row.proposal_count ?? 0;
  const openLayer = (name: string, documentId: string, submissionId: string, removed = false) =>
    <RouteLink route={textViewRoute(projectKey, row.case_id, documentId, query, { show: `submission:${submissionId}` })} onNavigate={onNavigate}
      className="btn btn-secondary btn-sm" aria-label={`Open annotation of ${name}${removed ? " (assignment removed)" : ""}`}>Open annotation</RouteLink>;

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
    {(people.length > 0 || removedPeople.length > 0) && <PersonList label="Annotators">
      {people.map(item => {
        const layer = item.status === "submitted" ? layerOf(item.author_label, item.document_id) : undefined;
        const day = layer ? dayMonth(layer.recorded_at) : null;
        const submittedText = layer ? `Submitted${day ? ` ${day}` : ""}, ${plural(layer.finding_count, "finding")}` : null;
        // "Assigned 18 Oct by you, from proposals"; "Submitted 22 Oct, 14 findings · assigned 15 Oct".
        const assignedText = assignedLine(item, now, !submittedText && !item.held);
        const modeText = item.status !== "submitted" && item.annotation_mode ? MODE_TEXT[item.annotation_mode] : null;
        const details = joined([
          item.held && "Paused",
          submittedText,
          assignedText ? <>{assignedText}{modeText && `, ${modeText}`}</> : modeText,
        ]);
        return <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} details={details} canManage={canManage} tools={tools}
          onChanged={onChanged} onRemoved={focusAfterRemoval} open={layer ? openLayer(workerName(item), item.document_id, layer.submission_id) : undefined} />;
      })}
      {removedPeople.map(layer => {
        const name = layer.author ? shortName(layer.author) : layer.author_label;
        // The removal date when the page's assignments still list the revoked assignment.
        const revoked = tools?.assignments.find(entry => entry.pseudonym === layer.author_label && entry.document_id === layer.document_id && entry.revoked_at)?.revoked_at;
        const submittedDay = dayMonth(layer.recorded_at);
        return <PersonRow key={layer.submission_id} name={name} pseudonym={layer.author_label} removed status={{ tone: "neutral", label: "Removed" }}
          details={joined([revoked ? `Removed ${dayMonth(revoked)}` : "Assignment removed", `${submittedDay ? `submitted ${submittedDay}` : "submitted"}, kept in the history`])}>
          {openLayer(name, layer.document_id, layer.submission_id, true)}
        </PersonRow>;
      })}
    </PersonList>}
    {canManage && annotating && <div className="text-card-actions">
      <Button ref={assignButton} size="sm" variant="primary" aria-disabled={full ? "true" : undefined} aria-describedby={full ? `${id}-status` : undefined}
        onClick={() => { if (!full) onAssign(row, "annotate"); }}>Assign annotators…</Button>
    </div>}
  </section>;
}
