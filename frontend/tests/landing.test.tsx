import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type ProjectSummary, type TaskSummary } from "../src/api/client";
import { useEffect } from "react";
import { LAST_PROJECT_PREFIX } from "../src/app/lastProject";
import { testUser } from "./session";

// The Documents page has its own tests; here only the destination matters.
vi.mock("../src/admin/DocumentsPage", () => ({
  DocumentsPage: ({ projectKey, query }: { projectKey: string; query: { segment?: string } }) =>
    <h1>Documents of {projectKey}{query.segment ? ` (${query.segment})` : ""}</h1>,
}));

// The editor has its own tests; this stub only reports the task's project like CaseScreen does.
vi.mock("../src/tasks/TaskEditor", () => ({
  TaskEditor: ({ onProjectContext }: { onProjectContext?: (key: string) => void }) => {
    useEffect(() => { onProjectContext?.("p4"); }, []);
    return <h1>Task editor</h1>;
  },
}));

const project = (key: string, roles: ProjectSummary["roles"]): ProjectSummary => ({
  project_key: key, name: `Project ${key}`, description: null, roles, allowed_modes: ["independent"], document_count: 0,
  can_manage: roles.includes("lead"),
});
const openTask: TaskSummary = {
  assignment_id: 7, workflow_revision: 0, held: false, report_answered: false, waiting_for_translation_review: false, waiting_for_lead: false, project_key: "p1", project_name: "Project p1", document_id: "doc-7",
  case_id: "case-0101", language: "de", task: "annotate", status: "open", updated_at: "2026-10-20T10:00:00Z",
};
const lead = testUser("lead", { username: "lead", is_system_admin: false });

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "#/");
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "documentsSummary").mockResolvedValue({ needs_decision: 0 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); window.history.replaceState(null, "", "#/"); });

