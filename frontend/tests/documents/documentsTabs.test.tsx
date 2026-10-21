import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { DocumentsTabs, TabEmptyState, type DocumentsTabsProps } from "../../src/documents/DocumentsTabs";
import { bar } from "./fixtures";

afterEach(cleanup);

const counts = bar({ needs_decision: 3, to_assign: 2, in_progress: 4, done: 5, all: 14, in_plan: 11 });

function renderTabs(query: ProjectDocumentsQuery, overrides: Partial<DocumentsTabsProps> = {}) {
  const onNavigate = vi.fn();
  render(<DocumentsTabs bar={counts} query={query} projectKey="p" panelId="documents-panel" onNavigate={onNavigate} {...overrides} />);
  return { onNavigate };
}

it("Needs your decision (3) · To assign (2) · In progress (4) · Done (5) · All (14)", () => {
  const { onNavigate } = renderTabs({ segment: "assign", language: "de", page: "2", open: ["c:de"], select: "x" });
  const list = screen.getByRole("tablist", { name: "Documents views" });
  const tabs = screen.getAllByRole("tab");
  expect(list.contains(tabs[0])).toBe(true);
  expect(tabs.map(tab => tab.getAttribute("aria-label"))).toEqual(["Needs your decision, 3", "To assign, 2", "In progress, 4", "Done, 5", "All, 14"]);
  expect(tabs.map(tab => tab.textContent)).toEqual(["Needs your decision3", "To assign2", "In progress4", "Done5", "All14"]);
  // The decision count is a filled warning pill when above 0.
  expect(tabs[0].querySelector(".ui-tab-count--emphasised")).not.toBeNull();
  expect(tabs[1].querySelector(".ui-tab-count--emphasised")).toBeNull();
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(tabs[3].getAttribute("href")).toBe("#/projects/p/documents?language=de&segment=done");
  fireEvent.click(tabs[3]);
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", segment: "done", language: "de" });
  fireEvent.keyDown(tabs[4], { key: "Enter" });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de" });
});

it("no segment shows All", () => {
  renderTabs({}, { bar: { ...counts, needs_decision: 0 } });
  const all = screen.getByRole("tab", { name: "All, 14" });
  expect(all.getAttribute("aria-selected")).toBe("true");
  expect(all.getAttribute("aria-controls")).toBe("documents-panel");
  expect(screen.getByRole("tab", { name: "Needs your decision, 0" }).querySelector(".ui-tab-count--emphasised")).toBeNull();
  cleanup();
  renderTabs({ decision: "translation" });
  expect(screen.getByRole("tab", { name: "Needs your decision, 3" }).getAttribute("aria-selected")).toBe("true");
});

it("tab empty states with Show all texts", () => {
  const onNavigate = vi.fn();
  const titles: [Parameters<typeof TabEmptyState>[0]["tab"], string][] = [
    ["decision", "Nothing needs your decision"], ["assign", "Nothing to assign"], ["progress", "Nothing in progress"], ["done", "Nothing done yet"],
  ];
  for (const [tab, title] of titles) {
    const view = render(<TabEmptyState tab={tab} projectKey="p" onNavigate={onNavigate} />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Show all texts" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p" });
    view.unmount();
  }
  render(<TabEmptyState tab="all" projectKey="p" onNavigate={onNavigate} />);
  expect(screen.getByRole("heading", { name: "No texts yet" })).toBeTruthy();
  expect(screen.getByText("Upload texts to start.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Show all texts" })).toBeNull();
});

it("Updated 10:42 · Refresh and Export final results… when finals > 0", () => {
  const onRefresh = vi.fn();
  renderTabs({}, { updatedAt: new Date(2026, 9, 21, 10, 42), onRefresh, bar: { ...counts, finals: 2 } });
  expect(screen.getByText("Updated 10:42")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Export final results…" }).getAttribute("href")).toBe("#/projects/p/export");
  cleanup();
  renderTabs({});
  expect(screen.queryByRole("link", { name: "Export final results…" })).toBeNull();
  expect(screen.queryByText(/^Updated/)).toBeNull();
});
