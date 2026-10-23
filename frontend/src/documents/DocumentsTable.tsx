/**
 * Documents table (spec 2026-10-23 §2b, documents overview VD1, VD4, VD5): one `<tbody>` per case with a
 * slim case line (case checkbox, case ID and, when the source is not planned, "source en (native),
 * 1 translation" instead of the source's own row), then one line per text: [checkbox] Text, Translation,
 * Annotation, Finalization, Waiting on, Next step, Last activity. Rows outside the plan are muted;
 * decision rows get the left edge. A row click selects the text and opens its card, a second click
 * deselects (`rowClick`); the text name opens the card. Selection and the card are owned by the page.
 */
import { useMemo, type MouseEvent, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, DocumentRowsRequest, NextStepView } from "../api/client";
import type { Route } from "../app/router";
import { plural } from "../app/labels";
import { DataTable, type Column, type DataTableGroup, type DataTableSort, type GroupSelectMode } from "../ui/DataTable";
import { RowActionCell } from "./RowActions";
import {
  documentsGroupId,
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

/** The source row the case line stands for: not planned, and the case shows other rows (spec §2b). */
export function foldedSource(group: Pick<DocumentGroupView, "rows">): DocumentRowView | null {
  const source = group.rows.find(row => row.is_source);
  return source && !isActiveRow(source) && group.rows.length > 1 ? source : null;
}

/** Grey part of the case line: "source en (native), 1 translation" when the source row is folded into it. */
export function caseLineMeta(group: Pick<DocumentGroupView, "rows" | "language_count">): string | null {
  const source = foldedSource(group);
  return source ? `source ${source.language} (native), ${plural(group.language_count - 1, "translation")}` : null;
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

/** Spec §2: unselected row → select and open the card; selected row → deselect, no card;
 *  the text name → open the card, selection unchanged. Checkbox, Shift and Ctrl keep their behaviour. */
export function rowClick(
  row: DocumentRowView,
  target: "row" | "name",
  selection: TableSelection | undefined,
  order: readonly string[],
  open: (row: DocumentRowView) => void,
): void {
  const key = rowKeyOf(row);
  if (target === "name" || !selection) { open(row); return; }
  if (selection.keys.has(key)) { selection.select(key, "toggle", order); return; }
  selection.select(key, "select", order);
  open(row);
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
  /** Current server sort; with `onSort` the Text and Last activity headers sort (VD10). */
  sort?: DocumentRowsRequest["sort"];
  onSort?: (sort: HeaderSort) => void;
}

export function DocumentsTable({
  page, onOpenPanel, activeKey = null, renderRowNotice, rowBadge, onAction, onNavigate, busy, empty, selection, sort, onSort,
}: DocumentsTableProps): JSX.Element {
  // Folded source rows are not rendered: they are not part of the range order; the case checkbox and the case line's
  // "source en (native)" button cover them.
  const shownGroups = useMemo(() => page.groups.map(group => {
    const folded = foldedSource(group);
    return { group, rows: folded ? group.rows.filter(row => row !== folded) : group.rows };
  }), [page.groups]);
  const order = useMemo(() => shownGroups.flatMap(entry => entry.rows.map(rowKeyOf)), [shownGroups]);
  const groupOf = useMemo(() => new Map(page.groups.map(group => [group.case_id, group])), [page.groups]);
  const shownRowsOf = useMemo(() => new Map(shownGroups.map(entry => [entry.group.case_id, entry.rows])), [shownGroups]);

  const openCard = (row: DocumentRowView, opener: HTMLElement) => onOpenPanel?.(row, { opener });
  const onRowClick = (row: DocumentRowView) => onOpenPanel ? (event: MouseEvent<HTMLTableRowElement>) => {
    const kind = rowAreaClick(event);
    if (kind === null) return;
    if (kind !== "row") { selection?.select(rowKeyOf(row), kind, order); return; }
    // The text name gets focus back when the card closes.
    const opener = document.getElementById(documentsRowId(row.case_id, row.language, "header")) ?? event.currentTarget;
    rowClick(row, "row", selection, order, entry => openCard(entry, opener));
  } : undefined;

  const columns: Column<DocumentRowView>[] = [
    {
      id: "text",
      header: "Text",
      rowHeader: true,
      sortable: true,
      cell: row => <RowHeaderCell row={row} badge={rowBadge?.(row)}
        onOpenCard={onOpenPanel ? opener => rowClick(row, "name", selection, order, entry => openCard(entry, opener)) : undefined} />,
    },
    { id: "review", header: "Translation", cell: row => <RowStageCell row={row} stage="review" /> },
    { id: "annotation", header: "Annotation", cell: row => <RowStageCell row={row} stage="annotation" /> },
    { id: "final", header: "Finalization", cell: row => <RowStageCell row={row} stage="final" /> },
    // `documents-col-wide`: hidden below 900 px (the text card shows it).
    { id: "waiting", header: <span className="documents-col-wide">Waiting on</span>, cell: row => <span className="documents-col-wide"><WaitingOnCell row={row} /></span> },
    {
      id: "action",
      header: "Next step",
      cell: row => <RowActionCell row={row} onAction={onAction} onNavigate={onNavigate} />,
    },
    {
      id: "activity",
      header: <span className="documents-col-wide">Last activity</span>,
      sortable: true,
      cell: row => <span className="documents-activity-cell documents-col-wide"><LastActivityCell iso={row.last_activity_at} /></span>,
    },
  ];

  const groups: DataTableGroup<DocumentRowView>[] = shownGroups.map(({ group, rows }) => {
    const meta = caseLineMeta(group);
    const folded = foldedSource(group);
    return {
      key: group.case_id,
      expanded: true,
      rows,
      headerProps: { className: "documents-group" },
      header: (
        <span id={documentsGroupId(group.case_id)} tabIndex={-1} className="documents-group-label">
          <ShortId value={group.case_id} />
          {meta && (folded && onOpenPanel
            ? <button type="button" className="documents-group-meta" onClick={event => openCard(folded, event.currentTarget)}>{meta}</button>
            : <span className="documents-group-meta">{meta}</span>)}
        </span>
      ),
    };
  });

  // The case checkbox selects the case's texts in the current view (filters respected), the folded source included
  // (Select all filtered and Select by IDs add it too, so unchecking the case must clear it). Shown rows first: the
  // range and the anchor use the shown order.
  const caseRows = (caseId: string) => {
    const shown = shownRowsOf.get(caseId) ?? [];
    return [...shown, ...(groupOf.get(caseId)?.rows ?? []).filter(row => !shown.includes(row))];
  };
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
