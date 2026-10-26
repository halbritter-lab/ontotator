import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { api, type AnnotationSnapshot } from "../src/api/client";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const key = { project_key: "pkg-1", document_id: "doc-pc-1", annotator_id: "user-test", mode: "proposal_check" as const, scope_id: "scope-default", target_set_id: "targets-0" };
const axes = [
  { id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true },
  { id: "experiencer", label: "Experiencer", options: ["patient", "other"], allow_empty: true },
  { id: "temporality", label: "Temporality", options: ["current", "historical", "future"], allow_empty: true },
];
const proposal = (id: string, term: string): AnnotationSnapshot => ({
  schema_version: "ontocurator-annotation/v3", version: `${id}-v1`, document_id: "doc-pc-1", text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer",
  annotation: { annotation_id: id, document_id: "doc-pc-1", layer_id: "phenotype", type_id: "default", term_id: term, axes_values: {}, evidence_refs: [],
    provenance: { actor: { actor_id: "tool", kind: "tool" }, method: "automatic", source_refs: [] } }, evidence: [],
} as unknown as AnnotationSnapshot);
const proposals = [proposal("p-1", "HP:0001252"), proposal("p-2", "HP:0001250"), proposal("p-3", "HP:0000001")];

function proposalView(): WorkspaceView {
  const targets = { target_set_id: "targets-0", targets: proposals.map(p => ({ annotation_id: p.annotation.annotation_id, version: p.version })) };
  return {
    require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false,
    document: { document_id: "doc-pc-1", text: "The patient showed severe hypotonia and seizure activity.", language: "de", text_sha256: "sha-text" },
    key,
    scope: { scope_id: "scope-default", mode: "proposal_check", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
      annotation_types: [{ type_id: "default", label: "Phenotype", evidence_policy: "optional", axes }] }],
    ontologies: [{ ontology_id: "hp", release: "2024-06-25", label: "Human Phenotype Ontology", sha256: "hp-sha", format: "obo-graph-json" }],
    checked_layer_ids: [],
    draft: { key, targets, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
    targets, submissions: [], available_inputs: proposals, term_statuses: {},
    axes_definition: "editor-axes/v1", axes_config: axes, axes_config_sha256: "sha-axes",
  } as unknown as WorkspaceView;
}

it("shows the Annotate from proposals badge", () => {
  render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} />);
  const badge = screen.getByText("Annotate from proposals");
  expect(badge.getAttribute("title")).toBe("You see the tool's proposals, never other people's work.");
});

it("lists the proposals as review targets", () => {
  render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} />);
  expect(document.querySelectorAll('[data-list-key^="target:"]').length).toBe(3);
});

it("J moves to the next proposal and 1 confirms it", async () => {
  const view = proposalView();
  const record = vi.spyOn(api, "recordDecision").mockImplementation(async (_id, envelope) => {
    const payload = envelope.payload as { target: { annotation_id: string; version: string }; outcome: "confirmed" };
    return { ...view.draft, revision: 1, decisions: [{ decision_id: "d", target: payload.target, outcome: payload.outcome, reviewer_id: "user-test" }] };
  });
  render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
  fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
  fireEvent.keyDown(window, { key: "j" });
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(record).toHaveBeenLastCalledWith("ws-pc", expect.objectContaining({
    payload: expect.objectContaining({ outcome: "confirmed", target: { annotation_id: "p-2", version: "p-2-v1" } }) })));
});

it("J resumes after the last proposal once the selection is cleared and skips decided ones", () => {
  const view = proposalView();
  view.draft.decisions = [{ decision_id: "d", target: { annotation_id: "p-2", version: "p-2-v1" }, outcome: "confirmed", reviewer_id: "user-test" }] as never;
  render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
  const rows = () => Array.from(document.querySelectorAll('[data-list-key^="target:"]'));
  const selected = () => rows().findIndex(row => row.classList.contains("selected"));
  fireEvent.click(rows()[0]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(selected()).toBe(-1);
  fireEvent.keyDown(window, { key: "j" });
  expect(selected()).toBe(2);
  fireEvent.keyDown(window, { key: "k" });
  expect(selected()).toBe(0);
});

it("Submit is unavailable until every proposal has a decision", async () => {
  render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
  const dialog = await screen.findByRole("dialog", { name: "Submit case" });
  const submit = within(dialog).getByRole("button", { name: "Submit case" });
  expect(submit.getAttribute("aria-disabled")).toBe("true");
  const reason = document.getElementById(submit.getAttribute("aria-describedby")!)!;
  expect(reason.textContent).toBe("Decide every review proposal before submitting.");
});

it("the header shows the language flag", () => {
  render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} />);
  const tag = document.querySelector(".case-title + .language-tag");
  expect(tag?.textContent).toBe("de");
  expect(tag?.querySelector("svg.language-flag")).not.toBeNull();
});
