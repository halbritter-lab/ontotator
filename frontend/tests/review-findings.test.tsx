import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiClient,
  ConflictError,
  initSessionToken,
  parseContentDispositionFilename,
  parseLaunchHash,
  setActiveSessionToken,
  takeLaunchPackageId,
} from "../src/api/client";
import { App, ANNOTATOR_STORAGE_KEY, modeStorageKey } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { CaseErrorBoundary } from "../src/app/ErrorBoundary";
import { createMutationQueue, UnsavedChangesError } from "../src/editor/autosave";
import { ReviewActions } from "../src/editor/ReviewActions";
import { SearchPanel } from "../src/editor/SearchPanel";
import { SearchManager } from "../src/editor/searchState";
import { TextPane } from "../src/editor/TextPane";
import { getOffsetMapBuildCount, toCodepoint, toUtf16 } from "../src/spans/offsets";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};
const scope = { scope_id: "scope-default", mode: "independent" as const, editable_layer_ids: ["phenotype"], reference_layer_ids: [] };
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

const baseView = (): WorkspaceView => ({
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
  draft: { key, targets: { target_set_id: "empty", targets: [] }, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
});

const proposal = (annotationId: string, version: string, termId: string, segments = [{ start: 0, end: 5 }]) => ({
  schema_version: "ontocurator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId,
    document_id: "doc",
    layer_id: "phenotype",
    type_id: "default",
    term_id: termId,
    axes_values: { assertion: "absent" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance: { actor: { actor_id: "source", kind: "tool" as const }, method: "automated" },
  },
  evidence: [{ mention: { evidence_id: `ev-${annotationId}`, segments, cue_segments: [] }, version: "ev-v", document_id: "doc", text_sha256: "text" }],
  version,
  document_id: "doc",
  text_sha256: "text",
  ontology_sha256: "ontology",
  layer_config_sha256: "layer-sha",
});

const reviewView = (decisions: any[] = [], annotations: any[] = [], evidence: any[] = []): WorkspaceView => {
  const view = baseView();
  const target = proposal("prop", "p-v1", "HP:0001");
  view.key = { ...key, mode: "review" };
  view.scope = { ...scope, mode: "review" };
  view.available_inputs = [target];
  view.targets = { target_set_id: "targets", targets: [{ annotation_id: "prop", version: "p-v1" }] };
  view.draft = { ...view.draft, key: view.key, targets: view.targets, decisions, annotations, evidence };
  return view;
};

const docs = [
  { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "completed" as const },
  { document_id: "doc-2", text_length: 10, language: "en", position: 2, status: "in_progress" as const },
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("A2/token: launch hash and token storage", () => {
  it("parses #token=T&package_id=P, strips the hash and never stores the token in localStorage", () => {
    expect(parseLaunchHash("#token=T&package_id=P")).toEqual({ token: "T", packageId: "P" });
    setActiveSessionToken(null);
    window.localStorage.setItem("hpo-editor-token", "stale");
    history.replaceState(null, "", "/#token=abc%2B1&package_id=pkg-2");
    expect(initSessionToken()).toBe("abc+1");
    expect(window.location.hash).toBe("");
    expect(takeLaunchPackageId()).toBe("pkg-2");
    expect(takeLaunchPackageId()).toBeNull();
    expect(window.localStorage.getItem("hpo-editor-token")).toBeNull();
    // Reload: memory is gone but the tab-scoped sessionStorage still has it.
    setActiveSessionToken(null);
    expect(initSessionToken()).toBe("abc+1");
  });

  it("preselects the package passed in the launch link", async () => {
    history.replaceState(null, "", "/#token=t&package_id=pkg-b");
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg-a" }, { package_id: "pkg-b" }] as any);
    const list = vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list.mock.calls[0][0]).toBe("pkg-b");
    expect((screen.getByLabelText(/Work Package/i) as HTMLSelectElement).value).toBe("pkg-b");
  });
});

describe("A1/A7: dashboard blinding, identity and persistence", () => {
  it("does not refetch on every keystroke, applies the annotator on blur and persists identity and mode", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    const list = vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    const inputs = vi.spyOn(api, "getReviewInputs").mockResolvedValue([]);
    const first = render(<App />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    const field = screen.getByLabelText(/Annotator ID/i);
    fireEvent.change(field, { target: { value: "d" } });
    fireEvent.change(field, { target: { value: "dr" } });
    fireEvent.change(field, { target: { value: "dr-x" } });
    expect(list).toHaveBeenCalledTimes(1);
    fireEvent.blur(field);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls[1][1]).toEqual({ annotator_id: "dr-x", mode: "independent" });
    expect(window.localStorage.getItem(ANNOTATOR_STORAGE_KEY)).toBe("dr-x");
    fireEvent.change(screen.getByLabelText(/Working Mode/i), { target: { value: "review" } });
    expect(window.localStorage.getItem(modeStorageKey("pkg"))).toBe("review");
    expect(inputs).not.toHaveBeenCalled();
    first.unmount();

    render(<App />);
    await waitFor(() => expect((screen.getByLabelText(/Annotator ID/i) as HTMLInputElement).value).toBe("dr-x"));
    await waitFor(() => expect((screen.getByLabelText(/Working Mode/i) as HTMLSelectElement).value).toBe("review"));
    expect(inputs).not.toHaveBeenCalled();
  });

  it("dedupes ontology badges, keeps hero and selection consistent and disables open while loading", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listOntologies").mockResolvedValue([
      { ontology_id: "hp", release: "a", sha256: "1", term_count: 1 },
      { ontology_id: "hp", release: "b", sha256: "2", term_count: 1 },
    ]);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    let finishOpen!: (v: any) => void;
    const open = vi.spyOn(api, "openWorkspace").mockImplementation(() => new Promise((resolve) => { finishOpen = resolve; }));
    render(<App />);
    await waitFor(() => expect(screen.getByText("Ontologies: HP")).toBeDefined());
    // Selection defaults to the in-progress case and the hero shows that case.
    const hero = document.querySelector(".dashboard-hero") as HTMLElement;
    await waitFor(() => expect(within(hero).getByText("doc-2")).toBeDefined());
    fireEvent.click(within(screen.getByRole("table")).getByText("doc-1"));
    await waitFor(() => expect(within(document.querySelector(".dashboard-hero") as HTMLElement).getByText("doc-1")).toBeDefined());
    const openBtn = screen.getByRole("button", { name: /Open Workspace/i });
    fireEvent.click(openBtn);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Opening/i }).length).toBeGreaterThan(0));
    for (const b of screen.getAllByRole("button", { name: /Opening/i })) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: /Opening/i })[0]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].document_id).toBe("doc-1");
    await act(async () => finishOpen({ workspace_id: "ws", view: baseView() }));
  });

  it("shows the annotator identity in the case header", () => {
    render(<CaseScreen view={baseView()} workspaceId="ws" onClose={vi.fn()} />);
    expect(screen.getByTestId("annotator-identity").textContent).toContain("dr-a");
  });
});

