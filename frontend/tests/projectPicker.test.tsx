import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../src/api/client";
import { ProjectPicker } from "../src/app/ProjectPicker";
import { routeHref, type Route } from "../src/app/router";

const project = (key: string, name = key, can_manage = true): ProjectSummary => ({
  project_key: key, name, description: null, roles: [], allowed_modes: [], document_count: 0, can_manage,
});
const projects = [project("first", "First study"), project("reader", "reader", false)];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const setup = (extra: Partial<Parameters<typeof ProjectPicker>[0]> = {}) => {
  const props = { projects, current: projects[0], route: { name: "projectDocuments", key: "first" } as Route, onNavigate: vi.fn(), onChoose: vi.fn(), ...extra };
  const view = render(<><ProjectPicker {...props} /><button>Outside</button></>);
  const trigger = screen.getByRole("button", { name: "Current project: First study" });
  const panel = view.container.querySelector<HTMLElement>("#shell-project-panel")!;
  return { props, view, trigger, panel };
};

it("is a closed disclosure with the visible project name", () => {
  const { trigger, panel } = setup();
  expect(trigger.textContent).toContain("Project: First study");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-controls")).toBe("shell-project-panel");
  expect(panel.hidden).toBe(true);
});

it("reads Choose project without a current project", () => {
  render(<ProjectPicker projects={projects} route={{ name: "tasks" }} onNavigate={vi.fn()} onChoose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Choose project" }).textContent).toContain("Choose project");
});

it("lists projects as links with destinations, keys and a visible current marker", () => {
  const { trigger, panel } = setup();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(panel.hidden).toBe(false);
  const list = within(panel).getByRole("list", { name: "Projects" });
  const [first, reader] = within(list).getAllByRole("link");
  expect(first.getAttribute("href")).toBe("#/projects/first/documents");
  expect(first.getAttribute("aria-current")).toBe("true");
  expect(first.textContent).toContain("first · opens Documents");
  expect(first.textContent).toContain("Current");
  expect(reader.getAttribute("href")).toBe(routeHref({ name: "tasks", project: "reader" }));
  expect(reader.textContent).toContain("opens My tasks");
  expect(reader.textContent).not.toContain("reader · ");
  expect(reader.hasAttribute("aria-current")).toBe(false);
  expect(within(panel).queryByRole("searchbox")).toBeNull();
});

it("navigates on a plain click, closes and returns focus to the trigger", () => {
  const { props, trigger, panel } = setup();
  fireEvent.click(trigger);
  fireEvent.click(within(panel).getAllByRole("link")[1]);
  expect(props.onChoose).toHaveBeenCalledWith("reader");
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "reader" });
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

it("keeps browser behaviour and the panel for modified clicks", () => {
  const { props, trigger, panel } = setup();
  fireEvent.click(trigger);
  fireEvent.click(within(panel).getAllByRole("link")[1], { ctrlKey: true });
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(panel.hidden).toBe(false);
});

it("never navigates on arrow keys", () => {
  const { props, trigger, panel } = setup();
  fireEvent.click(trigger);
  const link = within(panel).getAllByRole("link")[1];
  link.focus();
  fireEvent.keyDown(link, { key: "ArrowDown" });
  fireEvent.keyDown(link, { key: "ArrowUp" });
  expect(props.onNavigate).not.toHaveBeenCalled();
});

it("closes on Escape, refocuses the trigger and stops the key from reaching window shortcuts", () => {
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  try {
    const { trigger, panel } = setup();
    fireEvent.click(trigger);
    const link = within(panel).getAllByRole("link")[0];
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(shortcut).not.toHaveBeenCalled();
  } finally { window.removeEventListener("keydown", shortcut); }
});

it("closes on outside pointer down without moving focus", () => {
  const { trigger, panel } = setup();
  fireEvent.click(trigger);
  trigger.focus();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

it("closes when focus leaves the picker", () => {
  const { trigger, panel } = setup();
  fireEvent.click(trigger);
  const link = within(panel).getAllByRole("link")[1];
  fireEvent.blur(link, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
  expect(panel.hidden).toBe(true);
});

it("closes on route change", () => {
  const { props, view, trigger, panel } = setup();
  fireEvent.click(trigger);
  view.rerender(<><ProjectPicker {...props} route={{ name: "projectSettings", key: "first" }} /><button>Outside</button></>);
  expect(panel.hidden).toBe(true);
});

it("shows and focuses a search field only above six projects", () => {
  const many = Array.from({ length: 7 }, (_, n) => project(`p${n}`, `Study ${n}`));
  const view = render(<ProjectPicker projects={many} route={{ name: "tasks" }} onNavigate={vi.fn()} onChoose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose project" }));
  const search = screen.getByRole("searchbox", { name: "Find project" });
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: "study 3" } });
  expect(within(view.container.querySelector<HTMLElement>("#shell-project-panel")!).getAllByRole("link")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(screen.getByRole("status").textContent).toBe("No matching projects.");
});
