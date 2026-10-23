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
describe("row_selection_edges_and_server_sort", () => {
  type Row = { id: string; group: string; name: string; n: number };
  const rows: Row[] = [{ id: "a-de", group: "A", name: "de", n: 2 }, { id: "a-fr", group: "A", name: "fr", n: 1 }, { id: "b-de", group: "B", name: "de", n: 3 }];
  const columns: Column<Row>[] = [{ id: "name", header: "Text", cell: r => `${r.group}, ${r.name}`, rowHeader: true }, { id: "n", header: "N", cell: r => r.n, sortValue: r => r.n }];
  const groups = [{ key: "A", header: <span>Case A</span>, rows: rows.slice(0, 2), expanded: true }, { key: "B", header: <span>Case B</span>, rows: rows.slice(2), expanded: true }];
  const rowSelection = (onSelect = vi.fn(), selected: (row: Row) => boolean = (row) => row.id === "a-de") =>
    ({ selected, onSelect, label: (row: Row) => `Select ${row.group}, ${row.name}` });
  const groupSelection = (state: (key: string) => "all" | "some" | "none" = () => "none") =>
    ({ selected: (key: string) => state(key) === "all", onSelect: vi.fn(), checkboxLabel: (key: string) => `Select ${key}`, state });

  it("renders a first checkbox cell per row with rowSelection", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} rowSelection={rowSelection()} />);
    const headers = container.querySelectorAll("thead th");
    expect(headers).toHaveLength(3);
    expect(headers[0].getAttribute("scope")).toBe("col");
    expect(headers[0].querySelector(".visually-hidden")?.textContent).toBe("Select");
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(3);
    for (const row of bodyRows) {
      const first = row.firstElementChild!;
      expect(first.tagName).toBe("TD");
      expect(first.querySelector("input[type=checkbox].data-table-row-select.checkbox-target")).not.toBeNull();
    }
    const box = screen.getByRole("checkbox", { name: "Select A, de" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select A, fr" }) as HTMLInputElement).checked).toBe(false);
  });
  it("reports click modes for row checkboxes", () => {
    const onSelect = vi.fn();
    render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} rowSelection={rowSelection(onSelect)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A, fr" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select B, de" }), { shiftKey: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A, de" }), { ctrlKey: true });
    expect(onSelect.mock.calls).toEqual([[rows[1], "toggle"], [rows[2], "range"], [rows[0], "toggle-keep-anchor"]]);
  });
  it("custom selectionHeader replaces the hidden Select header", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} rowSelection={rowSelection()} selectionHeader={<span className="visually-hidden">Choose</span>} />);
    expect(container.querySelector("thead th")?.textContent).toBe("Choose");
  });
  it("group row: checkbox td plus a left-aligned rowgroup th spanning the other columns", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} groups={groups} rowSelection={rowSelection()} groupSelection={groupSelection()} />);
    const groupRow = container.querySelector("tbody tr.data-table-group")!;
    expect(groupRow.children).toHaveLength(2);
    const [cell, header] = [...groupRow.children] as HTMLElement[];
    expect(cell.tagName).toBe("TD");
    expect(cell.querySelector("input.data-table-group-select")).not.toBeNull();
    expect(header.tagName).toBe("TH");
    expect(header.getAttribute("scope")).toBe("rowgroup");
    expect(header.getAttribute("colspan")).toBe("2");
    expect(header.style.textAlign).toBe("start");
    expect(header.querySelector("input")).toBeNull();
    expect(header.textContent).toBe("Case A");
  });
  it("label layout without rowSelection still gives the group checkbox its own column", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} groups={groups} groupLayout="label" groupSelection={groupSelection()} />);
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelector("tbody tr.data-table-group > td input.data-table-group-select")).not.toBeNull();
    expect(container.querySelector("tbody tr:not(.data-table-group) > td:first-child")?.textContent).toBe("");
  });
  it("group checkbox is indeterminate for state some", () => {
    render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} groups={groups} rowSelection={rowSelection()}
      groupSelection={groupSelection((key) => key === "A" ? "some" : "all")} />);
    const a = screen.getByRole("checkbox", { name: "Select A" }) as HTMLInputElement;
    const b = screen.getByRole("checkbox", { name: "Select B" }) as HTMLInputElement;
    expect(a.indeterminate).toBe(true); expect(a.checked).toBe(false);
    expect(b.indeterminate).toBe(false); expect(b.checked).toBe(true);
  });
  it("Shift+ArrowDown moves and selects over rows in order; from a case checkbox its rows come next", () => {
    const onSelect = vi.fn();
    const onGroup = vi.fn();
    render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} groups={groups} rowSelection={rowSelection(onSelect)}
      groupSelection={{ ...groupSelection(), onSelect: onGroup }} />);
    const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
    // From a case checkbox the next box is its first row, not the next case.
    box("Select A").focus();
    fireEvent.keyDown(box("Select A"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(box("Select A, de"));
    expect(onSelect).toHaveBeenLastCalledWith(rows[0], "select");
    fireEvent.keyDown(box("Select A, de"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(box("Select A, fr"));
    expect(onSelect).toHaveBeenLastCalledWith(rows[1], "select");
    // Row checkboxes walk the rows (the next case's first row).
    fireEvent.keyDown(box("Select A, fr"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(box("Select B, de"));
    expect(onSelect).toHaveBeenLastCalledWith(rows[2], "select");
    fireEvent.keyDown(box("Select B, de"), { key: "ArrowUp", shiftKey: true });
    expect(document.activeElement).toBe(box("Select A, fr"));
    // A case checkbox steps up to the row above it.
    box("Select B").focus();
    fireEvent.keyDown(box("Select B"), { key: "ArrowUp", shiftKey: true });
    expect(document.activeElement).toBe(box("Select A, fr"));
    expect(onGroup).not.toHaveBeenCalled();
    onSelect.mockClear();
    fireEvent.keyDown(box("Select A, fr"), { key: "ArrowDown" });
    box("Select B, de").focus();
    fireEvent.keyDown(box("Select B, de"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(box("Select B, de"));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("server-driven sort sets aria-sort and calls onSort without reordering", () => {
    const onSort = vi.fn();
    const serverColumns: Column<Row>[] = [{ ...columns[0], sortable: true }, columns[1]];
    const { container } = render(<DataTable label="T" columns={serverColumns} rows={rows} rowKey={r => r.id} sort={{ column: "n", direction: "desc" }} onSort={onSort} />);
    const text = screen.getByRole("button", { name: "Text" });
    const n = screen.getByRole("button", { name: "N" });
    expect(text.closest("th")?.getAttribute("aria-sort")).toBe("none");
    expect(n.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(n);
    fireEvent.click(text);
    expect(onSort.mock.calls).toEqual([["n"], ["name"]]);
    expect([...container.querySelectorAll("th[scope=row]")].map((th) => th.textContent)).toEqual(["A, de", "A, fr", "B, de"]);
    expect(n.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  });
  it("rowEdge decision adds the class", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} rowEdge={(row) => row.id === "a-fr" ? "decision" : null}
      rowProps={(row) => ({ className: `row-${row.id}` })} />);
    expect(container.querySelector(".row-a-fr")?.className).toContain("data-table-row--decision");
    expect(container.querySelectorAll(".data-table-row--decision")).toHaveLength(1);
  });
  it("expanded rows and the empty state span the selection column", () => {
    const { container, rerender } = render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} rowSelection={rowSelection()} renderExpanded={(row) => row.id === "a-de" ? "more" : null} />);
    expect(container.querySelector("tr.data-table-expanded > td")?.getAttribute("colspan")).toBe("3");
    rerender(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id} rowSelection={rowSelection()} />);
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("3");
  });
  it("existing callers render as before", () => {
    const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id}
      groups={[{ ...groups[0], headerProps: { className: "custom" } }, { ...groups[1], expanded: false }]}
      groupSelection={{ selected: (key) => key === "A", onSelect: vi.fn(), checkboxLabel: (key) => `Select ${key}` }} />);
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="data-table-scroll"><table class="data-table density-compact"><caption class="visually-hidden">T</caption><thead><tr><th scope="col" style="text-align: start;">Text</th><th scope="col" style="text-align: start;" aria-sort="none"><button class="data-table-sort" type="button">N<svg class="data-table-sort-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5"></path></svg></button></th></tr></thead><tbody><tr class="data-table-group custom"><th scope="rowgroup" colspan="2"><input type="checkbox" class="data-table-group-select checkbox-target" data-group-key="A" aria-label="Select A" checked=""><span>Case A</span></th></tr><tr class=""><th scope="row" style="text-align: start;">A, de</th><td style="text-align: start;">2</td></tr><tr class=""><th scope="row" style="text-align: start;">A, fr</th><td style="text-align: start;">1</td></tr></tbody><tbody><tr class="data-table-group"><th scope="rowgroup" colspan="2"><input type="checkbox" class="data-table-group-select checkbox-target" data-group-key="B" aria-label="Select B"><span>Case B</span></th></tr></tbody></table></div>"`);
  });
});