describe("Export", () => {
  it("uses the server filename from Content-Disposition (filename and filename*)", async () => {
    expect(parseContentDispositionFilename('attachment; filename="case-1_dr-a.zip"')).toBe("case-1_dr-a.zip");
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''f%C3%A4lle.zip; filename=\"x.zip\"")).toBe("fälle.zip");
    expect(parseContentDispositionFilename(null)).toBeNull();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="pkg_dr-a_review.zip"' }),
      blob: async () => new Blob(["zip"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    let downloaded = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
    const name = await new ApiClient({ token: "t" }).downloadPackageExport("pkg", { annotator_id: "dr a", mode: "review" });
    expect(name).toBe("pkg_dr-a_review.zip");
    expect(downloaded).toBe("pkg_dr-a_review.zip");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/packages/pkg/export?annotator_id=dr+a&mode=review");
    await new Promise((r) => setTimeout(r, 0));
  });

  it("reports export failures in English and offers a package-wide export on the dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(new ApiClient().downloadExport("ws")).rejects.toThrow(/Export failed \(500\)/);
    vi.unstubAllGlobals();
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    const exportSpy = vi.spyOn(api, "downloadPackageExport").mockResolvedValue("x.zip");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Export package/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith("pkg", { annotator_id: "annotator-1", mode: "independent" }));
  });
});

