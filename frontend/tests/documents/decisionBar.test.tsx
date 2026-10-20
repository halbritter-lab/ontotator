import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { DecisionBar, type DecisionBarProps } from "../../src/documents/DecisionBar";
import { bar } from "./fixtures";

afterEach(cleanup);

const counts = bar({
  total: 5, report_or_pause: 1, confirm_final: 2, translation: 1, missing_final: 3, no_final: 7, shown: 5,
  in_plan: 40, needs_decision: 6, to_assign: 12, in_progress: 9,
  decision_categories: { "report-or-pause": 1, "confirm-final": 2, translation: 2, "missing-final": 1 },
});

function renderBar(query: ProjectDocumentsQuery, view = counts, overrides: Partial<DecisionBarProps> = {}) {
  const onNavigate = vi.fn();
  const props: DecisionBarProps = { bar: view, query, projectKey: "p", onNavigate, ...overrides };
  render(<DecisionBar {...props} />);
  return { onNavigate, props };
}

const link = (name: string) => screen.getByRole("link", { name });
const paramsOf = (name: string) => new URLSearchParams((link(name).getAttribute("href") ?? "").split("?")[1] ?? "");
const current = () => screen.getAllByRole("link").filter(item => item.getAttribute("aria-current") === "page").map(item => item.textContent);

it("shows All, Needs your decision, To assign, In progress", () => {
  renderBar({});
  const segments = screen.getByRole("navigation", { name: "Segments" });
  expect(within(segments).getAllByRole("link").map(item => item.textContent)).toEqual(["All (40)", "Needs your decision (6)", "To assign (12)", "In progress (9)"]);
  expect(screen.queryByRole("link", { name: /No final result/ })).toBeNull();
  expect(current()).toEqual(["All (40)"]);
});

it("links segments to the segment filter and marks the current one", () => {
  const { onNavigate } = renderBar({ segment: "assign", language: "de", decision: undefined, page: "3", open: ["c:de"] });
  expect(current()).toEqual(["To assign (12)"]);
  expect(paramsOf("Needs your decision (6)").get("segment")).toBe("decision");
  expect(paramsOf("In progress (9)").get("segment")).toBe("progress");
  const all = paramsOf("All (40)");
  expect(all.has("segment")).toBe(false);
  expect(all.get("language")).toBe("de");
  expect(all.has("page")).toBe(false);
  expect(all.has("open")).toBe(false);
  fireEvent.click(link("In progress (9)"));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "progress" });
  onNavigate.mockClear();
  expect(fireEvent.click(link("All (40)"), { ctrlKey: true })).toBe(true);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("shows decision categories under Needs your decision and marks a category", () => {
  renderBar({ segment: "decision" });
  const categories = screen.getByRole("navigation", { name: "Decision categories" });
  expect(within(categories).getAllByRole("link").map(item => item.textContent)).toEqual([
    "Problem report or paused task (1)", "Final result to confirm (2)", "Translation rejected or queried (2)", "Final result missing (1)",
  ]);
  const params = paramsOf("Translation rejected or queried (2)");
  expect(params.get("decision")).toBe("translation");
  expect(params.has("segment")).toBe(false);
  cleanup();
  renderBar({ decision: "translation" });
  expect(link("Needs your decision (6)").getAttribute("aria-current")).toBe("true");
  expect(current()).toEqual(["Translation rejected or queried (2)"]);
  cleanup();
  renderBar({ segment: "assign" });
  expect(screen.queryByRole("navigation", { name: "Decision categories" })).toBeNull();
});

it("compares shown rows against the active segment's count and offers Clear filters", () => {
  renderBar({ segment: "assign", language: "de", plan: "review,annotate", step: "assign_translation_review", stage: "final,done", paused: "no", final: "none", page: "2" }, { ...counts, shown: 4 });
  expect(screen.getByText("4 of 12 shown", { exact: false })).toBeTruthy();
  const params = paramsOf("Clear filters");
  for (const name of ["language", "plan", "step", "stage", "paused", "final", "page"]) expect(params.has(name)).toBe(false);
  expect(params.get("segment")).toBe("assign");
  cleanup();
  renderBar({ decision: "translation", language: "de" }, { ...counts, shown: 1 });
  expect(screen.getByText("1 of 2 shown", { exact: false })).toBeTruthy();
  cleanup();
  renderBar({ language: "de" }, { ...counts, shown: 40 });
  expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
});

it("keeps paused and comma-joined filters on segment links", () => {
  renderBar({ plan: "annotate,review_and_annotate", paused: "yes", final: "any" });
  const all = paramsOf("To assign (12)");
  expect(all.get("plan")).toBe("annotate,review_and_annotate");
  expect(all.get("paused")).toBe("yes");
  expect(all.get("final")).toBe("any");
});

it("shows Export final results… from the project-wide final count", () => {
  renderBar({ segment: "assign" }, { ...counts, finals: 3, shown: 0 });
  expect(link("Export final results…").getAttribute("href")).toBe("#/projects/p/export");
  cleanup();
  renderBar({}, { ...counts, finals: 0 });
  expect(screen.queryByRole("link", { name: "Export final results…" })).toBeNull();
});

it("moves No final result to More filters", () => {
  renderBar({ final: "none" });
  expect(screen.queryByRole("link", { name: /No final result/ })).toBeNull();
  // The bar's All segment does not drop the Final result filter (it is a filter, not a segment).
  expect(paramsOf("All (40)").get("final")).toBe("none");
});

it("shows when the rows were updated with Refresh and the export link", () => {
  const onRefresh = vi.fn();
  renderBar({}, { ...counts, finals: 1 }, { updatedAt: new Date(2026, 9, 20, 10, 42), onRefresh });
  expect(screen.getByText("Updated 10:42")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(onRefresh).toHaveBeenCalled();
  expect(link("Export final results…").getAttribute("href")).toBe("#/projects/p/export");
  cleanup();
  renderBar({}, counts, { updatedAt: null, onRefresh });
  expect(screen.queryByRole("link", { name: "Export final results…" })).toBeNull();
});
