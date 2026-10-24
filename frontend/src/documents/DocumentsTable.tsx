/**
 * Documents table (spec 2026-10-23 §2b, documents overview VD1, VD4, VD5): one `<tbody>` per case with a
 * slim case line (case checkbox, case ID and, on the right, the "n not in plan" toggle), then one line per
 * planned text: [checkbox] Text, Translation, Annotation, Finalization, Waiting on, Next step, Last activity.
 * Texts outside the plan (source and translations alike) stay folded per case; expanded they are muted rows
 * with "Add to plan…". Decision rows get the left edge. A row click (or the text name) opens the text card
 * and never changes the selection; only the checkboxes select. Selection and the card are owned by the page.
 */
import { useMemo, type MouseEvent, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, DocumentRowsRequest, NextStepView } from "../api/client";
import type { Route } from "../app/router";
import { plural } from "../app/labels";
import { DataTable, type Column, type DataTableGroup, type DataTableSort, type GroupSelectMode } from "../ui/DataTable";
import { IconChevronRight } from "../ui/icons";
import { RowActionCell } from "./RowActions";
import {
  documentsGroupId,
  documentsNotInPlanId,
  documentsRowId,
  LastActivityCell,
  type OpenTextCard,
  RowHeaderCell,
  RowStageCell,
  rowKeyOf,
  rowName,
  rowNeedsDecision,
  ShortId,
  WaitingOnCell,
} from "./RowCells";
import { isActiveRow } from "./stageLabels";

/** Narrow cards' case heading: "case-0101, en source + 2 translations"; without the source row in view "case-0101, 3 languages". */
export function caseHeaderText(group: Pick<DocumentGroupView, "case_id" | "rows" | "language_count">): string {
  const source = group.rows.find(row => row.is_source);
  if (!source) return `${group.case_id}, ${plural(group.language_count, "language")}`;
  const translations = group.language_count - 1;
  return `${group.case_id}, ${source.language} source${translations > 0 ? ` + ${plural(translations, "translation")}` : ""}`;
}

/** The rows a case shows: its planned texts, then (when the case's "not in plan" toggle is open) the others. */
export function visibleRows(group: Pick<DocumentGroupView, "rows">, notInPlanOpen: boolean): DocumentRowView[] {
  const planned = group.rows.filter(isActiveRow);
  return notInPlanOpen ? [...planned, ...group.rows.filter(row => !isActiveRow(row))] : planned;
}

/** The page's text selection as the table needs it (`"{case}:{language}"` keys, list order passed back). */
export interface TableSelection {
  keys: ReadonlySet<string>;
  caseState: (caseKeys: readonly string[]) => "all" | "some" | "none";
  select: (key: string, mode: GroupSelectMode, order: readonly string[]) => void;
  selectCase: (caseKeys: readonly string[], mode: GroupSelectMode, order: readonly string[]) => void;
}

/** Elements inside a row that handle their own clicks; a click on them never counts as a click on the row. */
const ROW_INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button'], [role='menuitem'], [role='checkbox'], [tabindex]:not([tabindex='-1']), .data-table-select-cell";

/**
 * How a click on a row's own area selects: plain "row", Shift "range", Ctrl/Meta "toggle-keep-anchor"; null for
 * clicks on interactive elements, from a portal (popover/menu content bubbles through React), other buttons,
 * Alt, or while text is being selected (dragging over a name copies it).
 */
export function rowAreaClick(event: MouseEvent<HTMLElement>): "row" | "range" | "toggle-keep-anchor" | null {
  const target = event.target as Element | null;
  if (!target || !event.currentTarget.contains(target) || event.button !== 0 || event.altKey) return null;
  if (target.closest(ROW_INTERACTIVE)) return null;
  const selected = typeof window.getSelection === "function" ? window.getSelection()?.toString() ?? "" : "";
  if (selected.length > 0) return null;
  return event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle-keep-anchor" : "row";
}

/** Server sorts the headers can set (VD10). */
export type HeaderSort = "case" | "-case" | "activity" | "-activity";

