import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DataTable, type Column } from "../../src/ui/DataTable";
type Row = { id: string; name: string; count: number };
const rows: Row[] = [{ id: "a", name: "Alpha", count: 2 }, { id: "b", name: "Beta", count: 1 }, { id: "c", name: "Gamma", count: 2 }];
const columns: Column<Row>[] = [{ id: "name", header: "Name", cell: (row) => row.name }, { id: "count", header: "Count", cell: (row) => row.count, sortValue: (row) => row.count, align: "end", width: "6rem" }];
afterEach(cleanup);
const names = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
it("renders_headers_with_col_scope_and_the_label", () => {
  render(<DataTable label="Cases" columns={columns} rows={rows} rowKey={(row) => row.id} />);
  expect(screen.getByRole("table", { name: "Cases" })).not.toBeNull();
  expect(screen.getAllByRole("columnheader").every((th) => th.getAttribute("scope") === "col")).toBe(true);
});
it("sorts_by_a_sortable_column_stably_and_sets_aria_sort", () => {
  render(<DataTable label="Cases" columns={columns} rows={rows} rowKey={(row) => row.id} />);
  const button = screen.getByRole("button", { name: "Count" });
  fireEvent.click(button); expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
  expect(button.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
  fireEvent.click(button); expect(names()).toEqual(["Alpha", "Gamma", "Beta"]);
  expect(button.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  expect(rows.map((row) => row.name)).toEqual(["Alpha", "Beta", "Gamma"]);
});
it("applies_initial_sort", () => {
  render(<DataTable label="Cases" columns={columns} rows={rows} rowKey={(row) => row.id} initialSort={{ column: "count", direction: "desc" }} />);
  expect(names()).toEqual(["Alpha", "Gamma", "Beta"]);
});
it("shows_the_empty_state", () => {
  render(<DataTable label="Cases" columns={columns} rows={[]} rowKey={(row) => row.id} empty="No cases" />);
  expect(screen.getByRole("cell").getAttribute("colspan")).toBe("2"); expect(screen.getByRole("cell").textContent).toBe("No cases");
});
it("row_props_select_and_handle_events", () => {
  const click = vi.fn();
  render(<DataTable label="Cases" columns={columns} rows={rows} rowKey={(row) => row.id} rowProps={(row) => ({ selected: row.id === "a", onClick: click, className: "custom" })} />);
  const selected = screen.getAllByRole("row")[1];
  expect(selected.getAttribute("aria-selected")).toBe("true"); expect(selected.className).toContain("is-selected"); expect(selected.className).toContain("custom");
  expect(selected.hasAttribute("selected")).toBe(false); fireEvent.click(selected); expect(click).toHaveBeenCalledOnce();
});