describe("A4/A5: review decisions and notes", () => {
  const rejected = { decision_id: "d", target: { annotation_id: "prop", version: "p-v1" }, outcome: "rejected" as const, note: "wrong body site", reviewer_id: "dr-a" };

  it("never overrides an explicit rejection when an adopted copy is edited", async () => {
    const copy = proposal("copy", "c-v1", "HP:0001");
    copy.annotation.provenance = { actor: { actor_id: "dr-a", kind: "human" as any }, method: "manual", source_refs: ["prop:p-v1"] } as any;
    const view = reviewView([rejected], [copy], copy.evidence);
    vi.spyOn(api, "applyCommand").mockResolvedValue({
      ...view.draft, revision: 1,
      annotations: [{ ...copy, version: "c-v2", annotation: { ...copy.annotation, axes_values: { assertion: "present" } } }],
    });
    const decide = vi.spyOn(api, "recordDecision");
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("HP:0001", { selector: ".doc-list li:not(.doc-item--resolved) *" }));
    fireEvent.click(screen.getByRole("radio", { name: /Present/i }));
    await waitFor(() => expect(api.applyCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps the saved note when deciding via keyboard and saves notes typed after the outcome on blur", async () => {
    const view = reviewView([{ ...rejected, outcome: "uncertain" }]);
    const decide = vi.spyOn(api, "recordDecision").mockImplementation(async (_ws, env: any) => ({
      ...view.draft, revision: 1,
      decisions: env.payload.outcome ? [{ ...rejected, outcome: env.payload.outcome, note: env.payload.note }] : [],
    }));
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(screen.getByLabelText("Reviewer note")).toBeDefined());
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0][1].payload).toEqual(expect.objectContaining({ outcome: "rejected", note: "wrong body site" }));

    const noteField = screen.getByLabelText("Reviewer note");
    fireEvent.change(noteField, { target: { value: "laterality differs" } });
    fireEvent.blur(noteField);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1][1].payload).toEqual(expect.objectContaining({ outcome: "rejected", note: "laterality differs" }));

    // Toggling the active outcome off removes the decision but keeps the note text in the editor.
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(3));
    expect(decide.mock.calls[2][1].payload.outcome).toBeNull();
    expect((screen.getByLabelText("Reviewer note") as HTMLInputElement).value).toBe("laterality differs");
    // ...and the next decision carries it again.
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(4));
    expect(decide.mock.calls[3][1].payload).toEqual(expect.objectContaining({ outcome: "confirmed", note: "laterality differs" }));
  });

  it("ReviewActions sends the typed note when it is committed with an existing decision", () => {
    const onDecide = vi.fn();
    render(
      <ReviewActions
        target={{ annotation_id: "a", version: "v", provenance: { actor: { actor_id: "x", kind: "tool" }, method: "m" }, evidence_count: 0 }}
        currentDecision={{ decision_id: "d", target: { annotation_id: "a", version: "v" }, outcome: "confirmed", reviewer_id: "r" } as any}
        draftAnnotations={[]}
        onDecide={onDecide}
      />,
    );
    const field = screen.getByLabelText("Reviewer note");
    fireEvent.change(field, { target: { value: "ok after re-reading" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onDecide).toHaveBeenCalledWith({ outcome: "confirmed", replacement: undefined, note: "ok after re-reading" });
  });

  it("asks before adopting (key 3) a proposal that is already rejected", async () => {
    const view = reviewView([rejected]);
    const apply = vi.spyOn(api, "applyCommand");
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(screen.getByLabelText("Reviewer note")).toBeDefined());
    fireEvent.keyDown(window, { key: "3" });
    const dialog = await screen.findByRole("dialog", { name: /Replace existing decision/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(apply).not.toHaveBeenCalled();
  });

  it("rolls back a partially adopted copy when attaching further mentions fails", async () => {
    const view = reviewView();
    const target = proposal("prop", "p-v1", "HP:0001");
    target.evidence.push({ mention: { evidence_id: "ev-2", segments: [{ start: 6, end: 10 }], cue_segments: [] }, version: "ev-v", document_id: "doc", text_sha256: "text" });
    view.available_inputs = [target];
    const { ValidationError } = await import("../src/api/client");
    const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_ws, env: any) => {
      if (env.payload.command === "attach_mention") throw new ValidationError("bad span");
      return { ...view.draft, revision: 1 };
    });
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("HP:0001"));
    fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/i }));
    await waitFor(() => expect(screen.getByText(/incomplete copy was removed/i)).toBeDefined());
    expect(apply.mock.calls.map((c: any) => c[1].payload.command)).toEqual(["create_annotation", "attach_mention", "delete_draft_annotation"]);
  });
});

