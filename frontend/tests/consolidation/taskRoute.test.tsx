import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type WorkRoundView } from "../../src/api/client";
import { parseRoute, routeHref } from "../../src/app/router";
import { TaskEditor } from "../../src/tasks/TaskEditor";
import { assigned, workspaceFixture } from "../assignments";
import { exampleView } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("task route view", () => {
  it("round-trips view=editor and leaves the plain task route unchanged", () => {
    expect(routeHref({ name: "task", assignmentId: 42, view: "editor" })).toBe("#/tasks/42?view=editor");
    expect(parseRoute("#/tasks/42?view=editor")).toEqual({ name: "task", assignmentId: 42, view: "editor" });
    expect(routeHref({ name: "task", assignmentId: 42 })).toBe("#/tasks/42");
    expect(parseRoute("#/tasks/42")).toEqual({ name: "task", assignmentId: 42 });
    expect(parseRoute("#/tasks/42?view=other")).toEqual({ name: "task", assignmentId: 42 });
  });

  it("round-trips the documents query of a consolidation route", () => {
    const route = { name: "projectConsolidation" as const, key: "p", roundId: "r-9", group: "g-1", documents: { panel: "case-1:de", stage: "final" } };
    expect(parseRoute(routeHref(route))).toEqual(route);
    expect(parseRoute("#/projects/p/consolidations/r-9")).toEqual({ name: "projectConsolidation", key: "p", roundId: "r-9" });
  });
});

const round: WorkRoundView = { round_id: "round-c", project_key: "pkg", assignment_id: 1, document_id: "doc", annotator_id: "alice", kind: "consolidation",
  mode: "review", state: "editable", workflow_revision: 3, input_manifest_sha256: "manifest", input_submission_ids: ["s1", "s2"], active: true, submission_count: 0, input_count: 2 };

function mockTask(assignment: Record<string, unknown> = {}) {
  const opened = assigned(workspaceFixture());
  Object.assign(opened.assignment, assignment);
  opened.view.key = { ...opened.view.key, round_id: "round-c" };
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(opened.assignment);
  vi.spyOn(api, "openAssignment").mockResolvedValue(opened);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "resolveTermLabels").mockResolvedValue([]);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} } as never);
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listGuidelines").mockResolvedValue([] as never);
  vi.spyOn(api, "listWorkRounds").mockResolvedValue([round]);
  vi.spyOn(api, "listRoundInputs").mockResolvedValue([]);
  vi.spyOn(api, "getConsolidation").mockResolvedValue(exampleView());
}

const user = { username: "alice", display_name: "Alice", pseudonym: "alice", is_system_admin: false, csrf_token: "csrf" };

describe("TaskEditor switch", () => {
  it("opens the consolidation view for an active consolidation round", async () => {
    mockTask();
    render(<TaskEditor assignmentId={1} user={user} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    expect(await screen.findByRole("heading", { name: "Consolidate case-107 de v2" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Open in full editor" })).toBeTruthy();
  });

  it("offers the guidelines and Report a text problem in the consolidation view", async () => {
    mockTask({ guideline: { version: 2 } });
    render(<TaskEditor assignmentId={1} user={user} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    await screen.findByRole("heading", { name: "Consolidate case-107 de v2" });
    expect(screen.getByRole("button", { name: /^Guidelines v2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Report a text problem/ })).toBeTruthy();
  });

  it("opens the editor with view=editor", async () => {
    mockTask();
    render(<TaskEditor assignmentId={1} user={user} view="editor" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    expect(await screen.findByText("Consolidate", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Consolidate / })).toBeNull();
  });
});
