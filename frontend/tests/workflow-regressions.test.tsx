import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, api, initSessionToken, setActiveSessionToken, ValidationError } from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { createMutationQueue } from "../src/editor/autosave";
import { TextPane } from "../src/editor/TextPane";

describe("Workflow Regressions", () => {
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  package_id: "pkg",
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
  axes_definition: "editor-axes/v1",
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
   format_version: "ontocurator-work-package/v2",
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
 fireEvent.click(screen.getByRole("button", { name: /Fall abschließen/ }));
 await waitFor(() => expect(screen.getByText(/Erneut versuchen/)).toBeDefined());
 expect(submit.mock.calls[0][1].payload).toEqual({
   command: "submit_workspace",
   document_checked: true,
   checked_layer_ids: ["phenotype"],
 });
 fireEvent.click(screen.getByText(/Erneut versuchen/));
 await waitFor(() => expect(screen.getByText(/Fall erfolgreich abgegeben/)).toBeDefined());
 expect(submit.mock.calls[1][1]).toEqual(submit.mock.calls[0][1]);
});

it("restores the tab token on reload and downloads exports with authorization", async () => {
 window.sessionStorage.clear();
 setActiveSessionToken(null);
 history.replaceState(null, "", "/#token=secret");
 expect(initSessionToken()).toBe("secret");
 expect(window.location.hash).toBe("");
 setActiveSessionToken(null);
 expect(initSessionToken()).toBe("secret");
 const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["zip"]) });
 vi.stubGlobal("fetch", fetchMock);
 vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:download"), revokeObjectURL: vi.fn() }));
 vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
 await new ApiClient().downloadExport("ws");
 await new Promise((resolve) => setTimeout(resolve, 0));
 expect(fetchMock).toHaveBeenCalledWith("/api/v1/workspaces/ws/export", { headers: { Authorization: "Bearer secret" } });
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
 schema_version: "ontocurator-annotation/v3" as const,
 annotation: {
   annotation_id: "same",
   document_id: "doc",
   layer_id: "phenotype",
   type_id: "default",
   term_id: hpoId,
   axes_values: { assertion: "absent" },
   evidence_refs: [{ evidence_id: "ev", version: "ev-version" }],
   provenance: { actor: { actor_id: "source", kind: "human" as const }, method: "manual" },
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
 expect(screen.getByText("absent")).toBeDefined();
 expect(rendered.container.querySelector('.run--marked')!.textContent).toBe("alpha");
 fireEvent.click(screen.getByText("HP:2"));
 fireEvent.click(screen.getByRole("button", { name: /Verwerfen/ }));
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
 expect(screen.getByText("confirmed")).toBeDefined();
 fireEvent.click(screen.getByRole("button", { name: /Auswahl aufheben/ }));
 await waitFor(() => expect(decide).toHaveBeenCalled());
 expect(decide.mock.calls[0][1].payload.outcome).toBeNull();
 expect(decide.mock.calls[0][1].payload.target).toEqual({ annotation_id: "same", version: "v1" });
 await waitFor(() => expect(screen.getByText("offen")).toBeDefined());
});

it("allows toggling an active review decision button to reset to offen", async () => {
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
 const confirmBtn = screen.getByRole("button", { name: /Bestätigen/ });
 expect(confirmBtn.getAttribute("aria-pressed")).toBe("true");
 fireEvent.click(confirmBtn);
 await waitFor(() => expect(decide).toHaveBeenCalled());
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
 expect(screen.getByText("Review-Entscheidung für diesen Vorschlag")).toBeDefined();
 expect(screen.queryByText("Kontext-Achsen")).toBeNull();

 // Click own annotation HP:2:
 fireEvent.click(screen.getAllByText("HP:2")[0]);
 // Should show AnnotationPanel, but NOT ReviewActions!
 expect(screen.queryByText("Review-Entscheidung für diesen Vorschlag")).toBeNull();
 expect(screen.getByText("Kontext-Achsen")).toBeDefined();

 // Click back on HP:1:
 fireEvent.click(screen.getAllByText("HP:1")[0]);
 expect(screen.getByText("Review-Entscheidung für diesen Vorschlag")).toBeDefined();
 expect(screen.queryByText("Kontext-Achsen")).toBeNull();
});

