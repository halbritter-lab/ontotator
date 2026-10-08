import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ValidationError } from "../src/api/client";
import { App } from "../src/App";
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

/** Select the draft annotation and open its tree as the docked panel. */
const openPanel = async (container: HTMLElement, annotationId: string) => {
  fireEvent.click(entry(container, annotationId));
  fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
  const panel = await screen.findByRole("region", { name: "Ontology tree" });
  await within(panel).findByText("Beta term", { selector: ".tree-label" });
  return panel;
};
describe("the annotation panel", () => {
  it("starts at its top when it shows another annotation, and stays put while one is edited", async () => {
    const view = baseView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const pane = container.querySelector<HTMLElement>(".inspector-pane")!;

    // Next to a docked tree the panel is short: its content is scrolled, for
    // instance down to a candidate of the search.
    fireEvent.click(entry(container, "a1"));
    pane.scrollTop = 120;
    expect(pane.scrollTop).toBe(120);

    // Editing the annotation that is shown does not move the panel ...
    fireEvent.click(within(pane).getByLabelText("Absent"));
    await waitFor(() => expect(api.applyCommand).toHaveBeenCalledTimes(1));
    expect(pane.scrollTop).toBe(120);

    // ... another annotation is shown from its top, with its term name ...
    fireEvent.click(entry(container, "a2"));
    expect(within(pane).getByRole("heading", { level: 2 }).textContent).toContain("HP:C");
    expect(pane.scrollTop).toBe(0);

    // ... and so is the search for a new one, and the panel after it was cancelled.
    pane.scrollTop = 80;
    fireEvent.click(screen.getByRole("button", { name: "+ New Annotation" }));
    expect(within(pane).getByLabelText(/Search ontology term/i)).toBeDefined();
    expect(pane.scrollTop).toBe(0);
    pane.scrollTop = 60;
    fireEvent.click(entry(container, "a1"));
    expect(pane.scrollTop).toBe(0);
  });
});

const panelNow = () => screen.getByRole("region", { name: "Ontology tree" });
const pinSwitch = () => screen.getByRole("button", { name: "Keep open" });

