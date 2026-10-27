import { assigned, assignedList } from "./assignments";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ValidationError } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { createMutationQueue } from "../src/editor/autosave";
import { TextPane } from "../src/editor/TextPane";
import { loggedInAs } from "./session";

describe("Workflow Regressions", () => {
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.getSelection()?.removeAllRanges(); });

// The identity comes from the session; the preferences only keep the working modes.
const asAnnotator = (id: string) => {
  loggedInAs(id);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: id, mode_by_package: {} });
  vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: id, mode_by_package: {} });
};
const confirmIdentity = async () => {};

it("uses current span callbacks after selecting an annotation", () => {
  const initial = vi.fn(), current = vi.fn();
  const props = {text:"alpha beta", mentions:[], selectedEvidenceId:null, selectionIntent:"new_mention" as const, onSelection:initial,onPick:vi.fn(),onChangeIntent:vi.fn()};
  const view = render(<TextPane {...props}/>);
  view.rerender(<TextPane {...props} onSelection={current} selectedEvidenceId="ev1" selectionIntent="extend_mention"/>);
  const node=view.container.querySelector(".run")!.firstChild!;
  const range=document.createRange();range.setStart(node,6);range.setEnd(node,10);
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(view.container.querySelector(".text-container")!);
  expect(current).toHaveBeenCalledWith({segments:[{start:6,end:10}],intent:"extend_mention",evidenceId:"ev1"});
  expect(initial).not.toHaveBeenCalled();
});

it("removes permanent validation failures so corrections can save", async () => {
 const queue = createMutationQueue({ initialRevision: 0 });
 await expect(queue.enqueue(async () => { throw new ValidationError("invalid term"); })).rejects.toThrow("invalid term");
 await expect(queue.enqueue(async () => ({ revision: 1 }))).resolves.toEqual({ revision: 1 });
});
it("retains the caller continuation through a transient retry", async () => {
 const queue = createMutationQueue({ initialRevision: 0 });
 let attempts = 0;
 const completed = vi.fn();
 const pending = queue.enqueue(async () => {
   if (++attempts === 1) throw new Error("offline");
   return { revision: 1 };
 }).then(completed);
 await new Promise((resolve) => setTimeout(resolve, 0));
 expect(queue.getState()).toBe("error");
 await queue.retry();
 await pending;
 expect(completed).toHaveBeenCalledWith({ revision: 1 });
});