describe("last-used landing (F8, D4)", () => {
  const remember = (key: string, user = "lead") => window.localStorage.setItem(`${LAST_PROJECT_PREFIX}${user}`, key);

  it("sends a lead from #/ to Documents of the last-used project with replace", async () => {
    remember("p2");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"]), project("p2", ["lead"])]);
    const before = window.history.length;
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p2" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p2/documents");
    expect(window.history.length).toBe(before);
    expect(screen.queryByRole("heading", { name: "My tasks" })).toBeNull();
  });

  it("lands on Needs your decision when the count is > 0, on All when the summary fails", async () => {
    remember("p2");
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 3 });
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"]), project("p2", ["lead"])]);
    const before = window.history.length;
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p2 (decision)" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p2/documents?segment=decision");
    expect(window.history.length).toBe(before);
    expect(api.documentsSummary).toHaveBeenCalledWith("p2");
    cleanup();
    window.history.replaceState(null, "", "#/");
    vi.mocked(api.documentsSummary).mockRejectedValue(new Error("offline"));
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p2" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p2/documents");
  });

  it("sends an annotator to My tasks filtered to the last-used project", async () => {
    remember("p1");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["annotator"]), project("p2", ["lead"])]);
    const before = window.history.length;
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await waitFor(() => expect(window.location.hash).toBe("#/?project=p1"));
    expect(window.history.length).toBe(before);
    expect(api.documentsSummary).not.toHaveBeenCalledWith("p2");
  });

  it("shows the Projects page to a lead of any project when nothing is remembered", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue([project("a", ["annotator"]), project("b", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects");
    expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}lead`)).toBeNull();
  });

  it("shows the Projects page when the remembered project is no longer accessible", async () => {
    remember("gone");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects");
  });

  it.each([
    ["nothing is remembered", null, [project("a", ["annotator"]), project("b", ["adjudicator"])]],
    ["the remembered project is no longer accessible", "gone", [project("a", ["annotator"])]],
    ["there is no project", "gone", []],
  ])("stays on My tasks without a lead role when %s (#153)", async (_case, remembered, projects) => {
    if (remembered) remember(remembered);
    const list = vi.spyOn(api, "listProjects").mockResolvedValue(projects);
    const before = window.history.length;
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(window.location.hash).toBe("#/");
    expect(window.history.length).toBe(before);
  });

  it("lands on Documents even with own open tasks", async () => {
    remember("p1");
    vi.mocked(api.listMyTasks).mockResolvedValue([openTask]);
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p1" })).toBeDefined();
    await waitFor(() => expect(screen.getByRole("link", { name: "My tasks (1)" })).toBeDefined());
  });

  it("does not redirect a later in-app visit to My tasks", async () => {
    remember("p1");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    await screen.findByRole("heading", { name: "Documents of p1" });
    screen.getByRole("link", { name: /^My tasks/ }).click();
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    expect(window.location.hash).toBe("#/?status=all");
  });

  it.each(["#/projects/p1/progress", "#/me"])("does not redirect the deep link %s", async (hash) => {
    remember("p1");
    window.history.replaceState(null, "", hash);
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(window.location.hash).toBe(hash);
  });

  it("does not redirect #/?status=all", async () => {
    remember("p1");
    window.history.replaceState(null, "", "#/?status=all");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(window.location.hash).toBe("#/?status=all");
    expect(screen.queryByRole("heading", { name: "Documents of p1" })).toBeNull();
  });

  it.each(["#/?foo=1", "#/?status=bogus"])("does not redirect the explicit visit %s", async (hash) => {
    remember("p1");
    window.history.replaceState(null, "", hash);
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await act(async () => { await Promise.resolve(); });
    expect(window.location.hash).toBe(hash);
  });

  it.each([["lead", "p1"], ["annotator", "p1"], ["lead", "gone"]] as const)(
    "keeps a native Back started while the projects load (%s, remembered %s)", async (role, remembered) => {
      remember(remembered);
      window.history.replaceState({ ontotatorRouteIndex: 0 }, "", "#/me");
      window.history.pushState({ ontotatorRouteIndex: 1 }, "", "#/");
      let resolveProjects: (projects: ProjectSummary[]) => void = () => {};
      vi.spyOn(api, "listProjects").mockReturnValue(new Promise(resolve => { resolveProjects = resolve; }));
      render(<App user={lead} />);
      await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
      await act(async () => {
        window.history.back();
        await new Promise(resolve => setTimeout(resolve, 0));
        resolveProjects([project("p1", [role])]);
      });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(window.location.hash).toBe("#/me");
      expect(screen.getByRole("heading", { level: 1, name: /profile/i })).toBeDefined();
    });

  it("shows only the error on the Projects page when the projects fail to load", async () => {
    window.history.replaceState(null, "", "#/projects");
    vi.spyOn(api, "listProjects").mockRejectedValue(new Error("offline"));
    render(<App user={lead} />);
    expect(await screen.findByRole("button", { name: "Retry projects" })).toBeDefined();
    expect(screen.queryByText("Loading your projects…")).toBeNull();
  });

  it("remembers a filtered My tasks visit without redirecting it", async () => {
    window.history.replaceState(null, "", "#/?project=p3");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p3", ["annotator"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await waitFor(() => expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}lead`)).toBe("p3"));
    expect(window.location.hash).toBe("#/?project=p3");
  });

  it("opening a task remembers its project", async () => {
    window.history.replaceState(null, "", "#/tasks/7");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p4", ["annotator"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Task editor" })).toBeDefined();
    await waitFor(() => expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}lead`)).toBe("p4"));
    cleanup();
    window.history.replaceState(null, "", "#/");
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await waitFor(() => expect(window.location.hash).toBe("#/?project=p4"));
  });
});

describe("project list freshness (#192)", () => {
  it("reloads the projects on navigation to My tasks or Projects, keeping the shown list meanwhile", async () => {
    window.history.replaceState(null, "", "#/me");
    const projects = vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["annotator"])]);
    render(<App user={lead} />);
    await waitFor(() => expect(projects).toHaveBeenCalledTimes(1));
    projects.mockResolvedValue([project("p1", ["annotator"]), project("p2", ["annotator"])]);
    fireEvent.click(await screen.findByRole("link", { name: "Projects" }));
    expect(await screen.findByText("Project p2")).toBeDefined();
    expect(projects).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("link", { name: /^My tasks/ }));
    await waitFor(() => expect(projects).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("Loading your projects…")).toBeNull();
  });
});
