/** Accessibility pass of the documents overview (spec "Accessibility"): names, roles and table semantics, without axe. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/api/client";
import { DocumentsTable, type TableSelection } from "../../src/documents/DocumentsTable";
import { TextCard } from "../../src/documents/textCard/TextCard";
import { DocumentsTabs } from "../../src/documents/DocumentsTabs";
import { FilterPopover } from "../../src/documents/FilterPopover";
import { MenuButton, Popover } from "../../src/ui";
import { bar, group, notInPlanRow, page, stepOf, submissions } from "./fixtures";
import { cell, scenario7a, stagedRow } from "./tableFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

const view = () => page([
  group("case-107", [
    notInPlanRow("case-107", "en", { is_source: true, stages: { review: cell("source", "none"), annotation: cell("not_planned", "none"), final: cell("none", "none") } }),
    scenario7a(),
  ]),
  group("case-108", [stagedRow("case-108", "fr", { steps: [stepOf("assign_annotation")] })]),
]);

describe("table", () => {
  it("caption Documents, one flat tbody without case lines", () => {
    render(<DocumentsTable page={view()} onOpenPanel={vi.fn()} onAction={vi.fn()} selection={selection()} />);
    const table = screen.getByRole("table", { name: "Documents" });
    const caption = table.querySelector("caption");
    expect(caption?.textContent).toBe("Documents");
    expect(caption?.className).toBe("visually-hidden");
    const bodies = table.querySelectorAll("tbody");
    expect(bodies).toHaveLength(1);
    expect(table.querySelector("th[scope='rowgroup']")).toBeNull();
    // Text cells are row headers named "{case}, {language}"; stage cells are plain cells.
    const de = within(bodies[0]).getAllByRole("rowheader").find(element => element.getAttribute("scope") === "row" && element.textContent?.startsWith("case-107 de"))!;
    expect(de).toBeTruthy();
    expect(de.textContent).toContain("Needs your decision");
    const rowCells = [...de.closest("tr")!.children];
    expect(rowCells.slice(2, 5).every(element => element.tagName === "TD")).toBe(true);
    for (const glyph of table.querySelectorAll(".stage-cell-symbol")) expect(glyph.getAttribute("aria-hidden")).toBe("true");
    // Sortable headers contain a button and carry aria-sort.
    const textHeader = screen.getByRole("columnheader", { name: "Text" });
    expect(textHeader.getAttribute("aria-sort")).toBeNull();
  });

  it("row checkbox names, no case checkbox, sortable headers", () => {
    const { unmount } = render(<DocumentsTable page={view()} onOpenPanel={vi.fn()} onAction={vi.fn()} selection={selection(["case-107:de"])}
      sort="case" onSort={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Select case-107 de" })).toHaveProperty("checked", true);
    // The not-planned en source is not a row (only "+1" says it exists): no checkbox.
    expect(screen.queryByRole("checkbox", { name: "Select case-107 en" })).toBeNull();
    expect(screen.getByText("1 more text of this case not in plan")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /^Select case-107 \(/ })).toBeNull();
    unmount();
    render(<DocumentsTable page={view()} onOpenPanel={vi.fn()} onAction={vi.fn()} selection={selection(["case-107:de"])}
      sort="case" onSort={vi.fn()} showNotInPlan />);
    expect(screen.getByRole("checkbox", { name: "Select case-107 en" })).toHaveProperty("checked", false);
    const textHeader = screen.getByRole("columnheader", { name: "Text" });
    expect(textHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(within(textHeader).getByRole("button", { name: "Text" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Select" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Next step" })).toBeTruthy();
  });

  it("one-line rows: named text buttons, robot image, one next-step button, no nested interactive content", () => {
    const fresh = { ...stagedRow("case-108", "fr", { steps: [stepOf("assign_annotation"), stepOf("decide_report")] }), proposal_count: 3 };
    const { container } = render(<DocumentsTable page={page([group("case-108", [fresh])])} onOpenPanel={vi.fn()} onAction={vi.fn()} selection={selection()} />);
    const name = screen.getByRole("button", { name: "Open text card, case-108 fr" });
    expect(name.closest("th")!.getAttribute("scope")).toBe("row");
    expect(screen.getByRole("img", { name: "3 tool proposals available; the annotation starts from them" }).querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "Assign annotation…, case-108 fr" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^More/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Decide on report/ })).toBeNull();
    // No interactive element inside another one; every button has a name.
    for (const element of container.querySelectorAll("button, a, input")) {
      expect(element.parentElement!.closest("button, a")).toBeNull();
      expect((element.getAttribute("aria-label") ?? element.textContent ?? "").trim()).not.toBe("");
    }
  });
});

describe("tabs, popover, card, dialogs", () => {
  it("tabs, popover, card, dialogs expose their roles and names", async () => {
    vi.spyOn(api, "getRowSubmissions").mockResolvedValue(submissions("case-107", "de"));
    const row = scenario7a();
    function Host() {
      const anchor = useRef<HTMLButtonElement>(null);
      const [panel, setPanel] = useState(false);
      return <>
        <DocumentsTabs bar={bar({ needs_decision: 3, all: 14 })} query={{}} projectKey="p" panelId="documents-panel" onNavigate={vi.fn()} />
        <div id="documents-panel" role="tabpanel" aria-labelledby="documents-panel-tab-all">table</div>
        <FilterPopover query={{}} bar={bar({ shown: 14, facets: { language: { de: 8 } } })} sourceLanguages={new Set(["en"])} onChange={vi.fn()} onClearAll={vi.fn()} />
        <button ref={anchor} type="button" onClick={() => setPanel(true)}>Accept result…, case-107 de</button>
        <MenuButton label="1 more action for case-107 de" buttonLabel="+1" items={[{ id: "a", label: "Decide on report…", onSelect: vi.fn() }]} />
        <Popover open={false} anchorRef={anchor} label="Plan" onClose={vi.fn()}>plan</Popover>
        {panel && <TextCard projectKey="p" row={row} rows={[row]} query={{}} canManage onSegment={vi.fn()} onView={vi.fn()} onStep={vi.fn()}
          onNavigate={vi.fn()} onAssign={vi.fn()} onChangePlan={vi.fn()} onChanged={vi.fn()} onClose={() => setPanel(false)}
          reportRoute={reportId => ({ name: "projectProblemReport", key: "p", reportId })} />}
      </>;
    }
    render(<Host />);
    const tablist = screen.getByRole("tablist", { name: "Documents views" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs[0].getAttribute("aria-label")).toBe("Needs your decision, 3");
    expect(tabs.every(tab => tab.getAttribute("aria-controls") === "documents-panel")).toBe(true);
    expect(screen.getByRole("tabpanel", { name: "All, 14" })).toBeTruthy();

    const filter = screen.getByRole("button", { name: "Filter" });
    expect(filter.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(filter);
    const popover = screen.getByRole("dialog", { name: "Filter" });
    expect(popover.getAttribute("aria-modal")).toBeNull();
    expect(filter.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(filter.getAttribute("aria-controls")!)).not.toBeNull();
    expect(within(popover).getByRole("group", { name: "Language" })).toBeTruthy();
    expect(within(popover).getByRole("checkbox", { name: "de, 8 texts" })).toBe(document.activeElement);
    expect(within(popover).getByRole("status").textContent).toBe("14 texts match");
    fireEvent.keyDown(popover, { key: "Escape" });
    expect(document.activeElement).toBe(filter);

    const more = screen.getByRole("button", { name: "1 more action for case-107 de" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");

    const trigger = screen.getByRole("button", { name: "Accept result…, case-107 de" });
    trigger.focus();
    fireEvent.click(trigger);
    // The text card is a modal dialog named "{case} {language}" with the text path; focus starts inside and returns to the opener.
    const card = screen.getByRole("dialog", { name: "case-107 de" });
    expect(card.getAttribute("aria-modal")).toBe("true");
    expect(card.contains(document.activeElement)).toBe(true);
    expect(within(card).getByRole("navigation", { name: "Text path" })).toBeTruthy();
    expect(within(card).queryByRole("tablist")).toBeNull();
    expect(await within(card).findByRole("button", { name: /^History \(\d+\)$/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "case-107 de" })).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
