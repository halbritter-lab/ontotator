import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Tabs, tabId } from "../../src/ui/Tabs";

afterEach(cleanup);
const tabs = [
  { id: "decision", label: "Needs your decision", count: 3, href: "#/d?tab=decision", emphasised: true },
  { id: "assign", label: "To assign", count: 2, href: "#/d?tab=assign" },
  { id: "progress", label: "In progress", count: 4, href: "#/d?tab=progress" },
  { id: "all", label: "All", count: 14, href: "#/d?tab=all" },
];
const renderTabs = (onSelect = vi.fn(), active = "assign") => {
  render(<><Tabs label="Documents views" tabs={tabs} active={active} panelId="documents-panel" onSelect={onSelect} />
    <div id="documents-panel" role="tabpanel" aria-labelledby={tabId("documents-panel", active)}>Table</div></>);
  return onSelect;
};
const tab = (name: string) => screen.getByRole("tab", { name });

it("renders a labelled tablist of link tabs controlling the panel", () => {
  renderTabs();
  expect(screen.getByRole("tablist", { name: "Documents views" })).not.toBeNull();
  const assign = tab("To assign, 2");
  expect(assign.tagName).toBe("A");
  expect(assign.getAttribute("href")).toBe("#/d?tab=assign");
  expect(assign.getAttribute("aria-selected")).toBe("true");
  expect(assign.getAttribute("aria-controls")).toBe("documents-panel");
  expect(assign.getAttribute("tabindex")).toBe("0");
  expect(tab("All, 14").getAttribute("aria-selected")).toBe("false");
  expect(tab("All, 14").getAttribute("tabindex")).toBe("-1");
  expect(screen.getByRole("tabpanel", { name: "To assign, 2" })).not.toBeNull();
});

it("arrows move focus, Enter activates, Home/End", () => {
  const onSelect = renderTabs();
  tab("To assign, 2").focus();
  fireEvent.keyDown(tab("To assign, 2"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(tab("In progress, 4"));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(tab("All, 14"));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(tab("Needs your decision, 3"));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(tab("All, 14"));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(tab("Needs your decision, 3"));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(onSelect).toHaveBeenLastCalledWith("decision");
  fireEvent.keyDown(tab("In progress, 4"), { key: " " });
  expect(onSelect).toHaveBeenLastCalledWith("progress");
});

it("a plain click selects; a modified click keeps the native link", () => {
  const onSelect = renderTabs();
  expect(fireEvent.click(tab("All, 14"))).toBe(false);
  expect(onSelect).toHaveBeenLastCalledWith("all");
  onSelect.mockClear();
  expect(fireEvent.click(tab("All, 14"), { ctrlKey: true })).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
});

it("accessible name 'Needs your decision, 3'", () => {
  renderTabs();
  const decision = tab("Needs your decision, 3");
  expect(decision.textContent).toBe("Needs your decision3");
  expect(decision.querySelector(".ui-tab-count")?.getAttribute("aria-hidden")).toBe("true");
});

it("emphasised count pill", () => {
  renderTabs();
  expect(tab("Needs your decision, 3").querySelector(".ui-tab-count")?.className).toBe("ui-tab-count ui-tab-count--emphasised");
  expect(tab("To assign, 2").querySelector(".ui-tab-count")?.className).toBe("ui-tab-count");
});