/** The route sort as the header state: Text = case ID, Last activity = newest first ("activity"). */
export function headerSortOf(sort: DocumentRowsRequest["sort"] | undefined): DataTableSort | undefined {
  switch (sort ?? "case") {
    case "case": return { column: "text", direction: "asc" };
    case "-case": return { column: "text", direction: "desc" };
    case "activity": return { column: "activity", direction: "desc" };
    case "-activity": return { column: "activity", direction: "asc" };
    default: return undefined;
  }
}

/** The sort after a click on a header: Text toggles case ↔ -case, Last activity newest ↔ oldest first. */
export function nextHeaderSort(column: string, sort: DocumentRowsRequest["sort"] | undefined): HeaderSort {
  const current = sort ?? "case";
  if (column === "activity") return current === "activity" ? "-activity" : "activity";
  return current === "case" ? "-case" : "case";
}

export interface DocumentsTableProps {
  page: DocumentRowsPage;
  /** Opens the text card; `opener` gets focus back on close. */
  onOpenPanel?: OpenTextCard;
  /** `"{case}:{language}"` of the row the card shows (the active row). */
  activeKey?: string | null;
  /** Inline notice under a row (plan confirmations, resolve options). */
  renderRowNotice?: (row: DocumentRowView) => ReactNode | null;
  /** Visit badge of a row, shown in its row header. */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  /** A lead action of the row (the next-step button or a "More" menu item). */
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Plan saves for the "Plan…" popover (VD2). */
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
  /** Row and case checkboxes (VD4); the page owns the selection. */
  selection?: TableSelection;
  /** Cases whose "n not in plan" toggle is open (the page owns it: ‹ › in the card walk the visible rows). */
  notInPlanOpen?: ReadonlySet<string>;
  onToggleNotInPlan?: (caseId: string) => void;
  /** "Add to plan…" of a text outside the plan (the Change plan dialog). */
  onAddToPlan?: (row: DocumentRowView) => void;
  /** Current server sort; with `onSort` the Text and Last activity headers sort (VD10). */
  sort?: DocumentRowsRequest["sort"];
  onSort?: (sort: HeaderSort) => void;
}

