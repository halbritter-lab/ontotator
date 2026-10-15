import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen } from "../src/app/CaseScreen";
import { loggedInAs } from "./session";

const docs = [
  { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "completed" as const },
  { document_id: "doc-2", text_length: 10, language: "en", position: 2, status: "in_progress" as const },
];

const view = () => ({
  document: { document_id: "doc-2", text: "Patient has seizures.", language: "en", text_sha256: "x" },
  key: { package_id: "pkg", document_id: "doc-2", annotator_id: "JPL", mode: "independent" as const, scope_id: "s", target_set_id: "t" },
  scope: { scope_id: "s", mode: "independent" as const, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
  draft: { schema_version: "ontocurator-draft/v3" as const, revision: 7, annotations: [], decisions: [] },
  layers: [{ layer_id: "phenotype", label: "Phenotype", access: "editable" as const, default_visible: true, default_type_id: "default", annotation_types: [] }],
}) as any;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard: guided first run", () => {
  it("uses real buttons for adding ontologies and importing packages", async () => {
    loggedInAs("annotator-1");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    const header = document.querySelector(".app-header") as HTMLElement;
    expect(within(header).getByRole("button", { name: /Add ontology/i }).tagName).toBe("BUTTON");
    expect(within(header).getByRole("button", { name: /Import work package/i }).tagName).toBe("BUTTON");
  });

  it("confirms a successful import with the number of cases", async () => {
    loggedInAs("annotator-1");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValueOnce([]).mockResolvedValue([{ package_id: "ward-7" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    vi.spyOn(api, "uploadPackage").mockResolvedValue({ package_id: "ward-7", manifest: { package_id: "ward-7", document_order: ["a", "b", "c"] } as any });
    render(<App />);
    await screen.findByRole("region", { name: /Get started/i });
    const input = document.querySelector('input[type="file"][accept=".zip"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["z"], "ward-7.zip")] } });
    const note = await screen.findByRole("status", { name: /Import result/i });
    expect(note.textContent).toMatch(/Package 'ward-7' imported – 3 cases/);
  });

  it("uses plain mode labels with one-sentence explanations", async () => {
    loggedInAs("annotator-1");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(/Working mode/i) as HTMLSelectElement;
    expect(within(select).getByText("Annotate from scratch")).toBeDefined();
    expect(within(select).getByText("Review proposals")).toBeDefined();
    expect(screen.getByText("You won't see any proposals.")).toBeDefined();
    fireEvent.change(select, { target: { value: "review" } });
    expect(screen.getByText("Check suggested terms one by one: confirm, reject or change.")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/origin-neutral|Independent Mode|Review Mode|Workspace/);
  });

  it("offers a single primary 'Open case' action", async () => {
    loggedInAs("JPL");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "JPL", mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    expect(screen.getAllByRole("button", { name: /Open case/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Continue|Open Workspace|Open Case →/ })).toBeNull();
  });
});

describe("annotator identity", () => {
  it("stores the working mode per package in the workspace", async () => {
    loggedInAs("annotator-1");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: { pkg: "review" } });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText(/Working mode/i), { target: { value: "review" } });
    expect(save).toHaveBeenCalledWith({ mode_by_package: { pkg: "review" } });
    expect(window.localStorage.getItem("ontocurator.mode.pkg")).toBeNull();
  });

});

describe("editor and page polish", () => {
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
