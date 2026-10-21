import { Fragment, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  width?: string;
  align?: "start" | "end";
  /** Render this column's cells as `<th scope="row">`. */
  rowHeader?: boolean;
  /** With server-driven `sort`/`onSort`: the header is a sort button even without `sortValue`. */
  sortable?: boolean;
}
export interface DataTableGroup<T> {
  key: string;
  /** Content of the group header row (one `<th scope="rowgroup">` spanning all columns). */
  header: ReactNode;
  rows: T[];
  /** Collapsed groups render only their header row. */
  expanded: boolean;
  headerProps?: HTMLAttributes<HTMLTableRowElement>;
}
/** How a group checkbox was used: plain click, Shift-click, Ctrl/Meta-click, or Shift+Arrow onto it. */
export type GroupSelectMode = "toggle" | "range" | "toggle-keep-anchor" | "select";
export interface GroupSelection {
  selected: (groupKey: string) => boolean;
  onSelect: (groupKey: string, mode: GroupSelectMode) => void;
  checkboxLabel: (groupKey: string) => string;
  /** How many of the group's rows are selected; `"some"` makes the checkbox indeterminate (announced "mixed"). */
  state?: (groupKey: string) => "all" | "some" | "none";
}
/** A selection checkbox in a first column of every row. The caller owns the selection state. */
export interface RowSelection<T> {
  selected: (row: T) => boolean;
  onSelect: (row: T, mode: GroupSelectMode) => void;
  label: (row: T) => string;
}
export interface DataTableSort { column: string; direction: "asc" | "desc" }
export interface DataTableProps<T> {
  label: string;
  columns: Column<T>[];
  /** Ignored when `groups` is given. */
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { column: string; direction: "asc" | "desc" };
  empty?: ReactNode;
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement> & { selected?: boolean };
  className?: string;
  /** One `<tbody>` per group; sorting applies within each group. */
  groups?: DataTableGroup<T>[];
  /** Non-null content is rendered in a following full-width row. */
  renderExpanded?: (row: T) => ReactNode | null;
  busy?: boolean;
  /** With `groups`: a selection checkbox at the start of each group header. The caller owns the selection state. */
  groupSelection?: GroupSelection;
  /** A checkbox column (first `td` of every row); the group checkbox then moves into that column. */
  rowSelection?: RowSelection<T>;
  /**
   * `"header"`: the group checkbox sits inside the spanning rowgroup `th` (the original layout).
   * `"label"`: a separate first checkbox column; the group row is a checkbox `td` plus a left-aligned rowgroup `th`.
   * Default: `"label"` with `rowSelection`, else `"header"`.
   */
  groupLayout?: "header" | "label";
  /** Header of the checkbox column; default a visually hidden "Select". */
  selectionHeader?: ReactNode;
  /** `"decision"` adds the class `data-table-row--decision` (the lead must act on this row). */
  rowEdge?: (row: T) => "decision" | null;
  /** Server-driven sort shown in `aria-sort` and the header icons; rows keep the given order. Takes effect with `onSort`. */
  sort?: DataTableSort;
  /** Called with the column id when a sortable header is activated; turns off client-side sorting. */
  onSort?: (column: string) => void;
}
const groupSelectionModeOf = (event: MouseEvent<HTMLInputElement>): GroupSelectMode =>
  event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle-keep-anchor" : "toggle";
