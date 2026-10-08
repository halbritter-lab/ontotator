import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type TreeOpenResponse, type TreeTermDetail } from "../src/api/client";
import { TreeBrowser, type TreeBrowserProps } from "../src/editor/TreeBrowser";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};

const node = (term_id: string, label: string, child_count = 0) => ({ term_id, label, child_count });
const detail = (term_id: string, label: string, extra: Partial<TreeTermDetail> = {}): TreeTermDetail => ({
  term_id,
  label,
  definition: "",
  synonyms: [],
  translations: {},
  parents: [],
  ...extra,
});

const ALL = node("HP:1", "All", 2);
const HEARING = node("HP:365", "Hearing impairment", 1);
const NERVOUS = node("HP:707", "Nervous system", 2);
const AREFLEXIA = node("HP:1284", "Areflexia");
const SEIZURE = node("HP:1250", "Seizure", 2);
const DIALEPTIC = node("HP:11146", "Dialeptic seizure");
const STATUS = node("HP:2133", "Status epilepticus");
const SENSORINEURAL = node("HP:407", "Sensorineural hearing impairment");

// All > (Hearing impairment [closed], Nervous system > (Areflexia, Seizure > (Dialeptic seizure, Status epilepticus)))
const seizureWalk = (): TreeOpenResponse => ({
  browse_id: "walk-1",
  start_status: "valid",
  roots: [ALL],
  path: ["HP:1", "HP:707", "HP:1250"],
  levels: [
    { term_id: "HP:1", children: [HEARING, NERVOUS] },
    { term_id: "HP:707", children: [AREFLEXIA, SEIZURE] },
    { term_id: "HP:1250", children: [DIALEPTIC, STATUS] },
  ],
  detail: detail("HP:1250", "Seizure", {
    definition: "A sudden surge of electrical activity.",
    synonyms: ["Seizures", "Convulsion"],
    translations: { de: ["Krampfanfall", "Anfall"], fr: ["Crise"] },
    parents: [NERVOUS],
  }),
});

// Root > (Alpha > Shared, Beta [closed]); "Shared" also sits under Beta.
const ROOT = node("R", "Root", 2);
const ALPHA = node("A", "Alpha", 1);
const BETA = node("B", "Beta", 2);
const SHARED = node("X", "Shared");
const sharedDetail = detail("X", "Shared", { parents: [ALPHA, BETA] });
const sharedWalk = (): TreeOpenResponse => ({
  browse_id: "walk-2",
  start_status: "valid",
  roots: [ROOT],
  path: ["R", "A", "X"],
  levels: [
    { term_id: "R", children: [ALPHA, BETA] },
    { term_id: "A", children: [SHARED] },
    { term_id: "X", children: [] },
  ],
  detail: sharedDetail,
});

const baseProps = (): TreeBrowserProps => ({
  variant: "dialog",
  workspaceKey: key,
  annotationId: "ann-1",
  layerId: "phenotype",
  startTermId: "HP:1250",
  currentTermId: "HP:1250",
  canAssign: true,
  focusOnOpen: true,
  pinned: false,
  canPin: true,
  onTogglePin: vi.fn(),
  onClose: vi.fn(),
  onUseTerm: vi.fn().mockResolvedValue(undefined),
});

const renderBrowser = (overrides: Partial<TreeBrowserProps> = {}) => {
  const props = { ...baseProps(), ...overrides };
  return { props, ...render(<TreeBrowser {...props} />) };
};

const item = (label: string) =>
  screen.getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const toggleOf = (label: string) => item(label).querySelector(".tree-toggle") as HTMLElement;
const labels = () => screen.getAllByRole("treeitem").map((el) => el.querySelector(".tree-label")?.textContent);
const loaded = (label = "Seizure") => screen.findByText(label, { selector: ".tree-label" });
const useButton = () => screen.getByRole("button", { name: "Use this term" }) as HTMLButtonElement;
const detailPane = (container: HTMLElement) => within(container.querySelector(".tree-detail") as HTMLElement);

const originalScroll = (Element.prototype as any).scrollIntoView;
let scrolled: Array<string | undefined> = [];

beforeEach(() => {
  scrolled = [];
  (Element.prototype as any).scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.key);
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  (Element.prototype as any).scrollIntoView = originalScroll;
});

