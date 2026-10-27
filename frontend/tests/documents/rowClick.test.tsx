/** Row interaction on Documents (R-4): a click selects, a double click or Enter on the text name opens the text card. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOUBLE_CLICK_MS, DocumentsTable, type TableSelection } from "../../src/documents/DocumentsTable";
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

describe("in the table", () => {
  function renderTable(selected: readonly string[] = []) {
    const onOpenPanel = vi.fn();
    const current = selection(selected);
    render(<DocumentsTable page={page([group("case-120", [de, fr])])} onOpenPanel={onOpenPanel} onAction={vi.fn()} selection={current} />);
    const waitingCell = (language: string) => {
      const name = screen.getByRole("button", { name: `Text case-120 ${language}` });
      return name.closest("tr")!.children[5] as HTMLElement;
    };
    return { onOpenPanel, current, waitingCell };
  }

  it("a click on a row's empty area toggles its selection and does not open the card (R-4)", () => {
    const { onOpenPanel, current, waitingCell } = renderTable();
    fireEvent.click(waitingCell("de"));
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("a click on the text name (or Space on it) toggles the selection", () => {
    const { onOpenPanel, current } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Text case-120 de" }), { detail: 0 });
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("the text name is a toggle button that names what a click does, Enter as its shortcut (#41)", () => {
    renderTable(["case-120:de"]);
    const de = screen.getByRole("button", { name: "Text case-120 de" });
    expect(de.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Text case-120 fr" }).getAttribute("aria-pressed")).toBe("false");
    expect(de.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(de.getAttribute("title")).toMatch(/Enter or double click opens the text card/);
  });

  it("a mouse click selects once no second click follows (R-16)", () => {
    vi.useFakeTimers();
    try {
      const { current, waitingCell } = renderTable();
      fireEvent.click(waitingCell("de"), { detail: 1 });
      expect(current.select).not.toHaveBeenCalled();
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
      expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a double click opens the card and never touches the selection (R-16)", () => {
    vi.useFakeTimers();
    try {
      const { onOpenPanel, current, waitingCell } = renderTable();
      const cell = waitingCell("de");
      fireEvent.click(cell, { detail: 1 });
      fireEvent.click(cell, { detail: 2 });
      fireEvent.doubleClick(cell);
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
      expect(current.select).not.toHaveBeenCalled();
      expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: screen.getByRole("button", { name: "Text case-120 de" }) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slow double click (after the selection applied) toggles back and opens the card", () => {
    const { onOpenPanel, current, waitingCell } = renderTable();
    const cell = waitingCell("de");
    fireEvent.click(cell, { detail: 0 });
    fireEvent.doubleClick(cell);
    expect(current.select).toHaveBeenCalledTimes(2);
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: screen.getByRole("button", { name: "Text case-120 de" }) });
  });

  it("Enter on the text name opens the card without selecting", () => {
    const { onOpenPanel, current } = renderTable();
    const name = screen.getByRole("button", { name: "Text case-120 de" });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(current.select).not.toHaveBeenCalled();
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: name });
  });

  it("shift- and ctrl-clicks on the row area select a range or keep the anchor", () => {
    const { onOpenPanel, current, waitingCell } = renderTable(["case-120:de"]);
    fireEvent.click(waitingCell("fr"), { shiftKey: true });
    fireEvent.click(waitingCell("de"), { ctrlKey: true });
    expect(current.select).toHaveBeenNthCalledWith(1, "case-120:fr", "range", order);
    expect(current.select).toHaveBeenNthCalledWith(2, "case-120:de", "toggle-keep-anchor", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("the checkbox keeps its own behaviour and never opens the card", () => {
    const { onOpenPanel, current } = renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select case-120 de" }));
    expect(current.select).toHaveBeenCalledTimes(1);
    expect(current.select).toHaveBeenCalledWith("case-120:de", "toggle", order);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });
});
