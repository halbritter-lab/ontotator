/**
 * Documents table (spec 2026-10-23 §2b, M1 variant D "flat list"): one line per text, no case headings:
 * [checkbox] Text (case ID, language, "+n" for texts of the case not shown), Translation, Annotation,
 * Finalization, Waiting on, Next step, Last activity. Texts outside the plan are rows only with the page's
 * "Show texts not in plan" switch: muted, with "Add to plan…". The row open in the card is current; the other
 * shown texts of its case are tinted wherever the sort puts them. Decision rows get the left edge. A row click
 * (or the text name) opens the text card and never changes the selection; only the checkboxes select.
 */
import { useMemo, type MouseEvent, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, DocumentRowsRequest, NextStepView } from "../api/client";
import type { Route } from "../app/router";
import { plural } from "../app/labels";
import { DataTable, type Column, type DataTableSort, type GroupSelectMode } from "../ui/DataTable";
import { RowActionCell, rowActionText } from "./RowActions";
import {
  documentsRowId,
  LastActivityCell,
  type OpenTextCard,
  RowHeaderCell,
  RowStageCell,
  rowKeyOf,
  rowName,
  rowNeedsDecision,
  stageCellText,
  WaitingOnCell,
} from "./RowCells";
import { isActiveRow, waitingOnText } from "./stageLabels";

/** The case of a `"{case}:{language}"` key (case IDs may hold colons; languages do not). */
const caseOfKey = (key: string): string => key.slice(0, key.lastIndexOf(":"));

/** Narrow cards' case heading: "case-0101, en source + 2 translations"; without the source row in view "case-0101, 3 languages". */
export function caseHeaderText(group: Pick<DocumentGroupView, "case_id" | "rows" | "language_count">): string {
  const source = group.rows.find(row => row.is_source);
  if (!source) return `${group.case_id}, ${plural(group.language_count, "language")}`;
  const translations = group.language_count - 1;
  return `${group.case_id}, ${source.language} source${translations > 0 ? ` + ${plural(translations, "translation")}` : ""}`;
}

/** Sort of a status column, done on the loaded page (the server pages and sorts by case). */
export type ColumnSort = DataTableSort;

/** Columns the table sorts itself, by the text the cell shows; ties keep the server order (case ID). */
const COLUMN_SORT_TEXT: Readonly<Record<string, (row: DocumentRowView) => string>> = {
  review: row => stageCellText(row, "review"),
  annotation: row => stageCellText(row, "annotation"),
  final: row => stageCellText(row, "final"),
  waiting: row => waitingOnText(row).text,
  action: rowActionText,
};
export const isColumnSort = (column: string): boolean => column in COLUMN_SORT_TEXT;

/**
 * The flat rows of the table in display order: the page's texts in plan (with `showNotInPlan` also the others),
 * sorted by `sort` when a status column is sorted. ‹ › in the text card walk the same list.
 */
export function tableRows(page: Pick<DocumentRowsPage, "groups">, showNotInPlan: boolean, sort: ColumnSort | null = null): DocumentRowView[] {
  const rows = page.groups.flatMap(group => showNotInPlan ? group.rows : group.rows.filter(isActiveRow));
  const text = sort ? COLUMN_SORT_TEXT[sort.column] : undefined;
  if (!sort || !text) return rows;
  const sign = sort.direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index, key: text(row) }))
    .sort((a, b) => sign * a.key.localeCompare(b.key, undefined, { sensitivity: "base" }) || a.index - b.index)
    .map(entry => entry.row);
}

/** Texts of a case the table does not show: not in plan while the switch is off (also those the tab leaves out). */
export function hiddenNotInPlan(group: Pick<DocumentGroupView, "rows" | "not_in_plan_languages">): number {
  const shown = new Set(group.rows.filter(isActiveRow).map(row => row.language));
  const hidden = new Set([...(group.not_in_plan_languages ?? []), ...group.rows.filter(row => !isActiveRow(row)).map(row => row.language)]);
  return [...hidden].filter(language => !shown.has(language)).length;
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
  /** False while the project has no translation (U-4): no Translation column. */
  translations?: boolean;
  /** The rows in display order; default `tableRows(page, showNotInPlan, columnSort)` (the page passes the list ‹ › walk). */
  rows?: readonly DocumentRowView[];
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
  /** Row checkboxes (VD4); the page owns the selection. */
  selection?: TableSelection;
  /** True while texts not in plan are rows of their own (no "+n" marker then). */
  showNotInPlan?: boolean;
  /** "Add to plan…" of a text outside the plan (the Change plan dialog). */
  onAddToPlan?: (row: DocumentRowView) => void;
  /** Current server sort; with `onSort` the Text and Last activity headers sort (VD10). */
  sort?: DocumentRowsRequest["sort"];
  onSort?: (sort: HeaderSort) => void;
  /** Status-column sort of the loaded page; it wins over `sort` in the headers while set. */
  columnSort?: ColumnSort | null;
  onColumnSort?: (sort: ColumnSort) => void;
}

