import { useState } from "react";
import { AssignmentActions } from "../../admin/AssignmentActions";
import type { Route } from "../../app/router";
import { AssignedDate } from "../../ui/AssignedDate";
import { IconSortDown } from "../../ui/icons";
import { MenuButton, type MenuItem } from "../../ui/MenuButton";
import { RouteLink } from "../RowCells";
import { shortName } from "../stageLabels";
import type { TextVersionsTools } from "../TextVersions";
import type { CardWorkItem } from "./cardModel";
import { RemoveAssignmentDialog } from "./RemoveAssignmentDialog";

const STATE_TEXT: Readonly<Record<CardWorkItem["status"], string>> = { open: "not started", in_progress: "in progress", reopened: "in progress", submitted: "submitted" };

/** The name of the person on a work item: display name, else pseudonym. */
export const workerName = (item: CardWorkItem): string => (item.person ? shortName(item.person) : item.author_label);

/** What the lead can do from an annotation chip (the chip becomes a menu button). */
export interface ChipMenu {
  /** Reassign… needs the assignment and the members (Text versions tools). */
  tools?: TextVersionsTools;
  /** "Assign another person (… keeps working)": only while the text is below its annotation limit. */
  onAssignAnother?: () => void;
  /** The text's annotation mode: a new person starts fresh in it. */
  mode?: "proposals" | "scratch";
  /** Submitted work: the menu only opens the history. */
  onHistory?: () => void;
}

/**
 * One person on a step of the text card: name, state, assignment date. With `menu` (the lead, annotation) the chip
 * is a menu button: unsubmitted work offers Reassign, Remove and (below the limit) Assign another person; submitted
 * work only opens the history.
 */
export function AssignmentChip({ item, caseId, menu, onChanged, link, onNavigate, now }: {
  item: CardWorkItem;
  caseId: string;
  menu?: ChipMenu;
  onChanged: () => void;
  /** The name links here (the text view with the person's layer); chips without a menu only. */
  link?: Route;
  onNavigate?: (route: Route) => void;
  now?: Date;
}): JSX.Element {
  const [dialog, setDialog] = useState<"remove" | "reassign" | null>(null);
  const name = workerName(item);
  const submitted = item.status === "submitted";
  const details = <>
    <span className="assignment-chip-state">{STATE_TEXT[item.status]}</span>
    {item.assigned_at && <span className="assignment-chip-date"><AssignedDate at={item.assigned_at} by={item.assigned_by ? shortName(item.assigned_by) : null} now={now} /></span>}
  </>;
  const assignment = menu?.tools?.assignments.find(entry => entry.id === item.assignment_id && !entry.revoked_at);
  const items: MenuItem[] = !menu ? [] : submitted
    // Submitted work counts: nothing to change; its name opens the person's layer, else the chip opens the history.
    ? (menu.onHistory && !link ? [{ id: "history", label: "Open history", onSelect: menu.onHistory }] : [])
    : [
      ...(assignment ? [{ id: "reassign", label: "Reassign to someone else…", description: `They start fresh ${menu.mode === "scratch" ? "from scratch" : "from proposals"}. ${name} can no longer continue; the draft stays in the history.`, onSelect: () => setDialog("reassign") }] : []),
      { id: "remove", label: "Remove (draft is discarded)", description: "Frees the slot.", onSelect: () => setDialog("remove") },
      ...(menu.onAssignAnother ? [{ id: "another", label: `Assign another person (${name} keeps working)`, onSelect: menu.onAssignAnother }] : []),
    ];
  if (!items.length) {
    return <span className="assignment-chip">
      {link ? <RouteLink route={link} onNavigate={onNavigate} className="assignment-chip-name">{name}</RouteLink> : <span className="assignment-chip-name">{name}</span>}
      {details}
    </span>;
  }
  return <>
    <MenuButton className="assignment-chip assignment-chip--menu" label={`${name}, ${STATE_TEXT[item.status]}: actions`} buttonLabel={name} items={items}
      content={<><span className="assignment-chip-name">{name}</span>{details}<IconSortDown className="assignment-chip-chevron" /></>} />
    {dialog === "remove" && <RemoveAssignmentDialog assignmentId={item.assignment_id} name={name} caseId={caseId}
      onCancel={() => setDialog(null)} onRemoved={() => { setDialog(null); onChanged(); }} />}
    {dialog === "reassign" && assignment && menu?.tools && <AssignmentActions assignment={assignment} members={menu.tools.members} open="reassign"
      onChanged={() => { menu.tools?.onAssignmentsChanged(); onChanged(); }} onClose={() => setDialog(null)} />}
  </>;
}
