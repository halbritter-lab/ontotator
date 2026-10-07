import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api/client";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";

const TEXT = "severe muscular hypotonia";
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
    axes: [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true }],
  }],
}];

const snapshot = (annotationId: string, termId: string, segments: Array<{ start: number; end: number }>,
  provenance: any = { actor: { actor_id: "dr-a", kind: "human" }, method: "manual" }) => ({
  schema_version: "ontocurator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId, document_id: "doc", layer_id: "phenotype", type_id: "default", term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance,
  },
  evidence: [{
    mention: { evidence_id: `ev-${annotationId}`, segments, cue_segments: [] },
    version: "ev-v", document_id: "doc", text_sha256: "text",
  }],
  version: `${annotationId}-v1`, document_id: "doc", text_sha256: "text",
  ontology_sha256: "ontology", layer_config_sha256: "layer-sha",
});

const makeView = (mode: "independent" | "review", annotations: any[], inputs: any[] = []): WorkspaceView => {
  const key = { package_id: "pkg", document_id: "doc", annotator_id: "dr-a", mode, scope_id: "scope-default", target_set_id: "t" };
  const targets = { target_set_id: "t", targets: inputs.map((s) => ({ annotation_id: s.annotation.annotation_id, version: s.version })) };
  return {
    key,
    scope: { scope_id: "scope-default", mode, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    layers,
    ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
    checked_layer_ids: [],
    document: { document_id: "doc", text: TEXT, language: "en", text_sha256: "text" },
    targets,
    available_inputs: inputs,
    submissions: [],
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true }],
    axes_config_sha256: "sha-axes",
    draft: {
      key, targets, revision: 0, annotations,
      evidence: annotations.flatMap((a) => a.evidence), decisions: [], checked_layer_ids: [],
    },
  } as WorkspaceView;
};

const handleKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".resize-handle"))
    .map((el) => `${el.dataset.mention}:${el.dataset.edge}`);
const entry = (container: HTMLElement, key: string) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-list-key]")).find((el) => el.dataset.listKey === key)!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resizing mentions in the case screen", () => {
  const own = snapshot("a1", "HP:0001", [{ start: 7, end: 15 }]);
  const other = snapshot("a2", "HP:0002", [{ start: 16, end: 25 }]);

  it("shows handles only for the selected curated annotation", () => {
    const { container } = render(<CaseScreen view={makeView("independent", [own, other])} workspaceId="ws" onClose={vi.fn()} />);
    expect(handleKeys(container)).toEqual([]);
    fireEvent.click(entry(container, "annotation:a1"));
    expect(handleKeys(container)).toEqual(["ev-a1:start", "ev-a1:end"]);
    fireEvent.click(entry(container, "annotation:a2"));
    expect(handleKeys(container)).toEqual(["ev-a2:start", "ev-a2:end"]);
    fireEvent.click(entry(container, "annotation:a2")); // deselect
    expect(handleKeys(container)).toEqual([]);
  });

  it("shows no handles for a selected review proposal", () => {
    const proposal = snapshot("prop", "HP:0003", [{ start: 0, end: 6 }],
      { actor: { actor_id: "pheno-nlp", kind: "tool" }, method: "llm" });
    const { container } = render(<CaseScreen view={makeView("review", [], [proposal])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(Array.from(container.querySelectorAll<HTMLElement>("[data-list-key^='target:']"))[0]);
    expect(container.querySelector(".run--hot")).not.toBeNull();
    expect(handleKeys(container)).toEqual([]);
  });

  it("hides the handles while a mention is being attached", () => {
    const { container } = render(<CaseScreen view={makeView("independent", [own])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    expect(handleKeys(container).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Add Mention/i }));
    expect(handleKeys(container)).toEqual([]);
  });

  it("saves a keyboard resize as edit_mention with codepoint segments", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = makeView("independent", [own]);
    const resized = {
      ...view.draft, revision: 1,
      evidence: [{ ...own.evidence[0], mention: { ...own.evidence[0].mention, segments: [{ start: 7, end: 14 }] } }],
    };
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(resized as any);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    const end = container.querySelector<HTMLElement>(".resize-handle--end")!;
    end.focus();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    vi.advanceTimersByTime(400);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith("ws", expect.objectContaining({
      expected_revision: 0,
      payload: { command: "edit_mention", annotation_id: "a1", evidence_id: "ev-a1", segments: [{ start: 7, end: 14 }] },
    }));
  });

  it("puts the text back when saving the resize fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A command the server rejects: the queue gives up on it (a network failure would stay queued for retry).
    vi.spyOn(api, "applyCommand").mockRejectedValue(new ApiError(422, "boom"));
    const { container } = render(<CaseScreen view={makeView("independent", [own])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    const marked = () => Array.from(container.querySelectorAll(".run--marked")).map((r) => r.textContent).join("|");
    expect(marked()).toBe("muscular");
    const end = container.querySelector<HTMLElement>(".resize-handle--end")!;
    end.focus();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(marked()).toBe("muscula");
    vi.advanceTimersByTime(400);
    await waitFor(() => expect(marked()).toBe("muscular"));
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });


  it("saves a late keyboard resize to the annotation that owns the mention, not to the current selection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = makeView("independent", [own, other]);
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 } as any);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    const end = container.querySelector<HTMLElement>(".resize-handle--end")!;
    end.focus();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    // The selection moves on before the pause has elapsed (no focus change in between).
    fireEvent.click(entry(container, "annotation:a2"));
    vi.advanceTimersByTime(400);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith("ws", expect.objectContaining({
      payload: { command: "edit_mention", annotation_id: "a1", evidence_id: "ev-a1", segments: [{ start: 7, end: 14 }] },
    }));
  });

});
