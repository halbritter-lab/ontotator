import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ValidationError } from "../src/api/client";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};
const scope = {
  scope_id: "scope-default",
  mode: "independent" as const,
  editable_layer_ids: ["phenotype"],
  reference_layer_ids: [],
};
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

/** A snapshot, usable as a draft annotation, a proposal or a reference. */
const snapshot = (annotationId: string, termId: string, sourceRefs?: string[]) => ({
  schema_version: "ontocurator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId,
    document_id: "doc",
    layer_id: "phenotype",
    type_id: "default",
    term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance: { actor: { actor_id: "dr-a", kind: "human" as const }, method: "manual", source_refs: sourceRefs },
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

const baseView = (annotations: any[] = []): WorkspaceView => ({
  key,
  scope,
  layers,
  ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
  checked_layer_ids: [],
  document: { document_id: "doc", text: "alpha beta gamma", language: "en", text_sha256: "text" },
  targets: { target_set_id: "empty", targets: [] },
  available_inputs: [],
  submissions: [],
  term_statuses: {},
  axes_definition: "editor-axes/v1",
  axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  axes_config_sha256: "sha-axes",
  draft: {
    key,
    targets: { target_set_id: "empty", targets: [] },
    revision: 0,
    annotations,
    evidence: annotations.flatMap((a) => a.evidence),
    decisions: [],
    checked_layer_ids: [],
  },
} as WorkspaceView);

/** Review view: `prop` (HP:P) is a proposal to decide, `ref` (HP:F) a reference, `annotations` the draft. */
const reviewView = (annotations: any[], decisions: any[] = []): WorkspaceView => {
  const view = baseView(annotations);
  const reviewKey = { ...key, mode: "review" as const, target_set_id: "targets" };
  const targets = { target_set_id: "targets", targets: [{ annotation_id: "prop", version: "prop-v1" }] };
  return {
    ...view,
    key: reviewKey,
    scope: { ...scope, mode: "review" as const },
    targets,
    available_inputs: [snapshot("prop", "HP:P"), snapshot("ref", "HP:F")],
    draft: { ...view.draft, key: reviewKey, targets, decisions },
  } as WorkspaceView;
};

/**
 * A tree for any start term: Root > (the start term, "Beta term" HP:B). Every walk gets its own id.
 */
const mockTree = () => {
  let walks = 0;
  const labelOf = (termId: string) => (termId === "HP:B" ? "Beta term" : `Term ${termId}`);
  const root = { term_id: "HP:R", label: "Root", child_count: 2 };
  const detailOf = (termId: string) => ({
    term_id: termId,
    label: labelOf(termId),
    definition: "",
    synonyms: [],
    translations: {},
    parents: [root],
  });
  const open = vi.spyOn(api, "openTree").mockImplementation(async (req) => {
    walks += 1;
    return {
      browse_id: `walk-${walks}`,
      start_status: "valid" as const,
      roots: [root],
      path: ["HP:R", req.term_id],
      levels: [
        {
          term_id: "HP:R",
          children: [
            { term_id: req.term_id, label: labelOf(req.term_id), child_count: 0 },
            { term_id: "HP:B", label: "Beta term", child_count: 0 },
          ],
        },
        { term_id: req.term_id, children: [] },
      ],
      detail: detailOf(req.term_id),
    };
  });
  const node = vi.spyOn(api, "loadTreeNode").mockImplementation(async (req) => ({
    detail: detailOf(req.term_id),
    children: [],
    path: [],
    levels: [],
  }));
  return { open, node };
};

/** A server that applies set_term (new version "<id>-v2") and counts decisions. */
const mockServer = (view: WorkspaceView) => {
  let current = view.draft;
  const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_workspaceId, envelope) => {
    const command: any = envelope.payload;
    current = {
      ...current,
      revision: current.revision + 1,
      annotations: (current.annotations ?? []).map((a) =>
        command.command === "set_term" && a.annotation.annotation_id === command.annotation_id
          ? { ...a, version: `${command.annotation_id}-v2`, annotation: { ...a.annotation, term_id: command.term_id } }
          : a,
      ),
    };
    return current;
  });
  const decide = vi.spyOn(api, "recordDecision").mockImplementation(async () => {
    current = { ...current, revision: current.revision + 1 };
    return current;
  });
  return { apply, decide };
};