const key = {
  project_key: "pkg",
  document_id: "doc",
  annotator_id: "doctor",
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

const layers = [
  {
    layer_id: "phenotype",
    label: "Phänotyp",
    ontology_id: "hp",
    access: "editable" as const,
    default_visible: true,
    default_type_id: "default",
    annotation_types: [
      {
        type_id: "default",
        label: "Phänotyp",
        evidence_policy: "optional" as const,
        axes: [
          { id: "assertion", label: "Vorhandensein (Assertion)", options: ["present", "absent", "uncertain"], allow_empty: true },
        ],
      },
    ],
  },
];

const ontologies = [
  {
    ontology_id: "hp",
    release: "2024-06-25",
    label: "Human Phenotype Ontology",
    sha256: "test-hp-sha",
    format: "obo-graph-json" as const,
  },
];

const baseView = (): WorkspaceView => ({
  key,
  scope,
  layers,
  ontologies,
  checked_layer_ids: [],
  document: { document_id: "doc", text: "alpha beta", language: "en", text_sha256: "text" },
  targets: { target_set_id: "empty", targets: [] },
  available_inputs: [],
  submissions: [],
  term_statuses: {},
  require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false, axes_definition: "editor-axes/v1",
  axes_config: [
    { id: "assertion", label: "Vorhandensein (Assertion)", options: ["present", "absent", "uncertain"], allow_empty: true },
  ],
  axes_config_sha256: "sha-axes",
  draft: {
    key,
    targets: { target_set_id: "empty", targets: [] },
    revision: 0,
    annotations: [],
    evidence: [],
    decisions: [],
    checked_layer_ids: [],
  },
});

it("submits the API payload and preserves its envelope through a lost-response retry", async () => {
 const view = baseView();
 const submission = {
   format_version: "ontotator-work-package/v2",
   submission_id: "sub",
   created_at: "today",
   draft_revision: 1,
   snapshots: [],
   decisions: [],
   checked_layer_ids: ["phenotype"],
   document_checked: true,
   origin_key: key,
   scope,
   targets: view.targets,
 };
 const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValueOnce(new Error("response lost")).mockResolvedValue(submission as any);
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button", { name: /Finish & submit text|Fall abschließen/i }));
 const dialog = await screen.findByRole("dialog", { name: /Submit text/i });
 fireEvent.click(within(dialog).getByRole("button", { name: /^Submit text$/i }));
 await waitFor(() => expect(screen.getByText(/Retry|Erneut versuchen/i)).toBeDefined());
 expect(submit.mock.calls[0][1].payload).toEqual({
   command: "submit_workspace",
   document_checked: true,
 });
 fireEvent.click(screen.getByText(/Retry|Erneut versuchen/i));
 await waitFor(() => expect(screen.getByRole("dialog", { name: "Text submitted" })).toBeDefined());
 expect(submit.mock.calls[1][1]).toEqual(submit.mock.calls[0][1]);
});

it("flush yields while a write is outstanding", async () => {
 const queue = createMutationQueue({ initialRevision: 0 });
 let complete!: (value: { revision: number }) => void;
 const pending = queue.enqueue(() => new Promise<{ revision: number }>((resolve) => { complete = resolve; }));
 await new Promise((resolve) => setTimeout(resolve, 0));
 const flushed = queue.flush();
 setTimeout(() => complete({ revision: 1 }), 0);
 await flushed;
 await pending;
 expect(queue.getRevision()).toBe(1);
});

const proposal = (version: string, hpoId: string) => ({
 schema_version: "ontotator-annotation/v3" as const,
 annotation: {
   annotation_id: "same",
   document_id: "doc",
   layer_id: "phenotype",
   type_id: "default",
   term_id: hpoId,
   axes_values: { assertion: "absent" },
   evidence_refs: [{ evidence_id: "ev", version: "ev-version" }],
   provenance: { actor: { actor_id: "source", kind: "human" as const }, method: "manual", source_refs: [] as string[] },
 },
 evidence: [{ mention: { evidence_id: "ev", segments: [{ start: 0, end: 5 }], cue_segments: [] }, version: "ev-version", document_id: "doc", text_sha256: "text" }],
 version,
 document_id: "doc",
 text_sha256: "text",
 ontology_sha256: "ontology",
 layer_config_sha256: "layer-sha",
});

it("reviews separate versions and exposes original clinical axes and evidence", async () => {
 const first = proposal("v1", "HP:1"), second = proposal("v2", "HP:2");
 const view = baseView();
 view.key = { ...key, mode: "review" };
 view.scope = { ...scope, mode: "review" };
 view.available_inputs = [first, second];
 view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "v1" }, { annotation_id: "same", version: "v2" }] };
 view.draft = { ...view.draft, key: view.key, targets: view.targets };
 const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...view.draft, revision: 1 });
 const rendered = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:1"));
 expect(within(screen.getByLabelText("Proposal details")).getByText("Absent")).toBeDefined();
 expect(rendered.container.querySelector('.run--marked')!.textContent).toBe("alpha");
 fireEvent.click(screen.getByText("HP:2"));
 fireEvent.click(screen.getByRole("button", { name: /^(Reject|Verwerfen)/i }));
 await waitFor(() => expect(decide).toHaveBeenCalled());
 expect(decide.mock.calls[0][1].payload.target).toEqual({ annotation_id: "same", version: "v2" });
});

it("allows clearing an existing review decision back to offen", async () => {
 const target = proposal("v1", "HP:1");
 const view = baseView();
 view.key = { ...key, mode: "review" };
 view.scope = { ...scope, mode: "review" };
 view.available_inputs = [target];
 view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "v1" }] };
 view.draft = {
  ...view.draft,
  key: view.key,
  targets: view.targets,
  decisions: [{
   decision_id: "dec-1",
   target: { annotation_id: "same", version: "v1" },
   outcome: "confirmed",
   reviewer_id: "annotator",
  }],
 };
 const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({
  ...view.draft,
  revision: 1,
  decisions: [],
 });
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:1"));
 expect(screen.getAllByText(/Confirmed|Bestätigt/i)[0]).toBeDefined();
 fireEvent.click(screen.getByRole("button", { name: /Reset decision|Auswahl aufheben/i }));
 await waitFor(() => expect(decide).toHaveBeenCalled());
 expect(decide.mock.calls[0][1].payload.outcome).toBeNull();
 expect(decide.mock.calls[0][1].payload.target).toEqual({ annotation_id: "same", version: "v1" });
 await waitFor(() => expect(within(document.querySelector<HTMLElement>(".sidebar")!).getByText(/Pending/)).toBeDefined());
});