it("requests canonical target identity and selects versions independently", async () => {
 vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg", ontology: { release: "test" } }] as any);
 vi.spyOn(api, "listDocuments").mockResolvedValue([{ document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" }]);
 vi.spyOn(api, "getReviewInputs").mockResolvedValue([proposal("v1", "HP:1"), proposal("v2", "HP:2")]);
 const open = vi.spyOn(api, "openWorkspace").mockResolvedValue({ workspace_id: "ws", view: baseView() });
 render(<App/>);
 await waitFor(() => expect(screen.getByRole("button", { name: /Arbeitsbereich öffnen/ }).hasAttribute("disabled")).toBe(false));
 fireEvent.change(screen.getByLabelText("Arbeitsmodus"), { target: { value: "review" } });
 await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
 fireEvent.click(screen.getAllByRole("checkbox")[0]);
 fireEvent.click(screen.getByRole("button", { name: /Arbeitsbereich öffnen/ }));
 await waitFor(() => expect(open).toHaveBeenCalled());
 expect(open.mock.calls[0][0].targets).toEqual({ target_set_id: "", targets: [{ annotation_id: "same", version: "v2" }] });
});

it("binds a changed decision to the replacement version after queued edits", async () => {
 const view = baseView(), target = proposal("target-v1", "HP:1");
 const own = proposal("own-v1", "HP:3");
 own.annotation.annotation_id = "own";
 view.key = { ...key, mode: "review" };
 view.scope = { ...scope, mode: "review" };
 view.available_inputs = [target];
 view.targets = { target_set_id: "targets", targets: [{ annotation_id: "same", version: "target-v1" }] };
 view.draft = { ...view.draft, key: view.key, targets: view.targets, annotations: [own] };
 let finish!: (value: typeof view.draft) => void;
 vi.spyOn(api, "applyCommand").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
 const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...view.draft, revision: 2 });
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:3"));
 fireEvent.click(screen.getByRole("radio", { name: "Vorhanden" }));
 await waitFor(() => expect(finish).toBeDefined());
 fireEvent.click(screen.getByText("HP:1"));
 fireEvent.click(screen.getByRole("button", { name: /Ändern \(Gegenfassung\)/ }));
 fireEvent.click(screen.getByRole("button", { name: "Änderung bestätigen" }));
 expect(decide).not.toHaveBeenCalled();
 await act(async () => finish({ ...view.draft, revision: 1, annotations: [{ ...own, version: "own-v2" }] }));
 await waitFor(() => expect(decide).toHaveBeenCalled());
 expect(decide.mock.calls[0][1].payload.replacement).toEqual({ annotation_id: "own", version: "own-v2" });
 expect(decide.mock.calls[0][1].expected_revision).toBe(1);
});

it("uses the search event when assigning a candidate and trusts obsolete metadata", async () => {
 const view = baseView(), own = proposal("own-v1", "HP:3");
 view.draft.annotations = [own];
 vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "search-event", candidates: [{ term_id: "HP:4", label: "Candidate", definition: "Not obsolete", obsolete: false, matched_term: "Candidate", match_kind: "label", rank: 1, display_pos: 1 }] } as any);
 const edit = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
 render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("HP:3"));
 fireEvent.click(screen.getByRole("button", { name: "Begriff ändern" }));
 fireEvent.change(screen.getByLabelText("Ontologie-Term suchen"), { target: { value: "Candidate" } });
 await waitFor(() => expect(screen.getByText("Candidate")).toBeDefined());
 fireEvent.click(screen.getByText("Candidate"));
 await waitFor(() => expect(edit).toHaveBeenCalled());
 expect(edit.mock.calls[0][1].payload).toEqual({ command: "set_term", annotation_id: "same", term_id: "HP:4", search_event_id: "search-event" });
});

it("exposes an immutable historical submission", () => {
 const view = baseView();
 view.submissions = [{
   format_version: "ontocurator-work-package/v2",
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
 fireEvent.click(screen.getByRole("button", { name: /yesterday/ }));
 expect(screen.getByRole("dialog", { name: "Historische Abgabe" })).toBeDefined();
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
 fireEvent.click(screen.getByRole("button", { name: /Auf »Weiteres Segment«/ }));
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
  expect(screen.getByText("Kontext-Achsen")).toBeDefined();
  expect(screen.queryByText("Review-Entscheidung für diesen Vorschlag")).toBeNull();

  // Clicking a target mention in the text selects that review target:
  fireEvent.click(rendered.container.querySelectorAll(".run--target")[1]);
  expect(screen.getByText("Review-Entscheidung für diesen Vorschlag")).toBeDefined();
  expect(screen.queryByText("Kontext-Achsen")).toBeNull();
});
});