describe("TreeBrowser: one walk", () => {
  it("opens at the start term: path open, term selected, focused and scrolled into view", async () => {
    const open = vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    renderBrowser();

    const start = (await loaded()).closest('[role="treeitem"]') as HTMLElement;

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toEqual({
      workspace_key: key,
      annotation_id: "ann-1",
      layer_id: "phenotype",
      term_id: "HP:1250",
    });
    expect(labels()).toEqual([
      "All",
      "Hearing impairment",
      "Nervous system",
      "Areflexia",
      "Seizure",
      "Dialeptic seizure",
      "Status epilepticus",
    ]);
    expect(start.dataset.key).toBe("HP:1/HP:707/HP:1250");
    expect(start.getAttribute("aria-selected")).toBe("true");
    expect(start.getAttribute("aria-expanded")).toBe("true");
    expect(start.getAttribute("aria-current")).toBe("true");
    expect(item("Hearing impairment").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(start);
    expect(scrolled).toEqual(["HP:1/HP:707/HP:1250"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows name, id, definition, synonyms and translated names by language", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { container } = renderBrowser();
    await loaded();
    const pane = detailPane(container);

    expect(pane.getByRole("heading", { name: "Seizure" })).toBeDefined();
    expect(pane.getByText("HP:1250")).toBeDefined();
    expect(pane.getByText("A sudden surge of electrical activity.")).toBeDefined();
    expect(pane.getByText("Seizures")).toBeDefined();
    expect(pane.getByText("Convulsion")).toBeDefined();
    expect(pane.getByText("de").nextElementSibling?.textContent).toBe("Krampfanfall; Anfall");
    expect(pane.getByText("fr").nextElementSibling?.textContent).toBe("Crise");
    // The only parent is the one the path runs through.
    expect(pane.queryByText("Also under")).toBeNull();
  });

  it("shows no translation block for a term without translated names", async () => {
    const walk = seizureWalk();
    walk.detail = detail("HP:1250", "Seizure", { parents: [NERVOUS] });
    vi.spyOn(api, "openTree").mockResolvedValue(walk);
    const { container } = renderBrowser();
    await loaded();

    expect(detailPane(container).queryByText("Translated names")).toBeNull();
    expect(detailPane(container).queryByText("Synonyms")).toBeNull();
  });

  it("loads the children of a branch when it is opened, once", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:365", "Hearing impairment", { parents: [ALL] }),
      children: [SENSORINEURAL],
      path: [],
      levels: [],
    });
    renderBrowser();
    await loaded();

    fireEvent.click(toggleOf("Hearing impairment"));
    await loaded("Sensorineural hearing impairment");

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({
      workspace_key: key,
      annotation_id: "ann-1",
      layer_id: "phenotype",
      browse_id: "walk-1",
      term_id: "HP:365",
      expand: true,
    });
    expect(item("Hearing impairment").getAttribute("aria-expanded")).toBe("true");
    // Opening a branch selects nothing.
    expect(item("Seizure").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(toggleOf("Hearing impairment"));
    expect(screen.queryByText("Sensorineural hearing impairment")).toBeNull();
    fireEvent.click(toggleOf("Hearing impairment"));
    expect(screen.getByText("Sensorineural hearing impairment")).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("is operable with the keyboard, loading on the way", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockImplementation(async (req) =>
      req.term_id === "HP:365"
        ? { detail: detail("HP:365", "Hearing impairment"), children: [SENSORINEURAL], path: [], levels: [] }
        : { detail: detail("HP:407", "Sensorineural hearing impairment", { definition: "Inner ear." }), children: [], path: [], levels: [] },
    );
    renderBrowser();
    await loaded();

    fireEvent.keyDown(item("Seizure"), { key: "ArrowLeft" });
    expect(screen.queryByText("Status epilepticus")).toBeNull();
    fireEvent.keyDown(item("Seizure"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Nervous system"));
    fireEvent.keyDown(item("Nervous system"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Hearing impairment"));

    fireEvent.keyDown(item("Hearing impairment"), { key: "ArrowRight" });
    await loaded("Sensorineural hearing impairment");
    expect(load.mock.calls[0][0]).toMatchObject({ term_id: "HP:365", expand: true });

    fireEvent.keyDown(item("Hearing impairment"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Sensorineural hearing impairment"));
    // Still the start term: moving the focus selects nothing.
    expect(item("Seizure").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(item("Sensorineural hearing impairment"), { key: "Enter" });
    expect(item("Sensorineural hearing impairment").getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Inner ear.")).toBeDefined();
    expect(load.mock.calls[1][0]).toMatchObject({ term_id: "HP:407", expand: false });
  });

  it("a click selects; only 'Use this term' assigns, with the walk's id", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus", { definition: "Prolonged.", parents: [SEIZURE] }),
      children: [],
      path: [],
      levels: [],
    });
    const { props } = renderBrowser();
    await loaded();

    // The selected node is the annotation's current term.
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText("This is the annotation's current term.")).toBeDefined();

    fireEvent.click(item("Status epilepticus"));
    expect(item("Status epilepticus").getAttribute("aria-selected")).toBe("true");
    expect(item("Seizure").getAttribute("aria-selected")).toBe("false");
    expect(await screen.findByText("Prolonged.")).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ term_id: "HP:2133", expand: false, browse_id: "walk-1" });
    expect(props.onUseTerm).not.toHaveBeenCalled();

    expect(useButton().disabled).toBe(false);
    fireEvent.click(useButton());
    await waitFor(() => expect(props.onUseTerm).toHaveBeenCalledWith("HP:2133", "walk-1"));
    expect(props.onUseTerm).toHaveBeenCalledTimes(1);
    // Whether the tree closes afterwards is the parent's decision.
    expect(props.onClose).not.toHaveBeenCalled();

    // Back on the current term: disabled again, and its details need no second request.
    fireEvent.click(item("Seizure"));
    expect(useButton().disabled).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not offer to assign while the annotation is not the one being edited", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus"),
      children: [],
      path: [],
      levels: [],
    });
    const { props } = renderBrowser({ canAssign: false });
    await loaded();

    fireEvent.click(item("Status epilepticus"));

    expect(useButton().disabled).toBe(true);
    expect(screen.getByText("Select one of your annotations to assign a term from the tree.")).toBeDefined();
    fireEvent.click(useButton());
    expect(props.onUseTerm).not.toHaveBeenCalled();
  });

  it("shows why assigning failed and stays usable", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus"),
      children: [],
      path: [],
      levels: [],
    });
    const onUseTerm = vi.fn().mockRejectedValue(new Error("Search selection does not match"));
    renderBrowser({ onUseTerm });
    await loaded();

    fireEvent.click(item("Status epilepticus"));
    fireEvent.click(useButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Search selection does not match");
    await waitFor(() => expect(useButton().disabled).toBe(false));
  });

  it("'Also under' opens the path through the other parent and jumps there", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(sharedWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: sharedDetail,
      children: [],
      path: ["R", "B", "X"],
      levels: [
        { term_id: "R", children: [ALPHA, BETA] },
        { term_id: "B", children: [node("Y", "Yonder"), SHARED] },
      ],
    });
    const { container } = renderBrowser({ startTermId: "X", currentTermId: "X" });
    await loaded("Shared");
    const pane = detailPane(container);

    // Alpha is the parent on the open path; only Beta is "also".
    expect(pane.getByText("Also under")).toBeDefined();
    expect(pane.queryByRole("button", { name: "Alpha" })).toBeNull();

    fireEvent.click(pane.getByRole("button", { name: "Beta" }));
    await loaded("Yonder");

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ browse_id: "walk-2", term_id: "X", via_parent_id: "B", expand: false });
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta", "Yonder", "Shared"]);
    const places = screen
      .getAllByText("Shared", { selector: ".tree-label" })
      .map((el) => el.closest('[role="treeitem"]') as HTMLElement);
    expect(places.map((el) => el.dataset.key)).toEqual(["R/A/X", "R/B/X"]);
    expect(places.map((el) => el.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(places[1]);
    expect(scrolled[scrolled.length - 1]).toBe("R/B/X");
    // Seen from Beta, Alpha is the other parent.
    expect(pane.getByRole("button", { name: "Alpha" })).toBeDefined();
    expect(pane.queryByRole("button", { name: "Beta" })).toBeNull();
  });

  it.each([
    ["unknown", "HP:9999999 is not part of this ontology. The tree starts at the top."],
    ["obsolete", "HP:9999999 is obsolete. The tree starts at the top."],
  ] as const)("opens at the top with a notice when the start term is %s", async (status, notice) => {
    vi.spyOn(api, "openTree").mockResolvedValue({
      browse_id: "walk-3",
      start_status: status,
      roots: [ALL],
      path: [],
      levels: [],
      detail: null,
    });
    renderBrowser({ startTermId: "HP:9999999", currentTermId: "HP:9999999" });

    expect((await screen.findByRole("status")).textContent).toBe(notice);
    expect(labels()).toEqual(["All"]);
    expect(item("All").getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(item("All"));
    expect(useButton().disabled).toBe(true);
  });

  it("says so when the tree cannot be loaded", async () => {
    vi.spyOn(api, "openTree").mockRejectedValue(new Error("Layer 'x' is not defined in task profile"));
    renderBrowser();

    expect((await screen.findByRole("alert")).textContent).toBe("Layer 'x' is not defined in task profile");
    expect(screen.queryAllByRole("treeitem")).toEqual([]);
  });
});