it("keeps a repeated outcome explicit and resets only through zero", async () => {
 const target = proposal("v1", "HP:1");
 const view = baseView();
 view.key = { ...key, mode: "review" };
 view.scope = { ...scope, mode: "review" };
 view.available_inputs = [target];
 view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "v1" }] };
 view.draft = {
  ...view.draft,
  key: view.key,
  targets: view.targets,
  decisions: [{
   decision_id: "dec-1",
   target: { annotation_id: "same", version: "v1" },
   outcome: "confirmed",
   reviewer_id: "annotator",
  }],
 };
 const decide = vi.spyOn(api, "recordDecision").mockResolvedValueOnce({ ...view.draft, revision: 1, decisions: [] });
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:1"));
 const confirmBtn = screen.getByRole("button", { name: /^(Confirm|Bestätigen)/ });
 expect(confirmBtn.getAttribute("aria-pressed")).toBe("true");
 // The repeated outcome moves on (F7): nothing is saved, the decision stays.
 fireEvent.click(confirmBtn);
 expect(document.querySelector("[data-advance-status]")!.textContent).toBe("Already confirmed. Every proposal is decided.");
 expect(decide).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("HP:1"));
 fireEvent.keyDown(window, { key: "0" });
 await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
 expect(decide.mock.calls[0][1].payload.outcome).toBeNull();
 expect(decide.mock.calls[0][1].payload.target).toEqual({ annotation_id: "same", version: "v1" });
});

it("strictly separates selection between review targets and own annotations in sidebar and inspector", async () => {
 const target = proposal("target-v1", "HP:1");
 const own = proposal("own-v1", "HP:2");
 own.annotation.annotation_id = "own-ann";
 const view = baseView();
 view.key = { ...key, mode: "review" };
 view.scope = { ...scope, mode: "review" };
 view.available_inputs = [target];
 view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "target-v1" }] };
 view.draft = { ...view.draft, key: view.key, targets: view.targets, annotations: [own] };

 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);

 // Click Review Target HP:1:
 fireEvent.click(screen.getAllByText("HP:1")[0]);
 // Should show Review-Entscheidung, but NOT AnnotationPanel
 expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
 expect(screen.queryByRole("heading", { name: "Values" })).toBeNull();

 // Click own annotation HP:2:
 fireEvent.click(screen.getAllByText("HP:2")[0]);
 // Should show AnnotationPanel, but NOT ReviewActions!
 expect(screen.queryByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeNull();
 expect(screen.getByRole("heading", { name: "Values" })).toBeDefined();

 // Click back on HP:1:
 fireEvent.click(screen.getAllByText("HP:1")[0]);
 expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
 expect(screen.queryByRole("heading", { name: "Values" })).toBeNull();
});

it("lets the server resolve review targets only after opening explicitly opened assigned review task (blinding)", async () => {
 window.localStorage.clear();
 asAnnotator("dr-a");
 vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg", roles: ["reviewer"], can_manage: false, ontology: { release: "test" } }] as any);
 vi.spyOn(api, "listDocuments").mockResolvedValue([{ document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" }]);
 const inputs = vi.spyOn(api, "getReviewInputs").mockResolvedValue([proposal("v1", "HP:1"), proposal("v2", "HP:2")]);
 const view = baseView(); view.key.mode = "review"; view.scope.mode = "review";
 assignedList(view);
 vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view }).assignment);
 const open = vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view }));
 render(<App/>);
 await waitFor(() => expect(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }).hasAttribute("disabled")).toBe(false));
 // No auto mode detection and no proposal prefetch on package selection.
 expect(screen.queryByLabelText(/Working mode/i)).toBeNull();
 expect(inputs).not.toHaveBeenCalled();
 // The dashboard never lists proposal contents.
 await new Promise((resolve) => setTimeout(resolve, 0));
 expect(inputs).not.toHaveBeenCalled();
 expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
 expect(screen.queryByText("HP:1")).toBeNull();
 fireEvent.click(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }));
 await confirmIdentity();
 await waitFor(() => expect(open).toHaveBeenCalled());
 expect(inputs).not.toHaveBeenCalled();
 expect(open).toHaveBeenCalledWith(1);
});

