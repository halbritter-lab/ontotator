import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type ProjectSummary, type TaskSummary } from "../src/api/client";
import { ProjectsPage } from "../src/app/ProjectsPage";

const project = (key: string, roles: ProjectSummary["roles"], name = `Project ${key}`): ProjectSummary => ({
  project_key: key, name, description: null, roles, allowed_modes: ["independent"], document_count: 0, can_manage: roles.includes("lead"),
});
const task = (id: number, project_key: string, status: TaskSummary["status"]): TaskSummary => ({
  assignment_id: id, workflow_revision: 0, held: false, project_key, project_name: project_key, document_id: `doc-${id}`,
  case_id: `case-${id}`, language: "de", task: "annotate", status, updated_at: "2026-10-20T10:00:00Z",
});
const projects = [project("p1", ["lead", "annotator"]), project("p2", ["annotator"]), project("p3", ["lead"], "p3")];

beforeEach(() => {
  vi.spyOn(api, "listMyTasks").mockResolvedValue([task(1, "p1", "open"), task(2, "p1", "submitted"), task(3, "p2", "in_progress"), task(4, "p2", "reopened")]);
  vi.spyOn(api, "documentsSummary").mockImplementation(async key => {
    if (key === "p3") throw new Error("offline");
    return { needs_decision: 4 };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rowOf = (name: string) => screen.getAllByRole("row").find(row => row.querySelector("th, td")?.textContent?.includes(name))!;
const cells = (row: HTMLElement) => [...row.querySelectorAll("th, td")];

it("lists every project with roles, decisions, open tasks and actions", async () => {
  const onNavigate = vi.fn();
  render(<ProjectsPage projects={projects} currentKey="p2" onNavigate={onNavigate} />);
  expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeDefined();
  expect(screen.queryByRole("searchbox", { name: "Find project" })).toBeNull();
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").map(header => header.textContent))
    .toEqual(["Project", "Your roles", "Needs your decision", "Your open tasks", "Action"]);
  // While loading the counts read "–".
  expect(cells(rowOf("Project p1"))[2].textContent).toBe("–");
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  const [name1, roles1, decision1, open1, action1] = cells(rowOf("Project p1"));
  expect(name1.textContent).toContain("p1");
  expect(roles1.textContent).toBe("Lead, Annotator");
  expect(decision1.textContent).toContain("4 documents need your decision");
  expect(open1.textContent).toBe("1");
  expect(within(action1 as HTMLElement).getByRole("link", { name: "Open" }).getAttribute("href")).toBe("#/projects/p1/documents");
  expect(within(action1 as HTMLElement).getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("#/projects/p1/settings");

  const p2 = rowOf("Project p2");
  expect(p2.getAttribute("aria-current")).toBe("true");
  expect(cells(p2)[0].textContent).toContain("Current");
  expect(cells(p2)[2].textContent).toBe("–");
  expect(cells(p2)[3].textContent).toBe("2");
  expect(within(cells(p2)[4] as HTMLElement).getByRole("link", { name: "Open" }).getAttribute("href")).toBe("#/?project=p2");
  expect(within(cells(p2)[4] as HTMLElement).queryByRole("link", { name: "Settings" })).toBeNull();
  expect(rowOf("Project p1").hasAttribute("aria-current")).toBe(false);

  // A failed summary shows "–"; the key line is hidden when it equals the name.
  const p3 = rowOf("p3");
  expect(cells(p3)[2].textContent).toBe("–");
  expect(cells(p3)[0].querySelector(".cell-secondary")).toBeNull();
  expect(cells(rowOf("Project p1"))[0].querySelector(".cell-secondary")?.textContent).toBe("p1");
  // Only led projects load a summary, once each.
  expect(vi.mocked(api.documentsSummary).mock.calls.map(call => call[0]).sort()).toEqual(["p1", "p3"]);
  expect(api.listMyTasks).toHaveBeenCalledTimes(1);

  fireEvent.click(within(action1 as HTMLElement).getByRole("link", { name: "Open" }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p1" });
});

it("keeps browser behaviour for modified clicks", () => {
  const onNavigate = vi.fn();
  render(<ProjectsPage projects={projects} onNavigate={onNavigate} />);
  const link = within(cells(rowOf("Project p2"))[4] as HTMLElement).getByRole("link", { name: "Open" });
  let prevented: boolean | undefined;
  document.addEventListener("click", event => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
  fireEvent.click(link, { ctrlKey: true });
  expect(prevented).toBe(false);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("shows Find project only above six projects and filters by name and key", () => {
  const many = Array.from({ length: 7 }, (_, n) => project(`key-${n}`, ["annotator"], `Study ${n}`));
  render(<ProjectsPage projects={many} onNavigate={vi.fn()} />);
  const search = screen.getByRole("searchbox", { name: "Find project" });
  fireEvent.change(search, { target: { value: "STUDY 3" } });
  expect(screen.getAllByRole("row")).toHaveLength(2);
  fireEvent.change(search, { target: { value: "key-5" } });
  expect(rowOf("Study 5")).toBeDefined();
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(screen.getByText("No matching projects.")).toBeDefined();
});

it("says so when the user has no project", () => {
  render(<ProjectsPage projects={[]} onNavigate={vi.fn()} />);
  expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeDefined();
  expect(screen.getByText("You are not a member of any project yet.")).toBeDefined();
  expect(screen.queryByRole("table")).toBeNull();
  expect(api.listMyTasks).not.toHaveBeenCalled();
});

it("scopes the forced-colours card border to the narrow card layout", () => {
  const css = readFileSync(resolve(__dirname, "../src/styles/screens/projects.css"), "utf8");
  const start = css.indexOf("@media (forced-colors: active) {");
  const wide = css.slice(start, css.indexOf("@media", start + 1));
  expect(wide).not.toContain(".projects-table tbody tr {");
  expect(css).toMatch(/@media \(forced-colors: active\) and \(max-width: 699px\)\s*\{\s*\.projects-table tbody tr \{ border-color: CanvasText; \}/);
});
