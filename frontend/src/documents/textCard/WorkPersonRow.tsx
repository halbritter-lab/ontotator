import { useRef, useState, type ReactNode } from "react";
import { AssignmentActions } from "../../admin/AssignmentActions";
import { AssignedDate } from "../../ui/AssignedDate";
import { Button } from "../../ui/Button";
import type { StatusTone } from "../../ui/StatusBadge";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import type { CardWorkItem } from "./cardModel";
import { nextRowTarget, possessive, PersonRow } from "./PersonRow";
import { RemoveAssignmentDialog } from "./RemoveAssignmentDialog";

/** The name of the person on a work item: display name, else pseudonym. */
export const workerName = (item: CardWorkItem): string => (item.person ? shortName(item.person) : item.author_label);

const STATUS: Readonly<Record<CardWorkItem["status"], { tone: StatusTone; label: string }>> = {
  open: { tone: "neutral", label: "Not started" },
  in_progress: { tone: "info", label: "In progress" },
  reopened: { tone: "warning", label: "Reopened" },
  submitted: { tone: "success", label: "Submitted" },
};

/** The status pill of a work item; an unsubmitted consolidation says "Consolidating" (its round runs once it is assigned, even while the assignment is still "open"). */
export function workStatus(item: CardWorkItem): { tone: StatusTone; label: string } {
  if (item.task === "review" && item.status !== "submitted") return { tone: "info", label: "Consolidating" };
  return STATUS[item.status];
}

/** "Assigned 18 Oct by you" (the full date and assigner on hover); null without a date. */
export function assignedLine(item: CardWorkItem, now?: Date, capitalized = true): ReactNode {
  if (!item.assigned_at) return null;
  const by = item.assigned_by ? (item.assigned_by.is_me ? "you" : shortName(item.assigned_by)) : null;
  return <><AssignedDate at={item.assigned_at} by={item.assigned_by ? shortName(item.assigned_by) : null} now={now} capitalized={capitalized} />{by && ` by ${by}`}</>;
}

/** What the task is called in the actions' accessible names ("Reassign Anna Roth’s annotation"). */
const NOUN: Readonly<Record<CardWorkItem["task"], string>> = { annotate: "annotation", translation_review: "translation review", review: "consolidation" };
const REVOKE_NOUN: Readonly<Record<CardWorkItem["task"], string>> = { annotate: "assignment", translation_review: "review assignment", review: "consolidation assignment" };

/**
 * One person's work on a step of the text card: name, details, status and the lead's actions for exactly
 * this assignment. "Remove…" is one action per person: an unsubmitted annotation is removed with its draft
 * (`removeAssignment`), everything else (submitted or reopened work, reviews, consolidations) is revoked
 * (`revokeAssignment`); the confirm dialog says which. A consolidation is not reassigned (D1).
 */
export function WorkPersonRow({ item, caseId, details, canManage, tools, onChanged, onRemoved, open }: {
  item: CardWorkItem;
  caseId: string;
  details?: ReactNode;
  /** The lead: Reassign…, Reopen…, Remove…. */
  canManage: boolean;
  /** The assignments and members (Reassign…, Reopen…, revoking Remove…). */
  tools?: TextVersionsTools;
  onChanged: () => void;
  /** After a removal: the next person's first button (null for the last row). */
  onRemoved?: (next: HTMLElement | null) => void;
  /** A link first in the actions ("Open annotation", "Open consolidation"); for everyone. */
  open?: ReactNode;
}): JSX.Element {
  const [dialog, setDialog] = useState<"remove" | "reassign" | "reopen" | "revoke" | null>(null);
  const row = useRef<HTMLLIElement>(null);
  const name = workerName(item);
  const own = possessive(name);
  const submitted = item.status === "submitted";
  const assignment = canManage ? tools?.assignments.find(entry => entry.id === item.assignment_id && !entry.revoked_at) : undefined;
  // `removeAssignment` refuses work that was ever submitted (a reopened annotation keeps its submission): revoke it.
  const deletes = item.task === "annotate" && !submitted && item.status !== "reopened" && !assignment?.last_submission_id;
  const removed = () => { onChanged(); onRemoved?.(nextRowTarget(row.current)); };
  const actions = canManage ? <>
    {assignment && !submitted && item.task !== "review" && <Button size="sm" aria-label={`Reassign ${own} ${NOUN[item.task]}`} onClick={() => setDialog("reassign")}>Reassign…</Button>}
    {assignment && submitted && item.task === "annotate" && <Button size="sm" aria-label={`Reopen ${own} annotation`} onClick={() => setDialog("reopen")}>Reopen…</Button>}
    {deletes
      ? <Button size="sm" aria-label={`Remove ${own} assignment${item.status === "open" ? "" : ", the draft is discarded"}`} onClick={() => setDialog("remove")}>Remove…</Button>
      : assignment && <Button size="sm" aria-label={`Remove ${own} ${REVOKE_NOUN[item.task]}`} onClick={() => setDialog("revoke")}>Remove…</Button>}
  </> : null;
  return <PersonRow ref={row} name={name} pseudonym={item.person?.pseudonym ?? item.author_label} details={details} status={workStatus(item)}>
    {open}
    {actions}
    {dialog === "remove" && <RemoveAssignmentDialog assignmentId={item.assignment_id} name={name} caseId={caseId}
      onCancel={() => setDialog(null)} onRemoved={() => { setDialog(null); removed(); }} />}
    {dialog && dialog !== "remove" && assignment && tools && <AssignmentActions assignment={assignment} members={tools.members} open={dialog}
      // The page's assignments reload refreshes the rows too (one reload, not two).
      onChanged={() => { tools.onAssignmentsChanged(); if (dialog === "revoke") onRemoved?.(nextRowTarget(row.current)); }} onClose={() => setDialog(null)} />}
  </PersonRow>;
}