it("opens a review workspace without any review targets", async () => {
 window.localStorage.clear();
 vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg", roles: ["reviewer"], can_manage: false, ontology: { release: "test" } }] as any);
 vi.spyOn(api, "listDocuments").mockResolvedValue([{ document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" }]);
 vi.spyOn(api, "getReviewInputs").mockResolvedValue([]);
 asAnnotator("dr-a");
 const view = baseView(); view.key.mode = "review"; view.scope.mode = "review";
 assignedList(view);
 vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view }).assignment);
 const open = vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view }));
 render(<App/>);
 await waitFor(() => expect(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }).hasAttribute("disabled")).toBe(false));
 fireEvent.click(screen.getByRole("link", { name: /^(Start|Continue|View)$/ }));
 await confirmIdentity();
 await waitFor(() => expect(open).toHaveBeenCalled());
 expect(open).toHaveBeenCalledWith(1);
});

it("binds a changed decision to the replacement version after queued edits", async () => {
 const view = baseView(), target = proposal("target-v1", "HP:1");
 const own = proposal("own-v1", "HP:3");
 own.annotation.annotation_id = "own";
 own.annotation.provenance.source_refs = ["same:target-v1"];
 view.key = { ...key, mode: "review" };
 view.scope = { ...scope, mode: "review" };
 view.available_inputs = [target];
 view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "target-v1" }] };
 view.draft = { ...view.draft, key: view.key, targets: view.targets, annotations: [own] };
 const updated = { ...view.draft, revision: 1, annotations: [{ ...own, version: "own-v2",
   annotation: { ...own.annotation, axes_values: { assertion: "present" } } }] };
 let finish!: (value: typeof view.draft) => void;
 const apply = vi.spyOn(api, "applyCommand").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
 const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...updated, revision: 2 });
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:1"));
 fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/ }));
 await screen.findByRole("heading", { name: "Values" });
 expect(apply).not.toHaveBeenCalled(); // Existing adopted copy is resumed rather than cloned again.
 fireEvent.click(screen.getByRole("radio", { name: /Present|Vorhanden/i }));
 await waitFor(() => expect(finish).toBeDefined());
 expect(apply.mock.calls[0][1].payload).toEqual(expect.objectContaining({ command: "set_axes", annotation_id: "own" }));
 expect(decide).not.toHaveBeenCalled();
 await act(async () => finish(updated));
 await waitFor(() => expect(decide).toHaveBeenCalled());
 expect(decide.mock.calls[0][1].payload).toEqual(expect.objectContaining({ outcome: "changed",
   target: { annotation_id: "same", version: "target-v1" }, replacement: { annotation_id: "own", version: "own-v2" } }));
 expect(decide.mock.calls[0][1].expected_revision).toBe(1);
});

it("uses the search event when assigning a candidate and trusts obsolete metadata", async () => {
 const view = baseView(), own = proposal("own-v1", "HP:3");
 view.draft.annotations = [own];
 vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "search-event", candidates: [{ term_id: "HP:4", label: "Candidate", definition: "Not obsolete", obsolete: false, matched_term: "Candidate", match_kind: "label", rank: 1, display_pos: 1 }] } as any);
 const edit = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:3"));
 fireEvent.click(screen.getByRole("button", { name: /Change term|Begriff ändern/i }));
 fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Candidate" } });
 await waitFor(() => expect(screen.getByText("Candidate")).toBeDefined());
 fireEvent.click(screen.getByText("Candidate"));
 await waitFor(() => expect(edit).toHaveBeenCalled());
 expect(edit.mock.calls[0][1].payload).toEqual({ command: "set_term", annotation_id: "same", term_id: "HP:4", search_event_id: "search-event" });
});

