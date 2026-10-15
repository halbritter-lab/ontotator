import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ValidationError } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { loggedInAs } from "./session";

const key = {
  project_key: "pkg",
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
    external_url: `https://hpo.jax.org/browse/term/${termId}`,

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

/** Select the draft annotation and open its tree. */
const openPanel = async (container: HTMLElement, annotationId: string) => {
  fireEvent.click(entry(container, annotationId));
  fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
  const panel = await screen.findByRole("region", { name: "Ontology tree" });
  await within(panel).findByText("Beta term", { selector: ".tree-label" });
  return panel;
};
const panelNow = () => screen.getByRole("region", { name: "Ontology tree" });
const noTree = () => {
  expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).matchMedia;
});

describe("the tree in the case screen", () => {
  it("links the selected term to its official page next to its id", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const panel = await openPanel(container, "a1");
    const detail = panel.querySelector<HTMLElement>(".tree-detail")!;

    const link = await within(detail).findByRole("link", { name: "View HP:A on hpo.jax.org" });
    expect(link.getAttribute("href")).toBe("https://hpo.jax.org/browse/term/HP:A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // The id element holds the id alone; the link is its sibling.
    expect(detail.querySelector(".tree-detail__id")?.textContent).toBe("HP:A");
    expect(link.parentElement).toBe(detail.querySelector(".tree-detail__id")?.parentElement);
  });

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

  it("opens the tree at the annotation's term, docked under the annotation panel", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    // Never by itself: selecting an annotation is not asking for the tree.
    fireEvent.click(entry(container, "a1"));
    noTree();
    fireEvent.click(entry(container, "a1")); // deselect again

    const panel = await openPanel(container, "a1");

    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a1",
      layer_id: "phenotype",
      term_id: "HP:A",
    });
    expect(rowOf(panel, "Term HP:A").getAttribute("aria-selected")).toBe("true");
    expect(rowOf(panel, "Term HP:A").getAttribute("aria-current")).toBe("true");
    expect(useButton(panel).disabled).toBe(true);
    // Docked into the layout, right after the annotation panel.
    const layout = container.querySelector(".app-layout")!;
    expect(layout.classList.contains("tree-open")).toBe(true);
    expect(panel.parentElement!.className).toBe("tree-host");
    expect(panel.parentElement!.parentElement).toBe(layout);
    expect(layout.lastElementChild).toBe(panel.parentElement);
    expect(panel.parentElement!.previousElementSibling).toBe(container.querySelector(".inspector-pane"));
    // One control in the header: close. There is nothing to keep open or to store.
    const header = panel.querySelector<HTMLElement>(".tree-browser__header")!;
    expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Close tree"]);
    expect(screen.queryByRole("button", { name: "Keep open" })).toBeNull();
    // Opened by hand it takes the focus, on the start term; nothing is modal.
    expect(document.activeElement).toBe(rowOf(panel, "Term HP:A"));
    expect(panel.hasAttribute("aria-modal")).toBe(false);
  });

  it("is docked all the same in a narrow window", async () => {
    // Whatever the window's width, there is one form.
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
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const panel = await openPanel(container, "a1");

    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-open")).toBe(true);
    expect(panel.parentElement!.previousElementSibling).toBe(container.querySelector(".inspector-pane"));
  });

  it("'Use this term' sends set_term bound to the walk, as a search selection would, and keeps the annotation selected", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    // Selecting a node assigns nothing.
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
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
    // The tree is still there.
    expect(panelNow()).toBe(panel);
  });

  it("stays open after 'Use this term' and marks the new term as the current one", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { apply } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    expect(apply).toHaveBeenCalledTimes(1);
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

  it("says in the tree why the server refuses the term, and leaves the annotation as it was", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    // A 422 as the server sends it. (Any other error would count as "server unreachable":
    // the mutation queue then keeps the edit pending instead of rejecting it.)
    vi.spyOn(api, "applyCommand").mockRejectedValue(
      new ValidationError("Search selection does not match", "INVALID_SEARCH_SELECTION"),
    );
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    expect((await within(panel).findByRole("alert")).textContent).toBe("Search selection does not match");
    expect(panelNow()).toBe(panel);
    expect(entry(container, "a1").textContent).toContain("HP:A");
    expect(rowOf(panel, "Term HP:A").getAttribute("aria-current")).toBe("true");
    expect(rowOf(panel, "Beta term").hasAttribute("aria-current")).toBe(false);
    // Still usable: the term can be tried again.
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
  });

  it("Escape inside the tree closes it, leaves the selection and hands the focus back; a second Escape clears the selection as before", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");
    const row = rowOf(panel, "Term HP:A");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Escape" });
    noTree();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-open")).toBe(false);
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    // The focus was in the tree: it goes back to where the tree was asked for.
    expect(document.activeElement).toBe(showInTree());

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(entry(container, "a1").classList.contains("selected")).toBe(false);
  });

  it("Escape outside the tree widget is the case screen's: the tree stays", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");

    fireEvent.keyDown(within(panel).getByRole("button", { name: "Close tree" }), { key: "Escape" });

    expect(panelNow()).toBe(panel);
    expect(entry(container, "a1").classList.contains("selected")).toBe(false);
  });

  it("closes with its close button or with Escape inside the tree, and does not come back by itself", async () => {
    const view = baseView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");
    const row = rowOf(panel, "Term HP:A");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Escape" });

    noTree();
    // Escape closed the tree only: the annotation is still selected.
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);

    // Selecting another annotation does not bring the tree back.
    fireEvent.click(entry(container, "a2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    noTree();
    expect(open).toHaveBeenCalledTimes(1);

    // Asked for again, it is docked again; its close button closes it.
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    await screen.findByRole("region", { name: "Ontology tree" });
    expect(open).toHaveBeenCalledTimes(2);
    const close = screen.getByRole("button", { name: "Close tree" });
    close.focus();
    fireEvent.click(close);
    noTree();
    expect(entry(container, "a2").classList.contains("selected")).toBe(true);
    expect(document.activeElement).toBe(showInTree());

    // Closed while the focus is elsewhere, the focus stays where it is.
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    const again = await screen.findByRole("region", { name: "Ontology tree" });
    await within(again).findByText("Beta term", { selector: ".tree-label" });
    const elsewhere = entry(container, "a1");
    elsewhere.tabIndex = 0;
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
    fireEvent.click(screen.getByRole("button", { name: "Close tree" }));
    noTree();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("in review, a term from the tree makes the adopted proposal count as changed", async () => {
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "copy");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "copy",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide.mock.calls[0][1].payload).toMatchObject({
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "changed",
      replacement: { annotation_id: "copy", version: "copy-v2" },
    });
    await waitFor(() => expect(rowOf(panelNow(), "Beta term").getAttribute("aria-current")).toBe("true"));
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
    const panel = await openPanel(container, "copy");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    // The tree can assign again only after set_term and its post-processing are through:
    // the term it started at is then no longer the current one, and nothing is being saved.
    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    fireEvent.click(rowOf(panel, "Term HP:P"));
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
  });

  it("jumps to another own annotation with a term, and stays put for anything else", async () => {
    const view = reviewView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
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

  it("makes room for the term search of a new annotation, and comes back as it was", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const panel = await openPanel(container, "a1");
    fireEvent.click(rowOf(panel, "Beta term"));
    const layout = container.querySelector(".app-layout")!;
    expect(layout.classList.contains("tree-open")).toBe(true);

    // A new annotation has no term yet: the search gets the whole column.
    fireEvent.click(screen.getByRole("button", { name: "+ New Annotation" }));
    expect(screen.getByLabelText(/Search ontology term/i)).toBeDefined();
    noTree();
    expect(panel.parentElement!.hidden).toBe(true);
    expect(layout.classList.contains("tree-open")).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(false);

    // The search is given up: the tree is back, the same walk, with what was selected in it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(panelNow()).toBe(panel);
    expect(panel.parentElement!.hidden).toBe(false);
    expect(layout.classList.contains("tree-open")).toBe(true);
    expect(rowOf(panel, "Beta term").getAttribute("aria-selected")).toBe("true");
    expect(open).toHaveBeenCalledTimes(1);
  });
});

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