describe("the pinned tree", () => {
  it("pinning turns the dialog into a side panel without starting over, and reports the choice", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const onTreePinnedChange = vi.fn();
    const { container } = render(
      <CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} onTreePinnedChange={onTreePinnedChange} />,
    );
    const dialog = await openDialog(container, "a1");
    fireEvent.click(rowOf(dialog, "Beta term"));
    expect(pinSwitch().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(pinSwitch());

    const panel = panelNow();
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(onTreePinnedChange).toHaveBeenCalledTimes(1);
    expect(onTreePinnedChange).toHaveBeenCalledWith(true);
    expect(pinSwitch().getAttribute("aria-pressed")).toBe("true");
    // The same walk: no second request, the selection made in the dialog is still there.
    expect(open).toHaveBeenCalledTimes(1);
    expect(rowOf(panel, "Beta term").getAttribute("aria-selected")).toBe("true");
    // Docked into the layout, after the inspector.
    const layout = container.querySelector(".app-layout")!;
    expect(layout.classList.contains("tree-pinned")).toBe(true);
    expect(panel.parentElement!.parentElement).toBe(layout);
    expect(layout.lastElementChild).toBe(panel.parentElement);
  });

  it("opens as the side panel right away when the annotator has pinned it", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);

    // Never by itself: selecting an annotation is not asking for the tree.
    fireEvent.click(entry(container, "a1"));
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    fireEvent.click(entry(container, "a1")); // deselect again

    const panel = await openPanel(container, "a1");
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(pinSwitch().getAttribute("aria-pressed")).toBe("true");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("stays open after 'Use this term' and marks the new term as the current one", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { apply } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "a1",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(panelNow()).toBe(panel);
    expect(rowOf(panel, "Term HP:A").hasAttribute("aria-current")).toBe(false);
    await waitFor(() => expect(within(panel).getByText("This is the annotation's current term.")).toBeDefined());
    expect(useButton(panel).disabled).toBe(true);
    // Still the same walk.
    expect(open).toHaveBeenCalledTimes(1);

    // A second change from the same walk carries the same id.
    fireEvent.click(rowOf(panel, "Term HP:A"));
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
    fireEvent.click(useButton(panel));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply.mock.calls[1][1].payload).toMatchObject({ term_id: "HP:A", search_event_id: "walk-1" });
  });

  it("jumps to another own annotation with a term, and stays put for anything else", async () => {
    const view = reviewView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);
    await openPanel(container, "a1");
    expect(open.mock.calls[0][0]).toMatchObject({ annotation_id: "a1", term_id: "HP:A" });

    // Another own annotation: a new walk at its term.
    fireEvent.click(entry(container, "a2"));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a2",
      layer_id: "phenotype",
      term_id: "HP:C",
    });
    await within(panelNow()).findByText("Term HP:C", { selector: ".tree-label" });
    expect(rowOf(panelNow(), "Term HP:C").getAttribute("aria-selected")).toBe("true");
    // The jump does not take the keyboard focus away from where the annotator is working.
    expect(panelNow().contains(document.activeElement)).toBe(false);

    // A proposal: the tree stays where it is and assigns nothing.
    fireEvent.click(rowOf(panelNow(), "Beta term"));
    expect(useButton(panelNow()).disabled).toBe(false);
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    expect(screen.getByText(/Review decision for this proposal/i)).toBeDefined();
    expect(rowOf(panelNow(), "Term HP:C")).toBeDefined();
    expect(useButton(panelNow()).disabled).toBe(true);
    expect(within(panelNow()).getByText("Select one of your annotations to assign a term from the tree.")).toBeDefined();

    // A reference, then nothing at all: the same.
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="source:"]')!);
    expect(useButton(panelNow()).disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(container.querySelector(".doc-item.selected")).toBeNull();
    expect(rowOf(panelNow(), "Term HP:C")).toBeDefined();
    expect(useButton(panelNow()).disabled).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);

    // Back on the annotation the tree is showing: no new walk, and it can assign again.
    fireEvent.click(entry(container, "a2"));
    expect(useButton(panelNow()).disabled).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);

    // The first annotation again: that is another annotation, so a third walk.
    fireEvent.click(entry(container, "a1"));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(3));
    expect(open.mock.calls[2][0]).toMatchObject({ annotation_id: "a1", term_id: "HP:A" });
  });

  it("closes by releasing the pin, and the next time opens as a dialog", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const onTreePinnedChange = vi.fn();
    const { container } = render(
      <CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned onTreePinnedChange={onTreePinnedChange} />,
    );
    await openPanel(container, "a1");

    fireEvent.click(pinSwitch());

    expect(onTreePinnedChange).toHaveBeenCalledTimes(1);
    expect(onTreePinnedChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-pinned")).toBe(false);
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    expect(await screen.findByRole("dialog", { name: "Ontology tree" })).toBeDefined();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("closes with its close button or with Escape inside the tree, and does not come back by itself", async () => {
    const view = baseView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const onTreePinnedChange = vi.fn();
    const { container } = render(
      <CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned onTreePinnedChange={onTreePinnedChange} />,
    );
    const panel = await openPanel(container, "a1");
    const row = rowOf(panel, "Term HP:A");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    // Escape closed the tree only: the annotation is still selected, the pin is still set.
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    expect(onTreePinnedChange).not.toHaveBeenCalled();

    // Selecting another annotation does not bring the tree back.
    fireEvent.click(entry(container, "a2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);

    // Asked for again, it is the panel again; its close button closes it.
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    await screen.findByRole("region", { name: "Ontology tree" });
    fireEvent.click(screen.getByRole("button", { name: "Close tree" }));
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(onTreePinnedChange).not.toHaveBeenCalled();
  });

  it("below 1100 px a pinned tree is a dialog without a pin switch", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);

    const dialog = await openDialog(container, "a1");

    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Keep open" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-pinned")).toBe(false);
  });

  it("the App hands the stored choice of this annotator to the case and saves a change", async () => {
    window.localStorage.clear();
    vi.spyOn(api, "getPreferences").mockResolvedValue({
      last_annotator_id: "dr-a",
      mode_by_package: {},
      tree_pinned_by_annotator: { "dr-a": true, "dr-b": false },
    });
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({
      last_annotator_id: "dr-a",
      mode_by_package: {},
      tree_pinned_by_annotator: {},
    });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg", ontology: { release: "test" } }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue([
      { document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" },
    ]);
    vi.spyOn(api, "openWorkspace").mockResolvedValue({
      workspace_id: "ws",
      view: baseView([snapshot("a1", "HP:A")]),
    });
    mockTree();
    const { container } = render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open case/i }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Open case/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, continue/i }));
    await waitFor(() => expect(entry(container, "a1")).not.toBeNull());

    // As after a reload: the stored choice makes "Show in tree" open the side panel.
    await openPanel(container, "a1");

    fireEvent.click(pinSwitch());
    expect(save).toHaveBeenCalledWith({ tree_pinned_by_annotator: { "dr-a": false } });
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
  });
});