it("exposes an immutable historical submission", () => {
 const view = baseView();
 view.submissions = [{
   format_version: "ontotator-work-package/v2",
   submission_id: "historical",
   created_at: "yesterday",
   draft_revision: 1,
   snapshots: [proposal("old", "HP:old")],
   decisions: [],
   checked_layer_ids: ["phenotype"],
   document_checked: true,
   origin_key: key,
   scope,
   targets: view.targets,
 }];
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button", { name: "Submission 1, Date unavailable" }));
 const historical = screen.getByRole("dialog", { name: /Historical submission/ });
 fireEvent.click(within(historical).getByText("Technical details"));
 expect(within(historical).getByText("historical")).toBeDefined();
 expect(screen.getByRole("dialog", { name: /Historical submission|Historische Abgabe/i })).toBeDefined();
 expect(screen.getByText("HP:old")).toBeDefined();
});

it("starts a write enqueued by the previous caller continuation", async () => {
 const queue = createMutationQueue({ initialRevision: 0 });
 await queue.enqueue(async () => ({ revision: 1 }));
 await expect(queue.enqueue(async (revision) => ({ revision: revision + 1 }))).resolves.toEqual({ revision: 2 });
});

it("merges rapid span extensions against the latest saved evidence", async () => {
 const view = baseView(), own = proposal("own-v1", "HP:3");
 view.document.text = "alpha beta gamma";
 view.draft.annotations = [own];
 view.draft.evidence = own.evidence;
 let finish!: (value: typeof view.draft) => void;
 const edit = vi.spyOn(api, "applyCommand").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ ...view.draft, revision: 2 });
 const rendered = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:3"));
 fireEvent.click(screen.getAllByRole("button", { name: "Add segment" })[0]);
 const drag = (start: number, end: number) => {
   const node = rendered.container.querySelector('.text-container .run[data-start="5"]')!.firstChild!;
   const range = document.createRange();
   range.setStart(node, start);
   range.setEnd(node, end);
   window.getSelection()!.addRange(range);
   fireEvent.mouseUp(rendered.container.querySelector(".text-container")!);
 };
 drag(1, 5);
 await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
 drag(6, 11);
 expect(edit).toHaveBeenCalledTimes(1);
 await act(async () => finish({
   ...view.draft,
   revision: 1,
   evidence: [{
     ...own.evidence[0],
     version: "ev2",
     mention: { ...own.evidence[0].mention, segments: [{ start: 0, end: 5 }, { start: 6, end: 10 }] },
   }],
 }));
 await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
 expect(edit.mock.calls[1][1].payload.segments).toEqual([{ start: 0, end: 5 }, { start: 6, end: 10 }, { start: 11, end: 16 }]);
});

it("renders all review targets and own annotations in text with distinct styling and allows picking", async () => {
  const target1 = proposal("target-v1", "HP:0001");
  const target2 = proposal("target-v2", "HP:0002");
  target2.evidence = [{
    mention: { evidence_id: "ev-t2", segments: [{ start: 6, end: 10 }], cue_segments: [] },
    version: "ev-t2-ver",
    document_id: "doc",
    text_sha256: "text",
  }];
  const own = proposal("own-v1", "HP:0003");
  own.annotation.annotation_id = "own-ann";
  own.annotation.evidence_refs = [{ evidence_id: "ev-own", version: "ev-own-ver" }];
  own.evidence = [{
    mention: { evidence_id: "ev-own", segments: [{ start: 11, end: 16 }], cue_segments: [] },
    version: "ev-own-ver",
    document_id: "doc",
    text_sha256: "text",
  }];

  const view = baseView();
  view.document.text = "alpha beta gamma";
  view.key = { ...key, mode: "review" };
  view.scope = { ...scope, mode: "review" };
  view.available_inputs = [target1, target2];
  view.targets = {
    target_set_id: "targets",
    targets: [
      { annotation_id: "same", version: "target-v1" },
      { annotation_id: "same", version: "target-v2" },
    ],
  };
  view.draft = {
    ...view.draft,
    key: view.key,
    targets: view.targets,
    annotations: [own],
    evidence: own.evidence,
  };

  const rendered = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);

  // Both targets and the own annotation should have rendered spans in the text!
  const targetRuns = rendered.container.querySelectorAll(".run--target");
  expect(targetRuns.length).toBe(2);
  expect(targetRuns[0].textContent).toBe("alpha");
  expect(targetRuns[1].textContent).toBe("beta");

  const ownRuns = rendered.container.querySelectorAll(".run--own");
  expect(ownRuns.length).toBe(1);
  expect(ownRuns[0].textContent).toBe("gamma");

  // Clicking the own mention in the text selects the own annotation:
  fireEvent.click(ownRuns[0]);
  expect(screen.getByRole("heading", { name: "Values" })).toBeDefined();
  expect(screen.queryByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeNull();

  // Clicking a target mention in the text selects that review target:
  fireEvent.click(rendered.container.querySelectorAll(".run--target")[1]);
  expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
  expect(screen.queryByRole("heading", { name: "Values" })).toBeNull();
});

