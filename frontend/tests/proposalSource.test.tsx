import { StrictMode } from "react";
import { act, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type EditorProposal, type ProposalSetView } from "../src/api/client";
import { ProposalMetadataProvider, ProposalSource } from "../src/editor/ProposalSource";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { AiBadge } from "../src/editor/AiBadge";

export const proposal = (set = 1, kind: "tool" | "human" = "tool"): EditorProposal => ({
  schema_version: "ontocurator-annotation/v3", version: `v${set}`, document_id: "doc", text_sha256: "text", ontology_sha256: "ont", layer_config_sha256: "layer", evidence: [], proposal_set_id: set, notes: ["First note", "Second note"],
  annotation: {annotation_id: `a${set}`, document_id: "doc", layer_id: "hpo", type_id: "finding", term_id: "HP:1", provenance: {actor: {actor_id: kind === "tool" ? "tool-1" : "doctor", kind}, method: "import"}},
});
export const metadata = (id = 1): ProposalSetView => ({id, origin: "import", source_document_id: null, source_version: null, document_id: "doc", annotation_set_id: `set-${id}`, bundle_id: "bundle-1", set_kind: "tool", imported_at: "2026-10-14T12:30:00Z", imported_by_pseudonym: "ann-importer", actors: [{actor_id: "unrelated", kind: "tool", name: "Wrong tool"}, {actor_id: "tool-1", kind: "tool", name: "Phentrieve", version: "1.4", model: "bge-m3", run_id: `run-${id}`} ]});
const show = (items = [proposal()], scope = "workspace-1") => <ProposalMetadataProvider scope={scope} projectKey="project" proposals={items}>{items.map(p => <div key={p.version}><AiBadge provenance={p.annotation.provenance} source={p}/><ProposalSource source={p}/></div>)}</ProposalMetadataProvider>;
beforeEach(() => {vi.restoreAllMocks();vi.spyOn(api,"getReanchorItems").mockResolvedValue([]);});

it("shows the matching tool, version, model, run, import, set, bundle and notes", async () => {
  vi.spyOn(api, "getProposalSet").mockResolvedValue(metadata());
  render(show());
  expect(await screen.findByText("Phentrieve 1.4")).toBeTruthy();
  for (const value of ["bge-m3", "run-1", "ann-importer", "set-1", "bundle-1", "First note", "Second note"]) expect(screen.getByText(value)).toBeTruthy();
  expect(screen.queryByText("Wrong tool")).toBeNull();
  expect(screen.getByText("AI").title).toBe("Phentrieve 1.4");
});

it("deduplicates inflight detail and badge requests, then successful rerenders", async () => {
  let resolve!: (value: ProposalSetView) => void;
  const get = vi.spyOn(api, "getProposalSet").mockReturnValue(new Promise(r => {resolve = r;}));
  const p = proposal();
  const {rerender} = render(show([p, {...p, version: "another"}]));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => resolve(metadata()));
  rerender(show([p]));
  expect(get).toHaveBeenCalledTimes(1);
});

it("distinguishes duplicate tool labels in the document by their actual run", async () => {
  vi.spyOn(api, "getProposalSet").mockImplementation(async (_project, id) => metadata(id));
  render(show([proposal(1), proposal(2)]));
  await waitFor(() => expect(screen.getAllByText("AI").map(e => e.title)).toEqual(["Phentrieve 1.4 · run-1", "Phentrieve 1.4 · run-2"]));
});

it("keeps human imports human and omits absent optional fields", async () => {
  vi.spyOn(api, "getProposalSet").mockResolvedValue({...metadata(), actors: [], bundle_id: null, imported_by_pseudonym: null});
  render(show([{...proposal(1, "human"), notes: []}]));
  expect(await screen.findByRole("heading", {name: "Source"})).toBeTruthy();
  expect(screen.queryByText("AI")).toBeNull();
  for (const label of ["Tool", "Model", "Run", "Notes", "Bundle"]) expect(screen.queryByText(label)).toBeNull();
});

