import { useState } from "react";
import type { Route } from "../../app/router";
import { AssignedDate } from "../../ui/AssignedDate";
import { IconButton } from "../../ui/IconButton";
import { IconClose } from "../../ui/icons";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { CardWorkItem } from "./cardModel";
import { RemoveAssignmentDialog } from "./RemoveAssignmentDialog";

const STATE_TEXT: Readonly<Record<CardWorkItem["status"], string>> = { open: "not started", in_progress: "in progress", reopened: "in progress", submitted: "submitted" };

/** The name of the person on a work item: display name, else pseudonym. */
export const workerName = (item: CardWorkItem): string => (item.person ? shortName(item.person) : item.author_label);

/** One person on a step of the text card: name, state, assignment date, and (lead, unsubmitted) ✕ to remove. */
export function AssignmentChip({ item, caseId, canRemove, onChanged, link, onNavigate, now }: {
  item: CardWorkItem;
  caseId: string;
  /** The lead may remove it; never for a submitted item. */
  canRemove: boolean;
  onChanged: () => void;
  /** The name links here (the text view with the person's layer). */
  link?: Route;
  onNavigate?: (route: Route) => void;
  now?: Date;
}): JSX.Element {
  const [removing, setRemoving] = useState(false);
  const name = workerName(item);
  const removable = canRemove && item.status !== "submitted";
  return <span className="assignment-chip">
    {link ? <RouteLink route={link} onNavigate={onNavigate} className="assignment-chip-name">{name}</RouteLink> : <span className="assignment-chip-name">{name}</span>}
    <span className="assignment-chip-state">{STATE_TEXT[item.status]}</span>
    {item.assigned_at && <span className="assignment-chip-date"><AssignedDate at={item.assigned_at} by={item.assigned_by ? shortName(item.assigned_by) : null} now={now} /></span>}
    {removable && <IconButton className="assignment-chip-remove" label={`Remove ${name}`} icon={<IconClose />} variant="quiet" size="sm" onClick={() => setRemoving(true)} />}
    {removing && <RemoveAssignmentDialog assignmentId={item.assignment_id} name={name} caseId={caseId}
      onCancel={() => setRemoving(false)} onRemoved={() => { setRemoving(false); onChanged(); }} />}
  </span>;
}
