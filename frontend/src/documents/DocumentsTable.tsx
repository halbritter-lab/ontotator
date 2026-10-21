/**
 * Documents table, variant A (documents overview "Table", V1, VD1, VD4, VD5): one `<tbody>` per
 * case with a slim group label row (case checkbox, case name, "· en source + 1 translation"),
 * then one flat row per text with eight columns: [checkbox] · Text · Review · Annotation · Final ·
 * Waiting on · Action · Last activity. Rows outside the plan are muted rows; nothing collapses.
 * Decision rows get the left edge. The text name and the stage cells open the row panel (acceptance
 * fixes WP-A); the row the panel shows is the active row. Selection and the panel are owned by the page.
 */
import { useMemo, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, DocumentRowsRequest, NextStepView } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { plural } from "../app/labels";
import { DataTable, type Column, type DataTableGroup, type DataTableSort, type GroupSelectMode } from "../ui/DataTable";
import type { MenuItem } from "../ui/MenuButton";
import type { PlanSaves } from "./PlanChips";
import { RowActionCell } from "./RowActions";
import {
  documentsGroupId,
  LastActivityCell,
  type OpenRowPanel,
  RowHeaderCell,
  RowStageCell,
  rowKeyOf,
  rowName,
  rowNeedsDecision,
  ShortId,
  WaitingOnCell,
} from "./RowCells";
import { isActiveRow } from "./stageLabels";

/** "case-0101 · en source + 2 translations"; without the source row in view "case-0101 · 3 languages". */
export function caseHeaderText(group: Pick<DocumentGroupView, "case_id" | "rows" | "language_count">): string {
  const source = group.rows.find(row => row.is_source);
  if (!source) return `${group.case_id} · ${plural(group.language_count, "language")}`;
  const translations = group.language_count - 1;
  return `${group.case_id} · ${source.language} source${translations > 0 ? ` + ${plural(translations, "translation")}` : ""}`;
}

/** The page's text selection as the table needs it (`"{case}:{language}"` keys, list order passed back). */
export interface TableSelection {
  keys: ReadonlySet<string>;
  caseState: (caseKeys: readonly string[]) => "all" | "some" | "none";
  select: (key: string, mode: GroupSelectMode, order: readonly string[]) => void;
  selectCase: (caseKeys: readonly string[], mode: GroupSelectMode, order: readonly string[]) => void;
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
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** Opens the row panel (text name: unfiltered; stage cell: filtered to the stage). */
  onOpenPanel?: OpenRowPanel;
  /** `"{case}:{language}"` of the row the panel shows (the active row). */
  activeKey?: string | null;
  /** Inline notice under a row (plan confirmations, resolve options). */
  renderRowNotice?: (row: DocumentRowView) => ReactNode | null;
  /** Visit badge of a row, shown in its row header. */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  /** A lead action of the row (first step's button or a "+n" menu item). */
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Plan saves for the "Plan…" popover (VD2). */
  planSaves?: PlanSaves;
  /** Lead actions of a row that are no step (its "+n" menu). */
  rowExtras?: (row: DocumentRowView) => readonly MenuItem[];
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
  page, projectKey, query, onOpenPanel, activeKey = null, renderRowNotice, rowBadge, onAction, planSaves, onNavigate, busy, empty, selection, sort, onSort, rowExtras,
}: DocumentsTableProps): JSX.Element {
  const order = useMemo(() => page.groups.flatMap(group => group.rows.map(rowKeyOf)), [page.groups]);
  const groupOf = useMemo(() => new Map(page.groups.map(group => [group.case_id, group])), [page.groups]);

  const sourceOf = (row: DocumentRowView) => groupOf.get(row.case_id)?.rows.find(entry => entry.is_source)?.language ?? null;

  const columns: Column<DocumentRowView>[] = [
    {
      id: "text",
      header: "Text",
      rowHeader: true,
      sortable: true,
      cell: row => <RowHeaderCell row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} badge={rowBadge?.(row)} onOpenPanel={onOpenPanel} />,
    },
    { id: "review", header: "Review", cell: row => <RowStageCell row={row} stage="review" sourceLanguage={sourceOf(row)} onOpenPanel={onOpenPanel} /> },
    { id: "annotation", header: "Annotation", cell: row => <RowStageCell row={row} stage="annotation" onOpenPanel={onOpenPanel} /> },
    { id: "final", header: "Final", cell: row => <RowStageCell row={row} stage="final" onOpenPanel={onOpenPanel} /> },
    { id: "waiting", header: "Waiting on", cell: row => <WaitingOnCell row={row} /> },
    {
      id: "action",
      header: <span className="visually-hidden">Action</span>,
      cell: row => <RowActionCell row={row} onAction={onAction} extraActions={rowExtras?.(row)}
        plan={planSaves ? { saves: planSaves, groupRevision: groupOf.get(row.case_id)?.plan_revision ?? 1 } : undefined} />,
    },
    {
      id: "activity",
      header: "Last activity",
      sortable: true,
      cell: row => <span className="documents-activity-cell"><LastActivityCell iso={row.last_activity_at} /></span>,
    },
  ];

  const groups: DataTableGroup<DocumentRowView>[] = page.groups.map(group => {
    const title = caseHeaderText(group);
    return {
      key: group.case_id,
      expanded: true,
      rows: group.rows,
      headerProps: { className: "documents-group" },
      header: (
        <span id={documentsGroupId(group.case_id)} tabIndex={-1} className="documents-group-label">
          <ShortId value={group.case_id} />
          <span className="documents-group-meta">{title.slice(group.case_id.length)}</span>
        </span>
      ),
    };
  });

  // The case checkbox selects the case's rows in the current view (filters respected), not every text of the case.
  const caseKeys = (caseId: string) => (groupOf.get(caseId)?.rows ?? []).map(rowKeyOf);

  const below = (row: DocumentRowView): ReactNode | null => {
    const notice = renderRowNotice?.(row) ?? null;
    return notice == null ? null : <div className="documents-row-notice-slot">{notice}</div>;
  };
  const rowClass = (row: DocumentRowView) => ["documents-row", !isActiveRow(row) && "documents-row--not-in-plan", rowKeyOf(row) === activeKey && "documents-row--active"]
    .filter(Boolean).join(" ");

  return (
    <DataTable
      label="Documents"
      className="documents-table"
      columns={columns}
      rows={[]}
      groups={groups}
      rowKey={rowKeyOf}
      rowProps={row => ({ className: rowClass(row), ...(rowKeyOf(row) === activeKey ? { "aria-current": true } : {}) })}
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
        checkboxLabel: caseId => `Select ${caseId} (${plural(groupOf.get(caseId)?.rows.length ?? 0, "text")})`,
      } : undefined}
      sort={onSort ? headerSortOf(sort) : undefined}
      onSort={onSort ? column => onSort(nextHeaderSort(column, sort)) : undefined}
    />
  );
}
