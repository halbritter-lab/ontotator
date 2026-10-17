import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type DocumentSummary, type OpenWorkspaceResponse } from "../src/api/client";
import { assigned } from "./assignments";
type WorkspaceMode = "independent" | "review";
import { testUser } from "./session";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });

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
  window.history.replaceState(null, "", "#/");
  const tasks = documents.map((document, index) => Object.freeze({ ...document, assignment_id: 100 + index,
    project_key: "pkg", project_name: "Synthetic cases", task: mode === "review" ? "review" as const : "annotate" as const,
    status: "open" as const, updated_at: "2026-10-14T12:00:00Z" }));
  Object.freeze(tasks);
  vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
  vi.spyOn(api, "getAssignmentMetadata").mockImplementation(async assignmentId => {
    const task = tasks.find(row => row.assignment_id === assignmentId);
    if (!task) throw new Error("Unassigned fixture ID");
    return { id: task.assignment_id, project_key: task.project_key, document_id: task.document_id, task: task.task,
      user_id: 1, username: "ann-0007", pseudonym: "ann-0007", display_name: "Test user", status: task.status,
      created_at: task.updated_at, updated_at: task.updated_at, revoked_at: null, last_submission_id: null };
  });
  const open = vi.spyOn(api, "openAssignment").mockImplementation(async (assignmentId) => {
    const request = { document_id: ids[assignmentId - 100] };
    const key = { project_key: "pkg", document_id: request.document_id, annotator_id: "ann-0007", mode, scope_id: "scope", target_set_id: "empty" };
    const targets = { target_set_id: "empty", targets: [] };
    return assigned({
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
    } as OpenWorkspaceResponse, assignmentId);
  });
  return { documents, ids, positions, open, tasks };
}

describe("assignment App presentation positions", () => {
  it("renders assigned documents in server order without mutating the API objects", async () => {
    const { tasks, ids, positions } = server();
    render(<App user={testUser("ann-0007")} />);
    const table = await screen.findByRole("table", { name: "My tasks" });
    expect(within(table).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[0].textContent)).toEqual(ids);
    expect(tasks.map(task => task.position)).toEqual(positions);
  });

  it.each(["independent", "review"] as const)("passes human ordinals to the real CaseScreen navigation in %s mode", async (mode) => {
    const { documents, ids, positions, open, tasks } = server(mode);
    const mutation = vi.spyOn(api, "applyCommand");
    render(<App user={testUser("ann-0007")} />);
    await screen.findByRole("table", { name: "My tasks" });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("link", { name: /^(Start|Continue|View)$/ })[0]);
    const select = await screen.findByRole("combobox", { name: "Select case" }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(ids.map((id, index) => `Case ${index + 1} of 4: ${id} (Open)`));
    expect((screen.getByRole("button", { name: "Previous Case" }) as HTMLButtonElement).disabled).toBe(true);
    for (let index = 0; index < ids.length; index++) {
      await waitFor(() => {
        const current = screen.getByRole("combobox", { name: "Select case" }) as HTMLSelectElement;
        expect(current.value).toBe(String(100 + index));
        expect(current.selectedOptions[0].textContent).toBe(`Case ${index + 1} of 4: ${ids[index]} (Open)`);
      });
      if (index < ids.length - 1) await user.click(screen.getByRole("button", { name: "Next Case" }));
    }
    expect((screen.getByRole("button", { name: "Next Case" }) as HTMLButtonElement).disabled).toBe(true);
    expect(open.mock.calls.map(([id]) => id)).toEqual([100, 101, 102, 103]);
    expect(mutation).not.toHaveBeenCalled();
    expect(documents.map((doc) => doc.position)).toEqual(positions);
    expect(tasks.map(task => task.position)).toEqual(positions);
  });
});
