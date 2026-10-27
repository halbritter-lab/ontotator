import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../src/api/client";
import { ProjectSwitcher, projectDestination } from "../src/app/ProjectPicker";
import { routeHref, type Route } from "../src/app/router";
import { Dialog } from "../src/ui";

const project = (key: string, name = key, can_manage = true): ProjectSummary => ({
  project_key: key, name, description: null, roles: can_manage ? ["lead"] : ["annotator"], allowed_modes: [], document_count: 0, can_manage,
});
const projects = [project("first", "First study"), project("reader", "Reader study", false), project("third", "Third study")];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Props = Parameters<typeof ProjectSwitcher>[0];
const setup = (extra: Partial<Props> = {}) => {
  const props: Props = { projects, current: projects[0], route: { name: "projectDocuments", key: "first" } as Route, onNavigate: vi.fn(), onChoose: vi.fn(), ...extra };
  const view = render(<><nav aria-label="Sections"><ProjectSwitcher {...props} /></nav><button>Outside</button><input aria-label="Elsewhere" /></>);
  const trigger = screen.getByRole("button", { name: /switch project$|^Choose project$/ });
  return { props, view, trigger };
};
const open = async (trigger: HTMLElement) => {
  await userEvent.setup().click(trigger);
  return { dialog: screen.getByRole("dialog", { name: "Switch project" }), field: screen.getByRole("combobox", { name: "Find project" }) };
};
const options = () => within(screen.getByRole("listbox", { name: "Projects" })).getAllByRole("option");

it("is a two-line button with the project and its accessible name", () => {
  const { trigger } = setup();
  expect(trigger.getAttribute("aria-label")).toBe("Project: First study, switch project");
  expect(trigger.querySelector(".project-switcher__label")?.textContent).toBe("Project");
  expect(trigger.querySelector(".project-switcher__name")?.textContent).toBe("First study");
  // The name is clamped to two lines in CSS; the title keeps the full name.
  expect(trigger.querySelector(".project-switcher__name")?.getAttribute("title")).toBe("First study");
  expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Alt+P");
  expect(trigger.classList.contains("project-switcher")).toBe(true);
});

it("reads Choose project without a current project", () => {
  setup({ current: undefined, route: { name: "tasks" } });
  expect(screen.getByRole("button", { name: "Choose project" }).querySelector(".project-switcher__name")?.textContent).toBe("Choose project");
});