it("adopts a review proposal as an editable copy and records 'changed' only once the copy differs", async () => {
  const target = proposal("target-v1", "HP:0001");
  const view = baseView();
  view.key = { ...key, mode: "review" };
  view.scope = { ...scope, mode: "review" };
  view.available_inputs = [target];
  view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "target-v1" }] };
  view.draft = { ...view.draft, key: view.key, targets: view.targets, annotations: [], evidence: [] };

  const commands: any[] = [];
  let currentDraft = view.draft;
  let versionCounter = 0;
  vi.spyOn(api, "applyCommand").mockImplementation(async (_wsId, envelope) => {
    const cmd: any = envelope.payload;
    commands.push(cmd);
    if (cmd.command === "create_annotation") {
      const evidence = cmd.evidence_id ? [{ mention: { evidence_id: cmd.evidence_id, segments: cmd.segments, cue_segments: [] }, version: "v-ev1", document_id: "doc", text_sha256: "text" }] : [];
      const newSnap = {
        schema_version: "ontotator-annotation/v3" as const,
        annotation: {
          annotation_id: cmd.annotation_id,
          document_id: "doc",
          layer_id: cmd.layer_id,
          type_id: cmd.type_id,
          term_id: cmd.term_id,
          axes_values: cmd.axes_values,
          evidence_refs: cmd.evidence_id ? [{ evidence_id: cmd.evidence_id, version: "v-ev1" }] : [],
          provenance: {
            actor: { actor_id: "annotator", kind: "human" as const },
            method: "manual",
            source_refs: [cmd.source_annotation_id + ":" + cmd.source_version],
          },
        },
        evidence,
        version: `rep-v${++versionCounter}`,
        document_id: "doc",
        text_sha256: "text",
        ontology_sha256: "ontology",
        layer_config_sha256: "layer-sha",
      };
      currentDraft = { ...currentDraft, revision: currentDraft.revision + 1, annotations: [newSnap], evidence };
    } else if (cmd.command === "set_axes") {
      currentDraft = {
        ...currentDraft,
        revision: currentDraft.revision + 1,
        annotations: (currentDraft.annotations ?? []).map((a) => a.annotation.annotation_id === cmd.annotation_id
          ? { ...a, version: `rep-v${++versionCounter}`, annotation: { ...a.annotation, axes_values: cmd.axes_values } }
          : a),
      };
    }
    return currentDraft;
  });

  const decideSpy = vi.spyOn(api, "recordDecision").mockImplementation(async (_wsId, envelope: any) => {
    currentDraft = {
      ...currentDraft,
      revision: currentDraft.revision + 1,
      decisions: envelope.payload.outcome === null ? [] : [{
        decision_id: "dec-1",
        target: envelope.payload.target,
        outcome: envelope.payload.outcome,
        replacement: envelope.payload.replacement,
        note: envelope.payload.note,
        reviewer_id: "annotator",
      }],
    };
    return currentDraft;
  });

  render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
  fireEvent.click(screen.getByText("HP:0001"));
  fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/i }));

  // 1. A copy is created with provenance pointing at the proposal
  await waitFor(() => expect(commands.length).toBe(1));
  expect(commands[0].command).toBe("create_annotation");
  expect(commands[0].term_id).toBe("HP:0001");
  expect(commands[0].axes_values).toEqual({ assertion: "absent" });
  expect(commands[0].source_annotation_id).toBe("same");
  expect(commands[0].source_version).toBe("target-v1");

  // 2. The inspector switches to the copy, but no "changed" decision exists yet (copy is identical)
  await waitFor(() => expect(screen.getByRole("heading", { name: "Values" })).toBeDefined());
  expect(decideSpy).not.toHaveBeenCalled();
  expect(screen.getByText(/Replacement for proposal/i)).toBeDefined();

  // 3. Going back and pressing Edit & Replace again re-opens the same copy instead of duplicating it
  fireEvent.click(screen.getByRole("button", { name: /View review target/i }));
  await waitFor(() => expect(screen.getByText(/Review decision for this proposal/i)).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/i }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Values" })).toBeDefined());
  expect(commands.length).toBe(1);

  // 4. Actually changing the copy records "changed" bound to the new version
  fireEvent.click(screen.getByRole("radio", { name: /Present/i }));
  await waitFor(() => expect(decideSpy).toHaveBeenCalledTimes(1));
  const call = decideSpy.mock.calls[0][1].payload;
  expect(call.outcome).toBe("changed");
  expect(call.target).toEqual({ annotation_id: "same", version: "target-v1" });
  expect(call.replacement).toEqual({ annotation_id: commands[0].annotation_id, version: "rep-v2" });
});

