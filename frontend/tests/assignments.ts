// Existing editor regression fixtures model drafts opened before the spanless rule; D3 cases opt into enforcement explicitly.
import { vi } from "vitest";
import { api, type AssignmentWorkspace, type TaskSummary, type OpenWorkspaceResponse } from "../src/api/client";

export function taskOf(view: OpenWorkspaceResponse["view"], id = 1): TaskSummary {
  return { assignment_id: id, workflow_revision: 0, held: false, report_answered: false, waiting_for_translation_review: false, project_key: view.key.project_key, project_name: view.key.project_key,
    document_id: view.document.document_id, language: view.document.language, task: view.key.mode === "review" ? "review" : "annotate",
    status: "open", updated_at: "2026-10-14T12:00:00Z" };
}

/** Add the actual assignment-open envelope to an existing workspace fixture. */
export function assigned(response: OpenWorkspaceResponse, id = 1): AssignmentWorkspace {
  const task = taskOf(response.view, id);
  return { ...response, assignment: { id, workflow_revision: 0, held: false, lead_correction: false, project_key: task.project_key, document_id: task.document_id,
    user_id: 1, display_name: "Test user", username: "test-user", pseudonym: response.view.key.annotator_id, task: task.task,
    status: response.read_only ? "submitted" : "open", created_at: task.updated_at, updated_at: task.updated_at,
    revoked_at: null, last_submission_id: null } };
}

/** My tasks with one task; "All" explicitly, since a bare "#/" lands on the last-used project or Projects (F8). */
export function assignedList(view: OpenWorkspaceResponse["view"]): void {
  window.history.replaceState(null, "", "#/?status=all");
  vi.spyOn(api, "listMyTasks").mockResolvedValue([taskOf(view)]);
}

export function workspaceFixture(documentId = "doc", mode: "independent" | "review" = "independent"): OpenWorkspaceResponse {
  const key = { project_key: "pkg", document_id: documentId, annotator_id: "alice", mode, scope_id: "s", target_set_id: "empty" };
  const targets = { target_set_id: "empty", targets: [] };
  return { workspace_id: `ws-${documentId}`, read_only: false, view: {
    key, document: { document_id: documentId, text: "Patient has seizures.", language: "en", text_sha256: "text" },
    targets, scope: { scope_id: "s", mode, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    draft: { key, targets, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
    layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true,
      default_type_id: "default", annotation_types: [{ type_id: "default", label: "Finding", axes: [], evidence_policy: "optional" }] },
      { layer_id: "reference", label: "Reference", ontology_id: "hp", default_type_id: "default", access: "reference", default_visible: true, annotation_types: [] }],
    checked_layer_ids: [], available_inputs: [], submissions: [], term_statuses: {},
    require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false, axes_definition: "custom", axes_config: [], axes_config_sha256: "axes",
  } };
}