export function DocumentsTable({
  page, onOpenPanel, activeKey = null, renderRowNotice, rowBadge, onAction, onNavigate, busy, empty, selection, sort, onSort,
  notInPlanOpen, onToggleNotInPlan, onAddToPlan,
}: DocumentsTableProps): JSX.Element {
  // Folded (not in plan) rows are not rendered: they are not part of the range order, and the case checkbox skips them.
  const shownGroups = useMemo(() => page.groups.map(group => ({ group, rows: visibleRows(group, notInPlanOpen?.has(group.case_id) ?? false) })),
    [page.groups, notInPlanOpen]);
  const order = useMemo(() => shownGroups.flatMap(entry => entry.rows.map(rowKeyOf)), [shownGroups]);
  const shownRowsOf = useMemo(() => new Map(shownGroups.map(entry => [entry.group.case_id, entry.rows])), [shownGroups]);

  const openCard = (row: DocumentRowView, opener: HTMLElement) => onOpenPanel?.(row, { opener });
  // A plain click on the row's own area opens the card (never the selection); modifier clicks do nothing.
  const onRowClick = (row: DocumentRowView) => onOpenPanel ? (event: MouseEvent<HTMLTableRowElement>) => {
    if (rowAreaClick(event) !== "row") return;
    // The text name gets focus back when the card closes.
    openCard(row, document.getElementById(documentsRowId(row.case_id, row.language, "header")) ?? event.currentTarget);
  } : undefined;

  const columns: Column<DocumentRowView>[] = [
    {
      id: "text",
      header: "Text",
      rowHeader: true,
      sortable: true,
      cell: row => <RowHeaderCell row={row} badge={rowBadge?.(row)} onOpenCard={onOpenPanel ? opener => openCard(row, opener) : undefined} />,
    },
    { id: "review", header: "Translation", cell: row => <RowStageCell row={row} stage="review" /> },
    { id: "annotation", header: "Annotation", cell: row => <RowStageCell row={row} stage="annotation" /> },
    { id: "final", header: "Finalization", cell: row => <RowStageCell row={row} stage="final" /> },
    // `documents-col-wide`: hidden below 900 px (the text card shows it).
    { id: "waiting", header: <span className="documents-col-wide">Waiting on</span>, cell: row => <span className="documents-col-wide"><WaitingOnCell row={row} /></span> },
    {
      id: "action",
      header: "Next step",
      cell: row => <RowActionCell row={row} onAction={onAction} onNavigate={onNavigate} onAddToPlan={onAddToPlan} />,
    },
    {
      id: "activity",
      header: <span className="documents-col-wide">Last activity</span>,
      sortable: true,
      cell: row => <span className="documents-activity-cell documents-col-wide"><LastActivityCell iso={row.last_activity_at} /></span>,
    },
  ];

  // The case line is a heading only; the "n not in plan" toggle on its right folds the texts outside the plan.
  const groups: DataTableGroup<DocumentRowView>[] = shownGroups.map(({ group, rows }) => {
    const hidden = group.rows.filter(row => !isActiveRow(row)).length;
    const open = notInPlanOpen?.has(group.case_id) ?? false;
    return {
      key: group.case_id,
      expanded: true,
      rows,
      headerProps: { className: "documents-group" },
      header: (
        <span className="documents-group-line">
          <span id={documentsGroupId(group.case_id)} tabIndex={-1} className="documents-group-label"><ShortId value={group.case_id} /></span>
          {hidden > 0 && onToggleNotInPlan && <button type="button" id={documentsNotInPlanId(group.case_id)} className="documents-not-in-plan-toggle"
            aria-expanded={open} onClick={() => onToggleNotInPlan(group.case_id)}>
            {`${hidden} not in plan`}<IconChevronRight className="disclosure-chevron" />
          </button>}
        </span>
      ),
    };
  });

  // The case checkbox selects exactly the case's visible rows (filters respected, folded rows not).
  const caseRows = (caseId: string) => shownRowsOf.get(caseId) ?? [];
  const caseKeys = (caseId: string) => caseRows(caseId).map(rowKeyOf);

  const below = (row: DocumentRowView): ReactNode | null => {
    const notice = renderRowNotice?.(row) ?? null;
    return notice == null ? null : <div className="documents-row-notice-slot">{notice}</div>;
  };
  const rowClass = (row: DocumentRowView) => ["documents-row", !isActiveRow(row) && "documents-row--not-in-plan", rowKeyOf(row) === activeKey && "documents-row--active", onOpenPanel && "documents-row--clickable"]
    .filter(Boolean).join(" ");

  return (
    <DataTable
      label="Documents"
      className="documents-table"
      columns={columns}
      rows={[]}
      groups={groups}
      rowKey={rowKeyOf}
      rowProps={row => ({ className: rowClass(row), onClick: onRowClick(row), ...(rowKeyOf(row) === activeKey ? { "aria-current": true } : {}) })}
      rowEdge={row => (rowNeedsDecision(row) ? "decision" : null)}
      renderExpanded={below}
      busy={busy}
      empty={empty}
      groupLayout="label"
      rowSelection={selection ? {
        selected: row => selection.keys.has(rowKeyOf(row)),
        onSelect: (row, mode) => selection.select(rowKeyOf(row), mode, order),
        label: row => `Select ${rowName(row)}`,
      } : undefined}
      groupSelection={selection ? {
        selected: caseId => selection.caseState(caseKeys(caseId)) === "all",
        state: caseId => selection.caseState(caseKeys(caseId)),
        onSelect: (caseId, mode) => selection.selectCase(caseKeys(caseId), mode, order),
        checkboxLabel: caseId => `Select ${caseId} (${plural(caseRows(caseId).length, "text")})`,
      } : undefined}
      sort={onSort ? headerSortOf(sort) : undefined}
      onSort={onSort ? column => onSort(nextHeaderSort(column, sort)) : undefined}
    />
  );
}