const entry = (container: HTMLElement, annotationId: string) =>
  container.querySelector<HTMLElement>(`[data-list-key="annotation:${annotationId}"]`)!;
const showInTree = () => screen.queryByRole("button", { name: "Show in tree" });
const rowOf = (scopeEl: HTMLElement, label: string) =>
  within(scopeEl).getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const useButton = (scopeEl: HTMLElement) =>
  within(scopeEl).getByRole("button", { name: "Use this term" }) as HTMLButtonElement;

/** Select the draft annotation and open its tree as a dialog. */
const openDialog = async (container: HTMLElement, annotationId: string) => {
  fireEvent.click(entry(container, annotationId));
  fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
  const dialog = await screen.findByRole("dialog", { name: "Ontology tree" });
  await within(dialog).findByText("Beta term", { selector: ".tree-label" });
  return dialog;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).matchMedia;
});

describe("the tree in the case screen", () => {
  it("is offered at an own annotation with a term and nowhere else", () => {
    const { container } = render(
      <CaseScreen view={reviewView([snapshot("a1", "HP:A")])} workspaceId="ws" onClose={vi.fn()} />,
    );

    expect(showInTree()).toBeNull();

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    expect(screen.getByText(/Review decision for this proposal/i)).toBeDefined();
    expect(showInTree()).toBeNull();

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="source:"]')!);
    expect(screen.getByLabelText("Reference details")).toBeDefined();
    expect(showInTree()).toBeNull();

    fireEvent.click(entry(container, "a1"));
    expect(showInTree()).not.toBeNull();

    // While the term of a new annotation is still being chosen there is nothing to show.
    fireEvent.click(screen.getByRole("button", { name: /\+ New Annotation/ }));
    expect(showInTree()).toBeNull();
  });

  it("opens the tree at the annotation's term, as a dialog", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const dialog = await openDialog(container, "a1");

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a1",
      layer_id: "phenotype",
      term_id: "HP:A",
    });
    expect(rowOf(dialog, "Term HP:A").getAttribute("aria-selected")).toBe("true");
    expect(rowOf(dialog, "Term HP:A").getAttribute("aria-current")).toBe("true");
    expect(useButton(dialog).disabled).toBe(true);
    expect(container.querySelector(".app-layout")!.classList.contains("tree-pinned")).toBe(false);
  });

  it("'Use this term' sends set_term bound to the walk, closes the dialog and keeps the annotation selected", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "a1");

    fireEvent.click(rowOf(dialog, "Beta term"));
    // Selecting a node assigns nothing.
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(useButton(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "a1",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    expect(entry(container, "a1").textContent).toContain("HP:B");
    expect(showInTree()).not.toBeNull();
  });

  it("keeps the dialog open and says why when the server refuses the term", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    // A 422 as the server sends it. (Any other error would count as "server unreachable":
    // the mutation queue then keeps the edit pending instead of rejecting it.)
    vi.spyOn(api, "applyCommand").mockRejectedValue(
      new ValidationError("Search selection does not match", "INVALID_SEARCH_SELECTION"),
    );
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "a1");

    fireEvent.click(rowOf(dialog, "Beta term"));
    fireEvent.click(useButton(dialog));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Search selection does not match");
    expect(screen.getByRole("dialog", { name: "Ontology tree" })).toBe(dialog);
    expect(entry(container, "a1").textContent).toContain("HP:A");
  });

  it("Escape closes the dialog and leaves the selection; a second Escape clears it as before", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    await openDialog(container, "a1");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(entry(container, "a1").classList.contains("selected")).toBe(false);
  });

  it("in review, a term from the tree makes the adopted proposal count as changed", async () => {
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "copy");

    fireEvent.click(rowOf(dialog, "Beta term"));
    fireEvent.click(useButton(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull());
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "copy",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][1].payload).toMatchObject({
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "changed",
      replacement: { annotation_id: "copy", version: "copy-v2" },
    });
  });

  it("in review, an explicit rejection of the proposal stays", async () => {
    const rejected = {
      decision_id: "d1",
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "rejected",
      reviewer_id: "dr-a",
    };
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])], [rejected]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "copy");

    fireEvent.click(rowOf(dialog, "Beta term"));
    fireEvent.click(useButton(dialog));

    // The dialog closes only after set_term and its post-processing are through.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
  });
});
