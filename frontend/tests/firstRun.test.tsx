import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ProjectSummary } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { loggedInAs } from "./session";
import { assigned, assignedList, workspaceFixture } from "./assignments";

const view = (): WorkspaceView => {
  const fixture = workspaceFixture("doc-2").view;
  const key = { ...fixture.key, annotator_id: "JPL", target_set_id: "t" };
  const targets = { ...fixture.targets, target_set_id: "t" };
  return {
    ...fixture, key, targets,
    document: { ...fixture.document, text_sha256: "x" },
    draft: { ...fixture.draft, key, targets, revision: 7 },
    layers: fixture.layers?.filter(layer => layer.layer_id === "phenotype"),
  };
};
const project: ProjectSummary = {
  project_key: "pkg", name: "First run project", description: null,
  roles: ["annotator"], allowed_modes: ["independent"],
  document_count: 1, can_manage: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("editor and page polish", () => {
  it("editor_shell_routes_logout_through_the_leave_guard", async () => {
    loggedInAs("JPL");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listProjects").mockResolvedValue([project]);
    assignedList(view());
    vi.spyOn(api, "listOntologies").mockResolvedValue([]);
    vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: view() }));
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: view() }).assignment);
    const onLogout = vi.fn();
    render(<App onLogout={onLogout} />);
    fireEvent.click(await screen.findByRole("link", { name: /^(Start|Continue|View)$/ }));
    await screen.findByRole("group", { name: "Case" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows 'Saved' without the revision number (revision in the tooltip)", () => {
    render(<CaseScreen view={view()} workspaceId="ws" onClose={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Saved/);
    expect(status.textContent).not.toMatch(/Rev/);
    expect(status.getAttribute("title")).toMatch(/7/);
  });

  it("declares an inline favicon and English page language", () => {
    const html = readFileSync(resolve(__dirname, "../index.html"), "utf-8");
    expect(html).toMatch(/<link rel="icon"[^>]*href="data:image\/svg\+xml/);
    expect(html).toMatch(/<html lang="en">/);
  });
});
