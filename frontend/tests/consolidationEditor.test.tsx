import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { api, type ConsolidationView } from "../src/api/client";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const axes = [
  { id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true },
];

const snapshot = (annotationId: string, termId: string, actor: string) => ({
  schema_version: "ontocurator-annotation/v3", version: `${annotationId}-v1`, document_id: "doc-1", text_sha256: "text",
  ontology_sha256: "ontology", layer_config_sha256: "layer",
  annotation: { annotation_id: annotationId, document_id: "doc-1", layer_id: "phenotype", type_id: "default", term_id: termId,
    axes_values: { assertion: "present" }, evidence_refs: [],
    provenance: { actor: { actor_id: actor, kind: "human" }, method: "manual", source_refs: [] } },
  evidence: [],
});

const luc = snapshot("a-luc", "HP:0001252", "ann-0004");
const tom = snapshot("a-tom", "HP:0001250", "ann-0007");

function consolidationView(): WorkspaceView {
  const key = { project_key: "pkg-1", document_id: "doc-1", annotator_id: "ann-0009", mode: "review" as const,
    scope_id: "scope-default", target_set_id: "targets-c", round_id: "round-c" };
  const targets = { target_set_id: "targets-c", targets: [luc, tom].map(s => ({ annotation_id: s.annotation.annotation_id, version: s.version })) };
  return {
    require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: false, enforce_spanless_rules: false,
    document: { document_id: "doc-1", text: "The patient showed severe hypotonia and seizure activity.", language: "en", text_sha256: "text" },
    key,
    scope: { scope_id: "scope-default", mode: "review", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
      annotation_types: [{ type_id: "default", label: "Phenotype", evidence_policy: "optional", axes }] }],
    ontologies: [{ ontology_id: "hp", release: "2024-06-25", label: "Human Phenotype Ontology", sha256: "hp", format: "obo-graph-json" }],
    checked_layer_ids: [],
    draft: { key, targets, revision: 3, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
    targets,
    submissions: [],
    available_inputs: [luc, tom],
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: axes,
    axes_config_sha256: "axes",
  } as unknown as WorkspaceView;
}

const member = (inputId: string, personId: string, annotationId: string, termId: string) => ({
  input_id: inputId, person_id: personId, annotation_id: annotationId, term_id: termId, term_label: termId,
  layer_id: "phenotype", type_id: "default", axes: { assertion: "present" }, spans: [], cues: [], note: null,
});

const consolidation: ConsolidationView = {
  round_id: "round-c", workspace_id: "ws-c", read_only: false, read_only_reason: null, case_id: "case-107", language: "en",
  document_version: 2, document_id: "doc-1", text: "The patient showed severe hypotonia and seizure activity.",
  people: [
    { person_id: "ann-0004", label: "Luc Martin (ann-0004)", lane: 1 },
    { person_id: "ann-0007", label: "Tom Reis (ann-0007)", lane: 2 },
  ],
  groups: [{
    group_id: "g1", kinds: ["term_differs"], differing_axes: [], majority: {}, keep_input_id: "in-1", start: null, state: "open",
    edited: false, note: null, guidelines_unclear: false, annotation_ids: [],
    members: [member("in-1", "ann-0004", "a-luc", "HP:0001252"), member("in-2", "ann-0007", "a-tom", "HP:0001250")],
  }],
  workflow_revision: 5, draft_revision: 3,
} as ConsolidationView;

const renderEditor = (roundKind: "consolidation" | "ordinary" = "consolidation") => render(
  <CaseScreen view={consolidationView()} workspaceId="ws-c" onClose={vi.fn()} roundKind={roundKind}
    versionContext={{ canBrowseVersions: false, username: "lead", assignmentId: 42, onNavigate: vi.fn() }} />,
);

const entry = (annotationId: string, version: string) =>
  document.querySelector<HTMLElement>(`[data-list-key="target:${annotationId}:${version}"]`)
  ?? [...document.querySelectorAll<HTMLElement>('[data-list-key^="target:"]')].find(element => element.dataset.listKey?.includes(annotationId))!;

it("shows the person's display name and pseudonym on every consolidation entry", async () => {
  const load = vi.spyOn(api, "getConsolidation").mockResolvedValue(consolidation);
  renderEditor();
  await waitFor(() => expect(within(entry("a-luc", luc.version)).getByText("Luc Martin (ann-0004)")).toBeDefined());
  expect(within(entry("a-tom", tom.version)).getByText("Tom Reis (ann-0007)")).toBeDefined();
  expect(load).toHaveBeenCalledWith("round-c");
});

it("has no merge panel in consolidation mode", async () => {
  vi.spyOn(api, "getConsolidation").mockResolvedValue(consolidation);
  renderEditor();
  await screen.findByText("Luc Martin (ann-0004)");
  expect(screen.queryByText("Merge overlapping submitted findings")).toBeNull();
});

it("links back to the consolidation view through the task route without the editor view", async () => {
  vi.spyOn(api, "getConsolidation").mockResolvedValue(consolidation);
  renderEditor();
  const link = screen.getByRole("link", { name: "Back to consolidation" });
  expect(link.getAttribute("href")).toBe("#/tasks/42");
  expect(link.closest('[role="group"][aria-label="Case"], .case-toolbar')).not.toBeNull();
  await screen.findByText("Luc Martin (ann-0004)");
});

it("keeps the entries usable without names when the consolidation read fails", async () => {
  const load = vi.spyOn(api, "getConsolidation").mockRejectedValue(new Error("offline"));
  renderEditor();
  await waitFor(() => expect(load).toHaveBeenCalled());
  expect(entry("a-luc", luc.version)).toBeDefined();
  expect(screen.queryByText("Luc Martin (ann-0004)")).toBeNull();
});

it("reads no consolidation and shows no link outside a consolidation round", () => {
  const load = vi.spyOn(api, "getConsolidation").mockResolvedValue(consolidation);
  renderEditor("ordinary");
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Back to consolidation" })).toBeNull();
});
