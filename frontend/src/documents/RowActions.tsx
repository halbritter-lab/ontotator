/**
 * Action column of a Documents row (documents overview "Columns" item 7, VD2, VD18): the first
 * lead-owned step's button plus a "+{n}" menu with the other lead actions; "Plan…" opens a small
 * plan popover with the row's Review / Annotate chips (secondary on undecided rows, quiet on rows
 * outside the plan). In-plan rows without a lead step show nothing.
 */
import { useEffect, useRef, useState } from "react";
import type { DocumentRowView, NextStepView } from "../api/client";
import { Button } from "../ui/Button";
import { MenuButton } from "../ui/MenuButton";
import { Popover } from "../ui/Popover";
import { leadSteps, rowActionLabel } from "./nextStepLabels";
import { PlanChips, type PlanSaves } from "./PlanChips";
import { documentsRowId, rowName } from "./RowCells";
import { isUndecided } from "./stageLabels";

export interface PlanPopoverProps {
  row: DocumentRowView;
  /** The case group's `plan_revision` from the rows page. */
  groupRevision: number;
  saves: PlanSaves;
  /** `secondary` on undecided rows, `quiet` on rows outside the plan (VD2). */
  variant?: "secondary" | "quiet";
  block?: boolean;
  /** Controlled open state (RowActionCell keeps it across reloads); uncontrolled without it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** "Plan…" and its non-modal popover with the row's plan chips (one click saves, Undo toast). */
export function PlanPopover({ row, groupRevision, saves, variant = "secondary", block = false, open: openProp, onOpenChange }: PlanPopoverProps): JSX.Element {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (value: boolean) => { if (openProp === undefined) setOwnOpen(value); onOpenChange?.(value); };
  const button = useRef<HTMLButtonElement>(null);
  const name = rowName(row);
  const popoverId = documentsRowId(row.case_id, row.language, "plan");
  return <>
    <Button ref={button} id={documentsRowId(row.case_id, row.language, "action")} size="sm" variant={variant}
      className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
      aria-label={`Plan…, ${name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined}
      onClick={() => setOpen(!open)}>Plan…</Button>
    <Popover open={open} anchorRef={button} label={`Plan, ${name}`} width={280} onClose={() => setOpen(false)}>
      <div id={popoverId}><PlanChips row={row} groupRevision={groupRevision} saves={saves} /></div>
    </Popover>
  </>;
}

export interface RowActionCellProps {
  row: DocumentRowView;
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Plan chips for "Plan…" (page plan saves and the case's revision); without it "Plan…" runs `onAction`. */
  plan?: { groupRevision: number; saves: PlanSaves };
  /** Full-width button (narrow cards). */
  block?: boolean;
}

/** "+2 more actions, case-107 · de" (starts with the visible "+2", WCAG 2.5.3). */
export function moreActionsLabel(count: number, row: Pick<DocumentRowView, "case_id" | "language">): string {
  return `+${count} more ${count === 1 ? "action" : "actions"}, ${rowName(row)}`;
}

export function RowActionCell({ row, onAction, plan, block = false }: RowActionCellProps): JSX.Element | null {
  // The plan popover's open state lives here: a chip save reloads the row, which may change its
  // branch (undecided → in plan); the popover stays open until the user closes it.
  const [planOpen, setPlanOpen] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !planOpen;
    wasOpen.current = planOpen;
    if (!closed) return;
    // Focus left with the popover's button (it may be gone now): the row's action button, else its disclosure.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    (document.getElementById(documentsRowId(row.case_id, row.language, "action"))
      ?? document.getElementById(documentsRowId(row.case_id, row.language, "disclosure")))?.focus();
  }, [planOpen, row.case_id, row.language]);

  const name = rowName(row);
  const className = ["documents-actions", block && "documents-actions--block"].filter(Boolean).join(" ");
  const popover = (variant: "secondary" | "quiet") => plan
    ? <PlanPopover key="plan" row={row} variant={variant} block={block} open={planOpen} onOpenChange={setPlanOpen} {...plan} />
    : null;
  const active = row.in_plan || isUndecided(row);
  const steps = active ? leadSteps(row) : [];
  const [first, ...rest] = steps;
  // Open popover: keep it (and its button) in the first slot whatever the row's branch is now.
  if (planOpen && plan) {
    return <span className={className}>{popover(active ? "secondary" : "quiet")}{menuOf(rest)}</span>;
  }
  if (!active) return plan ? <span className={className}>{popover("quiet")}</span> : null;
  if (!first) return null;
  const firstLabel = rowActionLabel(first, row);
  return <span className={className}>
    {first.action === "plan" && plan
      ? popover("secondary")
      : onAction && <Button key="first" id={documentsRowId(row.case_id, row.language, "action")} size="sm"
        className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
        aria-label={`${firstLabel}, ${name}`} onClick={() => onAction(row, first)}>{firstLabel}</Button>}
    {menuOf(rest)}
  </span>;

  function menuOf(others: NextStepView[]): JSX.Element | null {
    return others.length > 0 && onAction ? <MenuButton key="more" label={moreActionsLabel(others.length, row)} buttonLabel={`+${others.length}`}
      items={others.map((step, index) => ({ id: `${step.code}-${index}`, label: rowActionLabel(step, row), onSelect: () => onAction(row, step) }))} /> : null;
  }
}