describe("the tree in the App", () => {
  it("is docked whatever an older workspace has stored about it, and stores nothing", async () => {
    window.localStorage.clear();
    // A preferences answer as an earlier version gave it: this annotator had released
    // "Keep open" there, which made the tree a dialog.
    const stored: any = {
      last_annotator_id: "dr-a",
      mode_by_package: {},
      tree_pinned_by_annotator: { "dr-a": false },
    };
    loggedInAs("dr-a");
    vi.spyOn(api, "getPreferences").mockResolvedValue(stored);
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: "dr-a", mode_by_package: {} });
    vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg", ontology: { release: "test" } }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue([
      { document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" },
    ]);
    vi.spyOn(api, "openWorkspace").mockResolvedValue({
      read_only: false, workspace_id: "ws",
      view: baseView([snapshot("a1", "HP:A")]),
    });
    mockTree();
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open case/i }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Open case/i }));
    await waitFor(() => expect(entry(container, "a1")).not.toBeNull());

    const panel = await openPanel(container, "a1");

    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-open")).toBe(true);
    expect(within(panel).queryByRole("button", { name: "Keep open" })).toBeNull();
    // Opening and closing the tree are not settings: neither is stored.
    fireEvent.click(within(panel).getByRole("button", { name: "Close tree" }));
    noTree();
    const treeSaves = save.mock.calls.filter(([change]) => Object.keys(change).some((name) => name.includes("tree")));
    expect(treeSaves).toEqual([]);
  });
});
