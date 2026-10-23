/**
 * Next step column of a Documents row (spec 2026-10-23 §2b, VD2): one button, the viewer's next step
 * ("Open my task" for an own open task, else the first lead-owned step); further actions live in the text
 * card, and a "More" menu holds any that remain. Plan changes happen in the card ("Change plan…") or the bulk
 * "Plan…" dialog (F5); rows outside the plan and in-plan rows without a step show nothing.
 */
import type { DocumentRowView, NextStepView } from "../api/client";
import type { Route } from "../app/router";
import { Button } from "../ui/Button";
import { IconMore } from "../ui/icons";
import { MenuButton, type MenuItem } from "../ui/MenuButton";
import { leadSteps, rowActionLabel } from "./nextStepLabels";
import { documentsRowId, RouteLink, rowName } from "./RowCells";
import { isUndecided } from "./stageLabels";

export interface RowActionCellProps {
  row: DocumentRowView;
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Full-width button (narrow cards). */
  block?: boolean;
  /** In-app navigation of "Open my task". */
  onNavigate?: (route: Route) => void;
}

/** "More actions, case-107 de" (starts with the visible "More", WCAG 2.5.3). */
export function moreActionsLabel(row: Pick<DocumentRowView, "case_id" | "language">): string {
  return `More actions, ${row.case_id} ${row.language}`;
}

export function RowActionCell({ row, onAction, block = false, onNavigate }: RowActionCellProps): JSX.Element | null {
  const name = rowName(row);
  const className = ["documents-actions", block && "documents-actions--block"].filter(Boolean).join(" ");
  const active = row.in_plan || isUndecided(row);
  const steps = active ? leadSteps(row) : [];
  const ownTask = row.own_open_assignment_id;
  // An own open task is the viewer's next step; the lead steps then move into More.
  const [first, ...rest] = ownTask != null ? [null, ...steps] : steps;
  if (ownTask != null) {
    return <span className={className}>
      <RouteLink route={{ name: "task", assignmentId: ownTask }} onNavigate={onNavigate} id={documentsRowId(row.case_id, row.language, "action")}
        className={["documents-action", "btn", "btn-secondary", "btn-sm", block && "documents-action--block"].filter(Boolean).join(" ")}>Open my task</RouteLink>
      {menuOf(rest)}
    </span>;
  }
  if (!active) return null;
  // In-plan rows without a lead step show nothing; their other actions are in the text card.
  if (!first) return null;
  const firstLabel = rowActionLabel(first, row);
  return <span className={className}>
    {onAction && <Button key="first" id={documentsRowId(row.case_id, row.language, "action")} size="sm"
        className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
        aria-label={`${firstLabel}, ${name}`} onClick={() => onAction(row, first)}>{firstLabel}</Button>}
    {menuOf(rest)}
  </span>;

  // Lead actions that are no step ("Change final…", "Request correction…") live in the text card only.
  function menuOf(others: readonly (NextStepView | null)[]): JSX.Element | null {
    const items: MenuItem[] = onAction ? others.filter((step): step is NextStepView => step !== null)
      .map((step, index) => ({ id: `${step.code}-${index}`, label: rowActionLabel(step, row), onSelect: () => onAction(row, step) })) : [];
    return items.length > 0 ? <MenuButton key="more" label={moreActionsLabel(row)} buttonLabel="More" icon={<IconMore />} items={items} /> : null;
  }
}