it("opens a dialog with a focused combobox controlling the Projects listbox", async () => {
  const { trigger } = setup();
  const { dialog, field } = await open(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  // aria-haspopup + aria-expanded describe the popup; no aria-controls at an inner element.
  expect(trigger.hasAttribute("aria-controls")).toBe(false);
  expect(dialog.hasAttribute("aria-modal")).toBe(false);
  expect(document.activeElement).toBe(field);
  expect(field.getAttribute("aria-autocomplete")).toBe("list");
  expect(field.getAttribute("aria-expanded")).toBe("true");
  const listbox = screen.getByRole("listbox", { name: "Projects" });
  expect(field.getAttribute("aria-controls")).toBe(listbox.id);
  expect(field.getAttribute("aria-activedescendant")).toBe(options()[0].id);
  expect(options()[0].getAttribute("aria-selected")).toBe("true");
  expect(options()[1].getAttribute("aria-selected")).toBe("false");
});

it("shows name, key, roles and destination, the current one marked, each with a real link", async () => {
  const { trigger } = setup();
  await open(trigger);
  const [first, reader] = options();
  expect(first.textContent).toContain("First study");
  expect(first.textContent).toContain("first, Lead, opens Documents");
  expect(first.textContent).toContain("Current");
  expect(first.querySelector("svg")).not.toBeNull();
  expect(reader.textContent).toContain("reader, Annotator, opens My tasks");
  expect(reader.textContent).not.toContain("Current");
  const link = within(reader).getByRole("link");
  expect(link.getAttribute("href")).toBe(routeHref({ name: "tasks", project: "reader" }));
  expect(link.getAttribute("tabindex")).toBe("-1");
  const all = within(screen.getByRole("dialog")).getByRole("link", { name: "All projects" });
  expect(all.getAttribute("href")).toBe("#/projects");
  expect(screen.getByRole("dialog").querySelector("hr")).not.toBeNull();
});

it.each([3, 9])("filters by name and key, case-insensitively, with %i projects", async (count) => {
  const many = Array.from({ length: count }, (_, n) => project(`key-${n}`, `Study ${n}`));
  const { trigger } = setup({ projects: many, current: undefined, route: { name: "tasks" } });
  const { field } = await open(trigger);
  // The live region is mounted before its text appears, so the change is announced.
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");
  const user = userEvent.setup();
  await user.type(field, "STUDY 2");
  expect(options().map(option => option.textContent)).toEqual([expect.stringContaining("Study 2")]);
  await user.clear(field);
  await user.type(field, "KEY-1");
  expect(options()).toHaveLength(1);
  await user.type(field, "zzz");
  expect(screen.getByRole("status")).toBe(status);
  expect(status.textContent).toBe("No matching projects.");
});

it("moves the active option with arrows without navigating, Enter opens it and closes", async () => {
  const { props, trigger } = setup();
  const { field } = await open(trigger);
  const user = userEvent.setup();
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
  expect(field.getAttribute("aria-activedescendant")).toBe(options()[1].id);
  expect(props.onNavigate).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(props.onChoose).toHaveBeenCalledWith("reader");
  expect(props.onNavigate).toHaveBeenCalledWith(projectDestination(projects[1]));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([{ ctrlKey: true }, { metaKey: true }])("opens the active project in a new tab with %j + Enter", async (modifier) => {
  const opened = vi.fn();
  vi.stubGlobal("open", opened);
  const { props, trigger } = setup();
  const { field } = await open(trigger);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "Enter", ...modifier });
  expect(opened).toHaveBeenCalledWith(routeHref({ name: "tasks", project: "reader" }), "_blank", "noopener");
  expect(props.onNavigate).not.toHaveBeenCalled();
});

it("navigates on a plain option click and keeps browser behaviour for modified clicks", async () => {
  const { props, trigger } = setup();
  await open(trigger);
  const link = within(options()[2]).getByRole("link");
  const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  let prevented: boolean | undefined;
  document.addEventListener("click", event => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
  fireEvent(link, modified);
  expect(prevented).toBe(false);
  expect(props.onNavigate).not.toHaveBeenCalled();
  fireEvent.click(link);
  expect(props.onChoose).toHaveBeenCalledWith("third");
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "third" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("All projects navigates to the Projects page", async () => {
  const { props, trigger } = setup();
  await open(trigger);
  fireEvent.click(screen.getByRole("link", { name: "All projects" }));
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "projects" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes on Escape and focuses the button", async () => {
  const { trigger } = setup();
  await open(trigger);
  await userEvent.setup().keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("closes on an outside pointer down, on Tab out and on a route change", async () => {
  const { props, view, trigger } = setup();
  await open(trigger);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const { field } = await open(trigger);
  const all = screen.getByRole("link", { name: "All projects" });
  all.focus();
  fireEvent.keyDown(all, { key: "Tab" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await open(trigger);
  expect(field).toBeDefined();
  view.rerender(<><nav aria-label="Sections"><ProjectSwitcher {...props} route={{ name: "projectSettings", key: "first" }} /></nav><button>Outside</button><input aria-label="Elsewhere" /></>);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([
  { key: "p", code: "KeyP" },
  { key: "π", code: "KeyP" },
  { key: "P", code: "KeyP" },
])("Alt+P opens it from anywhere, also from a text field (%j)", ({ key, code }) => {
  setup();
  const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
  elsewhere.focus();
  act(() => { fireEvent.keyDown(elsewhere, { key, code, altKey: true }); });
  expect(screen.getByRole("dialog", { name: "Switch project" })).toBeDefined();
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Find project" }));
});

it("Alt+P does nothing while a modal dialog is open", () => {
  render(<><ProjectSwitcher projects={projects} route={{ name: "tasks" }} onNavigate={vi.fn()} onChoose={vi.fn()} />
    <Dialog open title="Busy" onClose={vi.fn()}>Modal content</Dialog></>);
  act(() => { fireEvent.keyDown(document.body, { key: "p", code: "KeyP", altKey: true }); });
  expect(screen.queryByRole("dialog", { name: "Switch project" })).toBeNull();
});

it("Alt+P first opens a closed Sections disclosure in the reading shell", () => {
  render(<details><summary>Sections</summary><nav aria-label="Sections">
    <ProjectSwitcher projects={projects} current={projects[0]} route={{ name: "task", assignmentId: 1 }} onNavigate={vi.fn()} onChoose={vi.fn()} />
  </nav></details>);
  const details = document.querySelector("details")!;
  expect(details.open).toBe(false);
  act(() => { fireEvent.keyDown(document.body, { key: "p", code: "KeyP", altKey: true }); });
  expect(details.open).toBe(true);
  expect(screen.getByRole("dialog", { name: "Switch project" })).toBeDefined();
});

it("keeps projectDestination: leads open Documents, others My tasks", () => {
  expect(projectDestination(projects[0])).toEqual({ name: "projectDocuments", key: "first" });
  expect(projectDestination(projects[1])).toEqual({ name: "tasks", project: "reader" });
});