it("hides markings of replaced or rejected review targets in text and grays them out in the sidebar list", async () => {
  const target1 = proposal("t1-v1", "HP:0001");
  target1.evidence = [{ mention: { evidence_id: "ev1", segments: [{ start: 0, end: 5 }], cue_segments: [] }, version: "ev1-v", document_id: "doc", text_sha256: "text" }];
  const target2 = proposal("t2-v1", "HP:0002");
  target2.annotation.annotation_id = "t2";
  target2.evidence = [{ mention: { evidence_id: "ev2", segments: [{ start: 6, end: 10 }], cue_segments: [] }, version: "ev2-v", document_id: "doc", text_sha256: "text" }];

  const ownSnap = proposal("rep-v1", "HP:0003");
  ownSnap.annotation.annotation_id = "rep-ann";
  ownSnap.annotation.evidence_refs = [{ evidence_id: "rep-ev", version: "v1" }];
  const ownEv = { mention: { evidence_id: "rep-ev", segments: [{ start: 0, end: 5 }], cue_segments: [] }, version: "v1", document_id: "doc", text_sha256: "text" };

  const view = baseView();
  view.key = { ...key, mode: "review" };
  view.scope = { ...scope, mode: "review" };
  view.available_inputs = [target1, target2];
  view.targets = {
    target_set_id: "targets",
    targets: [
      { annotation_id: "same", version: "t1-v1" },
      { annotation_id: "t2", version: "t2-v1" },
    ],
  };
  view.draft = {
    ...view.draft,
    key: view.key,
    targets: view.targets,
    annotations: [ownSnap],
    evidence: [ownEv],
    decisions: [
      {
        decision_id: "d1",
        target: { annotation_id: "same", version: "t1-v1" },
        outcome: "changed",
        replacement: { annotation_id: "rep-ann", version: "rep-v1" },
        reviewer_id: "annotator",
      },
      {
        decision_id: "d2",
        target: { annotation_id: "t2", version: "t2-v1" },
        outcome: "rejected",
        reviewer_id: "annotator",
      },
    ],
  };

  const rendered = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);

  // 1. In text pane: neither target1 nor target2 should render .run--target because both are resolved (changed & rejected)
  const targetRuns = rendered.container.querySelectorAll(".run--target");
  expect(targetRuns.length).toBe(0);

  // 2. The own replacement annotation IS rendered in text
  const ownRuns = rendered.container.querySelectorAll(".run--own");
  expect(ownRuns.length).toBeGreaterThan(0);

  // 3. In sidebar: target1 has badge '✎ Ersetzt' and resolved styling
  expect(screen.getByText(/^(Replaced|Ersetzt)$/i)).toBeDefined();
  expect(screen.getByRole("button", { name: /^(Replaced by|Ersetzt durch):.*HP:0003/i })).toBeDefined();

  // 4. In sidebar: target2 has badge '✕ Verworfen' and resolved styling
  expect(screen.getByText(/^(Rejected|Verworfen)$/i)).toBeDefined();
  expect(screen.getByText(/^(Proposal rejected|Vorschlag verworfen)$/i)).toBeDefined();

  // 5. Selecting target1 in sidebar opens ReviewActions in inspector while markings remain completely hidden from text
  fireEvent.click(screen.getAllByText("HP:0001")[0]);
  await waitFor(() => {
    expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
  });
  expect(rendered.container.querySelectorAll(".run--target").length).toBe(0);
});

