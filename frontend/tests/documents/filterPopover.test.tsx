import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DecisionBarView } from "../../src/api/client";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { FilterPopover } from "../../src/documents/FilterPopover";
import { bar } from "./fixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const stubMatchMedia = (matches: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({
  matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
}));

const counts: DecisionBarView = bar({
  shown: 14,
  facets: {
    language: { de: 8, fr: 3, en: 3 },
    review_state: { accepted: 6, check_failed: 1, rejected: 1, query: 1, in_progress: 0 },
    annotation_state: { unassigned: 2, in_progress: 3, old_text_open: 1 },
    final_state: { none: 9, final: 0 },
    origin: { machine_translation: 7 },
    plan: { not_in_plan: 3 },
    waiting_on: { me: 2, "ann-0001": 1 },
    proposals: { with: 4, without: 10 },
  },
});

/** The popover with a real route state: every change updates its query (as the page does). */
function renderPopover(initial: ProjectDocumentsQuery = {}, view: DecisionBarView | null = counts) {
  const onChange = vi.fn();
  const onClearAll = vi.fn();
  function Host() {
    const [query, setQuery] = useState(initial);
    return <FilterPopover query={query} bar={view} sourceLanguages={new Set(["en"])}
      onChange={patch => { onChange(patch); setQuery(current => ({ ...current, ...patch })); }} onClearAll={onClearAll} />;
  }
  render(<Host />);
  return { onChange, onClearAll, open: () => fireEvent.click(screen.getByRole("button", { name: /^Filter/ })) };
}

it("zero facets are collapsed behind Show n empty filters; a checked one stays", () => {
  const { open } = renderPopover({ final_state: "final" });
  open();
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(within(dialog).queryByRole("checkbox", { name: "In progress, 0 texts" })).toBeNull();
  expect(within(dialog).getByRole("checkbox", { name: "Final, 0 texts" })).toBeTruthy();
  const toggle = within(dialog).getByRole("button", { name: /^Show \d+ empty filters$/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(within(dialog).getByRole("checkbox", { name: "In progress, 0 texts" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Hide empty filters" }));
  expect(within(dialog).queryByRole("checkbox", { name: "In progress, 0 texts" })).toBeNull();
});

it("four fieldsets with counts, muted zero facets stay checkable when checked", () => {
  const { open, onChange } = renderPopover({ final_state: "final" });
  const button = screen.getByRole("button", { name: "Filter, 1 active" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  open();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(button.getAttribute("aria-controls")).toBe(dialog.querySelector("[id]")!.id);
  fireEvent.click(within(dialog).getByRole("button", { name: /^Show \d+ empty filters$/ }));
  // Language, Translation review, Annotation, Final, Origin, Plan, Flags, Tool proposals; Waiting on when someone has open work.
  expect(within(dialog).getAllByRole("group").map(group => group.querySelector("legend")!.textContent))
    .toEqual(["Language", "Translation review", "Annotation", "Final", "Origin", "Plan", "Flags", "Tool proposals", "Waiting on", "Order"]);
  // X5: the flags facet with its count.
  expect(within(dialog).getByRole("checkbox", { name: /^Flagged: guidelines unclear, / })).toBeTruthy();
  // Focus moves to the first checkbox.
  expect(document.activeElement).toBe(within(dialog).getByRole("checkbox", { name: "de, 8 texts" }));
  expect(within(dialog).getByRole("checkbox", { name: "en (source), 3 texts" })).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "Rejected / query, 2 texts" })).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "No final yet, 9 texts" })).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "You, 2 texts" })).toBeTruthy();
  // A zero facet is muted and not checkable…
  const zero = within(dialog).getByRole("checkbox", { name: "In progress, 0 texts" }) as HTMLInputElement;
  expect(zero.getAttribute("aria-disabled")).toBe("true");
  expect(zero.disabled).toBe(false);
  expect(zero.closest("label")!.className).toContain("documents-facet--muted");
  fireEvent.click(zero);
  expect(zero.checked).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  // …unless it is already checked: then it can be unchecked.
  const final = within(dialog).getByRole("checkbox", { name: "Final, 0 texts" }) as HTMLInputElement;
  expect(final.checked).toBe(true);
  expect(final.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(final);
  expect(onChange).toHaveBeenLastCalledWith({ final_state: undefined });
});

it("checking updates the route at once and keeps the popover open", () => {
  const { open, onChange } = renderPopover({ language: "de" });
  open();
  fireEvent.click(screen.getByRole("checkbox", { name: "fr, 3 texts" }));
  expect(onChange).toHaveBeenLastCalledWith({ language: "de,fr" });
  fireEvent.click(screen.getByRole("checkbox", { name: "In progress, 3 texts" }));
  expect(onChange).toHaveBeenLastCalledWith({ annotation_state: "in_progress,consolidating,finishing_on_old" });
  expect(screen.getByRole("dialog", { name: "Filter" })).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "fr, 3 texts" }) as HTMLInputElement).checked).toBe(true);
  // Escape closes and returns focus to the button.
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Filter" }), { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Filter/ }));
});

it("live region '14 texts match'", () => {
  const { open } = renderPopover();
  open();
  const region = within(screen.getByRole("dialog", { name: "Filter" })).getByRole("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent).toBe("14 texts match");
  cleanup();
  // While the first page loads the counts read "…".
  renderPopover({}, null).open();
  expect(screen.getAllByRole("checkbox", { name: "Unassigned, counting" })[0].closest("label")!.textContent).toContain("…");
});

it("footer Order radio and Clear all", () => {
  const { open, onChange, onClearAll } = renderPopover({ sort: "-activity", language: "de" });
  open();
  const order = screen.getByRole("group", { name: "Order" });
  expect(within(order).getAllByRole("radio").map(radio => radio.getAttribute("aria-label") ?? radio.closest("label")!.textContent)).toEqual(["Case ID", "Import order", "Last activity"]);
  expect((within(order).getByRole("radio", { name: "Last activity" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(order).getByRole("radio", { name: "Import order" }));
  expect(onChange).toHaveBeenLastCalledWith({ sort: "import" });
  fireEvent.click(within(order).getByRole("radio", { name: "Case ID" }));
  expect(onChange).toHaveBeenLastCalledWith({ sort: undefined });
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(onClearAll).toHaveBeenCalledTimes(1);
});

it("sheet with Show {n} texts below 700 px", () => {
  stubMatchMedia(true);
  const { open } = renderPopover();
  open();
  const sheet = screen.getByRole("dialog", { name: "Filter" });
  expect(sheet.closest(".ui-popover-sheet") ?? sheet.querySelector(".ui-popover-sheet") ?? (sheet.classList.contains("ui-popover-sheet") ? sheet : null)).not.toBeNull();
  fireEvent.click(within(sheet).getByRole("button", { name: "Show 14 texts" }));
  expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
});

it("shows With tool proposals and Without with counts", () => {
  const { open, onChange } = renderPopover();
  open();
  const group = screen.getByRole("group", { name: "Tool proposals" });
  expect(within(group).getAllByRole("checkbox").map(box => box.getAttribute("aria-label"))).toEqual(["With tool proposals, 4 texts", "Without, 10 texts"]);
  fireEvent.click(within(group).getByRole("checkbox", { name: "With tool proposals, 4 texts" }));
  expect(onChange).toHaveBeenLastCalledWith({ proposals: "with" });
  expect(screen.getByRole("button", { name: "Filter, 1 active" })).toBeTruthy();
});