describe("A6: conflicts and offline state", () => {
  it("shows a conflict banner, reloads the case, and allows leaving after confirmation", async () => {
    const view = baseView();
    view.draft.annotations = [proposal("own", "o-v1", "HP:0003")] as any;
    vi.spyOn(api, "applyCommand").mockRejectedValue(new ConflictError());
    const onReload = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} onReload={onReload}
      onNavigateCase={onNavigate} documentList={[{ ...docs[0], document_id: "doc" }, docs[1]]} />);
    fireEvent.click(screen.getByText("HP:0003"));
    fireEvent.click(screen.getByRole("radio", { name: /Present/i }));
    const banner = await screen.findByRole("alert", { name: /Revision conflict/i });
    expect(banner.textContent).toMatch(/Case was changed elsewhere/);
    expect(screen.getByRole("status").textContent).not.toMatch(/Saved/);

    fireEvent.click(screen.getByRole("button", { name: /Reload case/i }));
    const dialog = await screen.findByRole("dialog", { name: /Reload case/i });
    expect(dialog.textContent).toMatch(/will be discarded/);
    fireEvent.click(within(dialog).getByRole("button", { name: /Discard edits and reload/i }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("lets the user leave a conflicted case after confirming that edits are discarded", async () => {
    const view = baseView();
    view.draft.annotations = [proposal("own", "o-v1", "HP:0003")] as any;
    vi.spyOn(api, "applyCommand").mockRejectedValue(new ConflictError());
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}
      onNavigateCase={onNavigate} documentList={[{ ...docs[0], document_id: "doc" }, docs[1]]} />);
    fireEvent.click(screen.getByText("HP:0003"));
    fireEvent.click(screen.getByRole("radio", { name: /Present/i }));
    await screen.findByRole("alert", { name: /Revision conflict/i });
    fireEvent.click(screen.getByRole("button", { name: /Next Case/i }));
    const dialog = await screen.findByRole("dialog", { name: /Case was changed elsewhere/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Discard edits and leave/i }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("doc-2"));
  });

  it("never shows 'Saved' while the server is unreachable", async () => {
    const view = baseView();
    view.draft.annotations = [proposal("own", "o-v1", "HP:0003")] as any;
    vi.spyOn(api, "applyCommand").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("HP:0003"));
    fireEvent.click(screen.getByRole("radio", { name: /Present/i }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Offline – changes not saved/));
    expect(screen.getByRole("button", { name: /Retry/i })).toBeDefined();
  });

  it("queue: flush reports unsaved state and discardPending unblocks it", async () => {
    const queue = createMutationQueue({ initialRevision: 3 });
    const pending = queue.enqueue(async () => { throw new ConflictError(); });
    await expect(pending).rejects.toBeInstanceOf(ConflictError);
    await expect(queue.flush()).rejects.toBeInstanceOf(UnsavedChangesError);
    expect(queue.discardPending(7)).toBe(1);
    expect(queue.getState()).toBe("saved");
    expect(queue.getRevision()).toBe(7);
    await expect(queue.flush()).resolves.toBeUndefined();
  });
});