it("displays replacement term link in sidebar and allows deselecting so no term is selected", async () => {
  const target1 = proposal("t1-v1", "HP:0001");
  const ownSnap = proposal("rep-v1", "HP:0003");
  ownSnap.annotation.annotation_id = "rep-ann";

  const view = baseView();
  view.key = { ...key, mode: "review" };
  view.scope = { ...scope, mode: "review" };
  view.available_inputs = [target1];
  view.targets = {
    target_set_id: "targets",
    targets: [{ annotation_id: "same", version: "t1-v1" }],
  };
  view.draft = {
    ...view.draft,
    key: view.key,
    targets: view.targets,
    annotations: [ownSnap],
    decisions: [
      {
        decision_id: "d1",
        target: { annotation_id: "same", version: "t1-v1" },
        outcome: "changed",
        replacement: { annotation_id: "rep-ann", version: "rep-v1" },
        reviewer_id: "annotator",
      },
    ],
  };

  render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);

  // 1. Sidebar shows "Ersetzt durch: HP:0003" with link
  const replLink = screen.getByRole("button", { name: /^(Replaced by|Ersetzt durch):.*HP:0003/i });
  // Not inside the role="button" proposal row (axe nested-interactive).
  expect(replLink.closest('[role="button"]')).toBeNull();

  // 2. Clicking the replacement link in the sidebar selects the replacement annotation (AnnotationPanel opens)
  fireEvent.click(replLink);
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Values" })).toBeDefined();
  });
  expect(screen.queryByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeNull();

  // 3. Clicking the selected annotation in the sidebar again deselects it
  fireEvent.click(screen.getAllByText("HP:0003")[1]);
  await waitFor(() => {
    expect(screen.getByText("No finding selected")).toBeDefined();
  });
  expect(screen.queryByRole("heading", { name: "Values" })).toBeNull();
  expect(screen.queryByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeNull();

  // 4. Selecting target1 in sidebar opens ReviewActions; clicking it again keeps it (N-6), Escape deselects it
  fireEvent.click(screen.getAllByText("HP:0001")[0]);
  await waitFor(() => {
    expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
  });
  fireEvent.click(screen.getAllByText("HP:0001")[0]);
  expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => {
    expect(screen.getByText("No finding selected")).toBeDefined();
  });
});

it("supports review keyboard shortcuts: 1 (confirm), 2 (reject), Escape (deselect) and J/K (navigation)", async () => {
  const target1 = proposal("t1-v1", "HP:0001");
  const target2 = proposal("t2-v1", "HP:0002");

  const view = baseView();
  view.key = { ...key, mode: "review" };
  view.scope = { ...scope, mode: "review" };
  view.available_inputs = [target1, target2];
  view.targets = {
    target_set_id: "targets",
    targets: [
      { annotation_id: "same", version: "t1-v1" },
      { annotation_id: "same", version: "t2-v1" },
    ],
  };
  view.draft = {
    ...view.draft,
    key: view.key,
    targets: view.targets,
    annotations: [],
    decisions: [],
  };

  const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({
    ...view.draft,
    revision: 1,
  });

  render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);

  // 1. Press 'j' to navigate to first target
  fireEvent.keyDown(window, { key: "j" });
  await waitFor(() => {
    expect(screen.getByText(/Review decision for this proposal|Review-Entscheidung für diesen Vorschlag/i)).toBeDefined();
  });

  // 2. Press '1' to confirm target 1
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => {
    expect(decide).toHaveBeenCalledWith(
      "ws",
      expect.objectContaining({
        payload: expect.objectContaining({
          outcome: "confirmed",
          target: { annotation_id: "same", version: "t1-v1" },
        }),
      })
    );
  });

  // 3. Confirming moved on to the second (open) target
  await waitFor(() => expect(document.querySelectorAll('[data-list-key^="target:"]')[1].classList.contains("selected")).toBe(true));
  // Press '2' to reject target 2
  fireEvent.keyDown(window, { key: "2" });
  await waitFor(() => {
    expect(decide).toHaveBeenCalledWith(
      "ws",
      expect.objectContaining({
        payload: expect.objectContaining({
          outcome: "rejected",
          target: { annotation_id: "same", version: "t2-v1" },
        }),
      })
    );
  });

  // 4. Press Escape to deselect
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => {
    expect(screen.getByText("No finding selected")).toBeDefined();
  });
});
});
