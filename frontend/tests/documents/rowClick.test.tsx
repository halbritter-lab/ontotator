/** Row click on Documents (M1): it opens the text card only; only the checkboxes select. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsTable, type TableSelection } from "../../src/documents/DocumentsTable";
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
      const name = screen.getByRole("button", { name: `Open text card, case-120 ${language}` });
      return name.closest("tr")!.children[5] as HTMLElement;
    };
    return { onOpenPanel, current, waitingCell };
  }

  it("a click on a row's empty area opens the card and never selects", () => {
    const { onOpenPanel, current, waitingCell } = renderTable();
    fireEvent.click(waitingCell("de"));
    expect(current.select).not.toHaveBeenCalled();
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: screen.getByRole("button", { name: "Open text card, case-120 de" }) });
  });

  it("a click on a selected row keeps it selected and opens the card", () => {
    const { onOpenPanel, current, waitingCell } = renderTable(["case-120:de"]);
    fireEvent.click(waitingCell("de"));
    expect(current.select).not.toHaveBeenCalled();
    expect(onOpenPanel).toHaveBeenCalledTimes(1);
  });

  it("a click on the text name opens the card and keeps the selection", () => {
    const { onOpenPanel, current } = renderTable(["case-120:de"]);
    const name = screen.getByRole("button", { name: "Open text card, case-120 de" });
    fireEvent.click(name);
    expect(current.select).not.toHaveBeenCalled();
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), { opener: name });
  });

  it("shift-, ctrl- and meta-clicks on the row area neither select nor open", () => {
    const { onOpenPanel, current, waitingCell } = renderTable(["case-120:de"]);
    fireEvent.click(waitingCell("fr"), { shiftKey: true });
    fireEvent.click(waitingCell("de"), { ctrlKey: true });
    fireEvent.click(waitingCell("fr"), { metaKey: true });
    expect(current.select).not.toHaveBeenCalled();
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
