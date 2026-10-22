/**
 * Action column of a Documents row (documents overview "Columns" item 7, VD2, VD18): the first
 * lead-owned step's button plus a "+{n}" menu with the other lead actions; "Plan…" opens a small
 * plan popover with the row's Review / Annotate chips (a secondary button on undecided rows and on rows
 * outside the plan: actions are never text links). In-plan rows without a lead step show nothing.
 */
import { useEffect, useRef, useState } from "react";
import type { DocumentRowView, NextStepView } from "../api/client";
import { Button } from "../ui/Button";
import { MenuButton, type MenuItem } from "../ui/MenuButton";
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
  /** Button variant of "Plan…"; secondary on every row (actions are never text links). */
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
  // Undecided: the two-option controls; once decided (here or by a reload) the chips. The swap keeps focus in the popover.
  const choices = isUndecided(row) && !saves.decidedLocally(row);
  const shownChoices = useRef(choices);
  useEffect(() => {
    if (shownChoices.current === choices) return;
    shownChoices.current = choices;
    const active = document.activeElement;
    if (open && (!active || active === document.body)) document.getElementById(popoverId)?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [choices, open, popoverId]);
  return <>
    <Button ref={button} id={documentsRowId(row.case_id, row.language, "action")} size="sm" variant={variant}
      className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
      aria-label={`Plan…, ${name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined}
      onClick={() => setOpen(!open)}>Plan…</Button>
    <Popover open={open} anchorRef={button} label={`Plan, ${name}`} width={280} onClose={() => setOpen(false)}>
      <div id={popoverId}>{choices
        ? <PlanChoices row={row} groupRevision={groupRevision} saves={saves} />
        : <PlanChips row={row} groupRevision={groupRevision} saves={saves} />}</div>
    </Popover>
  </>;
}

/**
 * The plan of an undecided row as two-option controls ("Annotate" / "Don't annotate", and Review for
 * translations): neither option is pressed until the lead decides, so "not decided" never looks like "off".
 */
export function PlanChoices({ row, groupRevision, saves }: { row: DocumentRowView; groupRevision: number; saves: PlanSaves }): JSX.Element {
  const name = rowName(row);
  const reviewApplicable = row.plan_row?.review_applicable ?? !row.is_source;
  const choice = (flag: "review" | "annotate", on: string, off: string) => <div key={flag} role="group" aria-label={`${on}, ${name}`} className="documents-plan-choice">
    {[[true, on], [false, off]].map(([value, label]) => <Button key={String(value)} size="sm" variant="secondary"
      aria-pressed={false} aria-disabled={saves.isBusy(row, flag) || undefined}
      onClick={() => { if (!saves.isBusy(row, flag)) saves.set(row, flag, value as boolean, groupRevision); }}>{label as string}</Button>)}
    <span className="cell-secondary">Not decided yet</span>
  </div>;
  return <div className="documents-plan-choices" data-plan-row={`${row.case_id}:${row.language}`}>
    {reviewApplicable && choice("review", "Review", "Don't review")}
    {choice("annotate", "Annotate", "Don't annotate")}
  </div>;
}

export interface RowActionCellProps {
  row: DocumentRowView;
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Plan chips for "Plan…" (page plan saves and the case's revision); without it "Plan…" runs `onAction`. */
  plan?: { groupRevision: number; saves: PlanSaves };
  /** Full-width button (narrow cards). */
  block?: boolean;
  /**
   * Lead actions that are no step ("Change final…", "Request translation correction…"): listed in the
   * "+n" menu after the other steps of a row that has a step (the row panel offers them too).
   */
  extraActions?: readonly MenuItem[];
}

/** "+2 more actions, case-107 · de" (starts with the visible "+2", WCAG 2.5.3). */
export function moreActionsLabel(count: number, row: Pick<DocumentRowView, "case_id" | "language">): string {
  return `+${count} more ${count === 1 ? "action" : "actions"}, ${rowName(row)}`;
}

export function RowActionCell({ row, onAction, plan, block = false, extraActions = [] }: RowActionCellProps): JSX.Element | null {
  // The plan popover's open state lives here: a chip save reloads the row, which may change its
  // branch (undecided → in plan); the popover stays open until the user closes it.
  const [planOpen, setPlanOpen] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !planOpen;
    wasOpen.current = planOpen;
    if (!closed) return;
    // Focus left with the popover's button (it may be gone now): the row's action button, else its text name.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    (document.getElementById(documentsRowId(row.case_id, row.language, "action"))
      ?? document.getElementById(documentsRowId(row.case_id, row.language, "header")))?.focus();
  }, [planOpen, row.case_id, row.language]);

  const name = rowName(row);
  const className = ["documents-actions", block && "documents-actions--block"].filter(Boolean).join(" ");
  const popover = () => plan
    ? <PlanPopover key="plan" row={row} block={block} open={planOpen} onOpenChange={setPlanOpen} {...plan} />
    : null;
  const active = row.in_plan || isUndecided(row);
  const steps = active ? leadSteps(row) : [];
  const [first, ...rest] = steps;
  // Open popover: keep it (and its button) in the first slot whatever the row's branch is now.
  if (planOpen && plan) {
    return <span className={className}>{popover()}{menuOf(rest)}</span>;
  }
  if (!active) return plan ? <span className={className}>{popover()}</span> : null;
  // In-plan rows without a lead step show nothing; their other actions are in the row panel.
  if (!first) return null;
  const firstLabel = rowActionLabel(first, row);
  return <span className={className}>
    {first.action === "plan" && plan
      ? popover()
      : onAction && <Button key="first" id={documentsRowId(row.case_id, row.language, "action")} size="sm"
        className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
        aria-label={`${firstLabel}, ${name}`} onClick={() => onAction(row, first)}>{firstLabel}</Button>}
    {menuOf(rest)}
  </span>;

  function menuOf(others: NextStepView[]): JSX.Element | null {
    const items: MenuItem[] = [
      ...(onAction ? others.map((step, index) => ({ id: `${step.code}-${index}`, label: rowActionLabel(step, row), onSelect: () => onAction(row, step) })) : []),
      ...extraActions,
    ];
    return items.length > 0 ? <MenuButton key="more" label={moreActionsLabel(items.length, row)} buttonLabel={`+${items.length}`} items={items} /> : null;
  }
}
