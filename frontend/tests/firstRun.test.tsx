import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen } from "../src/app/CaseScreen";
import { loggedInAs } from "./session";
import { assigned, assignedList } from "./assignments";

const view = () => ({
  document: { document_id: "doc-2", text: "Patient has seizures.", language: "en", text_sha256: "x" },
  key: { project_key: "pkg", document_id: "doc-2", annotator_id: "JPL", mode: "independent" as const, scope_id: "s", target_set_id: "t" },
  scope: { scope_id: "s", mode: "independent" as const, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
  draft: { schema_version: "ontocurator-draft/v3" as const, revision: 7, annotations: [], decisions: [] },
  layers: [{ layer_id: "phenotype", label: "Phenotype", access: "editable" as const, default_visible: true, default_type_id: "default", annotation_types: [] }],
}) as any;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("editor and page polish", () => {
  it("editor_shell_routes_logout_through_the_leave_guard", async () => {
    loggedInAs("JPL");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg" }] as any);
    assignedList(view());
    vi.spyOn(api, "listOntologies").mockResolvedValue([]);
    vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: view() }));
    const onLogout = vi.fn();
    render(<App onLogout={onLogout} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/i }));
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
