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
  schema_version: "ontotator-annotation/v3", version: `${id}-v1`, document_id: "doc-pc-1", text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer",
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

it("proposal rows are tab stops and Enter or Space selects them (N-2)", () => {
  render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} />);
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-list-key^="target:"]'));
  expect(rows.map(row => [row.getAttribute("role"), row.tabIndex])).toEqual(rows.map(() => ["button", 0]));
  fireEvent.keyDown(rows[1], { key: "Enter" });
  expect(rows[1].getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(rows[2], { key: " " });
  expect(rows[2].classList.contains("selected")).toBe(true);
  expect(rows[1].getAttribute("aria-pressed")).toBe("false");
});

it("a click on the selected proposal keeps it selected, so its keys still work (N-6)", async () => {
  const view = proposalView();
  const record = recordDecisions(view);
  render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
  const row = document.querySelector<HTMLElement>('[data-list-key^="target:"]')!;
  fireEvent.click(row);
  fireEvent.click(row);
  expect(row.classList.contains("selected")).toBe(true);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(record).toHaveBeenCalledWith("ws-pc", expect.objectContaining({
    payload: expect.objectContaining({ outcome: "confirmed", target: { annotation_id: "p-1", version: "p-1-v1" } }) })));
});

it("proposals are listed and visited in text order, spanless ones last (N-4)", () => {
  const view = proposalView();
  const at = (start: number) => [{ mention: { evidence_id: `ev-${start}`, segments: [{ start, end: start + 4 }], cue_segments: [] }, version: "ev-v", document_id: "doc-pc-1", text_sha256: "text" }];
  // Canonical (ID) order p-1, p-2, p-3; in the text p-3 comes first, p-1 has no span.
  view.available_inputs = view.available_inputs!.map(s => s.annotation.annotation_id === "p-1" ? s
    : { ...s, evidence: at(s.annotation.annotation_id === "p-2" ? 30 : 4) } as never);
  render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-list-key^="target:"]'));
  expect(rows().map(row => JSON.parse(row.dataset.listKey!.slice("target:".length))[0])).toEqual(["p-3", "p-2", "p-1"]);
  fireEvent.keyDown(window, { key: "j" });
  expect(rows()[0].classList.contains("selected")).toBe(true);
  fireEvent.keyDown(window, { key: "j" });
  expect(rows()[1].classList.contains("selected")).toBe(true);
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
  // K steps back one by one, also onto a decided proposal.
  fireEvent.keyDown(window, { key: "k" });
  expect(selected()).toBe(1);
  // Without a selection K brings back the last proposal itself.
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyDown(window, { key: "k" });
  expect(selected()).toBe(1);
});

/** recordDecision answers with the draft's decisions plus the recorded one. */
function recordDecisions(view: WorkspaceView) {
  let decisions = [...(view.draft.decisions ?? [])];
  return vi.spyOn(api, "recordDecision").mockImplementation(async (_id, envelope) => {
    const payload = envelope.payload as { target: { annotation_id: string; version: string }; outcome: "confirmed" | "rejected" | "uncertain"; note?: string };
    decisions = [...decisions.filter(d => d.target.annotation_id !== payload.target.annotation_id),
      { decision_id: `d-${payload.target.annotation_id}`, target: payload.target, outcome: payload.outcome, reviewer_id: "user-test", note: payload.note }];
    return { ...view.draft, revision: decisions.length, decisions } as never;
  });
}