/** Shift+ArrowDown/Up: focuses the next/previous checkbox matching `selector` in DOM order (no wrap) and returns it. */
function moveSelection(event: KeyboardEvent<HTMLInputElement>, selector: string): HTMLInputElement | null {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return null;
  event.preventDefault();
  const boxes = [...(event.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>(selector) ?? [])];
  const target = boxes[boxes.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)];
  if (!target) return null;
  target.focus();
  return target;
}
function moveGroupSelection(event: KeyboardEvent<HTMLInputElement>, onSelect: GroupSelection["onSelect"]): void {
  const target = moveSelection(event, "input.data-table-group-select");
  if (target) onSelect(target.dataset.groupKey!, "select");
}
const indeterminateRef = (value: boolean) => (element: HTMLInputElement | null) => { if (element) element.indeterminate = value; };
export function DataTable<T>({ label, columns, rows, rowKey, initialSort, empty, rowProps, className, groups, renderExpanded, busy, groupSelection,
  rowSelection, groupLayout, selectionHeader, rowEdge, sort: serverSort, onSort }: DataTableProps<T>): JSX.Element {
  const [clientSort, setSort] = useState(initialSort);
  const sort = onSort ? serverSort : clientSort;
  const labelLayout = (groupLayout ?? (rowSelection ? "label" : "header")) === "label";
  const selectColumn = Boolean(rowSelection) || (labelLayout && Boolean(groups));
  const span = columns.length + (selectColumn ? 1 : 0);
  const rowsByKey = new Map<string, T>();
  const sortedColumn = onSort ? undefined : columns.find((column) => column.id === sort?.column && column.sortValue);
  const sortRows = (list: T[]): T[] => sortedColumn && sort ? list.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = sortedColumn.sortValue!(a.row); const right = sortedColumn.sortValue!(b.row);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return (sort.direction === "asc" ? comparison : -comparison) || a.index - b.index;
  }).map(({ row }) => row) : list;
  const selectRowByKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    const target = moveSelection(event, "input.data-table-row-select");
    if (target && rowSelection && rowsByKey.has(target.dataset.rowKey!)) rowSelection.onSelect(rowsByKey.get(target.dataset.rowKey!) as T, "select");
  };
  const renderRow = (row: T) => {
    const key = rowKey(row);
    const { selected, className: rowClassName, ...props } = rowProps?.(row) ?? {};
    const expanded = renderExpanded?.(row) ?? null;
    rowsByKey.set(key, row);
    return <Fragment key={key}>
      <tr {...props} aria-selected={selected ?? props["aria-selected"]} className={[rowClassName, selected && "is-selected", rowEdge?.(row) === "decision" && "data-table-row--decision"].filter(Boolean).join(" ")}>
        {selectColumn && <td className="data-table-select-cell">{rowSelection && <input type="checkbox" className="data-table-row-select checkbox-target" data-row-key={key}
          aria-label={rowSelection.label(row)} checked={rowSelection.selected(row)}
          onChange={() => undefined} onClick={(event) => rowSelection.onSelect(row, groupSelectionModeOf(event))} onKeyDown={selectRowByKeyboard} />}</td>}
        {columns.map((column) => column.rowHeader
          ? <th key={column.id} scope="row" style={{ textAlign: column.align ?? "start" }}>{column.cell(row)}</th>
          : <td key={column.id} style={{ textAlign: column.align ?? "start" }}>{column.cell(row)}</td>)}
      </tr>
      {expanded !== null && <tr className="data-table-expanded"><td colSpan={span}>{expanded}</td></tr>}
    </Fragment>;
  };
  const emptyBody = <tbody><tr><td colSpan={span}>{empty ?? "No items to display."}</td></tr></tbody>;
  let body: ReactNode;
  if (groups) {
    body = groups.length ? groups.map((group) => {
      const { className: headerClassName, ...headerProps } = group.headerProps ?? {};
      const groupBox = groupSelection && <input type="checkbox" className="data-table-group-select checkbox-target" data-group-key={group.key}
        ref={groupSelection.state ? indeterminateRef(groupSelection.state(group.key) === "some") : undefined}
        aria-label={groupSelection.checkboxLabel(group.key)} checked={groupSelection.selected(group.key)}
        onChange={() => undefined} onClick={(event) => groupSelection.onSelect(group.key, groupSelectionModeOf(event))}
        onKeyDown={(event) => moveGroupSelection(event, groupSelection.onSelect)} />;
      return <tbody key={group.key}>
        {labelLayout
          ? <tr {...headerProps} className={["data-table-group", "data-table-group--label", headerClassName].filter(Boolean).join(" ")}>
            <td className="data-table-select-cell">{groupBox}</td>
            <th scope="rowgroup" colSpan={columns.length} style={{ textAlign: "start" }}>{group.header}</th>
          </tr>
          : <tr {...headerProps} className={["data-table-group", headerClassName].filter(Boolean).join(" ")}><th scope="rowgroup" colSpan={columns.length}>
            {groupBox}
            {group.header}
          </th></tr>}
        {group.expanded && sortRows(group.rows).map(renderRow)}
      </tbody>;
    }) : emptyBody;
  } else {
    const sortedRows = sortRows(rows);
    body = sortedRows.length ? <tbody>{sortedRows.map(renderRow)}</tbody> : emptyBody;
  }
  const sortable = (column: Column<T>) => Boolean(column.sortValue || (onSort && column.sortable));
  const sortBy = (column: Column<T>) => onSort
    ? onSort(column.id)
    : setSort({ column: column.id, direction: sort?.column === column.id && sort.direction === "asc" ? "desc" : "asc" });
  return <div className="data-table-scroll"><table aria-label={label} aria-busy={busy ? true : undefined} className={["data-table", "density-compact", className].filter(Boolean).join(" ")}>
    <thead><tr>{selectColumn && <th scope="col" className="data-table-select-cell">{selectionHeader ?? <span className="visually-hidden">Select</span>}</th>}
      {columns.map((column) => <th key={column.id} scope="col" style={{ width: column.width, textAlign: column.align ?? "start" }} aria-sort={sortable(column) ? sort?.column === column.id ? sort.direction === "asc" ? "ascending" : "descending" : "none" : undefined}>
      {sortable(column) ? <button className="data-table-sort" type="button" onClick={() => sortBy(column)}>{column.header}<svg className="data-table-sort-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={sort?.column === column.id && sort.direction === "desc" ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button> : column.header}
    </th>)}</tr></thead>
    {body}
  </table></div>;
}
