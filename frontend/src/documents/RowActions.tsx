/**
 * Action column of a Documents row (documents overview "Columns" item 7, VD2, VD18): the first
 * lead-owned step's button plus a "+{n}" menu with the other lead actions; "Plan…" opens a small
 * plan popover with the row's Review / Annotate chips (secondary on undecided rows, quiet on rows
 * outside the plan). In-plan rows without a lead step show nothing.
 */
import { useRef, useState } from "react";
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
}

/** "Plan…" and its non-modal popover with the row's plan chips (one click saves, Undo toast). */
export function PlanPopover({ row, groupRevision, saves, variant = "secondary", block = false }: PlanPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const name = rowName(row);
  return <>
    <Button ref={button} id={documentsRowId(row.case_id, row.language, "action")} size="sm" variant={variant}
      className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
      aria-label={`Plan…, ${name}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>Plan…</Button>
    <Popover open={open} anchorRef={button} label={`Plan, ${name}`} width={280} onClose={() => setOpen(false)}>
      <PlanChips row={row} groupRevision={groupRevision} saves={saves} />
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
  const undecided = isUndecided(row);
  if (!row.in_plan && !undecided) {
    return plan ? <PlanPopover row={row} variant="quiet" block={block} {...plan} /> : null;
  }
  const steps = leadSteps(row);
  if (steps.length === 0) return null;
  const [first, ...rest] = steps;
  const name = rowName(row);
  const firstLabel = rowActionLabel(first, row);
  return <span className="documents-actions">
    {first.action === "plan" && plan
      ? <PlanPopover row={row} variant="secondary" block={block} {...plan} />
      : onAction && <Button id={documentsRowId(row.case_id, row.language, "action")} size="sm"
        className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
        aria-label={`${firstLabel}, ${name}`} onClick={() => onAction(row, first)}>{firstLabel}</Button>}
    {rest.length > 0 && onAction && <MenuButton label={moreActionsLabel(rest.length, row)} buttonLabel={`+${rest.length}`}
      items={rest.map((step, index) => ({ id: `${step.code}-${index}`, label: rowActionLabel(step, row), onSelect: () => onAction(row, step) }))} />}
  </span>;
}