it("manual annotations have no source block or metadata request", () => {
  const get = vi.spyOn(api, "getProposalSet");
  render(show([{...proposal(1, "human"), proposal_set_id: null}]));
  expect(screen.queryByRole("heading", {name: "Source"})).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

it("caches metadata 404 once and hides all source blocks", async () => {
  const get = vi.spyOn(api, "getProposalSet").mockRejectedValue(new ApiError(404, "gone"));
  const {rerender} = render(show());
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => {});
  rerender(show());
  expect(get).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", {name: "Source"})).toBeNull();
});

it("cancels stale replies and refetches the same set in a new workspace", async () => {
  let resolve!: (value: ProposalSetView) => void;
  const get = vi.spyOn(api, "getProposalSet").mockReturnValueOnce(new Promise(r => {resolve = r;})).mockResolvedValueOnce({...metadata(), annotation_set_id: "fresh-set"});
  const {rerender, unmount} = render(show());
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  const signal = get.mock.calls[0][2];
  rerender(show([proposal()], "workspace-2"));
  expect(await screen.findByText("fresh-set")).toBeTruthy();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({...metadata(), annotation_set_id: "stale-set"}));
  expect(screen.queryByText("stale-set")).toBeNull();
  get.mockReturnValueOnce(new Promise(() => {}));
  rerender(show([proposal()], "workspace-3"));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  unmount();
  await waitFor(() => expect(get.mock.calls[2][2]?.aborted).toBe(true));
});

const workspace = (): WorkspaceView => {
  const key = {project_key: "project", document_id: "doc", annotator_id: "reviewer", mode: "review" as const, target_set_id: "targets", scope_id: "scope"};
  const target = proposal(1), reference = proposal(2), human = proposal(3, "human");
  const derived = {...proposal(9, "human"), annotation: {...proposal(9, "human").annotation, annotation_id: "derived", provenance: {actor: {actor_id: "reviewer", kind: "human" as const}, method: "manual", source_refs: ["a1:v1"]}}};
  const targets = {target_set_id: "targets", targets: [{annotation_id: "a1", version: "v1"}]};
  return {key, document: {document_id: "doc", text: "Clinical text.", text_sha256: "text", language: "en"}, scope: {scope_id: "scope", mode: "review", editable_layer_ids: ["hpo"], reference_layer_ids: []}, layers: [{layer_id: "hpo", label: "Findings", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "finding", annotation_types: [{type_id: "finding", label: "Finding", axes: [], evidence_policy: "optional"}]}], ontologies: [], targets, available_inputs: [target, reference, human], proposal_sets: [metadata(1),metadata(2),metadata(3)], draft: {key, targets, revision: 0, annotations: [derived], evidence: [], decisions: [], checked_layer_ids: []}, checked_layer_ids: [], submissions: [], term_statuses: {}, axes_definition: "axes", axes_config_sha256: "axes-sha"};
};

it("actual CaseScreen wires target, source, derived and human provenance without mutations", async () => {
  const get = vi.spyOn(api, "getProposalSet").mockImplementation(async (_project, id) => metadata(id));
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  vi.spyOn(api, "getPreferences").mockResolvedValue({last_annotator_id: null, mode_by_package: {}});
  const mutate = vi.spyOn(api, "applyCommand");
  const {container} = render(<CaseScreen view={workspace()} workspaceId="actual-workspace" onClose={() => {}} readOnly/>);
  await waitFor(() => expect(screen.getAllByText("AI").every(b => b.title.startsWith("Phentrieve 1.4"))).toBe(true));
  const item = (id: string) => Array.from(container.querySelectorAll<HTMLElement>("[data-list-key]")).find(e => e.dataset.listKey?.includes(id))!;
  fireEvent.click(item("a1"));
  expect(await screen.findByRole("heading", {name: "Source"})).toBeTruthy();
  expect(screen.getByText("set-1")).toBeTruthy();
  expect(within(screen.getByLabelText("Proposal details").parentElement!).getAllByText("AI")[0].title).toContain("run-1");
  fireEvent.click(item("a2"));
  expect(await screen.findByText("set-2")).toBeTruthy();
  expect(within(screen.getByLabelText("Reference details")).getByText("AI").title).toContain("run-2");
  fireEvent.click(item("a3"));
  expect(await screen.findByText("set-3")).toBeTruthy();
  expect(within(screen.getByLabelText("Reference details")).queryByText("AI")).toBeNull();
  fireEvent.click(item("derived"));
  expect(await screen.findByText("set-1")).toBeTruthy();
  // The current curated snapshot remains human; the Source block describes its upstream tool.
  expect(within(item("derived")).queryByText("AI")).toBeNull();
  expect(within(container.querySelector<HTMLElement>(".inspector-pane")!).queryByText("AI")).toBeNull();
  expect(within(screen.getByLabelText("Proposal source")).getByText("Phentrieve 1.4")).toBeTruthy();
  expect(within(screen.getByLabelText("Proposal source")).getByText("run-1")).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});