describe("TreeBrowser: dialog and panel", () => {
  it("as a dialog it is modal, keeps Tab inside and closes on Escape from anywhere", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { props } = renderBrowser();
    const dialog = await screen.findByRole("dialog", { name: "Ontology tree" });
    await loaded();

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const pin = screen.getByRole("button", { name: "Keep open" });
    const close = screen.getByRole("button", { name: "Close tree" });

    // "Use this term" is disabled here, so the tree row is the last stop.
    fireEvent.keyDown(item("Seizure"), { key: "Tab" });
    expect(document.activeElement).toBe(pin);
    fireEvent.keyDown(pin, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(item("Seizure"));
    // In between, Tab is left to the browser.
    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("as a dialog it takes the focus at once and gives it back when it goes", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    try {
      const { unmount } = renderBrowser();
      // Before the tree has loaded, the focus is already inside the dialog.
      expect(screen.getByRole("dialog", { name: "Ontology tree" }).contains(document.activeElement)).toBe(true);
      await loaded();
      unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it("as a panel it is a plain region: Escape closes it only from inside the tree", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { props, container } = renderBrowser({ variant: "panel", pinned: true });
    const region = await screen.findByRole("region", { name: "Ontology tree" });
    await loaded();

    expect(region.hasAttribute("aria-modal")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector(".tree-host--panel")).not.toBeNull();
    expect(container.querySelector(".tree-host--dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Keep open" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Close tree" }), { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    // Tab is not trapped.
    expect(fireEvent.keyDown(item("Seizure"), { key: "Tab" })).toBe(true);

    fireEvent.keyDown(item("Seizure"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not pull the focus into a panel that was not opened by hand", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    renderBrowser({ variant: "panel", pinned: true, focusOnOpen: false });
    await loaded();

    expect(scrolled).toEqual(["HP:1/HP:707/HP:1250"]);
    expect(screen.getByRole("region", { name: "Ontology tree" }).contains(document.activeElement)).toBe(false);
  });

  it("has a pin switch only where pinning is possible, and a close button always", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { props, unmount } = renderBrowser();
    await loaded();

    const pin = screen.getByRole("button", { name: "Keep open" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close tree" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    unmount();

    renderBrowser({ canPin: false });
    await loaded();
    expect(screen.queryByRole("button", { name: "Keep open" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close tree" })).toBeDefined();
  });

  it("pinning keeps the walk: same tree, same selection, no second request", async () => {
    const open = vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus"),
      children: [],
      path: [],
      levels: [],
    });
    const props = baseProps();
    const { rerender } = render(<TreeBrowser {...props} />);
    await loaded();
    fireEvent.click(item("Status epilepticus"));
    const row = item("Status epilepticus");

    rerender(<TreeBrowser {...props} variant="panel" pinned />);

    expect(screen.getByRole("region", { name: "Ontology tree" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    // The very same DOM node, still selected.
    expect(item("Status epilepticus")).toBe(row);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });
});
