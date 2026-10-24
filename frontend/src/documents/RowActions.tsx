/**
 * Next step column of a Documents row (spec 2026-10-23 §2b, VD2): one button, the viewer's next step
 * ("Open my task" for an own open task, else the first lead-owned step); every other action lives in the text
 * card (no per-row overflow menu, M1). Plan changes happen in the card ("Change plan…") or the bulk
 * "Plan…" dialog (F5); rows outside the plan and in-plan rows without a step show nothing.
 */
import type { DocumentRowView, NextStepView } from "../api/client";
import type { Route } from "../app/router";
import { Button } from "../ui/Button";
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
  /** "Add to plan…" of a text outside the plan (the Change plan dialog). */
  onAddToPlan?: (row: DocumentRowView) => void;
}

/** The label of the row's one button, as the Next step column shows it (its sort value). */
export function rowActionText(row: DocumentRowView): string {
  if (row.own_open_assignment_id != null) return "Open my task";
  if (!(row.in_plan || isUndecided(row))) return "Add to plan…";
  const first = leadSteps(row)[0];
  return first ? rowActionLabel(first, row) : "";
}

export function RowActionCell({ row, onAction, block = false, onNavigate, onAddToPlan }: RowActionCellProps): JSX.Element | null {
  const name = rowName(row);
  const className = ["documents-actions", block && "documents-actions--block"].filter(Boolean).join(" ");
  const active = row.in_plan || isUndecided(row);
  const ownTask = row.own_open_assignment_id;
  if (ownTask != null) {
    return <span className={className}>
      <RouteLink route={{ name: "task", assignmentId: ownTask }} onNavigate={onNavigate} id={documentsRowId(row.case_id, row.language, "action")}
        className={["documents-action", "btn", "btn-secondary", "btn-sm", block && "documents-action--block"].filter(Boolean).join(" ")}>Open my task</RouteLink>
    </span>;
  }
  if (!active && onAddToPlan) {
    return <span className={className}>
      <Button id={documentsRowId(row.case_id, row.language, "action")} size="sm" className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
        aria-label={`Add to plan…, ${name}`} onClick={() => onAddToPlan(row)}>Add to plan…</Button>
    </span>;
  }
  // An own open task is the viewer's next step (above); otherwise the first lead step. In-plan rows without a lead
  // step show nothing; their other actions are in the text card.
  const first = active ? leadSteps(row)[0] : undefined;
  if (!first) return null;
  const firstLabel = rowActionLabel(first, row);
  return <span className={className}>
    {onAction && <Button key="first" id={documentsRowId(row.case_id, row.language, "action")} size="sm"
        className={["documents-action", block && "documents-action--block"].filter(Boolean).join(" ")}
        aria-label={`${firstLabel}, ${name}`} onClick={() => onAction(row, first)}>{firstLabel}</Button>}
  </span>;
}
