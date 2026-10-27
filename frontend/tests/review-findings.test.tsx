import userEvent from "@testing-library/user-event";
import { assigned, assignedList } from "./assignments";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  ConflictError,
} from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { CaseErrorBoundary } from "../src/app/ErrorBoundary";
import { createMutationQueue, UnsavedChangesError } from "../src/editor/autosave";
import { ReviewActions } from "../src/editor/ReviewActions";
import { SearchPanel } from "../src/editor/SearchPanel";
import { SearchManager } from "../src/editor/searchState";
import { TextPane } from "../src/editor/TextPane";
import { getOffsetMapBuildCount, toCodepoint, toUtf16 } from "../src/spans/offsets";
import { loggedInAs } from "./session";

const key = {
  project_key: "pkg",
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
  require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false, axes_definition: "editor-axes/v1",
  axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  axes_config_sha256: "sha-axes",
  draft: { key, targets: { target_set_id: "empty", targets: [] }, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
});

const proposal = (annotationId: string, version: string, termId: string, segments = [{ start: 0, end: 5 }]) => ({
  schema_version: "ontotator-annotation/v3" as const,
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

// The identity comes from the session; the preferences only keep the working modes.
const asAnnotator = (id: string) => {
  loggedInAs(id);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: id, mode_by_package: {} });
  vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: id, mode_by_package: {} });
};
const confirmIdentity = async () => {};

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

describe("A1/A7: dashboard blinding, identity and persistence", () => {
  it("opens a zero-proposal case for a review-only role without constructing fresh targets", async () => {
    asAnnotator("dr-a");
    vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg", roles: ["reviewer"], can_manage: false, allowed_modes: ["review"] }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue([{ ...docs[0], has_review_inputs: false }]);
    const inputs = vi.spyOn(api, "getReviewInputs").mockResolvedValue([]);
    const view = reviewView();
    view.targets = { target_set_id: "empty", targets: [] };
    view.available_inputs = [];
    assignedList(view);
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view }).assignment);
    const open = vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view }));
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /^(Start|Continue|View)$/ }));
    await confirmIdentity();
    await waitFor(() => expect(open).toHaveBeenCalledWith(1));
    expect(inputs).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Finish & submit/i })).toBeDefined();
  });

  it("requires and sends explicit round selection when resuming is ambiguous", async () => {
    asAnnotator("dr-a");
    vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg", roles: ["reviewer"], can_manage: false, allowed_modes: ["review"] }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    assignedList(reviewView());
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: reviewView() }).assignment);
    const open = vi.spyOn(api, "openAssignment")
      .mockRejectedValueOnce(new ApiError(422, "Select the review round to resume", "AMBIGUOUS_REVIEW_ROUND", { rounds: ["round-a", "round-b"] } as any))
      .mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: reviewView() }));
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /^(Start|Continue|View)$/ }));
    await confirmIdentity();
    const dialog = await screen.findByRole("dialog", { name: /Select review round/i });
    fireEvent.change(within(dialog).getByLabelText("Review round"), { target: { value: "round-b" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Resume round/i }));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(1, { review_round_target_set_id: "round-b" }));
  });

  it("opens an assignment once while its workspace is loading", async () => {
    asAnnotator("dr-a");
    vi.spyOn(api, "listProjects").mockResolvedValue([]);
    assignedList(baseView());
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: baseView() }).assignment);
    let finishOpen!: (value: any) => void;
    const open = vi.spyOn(api, "openAssignment").mockImplementation(() => new Promise(resolve => { finishOpen = resolve; }));
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /^(Start|Continue|View)$/ }));
    await screen.findByText("Opening task…");
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => finishOpen(assigned({ read_only: false, workspace_id: "ws", view: baseView() })));
    await screen.findByTestId("annotator-identity");
  });

  it("shows the annotator identity in the case header", () => {
    render(<CaseScreen view={baseView()} workspaceId="ws" onClose={vi.fn()} />);
    expect(screen.getByTestId("annotator-identity").textContent).toContain("dr-a");
  });

  it("shows the display name with the pseudonym; only the name has a bounded width", () => {
    const name = "Maximiliane Schmidt-Rottluff";
    render(<CaseScreen view={baseView()} workspaceId="ws" onClose={vi.fn()} annotatorName={name} />);
    const badge = screen.getByTestId("annotator-identity");
    expect(badge.textContent).toBe(`as ${name} (dr-a)`);
    expect(badge.title).toBe(`${name} (dr-a): your annotations and decisions are saved under this pseudonym`);
    // The CSS class .identity-name cuts the name with an ellipsis; the pseudonym is outside it.
    const cut = screen.getByTestId("annotator-name");
    expect(cut.className).toBe("identity-name");
    expect(cut.textContent).toBe(name);
    expect(badge.querySelector("strong")!.textContent).toBe(`${name} (dr-a)`);
  });
});

