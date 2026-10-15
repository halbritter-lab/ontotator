import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type DocumentSummary, type OpenWorkspaceResponse } from "../src/api/client";
import type { WorkspaceMode } from "../src/App";
import { testUser } from "./session";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function server(mode: WorkspaceMode = "independent") {
  const ids = ["doc-beta", "doc-alpha", "doc-zeta", "doc-delta"];
  const positions = [0, 1, null, 7];
  const documents: DocumentSummary[] = ids.map((document_id, index) => ({
    document_id, position: positions[index], language: "en", text_length: 16,
    status: "not_started",
  }));
  documents.forEach(Object.freeze);
  Object.freeze(documents);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ mode_by_package: {} });
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listProjects").mockResolvedValue([{
    project_key: "pkg", name: "Synthetic cases", description: null, roles: ["annotator", "adjudicator"],
    allowed_modes: [mode], document_count: ids.length, can_manage: false,
  }]);
  vi.spyOn(api, "listDocuments").mockResolvedValue(documents);
  const open = vi.spyOn(api, "openWorkspace").mockImplementation(async (request): Promise<OpenWorkspaceResponse> => {
    const key = { project_key: "pkg", document_id: request.document_id, annotator_id: "ann-0007", mode, scope_id: "scope", target_set_id: "empty" };
    const targets = { target_set_id: "empty", targets: [] };
    return {
      workspace_id: `workspace-${request.document_id}`, read_only: false,
      view: {
        key, document: { document_id: request.document_id, text: "alpha beta gamma", language: "en", text_sha256: "text" },
        draft: { key, targets, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
        targets, scope: { scope_id: "scope", mode, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
        layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
          annotation_types: [{ type_id: "default", label: "Phenotype", axes: [], evidence_policy: "optional" }] }],
        ontologies: [{ ontology_id: "hp", label: "HPO", release: "r", sha256: "s", format: "obo-graph-json" }],
        checked_layer_ids: [], available_inputs: [], submissions: [], term_statuses: {}, axes_definition: "custom", axes_config: [], axes_config_sha256: "axes",
      },
    };
  });
  return { documents, ids, positions, open };
}

describe("legacy App document presentation positions", () => {
  it("renders one-based dashboard ordinals in server order without mutating raw stored positions", async () => {
    const { documents, ids, positions } = server();
    render(<App user={testUser("ann-0007")} />);
    const table = await screen.findByRole("table", { name: "Clinical Cases" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["1", "2", "3", "4"]);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(ids);
    const hiddenSelect = screen.getByLabelText("Clinical Case (Document)") as HTMLSelectElement;
    expect(Array.from(hiddenSelect.options).map((option) => option.textContent)).toEqual(ids.map((id, index) => `Case ${index + 1}: ${id}`));
    const user = userEvent.setup();
    for (const [index, row] of rows.entries()) {
      await user.click(row);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(`Case ${index + 1}: ${ids[index]}`);
    }
    expect(documents.map((doc) => doc.position)).toEqual(positions);
    expect(documents.map((doc) => doc.document_id)).toEqual(ids);
  });

  it.each(["independent", "review"] as const)("passes human ordinals to the real CaseScreen navigation in %s mode", async (mode) => {
    const { documents, ids, positions, open } = server(mode);
    const mutation = vi.spyOn(api, "applyCommand");
    render(<App user={testUser("ann-0007")} />);
    await screen.findByRole("table", { name: "Clinical Cases" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open case" }));
    const select = await screen.findByRole("combobox", { name: "Select case" }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(ids.map((id, index) => `Case ${index + 1} of 4: ${id} (Open)`));
    expect((screen.getByRole("button", { name: "Previous Case" }) as HTMLButtonElement).disabled).toBe(true);
    for (let index = 0; index < ids.length; index++) {
      await waitFor(() => {
        const current = screen.getByRole("combobox", { name: "Select case" }) as HTMLSelectElement;
        expect(current.value).toBe(ids[index]);
        expect(current.selectedOptions[0].textContent).toBe(`Case ${index + 1} of 4: ${ids[index]} (Open)`);
      });
      if (index < ids.length - 1) await user.click(screen.getByRole("button", { name: "Next Case" }));
    }
    expect((screen.getByRole("button", { name: "Next Case" }) as HTMLButtonElement).disabled).toBe(true);
    expect(open.mock.calls.map(([request]) => request.document_id)).toEqual(ids);
    expect(open.mock.calls.every(([request]) => request.annotator_id === "ann-0007" && request.mode === mode)).toBe(true);
    expect(mutation).not.toHaveBeenCalled();
    expect(documents.map((doc) => doc.position)).toEqual(positions);
  });
});