it("other metadata failures leave quiet fallback badges and no error blocks", async () => {
  const get = vi.spyOn(api, "getProposalSet").mockRejectedValue(new ApiError(503, "busy"));
  const {rerender} = render(show());
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => {});
  rerender(show());
  expect(get).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", {name: "Source"})).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("AI").title).toContain("tool-1");
});

it("does not associate an unrelated manual annotation with a tool by shared term", async () => {
  vi.spyOn(api, "getProposalSet").mockImplementation(async (_project, id) => metadata(id));
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  const view = workspace();
  view.draft.annotations = [{...proposal(8, "human"), annotation: {...proposal(8, "human").annotation, annotation_id: "manual"}}];
  const {container} = render(<CaseScreen view={view} workspaceId="manual-workspace" onClose={() => {}}/>);
  const manual = Array.from(container.querySelectorAll<HTMLElement>("[data-list-key]")).find(e => e.dataset.listKey?.includes("manual"))!;
  fireEvent.click(manual);
  await act(async () => {});
  expect(screen.queryByRole("heading", {name: "Source"})).toBeNull();
  expect(within(manual).queryByText("AI")).toBeNull();
});


it("shares one inflight request through the application's StrictMode effect replay", async () => {
  const get = vi.spyOn(api, "getProposalSet").mockReturnValue(new Promise(() => {}));
  render(<StrictMode>{show()}</StrictMode>);
  await act(async () => {});
  expect(get).toHaveBeenCalledTimes(1);
});


it("omits optional tool fields and distinguishes different tool labels without run suffixes", async () => {
  vi.spyOn(api, "getProposalSet").mockImplementation(async (_project, id) => ({...metadata(id), bundle_id: null, imported_by_pseudonym: null, actors: [{actor_id: "tool-1", kind: "tool", name: id === 1 ? "First tool" : "Other tool", version: "2"}]}));
  render(show([{...proposal(1), notes: []}, {...proposal(2), notes: []}]));
  await waitFor(() => expect(screen.getAllByText("AI").map(e => e.title)).toEqual(["First tool 2", "Other tool 2"]));
  for (const label of ["Model", "Run", "Notes", "Bundle"]) expect(screen.queryByText(label)).toBeNull();
});

it("isolates the same set ID between projects even with the same workspace token", async () => {
  const get = vi.spyOn(api, "getProposalSet").mockImplementation(async project => ({...metadata(), annotation_set_id: project}));
  const showProject = (projectKey: string) => <ProposalMetadataProvider scope="same-token" projectKey={projectKey} proposals={[proposal()]}><ProposalSource source={proposal()}/></ProposalMetadataProvider>;
  const {rerender} = render(showProject("first-project"));
  expect(await screen.findByText("first-project")).toBeTruthy();
  rerender(showProject("other-project"));
  expect(await screen.findByText("other-project")).toBeTruthy();
  expect(screen.queryByText("first-project")).toBeNull();
  expect(get.mock.calls.map(call => call.slice(0, 2))).toEqual([["first-project", 1], ["other-project", 1]]);
});
