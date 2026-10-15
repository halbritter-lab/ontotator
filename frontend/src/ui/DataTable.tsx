import { useState, type HTMLAttributes, type ReactNode } from "react";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  width?: string;
  align?: "start" | "end";
}
export interface DataTableProps<T> {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { column: string; direction: "asc" | "desc" };
  empty?: ReactNode;
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement> & { selected?: boolean };
  className?: string;
}
export function DataTable<T>({ label, columns, rows, rowKey, initialSort, empty, rowProps, className }: DataTableProps<T>): JSX.Element {
  const [sort, setSort] = useState(initialSort);
  const sortedColumn = columns.find((column) => column.id === sort?.column && column.sortValue);
  const sortedRows = sortedColumn && sort ? rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = sortedColumn.sortValue!(a.row); const right = sortedColumn.sortValue!(b.row);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return (sort.direction === "asc" ? comparison : -comparison) || a.index - b.index;
  }).map(({ row }) => row) : rows;
  return <div className="data-table-scroll"><table aria-label={label} className={["data-table", "density-compact", className].filter(Boolean).join(" ")}>
    <thead><tr>{columns.map((column) => <th key={column.id} scope="col" style={{ width: column.width, textAlign: column.align ?? "start" }} aria-sort={column.sortValue ? sort?.column === column.id ? sort.direction === "asc" ? "ascending" : "descending" : "none" : undefined}>
      {column.sortValue ? <button className="data-table-sort" type="button" onClick={() => setSort({ column: column.id, direction: sort?.column === column.id && sort.direction === "asc" ? "desc" : "asc" })}>{column.header}<svg className="data-table-sort-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={sort?.column === column.id && sort.direction === "desc" ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button> : column.header}
    </th>)}</tr></thead>
    <tbody>{sortedRows.length ? sortedRows.map((row) => {
      const { selected, className: rowClassName, ...props } = rowProps?.(row) ?? {};
      return <tr {...props} key={rowKey(row)} aria-selected={selected ?? props["aria-selected"]} className={[rowClassName, selected && "is-selected"].filter(Boolean).join(" ")}>
        {columns.map((column) => <td key={column.id} style={{ textAlign: column.align ?? "start" }}>{column.cell(row)}</td>)}
      </tr>;
    }) : <tr><td colSpan={columns.length}>{empty ?? "No items to display."}</td></tr>}</tbody>
  </table></div>;
}