describe("Submit", () => {
  it("requires an explicit full-text check, shows a summary, has a single submit button and refreshes the list", async () => {
    const view = baseView();
    view.draft.annotations = [proposal("own", "o-v1", "HP:0003")] as any;
    const submit = vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s", created_at: "now", snapshots: [], decisions: [] } as any);
    const onSubmitted = vi.fn();
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} onSubmitted={onSubmitted} />);
    expect(screen.getAllByRole("button", { name: /Submit Case/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit case/i });
    expect(dialog.textContent).toMatch(/1 annotation\(s\)/);
    const confirm = within(dialog).getByRole("button", { name: /^Submit case$/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Entire text checked/i }));
    fireEvent.click(confirm);
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it("shows open review decisions in the summary and blocks submission", async () => {
    vi.spyOn(api, "submitWorkspace");
    render(<CaseScreen view={reviewView()} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit case/i });
    expect(dialog.textContent).toMatch(/0 of 1 review proposal\(s\) decided/);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect((within(dialog).getByRole("button", { name: /^Submit case$/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Search", () => {
  it("debounces typing into a single request and aborts superseded requests", async () => {
    vi.useFakeTimers();
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const manager = new SearchManager({ searchOntology } as any);
    render(<SearchPanel searchManager={manager} annotationId="a" workspaceKey={key} layerId="phenotype" onSelectCandidate={vi.fn()} />);
    const input = screen.getByLabelText(/Search ontology term/i);
    for (const value of ["h", "hy", "hyp", "hypo"]) fireEvent.change(input, { target: { value } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(searchOntology).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(searchOntology).toHaveBeenCalledTimes(1);
    expect(searchOntology.mock.calls[0][0].query).toBe("hypo");
    vi.useRealTimers();

    const signals: AbortSignal[] = [];
    const slow = vi.fn((_req: any, signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}); });
    const m2 = new SearchManager({ searchOntology: slow } as any);
    void m2.search("a", "x", key);
    void m2.search("ab", "x", key);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});

describe("Annotation panel and text pane", () => {
  const withMention = () => {
    const view = baseView();
    const own = proposal("own", "o-v1", "HP:0003", [{ start: 6, end: 10 }]);
    view.draft.annotations = [own] as any;
    view.draft.evidence = own.evidence as any;
    return view;
  };

  it("shows quoted mention text (offsets in tooltip) and confirms before removing", async () => {
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(baseView().draft);
    render(<CaseScreen view={withMention()} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("HP:0003"));
    const snippet = document.querySelector(".mention-snippet") as HTMLElement;
    expect(snippet.textContent).toBe("“beta”");
    expect(snippet.title).toBe("Offsets: [6:10]");
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Yes, remove/ }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0][1].payload.command).toBe("detach_mention");
  });

  it("shows a visible banner in add-mention mode that Esc cancels", async () => {
    render(<CaseScreen view={withMention()} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("HP:0003"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Mention/ }));
    expect(screen.getByText(/Adding a mention:/)).toBeDefined();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Adding a mention:/)).toBeNull());
    // The annotation stays selected.
    expect(screen.getByText(/Context Axes/i)).toBeDefined();
  });

  it("commits a keyboard (Shift+arrow) selection when Shift is released", () => {
    const onSelection = vi.fn();
    const view = render(<TextPane text="alpha beta" mentions={[]} selectedEvidenceId={null} selectionIntent="new_mention"
      onSelection={onSelection} onPick={vi.fn()} onChangeIntent={vi.fn()} />);
    const container = view.container.querySelector(".text-container")!;
    const node = container.querySelector(".run")!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.keyDown(container, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyUp(container, { key: "Shift" });
    expect(onSelection).toHaveBeenCalledWith({ segments: [{ start: 0, end: 5 }], intent: "new_mention", evidenceId: undefined });
  });

  it("does not crash on mentions with invalid offsets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<TextPane text="short" mentions={[{ evidence_id: "bad", segments: [{ start: 2, end: 99 }] }]} selectedEvidenceId={null}
      selectionIntent="new_mention" onSelection={vi.fn()} onPick={vi.fn()} onChangeIntent={vi.fn()} />);
    expect(screen.getByText(/1 mention\(s\) have offsets outside this text/)).toBeDefined();
    warn.mockRestore();
  });

  it("caches offset maps instead of rebuilding them per conversion", () => {
    const text = "a😀b".repeat(50);
    toUtf16(text, 1);
    const before = getOffsetMapBuildCount();
    for (let i = 0; i < 100; i++) { toUtf16(text, i); toCodepoint(text, 0); }
    expect(getOffsetMapBuildCount()).toBe(before);
  });
});

