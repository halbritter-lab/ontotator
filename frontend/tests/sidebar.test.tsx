import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "review" as const,
  scope_id: "scope-default",
  target_set_id: "targets",
};
const scope = { scope_id: "scope-default", mode: "review" as const, editable_layer_ids: ["phenotype"], reference_layer_ids: [] };
const layers = [{
  layer_id: "phenotype",
  label: "Phenotype",
  ontology_id: "hp",
  access: "editable" as const,
  default_visible: true,
  default_type_id: "default",
  annotation_types: [{
    type_id: "default",
    label: "Phenotype",
    evidence_policy: "optional" as const,
    axes: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  }],
}];

const snapshot = (
  annotationId: string,
  termId: string,
  provenance: { actor: { actor_id: string; kind: "tool" | "human" }; method: string; source_refs?: string[] },
) => ({
  schema_version: "ontocurator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId,
    document_id: "doc",
    layer_id: "phenotype",
    type_id: "default",
    term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance,
  },
  evidence: [{
    mention: { evidence_id: `ev-${annotationId}`, segments: [{ start: 0, end: 5 }], cue_segments: [] },
    version: "ev-v", document_id: "doc", text_sha256: "text",
  }],
  version: `${annotationId}-v1`,
  document_id: "doc",
  text_sha256: "text",
  ontology_sha256: "ontology",
  layer_config_sha256: "layer-sha",
});

const TOOL = { actor: { actor_id: "pheno-nlp", kind: "tool" as const }, method: "llm-v2" };
const HUMAN = { actor: { actor_id: "dr-weber", kind: "human" as const }, method: "manual" };

/**
 * Review view: `tool-prop` and `human-prop` are review targets, `reference` is an
 * extra input (shown under "Reference Annotations"), `annotations` is the draft.
 */
const reviewView = (annotations: any[] = []): WorkspaceView => {
  const inputs = [
    snapshot("tool-prop", "HP:0001", TOOL),
    snapshot("human-prop", "HP:0002", HUMAN),
    snapshot("reference", "HP:0003", TOOL),
  ];
  const targets = {
    target_set_id: "targets",
    targets: [
      { annotation_id: "tool-prop", version: "tool-prop-v1" },
      { annotation_id: "human-prop", version: "human-prop-v1" },
    ],
  };
  return {
    key,
    scope,
    layers,
    ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
    checked_layer_ids: [],
    document: { document_id: "doc", text: "alpha beta gamma", language: "en", text_sha256: "text" },
    targets,
    available_inputs: inputs,
    submissions: [],
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
    axes_config_sha256: "sha-axes",
    draft: {
      key, targets, revision: 0, annotations,
      evidence: annotations.flatMap((a) => a.evidence), decisions: [], checked_layer_ids: [],
    },
  } as WorkspaceView;
};

const renderCase = (view: WorkspaceView) =>
  render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

const itemFor = (container: HTMLElement, termId: string): HTMLElement => {
  const item = Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key]"))
    .find((el) => el.textContent?.includes(termId));
  if (!item) throw new Error(`no sidebar entry for ${termId}`);
  return item;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AI badge in the sidebar", () => {
  it("replaces the '• tool' text of a tool proposal and leaves human proposals unmarked", () => {
    const { container } = renderCase(reviewView());
    const toolItem = itemFor(container, "HP:0001");
    expect(within(toolItem).getByLabelText("AI-generated: pheno-nlp · llm-v2")).toBeDefined();
    expect(toolItem.textContent).not.toContain("• tool");

    const humanItem = itemFor(container, "HP:0002");
    expect(within(humanItem).queryByText("✦ AI")).toBeNull();
    expect(humanItem.textContent).toContain("• human");
  });

  it("marks tool-generated reference annotations in the list and in their details", () => {
    const { container } = renderCase(reviewView());
    const reference = itemFor(container, "HP:0003");
    expect(within(reference).getByText("✦ AI")).toBeDefined();

    fireEvent.click(reference);
    const details = screen.getByLabelText("Reference details");
    expect(within(details).getByText("✦ AI")).toBeDefined();
    expect(details.textContent).toContain("pheno-nlp · llm-v2");
  });

  it("does not mark a curated annotation that was adopted from a tool proposal", () => {
    const adopted = snapshot("copy", "HP:0001", {
      actor: { actor_id: "dr-a", kind: "human" }, method: "manual", source_refs: ["tool-prop:tool-prop-v1"],
    });
    const { container } = renderCase(reviewView([adopted]));
    const curated = Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key]"))
      .find((el) => el.dataset.listKey === "annotation:copy")!;
    expect(curated).toBeDefined();
    expect(within(curated).queryByText("✦ AI")).toBeNull();
  });
});
