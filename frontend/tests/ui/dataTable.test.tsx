import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
describe("groups_expansion_and_row_headers", () => {
  type Row = { id: string; group: string; name: string; n: number };
  const rows: Row[] = [{ id: "a1", group: "A", name: "de", n: 2 }, { id: "a2", group: "A", name: "en", n: 1 }, { id: "b1", group: "B", name: "fr", n: 3 }];
  const columns: Column<Row>[] = [{ id: "name", header: "Language", cell: r => r.name, rowHeader: true }, { id: "n", header: "N", cell: r => r.n, sortValue: r => r.n }];

  it("renders_one_tbody_per_group_with_a_rowgroup_header_and_row_headers", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id}
      groups={[{ key: "A", header: <button>A</button>, rows: rows.slice(0, 2), expanded: true }, { key: "B", header: <button>B</button>, rows: rows.slice(2), expanded: false }]} />);
    const bodies = container.querySelectorAll("tbody");
    expect(bodies).toHaveLength(2);
    expect(bodies[0].querySelector("th[scope=rowgroup]")?.getAttribute("colspan")).toBe("2");
    expect(bodies[0].querySelectorAll("th[scope=row]")).toHaveLength(2);
    expect(bodies[1].querySelectorAll("th[scope=row]")).toHaveLength(0);
  });
  it("sorts_within_groups_only", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id}
      groups={[{ key: "A", header: "A", rows: rows.slice(0, 2), expanded: true }, { key: "B", header: "B", rows: rows.slice(2), expanded: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: /N/ }));
    const names = [...container.querySelectorAll("th[scope=row]")].map(n => n.textContent);
    expect(names).toEqual(["en", "de", "fr"]);
  });
  it("renders_expanded_content_as_a_following_full_width_row", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} renderExpanded={r => r.id === "a1" ? <p>Details a1</p> : null} />);
    const expanded = screen.getByText("Details a1").closest("td")!;
    expect(expanded.getAttribute("colspan")).toBe("2");
    expect(expanded.closest("tr")?.previousElementSibling?.textContent).toContain("de");
    expect(container.querySelectorAll("tr.data-table-expanded")).toHaveLength(1);
  });
  it("shows_the_empty_state_without_groups_and_sets_busy", () => {
    render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} groups={[]} empty="Nothing" busy />);
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("2");
    expect(screen.getByRole("cell").textContent).toBe("Nothing");
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
  });
  it("applies_group_header_props_and_keeps_rowgroup_header_class", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id}
      groups={[{ key: "A", header: "A", rows: rows.slice(0, 2), expanded: false, headerProps: { id: "group-a", className: "custom" } }]} />);
    const header = container.querySelector("#group-a")!;
    expect(header.className).toContain("data-table-group"); expect(header.className).toContain("custom");
  });
});
describe("group_selection", () => {
  type Row = { id: string; name: string };
  const columns: Column<Row>[] = [{ id: "name", header: "Language", cell: r => r.name, rowHeader: true }];
  const groups = ["g1", "g2", "g3"].map((key) => ({ key, header: <span>{key}</span>, rows: [{ id: `${key}-de`, name: "de" }], expanded: true }));
  const renderTable = (onSelect = vi.fn(), selected: (key: string) => boolean = (key) => key === "g2") => {
    render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} groups={groups}
      groupSelection={{ selected, onSelect, checkboxLabel: (key) => `Select ${key} (1 language)` }} />);
    return onSelect;
  };
  const box = (key: string) => screen.getByRole("checkbox", { name: `Select ${key} (1 language)` }) as HTMLInputElement;

  it("group_selection_renders_a_named_checkbox_in_each_group_header", () => {
    renderTable();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(box("g1").checked).toBe(false);
    expect(box("g2").checked).toBe(true);
    expect(box("g1").closest("th")?.getAttribute("scope")).toBe("rowgroup");
    expect(box("g1").className).toContain("data-table-group-select");
    expect(box("g1").className).toContain("checkbox-target");
  });
  it("group_selection_reports_toggle_range_and_keep_anchor_modes", () => {
    const onSelect = renderTable();
    fireEvent.click(box("g1"));
    fireEvent.click(box("g2"), { shiftKey: true });
    fireEvent.click(box("g3"), { ctrlKey: true });
    fireEvent.click(box("g1"), { metaKey: true });
    expect(onSelect.mock.calls).toEqual([["g1", "toggle"], ["g2", "range"], ["g3", "toggle-keep-anchor"], ["g1", "toggle-keep-anchor"]]);
  });
  it("shift_arrow_moves_focus_to_the_next_group_checkbox_and_selects_it", () => {
    const onSelect = renderTable();
    box("g1").focus();
    fireEvent.keyDown(box("g1"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(box("g2"));
    expect(onSelect).toHaveBeenLastCalledWith("g2", "select");
    fireEvent.keyDown(box("g2"), { key: "ArrowUp", shiftKey: true });
    expect(document.activeElement).toBe(box("g1"));
    expect(onSelect).toHaveBeenLastCalledWith("g1", "select");
    onSelect.mockClear();
    fireEvent.keyDown(box("g1"), { key: "ArrowUp", shiftKey: true });
    expect(document.activeElement).toBe(box("g1"));
    box("g3").focus();
    fireEvent.keyDown(box("g3"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(box("g3"));
    fireEvent.keyDown(box("g3"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
