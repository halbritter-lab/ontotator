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

describe("continuous sidebar", () => {
  it("puts proposals, references and curated annotations into one scroll container", () => {
    const adopted = snapshot("copy", "HP:0001", {
      actor: { actor_id: "dr-a", kind: "human" }, method: "manual", source_refs: ["tool-prop:tool-prop-v1"],
    });
    const { container } = renderCase(reviewView([adopted]));
    const sidebar = container.querySelector(".sidebar")!;
    const scrollers = sidebar.querySelectorAll(".sidebar-scroll");
    expect(scrollers.length).toBe(1);
    const scroller = scrollers[0];

    for (const title of ["Review Proposals (2)", "Reference Annotations (1)", "Curated Annotations (1)"]) {
      const header = Array.from(scroller.querySelectorAll(".sidebar-header"))
        .find((el) => el.textContent?.includes(title));
      expect(header, title).toBeDefined();
    }
    for (const entry of Array.from(sidebar.querySelectorAll("[data-list-key]"))) {
      expect(scroller.contains(entry)).toBe(true);
    }
    for (const list of Array.from(sidebar.querySelectorAll<HTMLElement>(".doc-list"))) {
      expect(list.style.maxHeight).toBe("");
    }
    // The layer controls and the footer stay outside the scrolling part.
    expect(scroller.contains(screen.getByRole("button", { name: /\+ New Annotation/ }))).toBe(true);
    expect(sidebar.lastElementChild).not.toBe(scroller);
  });

  it("scrolls the selected entry into view", () => {
    const scrolled: string[] = [];
    const original = (Element.prototype as any).scrollIntoView;
    (Element.prototype as any).scrollIntoView = function (this: HTMLElement, options: unknown) {
      expect(options).toEqual({ block: "nearest" });
      scrolled.push(this.dataset.listKey ?? "");
    };
    try {
      const { container } = renderCase(reviewView());
      expect(scrolled).toEqual([]);
      fireEvent.click(itemFor(container, "HP:0002"));
      expect(scrolled).toEqual([itemFor(container, "HP:0002").dataset.listKey]);
      fireEvent.click(itemFor(container, "HP:0003"));
      expect(scrolled[1]).toBe(itemFor(container, "HP:0003").dataset.listKey);
      expect(scrolled.length).toBe(2);
    } finally {
      (Element.prototype as any).scrollIntoView = original;
    }
  });
});

describe("review outcome and section layout", () => {
  it("keeps the AI badge on rejected and replaced tool proposals", () => {
    const adopted = snapshot("copy", "HP:0009", {
      actor: { actor_id: "dr-a", kind: "human" }, method: "manual", source_refs: ["tool-prop:tool-prop-v1"],
    });
    for (const decision of [
      { outcome: "rejected" as const },
      { outcome: "changed" as const, replacement: { annotation_id: "copy", version: "copy-v1" } },
    ]) {
      const view = reviewView(decision.outcome === "changed" ? [adopted] : []);
      view.draft.decisions = [{
        decision_id: "d", target: { annotation_id: "tool-prop", version: "tool-prop-v1" },
        note: "", reviewer_id: "dr-a", ...decision,
      }] as any;
      const { container } = renderCase(view);
      const item = Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key^='target:']"))
        .find((el) => el.textContent?.includes("HP:0001"))!;
      expect(item.classList.contains("doc-item--resolved"), decision.outcome).toBe(true);
      expect(within(item).getByText("✦ AI"), decision.outcome).toBeDefined();
      cleanup();
    }
  });

  it("does not claim AI origin for a proposal whose snapshot is missing", () => {
    const view = reviewView();
    view.available_inputs = view.available_inputs!.filter((s) => s.annotation.annotation_id !== "tool-prop");
    const { container } = renderCase(view);
    const item = itemFor(container, "tool-prop");
    expect(within(item).queryByText("✦ AI")).toBeNull();
    expect(item.textContent).toContain("• origin unknown");

    fireEvent.click(item);
    const details = container.querySelector<HTMLElement>(".inspector-pane")!;
    expect(within(details).queryByText("✦ AI")).toBeNull();
    expect(details.textContent).toContain("Source: unknown");
  });

  it("lays out reference annotations as list entries with a visible selection", () => {
    const { container } = renderCase(reviewView());
    const reference = itemFor(container, "HP:0003");
    expect(reference.classList.contains("reference-item")).toBe(true);
    expect(reference.classList.contains("btn")).toBe(false);
    expect(reference.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(reference);
    expect(reference.getAttribute("aria-pressed")).toBe("true");
  });

  it("gives every section its own container so a sticky header leaves with its section", () => {
    const { container } = renderCase(reviewView());
    const scroller = container.querySelector(".sidebar-scroll")!;
    const headers = Array.from(scroller.querySelectorAll(".sidebar-header"));
    expect(headers.length).toBe(3);
    const parents = headers.map((h) => h.parentElement);
    expect(new Set(parents).size).toBe(3);
    for (const parent of parents) expect(parent).not.toBe(scroller);
  });
});
