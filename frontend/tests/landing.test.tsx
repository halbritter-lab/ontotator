import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type ProjectSummary, type TaskSummary } from "../src/api/client";
import { LAST_PROJECT_PREFIX, landingProject, rememberProject, rememberedProject } from "../src/app/lastProject";
import { testUser } from "./session";

// The Documents page has its own tests; here only the destination matters.
vi.mock("../src/admin/DocumentsPage", () => ({
  DocumentsPage: ({ projectKey, query }: { projectKey: string; query: { segment?: string } }) =>
    <h1>Documents of {projectKey}{query.segment ? ` (${query.segment})` : ""}</h1>,
}));

const project = (key: string, roles: ProjectSummary["roles"]): ProjectSummary => ({
  project_key: key, name: `Project ${key}`, description: null, roles, allowed_modes: ["independent"], document_count: 0,
  can_manage: roles.includes("lead"),
});
const openTask: TaskSummary = {
  assignment_id: 7, workflow_revision: 0, held: false, project_key: "p1", project_name: "Project p1", document_id: "doc-7",
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

describe("landing (D7)", () => {
  it("sends a lead from #/ to Documents of the last opened project with replace", async () => {
    window.localStorage.setItem("ontocurator.lastProject.v1:lead", "p2");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"]), project("p2", ["lead"])]);
    const before = window.history.length;
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p2" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p2/documents");
    expect(window.history.length).toBe(before);
    expect(screen.queryByRole("heading", { name: "My tasks" })).toBeNull();
  });

  it("lands on Needs your decision when the count is > 0", async () => {
    window.localStorage.setItem("ontocurator.lastProject.v1:lead", "p2");
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 3 });
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"]), project("p2", ["lead"])]);
    const before = window.history.length;
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p2 (decision)" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p2/documents?segment=decision");
    expect(window.history.length).toBe(before);
    expect(api.documentsSummary).toHaveBeenCalledWith("p2");
  });

  it("lands on All otherwise", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p1" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p1/documents");
    expect(api.documentsSummary).toHaveBeenCalledWith("p1");
    // A failed summary also lands on All.
    cleanup();
    window.history.replaceState(null, "", "#/");
    vi.mocked(api.documentsSummary).mockRejectedValue(new Error("offline"));
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p1" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p1/documents");
  });

  it("skips a remembered project the user no longer leads", async () => {
    window.localStorage.setItem("ontocurator.lastProject.v1:lead", "p2");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"]), project("p2", ["annotator"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p1" })).toBeDefined();
    expect(window.location.hash).toBe("#/projects/p1/documents");
  });

  it("falls back to the first led project", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue([project("a", ["annotator"]), project("b", ["lead"]), project("c", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of b" })).toBeDefined();
    // The landing project is remembered like any other opened project.
    await waitFor(() => expect(window.localStorage.getItem("ontocurator.lastProject.v1:lead")).toBe("b"));
  });

  it("keeps users who lead nothing on My tasks", async () => {
    window.localStorage.setItem("ontocurator.lastProject.v1:lead", "a");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("a", ["annotator"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    expect(window.location.hash).toBe("#/");
  });

  it("lands on Documents even with own open tasks", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([openTask]);
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "Documents of p1" })).toBeDefined();
    await waitFor(() => expect(screen.getByRole("link", { name: "My tasks (1)" })).toBeDefined());
  });

  it("does not redirect a later in-app visit to My tasks", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    await screen.findByRole("heading", { name: "Documents of p1" });
    screen.getByRole("link", { name: /^My tasks/ }).click();
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    expect(window.location.hash).toBe("#/");
  });

  it("does not redirect deep links or a filtered My tasks", async () => {
    window.history.replaceState(null, "", "#/?project=p1");
    vi.spyOn(api, "listProjects").mockResolvedValue([project("p1", ["lead"])]);
    render(<App user={lead} />);
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeDefined();
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    expect(window.location.hash).toBe("#/?project=p1");
  });
});

describe("last project storage", () => {
  it("is per user and skips projects the user no longer leads", () => {
    rememberProject("ana", "x");
    rememberProject("ben", "y");
    expect(rememberedProject("ana")).toBe("x");
    expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}ben`)).toBe("y");
    expect(landingProject("ana", [project("w", ["lead"]), project("x", ["lead"])])).toBe("x");
    expect(landingProject("ana", [project("w", ["lead"]), project("x", ["annotator"])])).toBe("w");
    expect(landingProject("ana", [project("x", ["annotator"])])).toBeUndefined();
  });

  it("survives unavailable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => rememberProject("ana", "x")).not.toThrow();
    expect(rememberedProject("ana")).toBeNull();
    expect(landingProject("ana", [project("w", ["lead"])])).toBe("w");
  });
});
