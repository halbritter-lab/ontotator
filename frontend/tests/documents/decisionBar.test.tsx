import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { DecisionBar } from "../../src/documents/DecisionBar";
import { bar } from "./fixtures";

afterEach(cleanup);

const counts = bar({ total: 5, report_or_pause: 1, confirm_final: 2, translation: 1, missing_final: 3, no_final: 7, shown: 5 });

function renderBar(query: ProjectDocumentsQuery, view = counts, onNavigate = vi.fn()) {
  render(<DecisionBar bar={view} query={query} projectKey="p" onNavigate={onNavigate} />);
  return onNavigate;
}

const hrefOf = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href") ?? "";
const paramsOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

it("shows the heading with a warning count when rows need a decision", () => {
  renderBar({});
  const heading = screen.getByRole("heading", { level: 2, name: "Needs your decision" });
  const section = heading.closest("section")!;
  expect(section.querySelector("svg.icon")).not.toBeNull();
  const warning = section.querySelector(".decision-bar-warning")!;
  expect(warning.querySelector("svg.icon")).not.toBeNull();
  expect(warning.textContent).toBe("5 rows");
});

it("keeps the bar without warning when nothing needs a decision", () => {
  renderBar({}, bar({ no_final: 2 }));
  const section = screen.getByRole("heading", { level: 2, name: "Needs your decision" }).closest("section")!;
  expect(section.querySelector(".decision-bar-warning")).toBeNull();
  expect(section.querySelector("svg.icon")).toBeNull();
  expect(screen.getByRole("link", { name: "Needs your decision (0)" })).toBeTruthy();
});

it("renders three segments as links with exactly one current", () => {
  renderBar({ language: "de" });
  const all = screen.getByRole("link", { name: "All" });
  const decision = screen.getByRole("link", { name: "Needs your decision (5)" });
  const missing = screen.getByRole("link", { name: "No final result (7)" });
  expect(all.getAttribute("aria-current")).toBe("page");
  expect(decision.getAttribute("aria-current")).toBeNull();
  expect(missing.getAttribute("aria-current")).toBeNull();
  const decisionParams = paramsOf(decision.getAttribute("href")!);
  expect(decisionParams.get("decision")).toBe("all");
  expect(decisionParams.has("final")).toBe(false);
  expect(decisionParams.get("language")).toBe("de");
  const missingParams = paramsOf(missing.getAttribute("href")!);
  expect(missingParams.get("final")).toBe("missing");
  expect(missingParams.has("decision")).toBe(false);
  expect(decision.getAttribute("href")).toMatch(/^#\/projects\/p\/documents\?/);
});

it("marks the active segment for decision and final filters and clears the other", () => {
  renderBar({ final: "missing", page: "3" });
  expect(screen.getByRole("link", { name: "No final result (7)" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  const decisionParams = paramsOf(hrefOf("Needs your decision (5)"));
  expect(decisionParams.has("final")).toBe(false);
  expect(decisionParams.has("page")).toBe(false);
  const allParams = paramsOf(hrefOf("All"));
  expect(allParams.has("final")).toBe(false);
  expect(allParams.has("decision")).toBe(false);
});

it("shows category links while the decision filter is active, keeping filters and dropping page", () => {
  renderBar({ decision: "confirm-final", language: "de", status: "submitted", q: "case", page: "2" });
  expect(screen.getByRole("link", { name: "Needs your decision (5)" }).getAttribute("aria-current")).toBe("true");
  const expected: [string, string][] = [
    ["Problem report or paused task (1)", "report-or-pause"],
    ["Final result to confirm (2)", "confirm-final"],
    ["Translation check or review failed (1)", "translation"],
    ["Final result missing (3)", "missing-final"],
  ];
  for (const [name, decision] of expected) {
    const params = paramsOf(hrefOf(name));
    expect(params.get("decision")).toBe(decision);
    expect(params.get("language")).toBe("de");
    expect(params.get("status")).toBe("submitted");
    expect(params.get("q")).toBe("case");
    expect(params.has("page")).toBe(false);
  }
  expect(screen.getByRole("link", { name: "Final result to confirm (2)" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toHaveLength(1);
});

it("marks the needs-decision segment current for decision=all and hides categories otherwise", () => {
  renderBar({ decision: "all" });
  expect(screen.getByRole("link", { name: "Needs your decision (5)" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Final result missing (3)" })).toBeTruthy();
  cleanup();
  renderBar({});
  expect(screen.queryByRole("link", { name: "Final result missing (3)" })).toBeNull();
});

it("says how many affected rows are shown and offers Clear filters", () => {
  renderBar({ decision: "all", language: "de", status: "open", q: "x", origin: "correction", translation_status: "accepted", page: "2" }, { ...counts, shown: 2 });
  expect(screen.getByText("2 of 5 shown", { exact: false })).toBeTruthy();
  const params = paramsOf(hrefOf("Clear filters"));
  for (const name of ["language", "status", "q", "origin", "translation_status", "page"]) expect(params.has(name)).toBe(false);
  expect(params.get("decision")).toBe("all");
});

it("omits the shown count without active filters or when every affected row is shown", () => {
  renderBar({ decision: "all" }, { ...counts, shown: 2 });
  expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  cleanup();
  renderBar({ language: "de" });
  expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
});

it("intercepts plain left clicks and navigates in-app", () => {
  const onNavigate = renderBar({ language: "de", page: "4" });
  const link = screen.getByRole("link", { name: "Needs your decision (5)" });
  const plain = fireEvent.click(link);
  expect(plain).toBe(false);
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", language: "de", decision: "all" });
  expect(onNavigate.mock.calls[0]).toHaveLength(1);
  onNavigate.mockClear();
  const modified = fireEvent.click(link, { ctrlKey: true });
  expect(modified).toBe(true);
  expect(onNavigate).not.toHaveBeenCalled();
});