describe("A4/A5: review decisions and notes", () => {
  const rejected = { decision_id: "d", target: { annotation_id: "prop", version: "p-v1" }, outcome: "rejected" as const, note: "wrong body site", reviewer_id: "dr-a" };

  it.each([false, true])("same-value axis confirmation binds a changed replacement while preserving explicit rejection=%s", async (explicitRejection) => {
    const copy = proposal("copy", "c-v1", "HP:0001");
    copy.annotation.provenance = { actor: { actor_id: "dr-a", kind: "human" as any }, method: "manual", source_refs: ["prop:p-v1"] } as any;
    const view = reviewView(explicitRejection ? [rejected] : [], [copy], copy.evidence);
    (copy.annotation as any).axes_defaulted = ["assertion"];
    view.available_inputs![0].annotation.axes_defaulted = ["assertion"];
    const updated = { ...copy, version: "c-v2", annotation: { ...copy.annotation, axes_defaulted: [] } };
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1, annotations: [updated] });
    const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...view.draft, revision: 2, annotations: [updated] });
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("HP:0001", { selector: '[data-list-key="annotation:copy"] *' }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm defaults (1)" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][1].payload).toEqual(expect.objectContaining({ command: "set_axes", chosen_axis_ids: ["assertion"], axes_values: { assertion: "absent" } }));
    if (explicitRejection) {
      await act(async () => { await Promise.resolve(); });
      expect(decide).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
      expect(decide.mock.calls[0][1].payload).toEqual(expect.objectContaining({ outcome: "changed", replacement: { annotation_id: "copy", version: "c-v2" } }));
    }
  });

  it("confirms discarding an adopted edited copy before switching away from changed", async () => {
    const copy = proposal("copy", "edited-v2", "HP:0002");
    copy.annotation.provenance = { actor: { actor_id: "dr-a", kind: "human" as any }, method: "manual", source_refs: ["prop:p-v1"] } as any;
    const changed = { ...rejected, outcome: "changed" as const, replacement: { annotation_id: "copy", version: "edited-v2" } };
    const view = reviewView([changed], [copy], copy.evidence);
    const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...view.draft, revision: 1, annotations: [], evidence: [], decisions: [rejected] });
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "2" });
    const dialog = await screen.findByRole("dialog", { name: /Discard adopted copy/i });
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    expect(decide).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "2" });
    const confirm = await screen.findByRole("dialog", { name: /Discard adopted copy/i });
    fireEvent.click(within(confirm).getByRole("button", { name: /Discard copy and change decision/i }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0][1].payload.outcome).toBe("rejected");
    await waitFor(() => expect(screen.queryByText("HP:0002")).toBeNull());
  });

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
    // The only proposal is decided, so the selection moved on to Finish & submit; J brings it back.
    await waitFor(() => expect(screen.queryByLabelText("Reviewer note")).toBeNull());
    fireEvent.keyDown(window, { key: "j" });

    const noteField = screen.getByLabelText("Reviewer note");
    fireEvent.change(noteField, { target: { value: "laterality differs" } });
    fireEvent.blur(noteField);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1][1].payload).toEqual(expect.objectContaining({ outcome: "rejected", note: "laterality differs" }));

    // Repeating the outcome moves on and saves nothing (F7); explicit zero resets while retaining the note.
    fireEvent.click(screen.getByRole("button", { name: /^Reject/ }));
    await waitFor(() => expect(screen.queryByLabelText("Reviewer note")).toBeNull());
    expect(decide).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "0" });
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(3));
    expect(decide.mock.calls[2][1].payload.outcome).toBeNull();
    expect((screen.getByLabelText("Reviewer note") as HTMLInputElement).value).toBe("laterality differs");
    // ...and the next decision carries it again.
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(4));
    expect(decide.mock.calls[3][1].payload).toEqual(expect.objectContaining({ outcome: "confirmed", note: "laterality differs" }));
  });

  it("ReviewActions permits multiline notes and saves them on blur with an existing decision", async () => {
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
    await userEvent.type(field, "ok after re-reading{Enter}Confirmed with source");
    expect(field).toHaveProperty("value", "ok after re-reading\nConfirmed with source");
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onDecide).toHaveBeenCalledWith({ outcome: "confirmed", replacement: undefined, note: "ok after re-reading\nConfirmed with source" });
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
    fireEvent.click(screen.getByRole("button", { name: /Next text/i }));
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
  it("states the full-text check, shows a summary, has a single submit button and refreshes the list", async () => {
    const view = baseView();
    view.draft.annotations = [proposal("own", "o-v1", "HP:0003")] as any;
    const submit = vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s", created_at: "now", snapshots: [], decisions: [] } as any);
    const onSubmitted = vi.fn();
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} onSubmitted={onSubmitted} />);
    expect(screen.getAllByRole("button", { name: /Submit text/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Finish & submit/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit text/i });
    expect(dialog.textContent).toMatch(/1 annotation in this case/);
    const confirm = within(dialog).getByRole("button", { name: /^Submit text$/i }) as HTMLButtonElement;
    expect(dialog.textContent).toContain("Submitting confirms you checked the entire text for further findings.");
    expect(confirm.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it("shows open review decisions in the summary and blocks submission", async () => {
    vi.spyOn(api, "submitWorkspace");
    render(<CaseScreen view={reviewView()} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & submit/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit text/i });
    expect(dialog.textContent).toMatch(/0 of 1 review proposal decided/);
    expect(within(dialog).getByRole("button", { name: /^Submit text$/i }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Review cases", () => {
  const confirmed = { decision_id: "d", target: { annotation_id: "prop", version: "p-v1" }, outcome: "confirmed" as const, reviewer_id: "dr-a" };
  const submitCase = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Finish & submit/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit text/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Submit text$/i }));
  };

  it("counts confirmed proposals among the annotations that will be submitted", async () => {
    const own = proposal("own", "o-v1", "HP:0003");
    render(<CaseScreen view={reviewView([confirmed], [own], own.evidence)} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & submit/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit text/i });
    expect(dialog.textContent).toMatch(/2 annotations will be submitted \(1 confirmed proposal, 1 saved finding\)/);
  });

  it("offers the next case including zero proposals after submitting a review", async () => {
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s", created_at: "now", snapshots: [], decisions: [] } as any);
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    const documentList = [
      { ...docs[0], document_id: "doc", has_review_inputs: true },
      { ...docs[1], document_id: "doc-de", position: 2, has_review_inputs: false },
      { ...docs[1], document_id: "doc-3", position: 3, has_review_inputs: true },
    ];
    render(<CaseScreen view={reviewView([confirmed])} workspaceId="ws" onClose={vi.fn()}
      onNavigateCase={onNavigate} documentList={documentList} />);
    await submitCase();
    fireEvent.click(await screen.findByRole("button", { name: /Review next text \(Text 2\)/i }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("doc-de"));
  });

  it("offers a later case even when it has no proposals", async () => {
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s", created_at: "now", snapshots: [], decisions: [] } as any);
    const documentList = [
      { ...docs[0], document_id: "doc", has_review_inputs: true },
      { ...docs[1], document_id: "doc-de", has_review_inputs: false },
    ];
    render(<CaseScreen view={reviewView([confirmed])} workspaceId="ws" onClose={vi.fn()}
      onNavigateCase={vi.fn()} documentList={documentList} />);
    await submitCase();
    await screen.findByRole("dialog", { name: /Text submitted/i });
    expect(screen.getByRole("button", { name: /Review next text/i })).toBeDefined();
  });

  it("quotes each proposal's text so equally named proposals can be told apart", () => {
    const view = reviewView();
    const second = proposal("prop-2", "p2-v1", "HP:0001", [{ start: 11, end: 16 }]);
    const spanless = { ...proposal("prop-3", "p3-v1", "HP:0002"), evidence: [] };
    spanless.annotation = { ...spanless.annotation, evidence_refs: [] };
    view.available_inputs = [...view.available_inputs!, second, spanless];
    view.targets = { target_set_id: "targets", targets: [
      { annotation_id: "prop", version: "p-v1" },
      { annotation_id: "prop-2", version: "p2-v1" },
      { annotation_id: "prop-3", version: "p3-v1" },
    ] };
    view.draft = { ...view.draft, targets: view.targets };
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const list = screen.getByText(/Review Proposals \(3\)/).nextElementSibling as HTMLElement;
    const items = Array.from(list.children).map((li) => li.textContent);
    expect(items[0]).toMatch(/“alpha”/);
    expect(items[1]).toMatch(/“gamma”/);
    expect(items[2]).toMatch(/Spanless/);
  });
});

describe("Search", () => {
  it("debounces typing into a single request and aborts superseded requests", async () => {
    vi.useFakeTimers();
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const manager = new SearchManager({ searchOntology } as any);
    render(<SearchPanel searchManager={manager} annotationId="a" workspaceKey={key} layerId="phenotype" onSelectCandidate={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Search term" });
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
    fireEvent.click(screen.getByRole("button", { name: "Add mention" }));
    expect(screen.getByText(/^Adding a mention to .*. Mark the text. Esc cancels.$/)).toBeDefined();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Adding a mention to/)).toBeNull());
    // The annotation stays selected.
    expect(screen.getByRole("heading", { name: "Values" })).toBeDefined();
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
    expect(screen.getByText(/1 mention has offsets outside this text/)).toBeDefined();
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & submit/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit text/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Submit text$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Review next text/i }));
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

  it("shows errors from the assignment open flow", async () => {
    asAnnotator("dr-a");
    vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg", roles: ["reviewer"], can_manage: false }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    assignedList(baseView());
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: baseView() }).assignment);
    vi.spyOn(api, "openAssignment").mockRejectedValue(new Error("boom"));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }));
    await confirmIdentity();
    await waitFor(() => expect(screen.getByText(/boom/)).toBeDefined());
  });
});
