/** Row click on Documents (spec 2026-10-23 §2 "Row click toggles the selection"). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentRowView } from "../../src/api/client";
import { DocumentsTable, rowClick, type TableSelection } from "../../src/documents/DocumentsTable";
import { group, page } from "./fixtures";
import { stagedRow } from "./tableFixtures";

afterEach(cleanup);

function selection(selected: readonly string[] = []): TableSelection {
  const keys = new Set(selected);
  return {
    keys,
    caseState: caseKeys => {
      const count = caseKeys.filter(key => keys.has(key)).length;
      return count === 0 ? "none" : count === caseKeys.length ? "all" : "some";
    },
    select: vi.fn(),
    selectCase: vi.fn(),
  };
}

const de = stagedRow("case-120", "de");
const fr = stagedRow("case-120", "fr");
const order = ["case-120:de", "case-120:fr"];

describe("rowClick", () => {
  it("a click on an unselected row selects it and opens the card", () => {
    const open = vi.fn<(row: DocumentRowView) => void>();
    const current = selection(["case-120:fr"]);
    rowClick(de, "row", current, order, open);
    expect(current.select).toHaveBeenCalledWith("case-120:de", "select", order);
    expect(open).toHaveBeenCalledWith(de);
  });

  it("a click on a selected row deselects it and opens nothing", () => {
    const open = vi.fn();
    const current = selection(["case-120:de"]);
    rowClick(de, "row", current, order, open);
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    expect(open).not.toHaveBeenCalled();
  });

  it("a click on the text name opens the card and keeps the selection", () => {
    const open = vi.fn();
    const current = selection(["case-120:de"]);
    rowClick(de, "name", current, order, open);
    expect(current.select).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(de);
  });

  it("without selection rights a row click only opens the card", () => {
    const open = vi.fn();
    rowClick(de, "row", undefined, order, open);
    expect(open).toHaveBeenCalledWith(de);
  });
});

describe("in the table", () => {
  function renderTable(selected: readonly string[] = []) {
    const onOpenPanel = vi.fn();
    const current = selection(selected);
    render(<DocumentsTable page={page([group("case-120", [de, fr])])} onOpenPanel={onOpenPanel} onAction={vi.fn()} selection={current} />);
    const waitingCell = (language: string) => {
      const name = screen.getByRole("button", { name: `Open text card, case-120 ${language}` });
      return name.closest("tr")!.children[5] as HTMLElement;
    };
    return { onOpenPanel, current, waitingCell };
  }

  it("a click on an unselected row's empty area selects it and opens the card", () => {
    const { onOpenPanel, current, waitingCell } = renderTable();
    fireEvent.click(waitingCell("de"));
    expect(current.select).toHaveBeenCalledWith("case-120:de", "select", order);
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: screen.getByRole("button", { name: "Open text card, case-120 de" }) });
  });

  it("a click on a selected row deselects it and opens nothing", () => {
    const { onOpenPanel, current, waitingCell } = renderTable(["case-120:de"]);
    fireEvent.click(waitingCell("de"));
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("a click on the text name opens the card and keeps the selection", () => {
    const { onOpenPanel, current } = renderTable(["case-120:de"]);
    const name = screen.getByRole("button", { name: "Open text card, case-120 de" });
    fireEvent.click(name);
    expect(current.select).not.toHaveBeenCalled();
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: name });
  });

  it("shift-click selects a range without opening", () => {
    const { onOpenPanel, current, waitingCell } = renderTable();
    fireEvent.click(waitingCell("fr"), { shiftKey: true });
    expect(current.select).toHaveBeenCalledWith("case-120:fr", "range", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("ctrl-click toggles without opening", () => {
    const { onOpenPanel, current, waitingCell } = renderTable(["case-120:de"]);
    fireEvent.click(waitingCell("de"), { ctrlKey: true });
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle-keep-anchor", order);
    fireEvent.click(waitingCell("fr"), { metaKey: true });
    expect(current.select).toHaveBeenLastCalledWith("case-120:fr", "toggle-keep-anchor", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("the checkbox keeps its own behaviour and never opens the card", () => {
    const { onOpenPanel, current } = renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select case-120 · de" }));
    expect(current.select).toHaveBeenCalledTimes(1);
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });
});
