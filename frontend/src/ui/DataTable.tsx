import { Fragment, useState, type HTMLAttributes, type ReactNode } from "react";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  width?: string;
  align?: "start" | "end";
  /** Render this column's cells as `<th scope="row">`. */
  rowHeader?: boolean;
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
}
export function DataTable<T>({ label, columns, rows, rowKey, initialSort, empty, rowProps, className, groups, renderExpanded, busy }: DataTableProps<T>): JSX.Element {
  const [sort, setSort] = useState(initialSort);
  const sortedColumn = columns.find((column) => column.id === sort?.column && column.sortValue);
  const sortRows = (list: T[]): T[] => sortedColumn && sort ? list.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = sortedColumn.sortValue!(a.row); const right = sortedColumn.sortValue!(b.row);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return (sort.direction === "asc" ? comparison : -comparison) || a.index - b.index;
  }).map(({ row }) => row) : list;
  const renderRow = (row: T) => {
    const key = rowKey(row);
    const { selected, className: rowClassName, ...props } = rowProps?.(row) ?? {};
    const expanded = renderExpanded?.(row) ?? null;
    return <Fragment key={key}>
      <tr {...props} aria-selected={selected ?? props["aria-selected"]} className={[rowClassName, selected && "is-selected"].filter(Boolean).join(" ")}>
        {columns.map((column) => column.rowHeader
          ? <th key={column.id} scope="row" style={{ textAlign: column.align ?? "start" }}>{column.cell(row)}</th>
          : <td key={column.id} style={{ textAlign: column.align ?? "start" }}>{column.cell(row)}</td>)}
      </tr>
      {expanded !== null && <tr className="data-table-expanded"><td colSpan={columns.length}>{expanded}</td></tr>}
    </Fragment>;
  };
  const emptyBody = <tbody><tr><td colSpan={columns.length}>{empty ?? "No items to display."}</td></tr></tbody>;
  let body: ReactNode;
  if (groups) {
    body = groups.length ? groups.map((group) => {
      const { className: headerClassName, ...headerProps } = group.headerProps ?? {};
      return <tbody key={group.key}>
        <tr {...headerProps} className={["data-table-group", headerClassName].filter(Boolean).join(" ")}><th scope="rowgroup" colSpan={columns.length}>{group.header}</th></tr>
        {group.expanded && sortRows(group.rows).map(renderRow)}
      </tbody>;
    }) : emptyBody;
  } else {
    const sortedRows = sortRows(rows);
    body = sortedRows.length ? <tbody>{sortedRows.map(renderRow)}</tbody> : emptyBody;
  }
  return <div className="data-table-scroll"><table aria-label={label} aria-busy={busy ? true : undefined} className={["data-table", "density-compact", className].filter(Boolean).join(" ")}>
    <thead><tr>{columns.map((column) => <th key={column.id} scope="col" style={{ width: column.width, textAlign: column.align ?? "start" }} aria-sort={column.sortValue ? sort?.column === column.id ? sort.direction === "asc" ? "ascending" : "descending" : "none" : undefined}>
      {column.sortValue ? <button className="data-table-sort" type="button" onClick={() => setSort({ column: column.id, direction: sort?.column === column.id && sort.direction === "asc" ? "desc" : "asc" })}>{column.header}<svg className="data-table-sort-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={sort?.column === column.id && sort.direction === "desc" ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button> : column.header}
    </th>)}</tr></thead>
    {body}
  </table></div>;
}