export function DocumentsTable({
  page, rows: givenRows, onOpenPanel, activeKey = null, renderRowNotice, rowBadge, onAction, onNavigate, busy, empty, selection, sort, onSort,
  showNotInPlan = false, onAddToPlan, columnSort = null, onColumnSort, translations = true,
}: DocumentsTableProps): JSX.Element {
  const rows = useMemo(() => givenRows ?? tableRows(page, showNotInPlan, columnSort), [givenRows, page, showNotInPlan, columnSort]);
  const order = useMemo(() => rows.map(rowKeyOf), [rows]);
  const hidden = useMemo(() => new Map(page.groups.map(group => [group.case_id, showNotInPlan ? 0 : hiddenNotInPlan(group)])), [page.groups, showNotInPlan]);
  const activeCase = activeKey ? caseOfKey(activeKey) : null;
  const isSibling = (row: DocumentRowView) => row.case_id === activeCase && rowKeyOf(row) !== activeKey;

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
      cell: row => <RowHeaderCell row={row} badge={rowBadge?.(row)} onOpenCard={onOpenPanel ? opener => openCard(row, opener) : undefined}
        showCaseId more={hidden.get(row.case_id) ?? 0} sibling={isSibling(row)} />,
    },
    ...(translations ? [{ id: "review", header: "Translation", sortable: true, cell: (row: DocumentRowView) => <RowStageCell row={row} stage="review" /> }] : []),
    { id: "annotation", header: "Annotation", sortable: true, cell: row => <RowStageCell row={row} stage="annotation" /> },
    { id: "final", header: "Finalization", sortable: true, cell: row => <RowStageCell row={row} stage="final" /> },
    // `documents-col-wide`: hidden below 900 px (the text card shows it).
    { id: "waiting", header: <span className="documents-col-wide">Waiting on</span>, sortable: true, cell: row => <span className="documents-col-wide"><WaitingOnCell row={row} /></span> },
    {
      id: "action",
      header: "Next step",
      sortable: true,
      cell: row => <RowActionCell row={row} onAction={onAction} onNavigate={onNavigate} onAddToPlan={onAddToPlan} />,
    },
    {
      id: "activity",
      header: <span className="documents-col-wide">Last activity</span>,
      sortable: true,
      cell: row => <span className="documents-activity-cell documents-col-wide"><LastActivityCell iso={row.last_activity_at} /></span>,
    },
  ];

  const below = (row: DocumentRowView): ReactNode | null => {
    const notice = renderRowNotice?.(row) ?? null;
    return notice == null ? null : <div className="documents-row-notice-slot">{notice}</div>;
  };
  const rowClass = (row: DocumentRowView) => ["documents-row", !isActiveRow(row) && "documents-row--not-in-plan", rowKeyOf(row) === activeKey && "documents-row--active",
    isSibling(row) && "documents-row--sibling", onOpenPanel && "documents-row--clickable"].filter(Boolean).join(" ");
  const headerSort = (column: string) => {
    if (isColumnSort(column)) onColumnSort?.({ column, direction: columnSort?.column === column && columnSort.direction === "asc" ? "desc" : "asc" });
    // Text and Last activity sort on the server; coming from a status-column sort they start ascending / newest first.
    else onSort?.(columnSort ? (column === "activity" ? "activity" : "case") : nextHeaderSort(column, sort));
  };

  return (
    <DataTable
      label="Documents"
      className="documents-table"
      columns={columns}
      rows={[...rows]}
      rowKey={rowKeyOf}
      rowProps={row => ({ className: rowClass(row), onClick: onRowClick(row), ...(rowKeyOf(row) === activeKey ? { "aria-current": true } : {}) })}
      rowEdge={row => (rowNeedsDecision(row) ? "decision" : null)}
      renderExpanded={below}
      busy={busy}
      empty={empty}
      rowSelection={selection ? {
        selected: row => selection.keys.has(rowKeyOf(row)),
        onSelect: (row, mode) => selection.select(rowKeyOf(row), mode, order),
        label: row => `Select ${rowName(row)}`,
      } : undefined}
      sort={onSort ? columnSort ?? headerSortOf(sort) : undefined}
      onSort={onSort ? headerSort : undefined}
    />
  );
}