describe("Shortcuts and error handling", () => {
  const twoTargets = () => {
    const view = reviewView();
    view.available_inputs = [proposal("prop", "p-v1", "HP:0001"), proposal("p2", "p2-v1", "HP:0002")];
    view.targets = { target_set_id: "t", targets: [{ annotation_id: "prop", version: "p-v1" }, { annotation_id: "p2", version: "p2-v1" }] };
    view.draft = { ...view.draft, targets: view.targets };
    return view;
  };

  it("ignores auto-repeat and keys typed in contentEditable or while a dialog is open; '?' shows help", async () => {
    const decide = vi.spyOn(api, "recordDecision").mockResolvedValue(twoTargets().draft);
    render(<CaseScreen view={twoTargets()} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(screen.getByText(/Review decision for this proposal/)).toBeDefined());
    fireEvent.keyDown(window, { key: "1", repeat: true });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: "1" });
    editable.remove();
    fireEvent.keyDown(window, { key: "?" });
    const help = screen.getByRole("dialog", { name: /Keyboard shortcuts/i });
    expect(help.textContent).toMatch(/j \/ k/);
    expect(help.textContent).toMatch(/Esc/);
    fireEvent.keyDown(window, { key: "1" });
    expect(decide).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  });

  it("surfaces navigation failures from the post-submit modal instead of swallowing them", async () => {
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s", created_at: "now", snapshots: [], decisions: [] } as any);
    const onNavigate = vi.fn().mockRejectedValue(new Error("network down"));
    render(<CaseScreen view={baseView()} workspaceId="ws" onClose={vi.fn()} onNavigateCase={onNavigate}
      documentList={[{ ...docs[0], document_id: "doc" }, docs[1]]} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit case/i });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Submit case$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Review next case/i }));
    await waitFor(() => expect(screen.getByText("network down")).toBeDefined());
  });

  it("shows a recoverable message when the case screen crashes", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => { throw new Error("kaputt"); };
    const back = vi.fn();
    render(<CaseErrorBoundary onBackToDashboard={back}><Boom /></CaseErrorBoundary>);
    expect(screen.getByText(/Something went wrong while displaying this case/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Back to dashboard/i }));
    expect(back).toHaveBeenCalled();
    err.mockRestore();
  });

  it("shows navigation errors from the dashboard open flow", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    vi.spyOn(api, "openWorkspace").mockRejectedValue(new Error("boom"));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Open Workspace/i }));
    await waitFor(() => expect(screen.getByText(/Error opening case: boom/)).toBeDefined());
  });
});