it("1 and 2 move on to the next open proposal and name what was decided; the last one goes to Finish & submit", async () => {
  const view = proposalView();
  view.draft.decisions = [{ decision_id: "d", target: { annotation_id: "p-2", version: "p-2-v1" }, outcome: "confirmed", reviewer_id: "user-test" }] as never;
  recordDecisions(view);
  render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
  const rows = () => Array.from(document.querySelectorAll('[data-list-key^="target:"]'));
  const selected = () => rows().findIndex(row => row.classList.contains("selected"));
  fireEvent.click(rows()[0]);
  fireEvent.keyDown(window, { key: "1" });
  // p-2 is decided already: the next open one is p-3.
  await waitFor(() => expect(selected()).toBe(2));
  const status = () => document.querySelector("[data-advance-status]")?.textContent;
  expect(status()).toMatch(/^Confirmed .+\. Next open proposal: 3 of 3 K: back to .+$/);
  // M-2: a framed success strip with a check icon inside the permanent polite live region, no role of its own.
  const strip = document.querySelector("[data-advance-status]")!;
  expect(strip.getAttribute("aria-live")).toBe("polite");
  const notice = strip.querySelector(".notice.notice-success")!;
  expect(notice.getAttribute("role")).toBeNull();
  expect(notice.querySelector("svg.icon")).not.toBeNull();
  // K returns to the proposal just decided, past the decided p-2 the advance skipped; J comes forward again.
  fireEvent.keyDown(window, { key: "k" });
  expect(selected()).toBe(0);
  expect(status()).toBe("");
  fireEvent.keyDown(window, { key: "j" });
  expect(selected()).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: /^Reject/ }));
  await waitFor(() => expect(selected()).toBe(-1));
  expect(status()).toMatch(/^Rejected .+\. Every proposal is decided\.$/);
  expect(document.activeElement).toBe(document.querySelector("[data-finish-submit]"));
});

it("the advance after a decision scrolls the text to the next proposal's mark if needed (N-5)", async () => {
  const view = proposalView();
  // p-1 (start 4) and p-3 (start 44) have marks; the list follows the text (N-4).
  const mark = (id: string, start: number, end: number) => [{ mention: { evidence_id: id, segments: [{ start, end }], cue_segments: [] }, version: "ev-v", document_id: "doc-pc-1", text_sha256: "text" }];
  view.available_inputs = view.available_inputs!.map(s => s.annotation.annotation_id === "p-3" ? { ...s, evidence: mark("ev-p3", 44, 51) } as never
    : s.annotation.annotation_id === "p-1" ? { ...s, evidence: mark("ev-p1", 4, 11) } as never : s);
  view.draft.decisions = [{ decision_id: "d", target: { annotation_id: "p-2", version: "p-2-v1" }, outcome: "confirmed", reviewer_id: "user-test" }] as never;
  recordDecisions(view);
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
  try {
    render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    scroll.mockClear();
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(scroll.mock.contexts.some(el => (el as HTMLElement).dataset.mentions?.includes("ev-p3"))).toBe(true));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

it("a repeated outcome moves on like a new decision and saves nothing (F7)", async () => {
  const view = proposalView();
  view.draft.decisions = [
    { decision_id: "d1", target: { annotation_id: "p-1", version: "p-1-v1" }, outcome: "confirmed", reviewer_id: "user-test" },
    { decision_id: "d2", target: { annotation_id: "p-2", version: "p-2-v1" }, outcome: "rejected", reviewer_id: "user-test" },
  ] as never;
  const record = recordDecisions(view);
  render(<CaseScreen view={view} workspaceId="ws-pc" onClose={vi.fn()} />);
  const rows = () => Array.from(document.querySelectorAll('[data-list-key^="target:"]'));
  const selected = () => rows().findIndex(row => row.classList.contains("selected"));
  const status = () => document.querySelector("[data-advance-status]")?.textContent;
  fireEvent.click(rows()[0]);
  fireEvent.keyDown(window, { key: "1" });
  expect(selected()).toBe(2);
  expect(status()).toBe("Already confirmed. Next open proposal: 3 of 3 K: back to HP:0001252");
  // The button of the outcome the proposal already has does the same.
  fireEvent.click(rows()[1]);
  fireEvent.click(screen.getByRole("button", { name: /^Reject/ }));
  expect(selected()).toBe(2);
  expect(status()).toBe("Already rejected. Next open proposal: 3 of 3 K: back to HP:0001250");
  expect(record).not.toHaveBeenCalled();
});

it("Submit is unavailable until every proposal has a decision", async () => {
  render(<CaseScreen view={proposalView()} workspaceId="ws-pc" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Finish & submit/ }));
  const dialog = await screen.findByRole("dialog", { name: "Submit text" });
  const submit = within(dialog).getByRole("button", { name: "Submit text" });
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
