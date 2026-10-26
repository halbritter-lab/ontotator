import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type RoundInputView, type RoundSourceView, type WorkRoundView } from "../src/api/client";
import { WorkRoundsDialog } from "../src/tasks/WorkRoundsDialog";
import { RoundInputEvidenceDialog } from "../src/tasks/RoundInputEvidenceDialog";
import { historical } from "./variantFixtures";
import { workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const assignment = { id: 7, task: "annotate", status: "in_progress", project_key: "p", document_id: "d", held: false, hold_reason: null, workflow_revision: 5, last_submission_id: "sub-2" } as unknown as AssignmentView;
const base = { project_key: "p", assignment_id: 7, document_id: "d", annotator_id: "alice", mode: "independent", workflow_revision: 5, input_manifest_sha256: "m", active: false, document_language: "de", document_version: 1 } as const;
const round = (o: Partial<WorkRoundView>): WorkRoundView => ({ ...base, round_id: "r", kind: "ordinary", state: "submitted", input_submission_ids: [], submission_count: 0, input_count: 0, ...o }) as WorkRoundView;
const rounds: WorkRoundView[] = [
  round({ round_id: "round-1", round_ordinal: 1, state: "superseded", submission_count: 1, latest_submission_id: "sub-1", latest_submission_recorded_at: "2026-10-19T00:16:00" }),
  round({ round_id: "round-2", round_ordinal: 2, kind: "carry_forward", predecessor_round_id: "round-1", state: "submitted", input_submission_ids: ["sub-1"], input_count: 1, source_round_ordinal: 1, submission_count: 1, latest_submission_id: "sub-2", latest_submission_recorded_at: "2026-10-19T00:57:00" }),
];
const source: RoundSourceView = { submission_id: "sub-2", document_id: "d", language: "de", version: 1, created_at: "2026-10-19T00:57:00", round_id: "round-2", round_ordinal: 2, recorded_at: "2026-10-19T00:57:00", finding_count: 1 };

function renderDialog(props: Partial<Parameters<typeof WorkRoundsDialog>[0]> = {}, data: { rounds?: WorkRoundView[]; sources?: RoundSourceView[] } = {}) {
  vi.spyOn(api, "listWorkRounds").mockResolvedValue(data.rounds ?? rounds);
  vi.spyOn(api, "listRoundSources").mockResolvedValue(data.sources ?? [source]);
  const handlers = { onClose: vi.fn(), onCreate: vi.fn().mockResolvedValue(undefined), onOpen: vi.fn().mockResolvedValue(undefined), onReload: vi.fn() };
  render(<WorkRoundsDialog assignment={assignment} documentLabel={{ textId: "case-12", language: "de" }} currentRoundId="round-2" {...handlers} {...props} />);
  return handlers;
}
const dialog = () => screen.getByRole("dialog");
const footer = () => within(dialog().querySelector<HTMLElement>(":scope > .modal-actions")!);

describe("Work rounds dialog", () => {
  it("names the text and explains rounds in one sentence", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Work rounds: case-12 de" })).toBeDefined();
    expect(await screen.findByText("Each round keeps its starting point and its submissions. Starting a round does not change the final result.")).toBeDefined();
  });

  it("shows one table row per round with separate state and submission columns", async () => {
    const { onOpen } = renderDialog();
    const table = await screen.findByRole("table", { name: "Rounds" });
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Round", "Round state", "Submission", "Carried", "Actions"]);
    const [, first, second] = within(table).getAllByRole("row");
    expect(first.textContent).toContain("Replaced by Round 2");
    expect(first.textContent).toContain("Submitted 19 Oct, 00:16");
    expect(first.textContent).toContain("None");
    expect(second.textContent).toContain("from Round 1 submission");
    expect(second.textContent).toContain("1 finding");
    const here = within(second).getByText("You are here");
    expect(here.closest("[aria-current='true']")).not.toBeNull();
    expect(within(second).queryByRole("button")).toBeNull();
    fireEvent.click(within(first).getByRole("button", { name: "Open Round 1" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("round-1"));
  });

  it("keeps IDs and raw wording out of the visible table", async () => {
    renderDialog();
    const table = await screen.findByRole("table", { name: "Rounds" });
    for (const hidden of ["round-1", "sub-1", "superseded", "carry-forward", "Carry-forward", "Historical round", "2026-10-19"]) expect(table.textContent).not.toContain(hidden);
    const details = screen.getByText("Technical details").closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("round-1");
    expect(details.textContent).toContain("sub-2");
  });

  it("continues from a chosen submission with the same request as before", async () => {
    const { onCreate } = renderDialog({ currentRoundId: "round-2" });
    const group = await screen.findByRole("radiogroup", { name: "Continue from" });
    expect(screen.getByText("The round you continue from stays in the history. Every carried finding must be checked again; carried values are not confirmed.")).toBeDefined();
    const primary = footer().getByRole("button", { name: "Continue from this submission" });
    fireEvent.click(within(group).getByRole("radio", { name: "Round 2 submission, 19 Oct, 00:57, de v1, 1 finding" }));
    expect(screen.getByText("Round 2 stays in the history. Every carried finding must be checked again; carried values are not confirmed.")).toBeDefined();
    fireEvent.click(primary);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ request_id: expect.any(String), expected_workflow_revision: 5, kind: "carry_forward", source_submission_ids: ["sub-2"] }));
    expect(footer().getByRole("button", { name: "Close" })).toBeDefined();
    expect(dialog().querySelector("[data-dialog-close]")).not.toBeNull();
  });

  it("reuses the request identity after a failed start", async () => {
    const { onCreate } = renderDialog();
    onCreate.mockRejectedValueOnce(new Error("The round could not be opened"));
    fireEvent.click(await screen.findByRole("radio", { name: /Round 2 submission/ }));
    fireEvent.click(footer().getByRole("button", { name: "Continue from this submission" }));
    await screen.findByText("The round could not be opened");
    expect((screen.getByRole("radio", { name: /Round 2 submission/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(footer().getByRole("button", { name: "Continue from this submission" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(onCreate.mock.calls[1][0]).toEqual(onCreate.mock.calls[0][0]);
  });

  const openedAt = (revision: number) => { const opened = workspaceFixture(); return { ...opened, view: { ...opened.view, draft: { ...opened.view.draft, revision } } }; };
  const autoRound = round({ round_id: "round-auto", round_ordinal: 1, kind: "ordinary", state: "editable", active: true, submission_count: 0 });
  const otherText = { ...source, document_id: "old-text", round_id: "round-old", round_ordinal: 1 };

  it("offers Continue from on an automatically created round with no saved change and replaces it", async () => {
    const open = vi.spyOn(api, "openWorkRound").mockResolvedValue(openedAt(0));
    const { onCreate } = renderDialog({ currentRoundId: "round-auto" }, { rounds: [autoRound], sources: [otherText] });
    const group = await screen.findByRole("radiogroup", { name: "Continue from" });
    expect(open).toHaveBeenCalledWith("round-auto");
    expect(screen.queryByText(/is still open/)).toBeNull();
    fireEvent.click(within(group).getByRole("radio", { name: /Round 1 submission/ }));
    fireEvent.click(footer().getByRole("button", { name: "Continue from this submission" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ request_id: expect.any(String), expected_workflow_revision: 5, kind: "carry_forward", source_submission_ids: ["sub-2"] }));
  });

  it("asks to submit first once anything is saved in the automatically created round", async () => {
    vi.spyOn(api, "openWorkRound").mockResolvedValue(openedAt(1));
    renderDialog({ currentRoundId: "round-auto" }, { rounds: [autoRound], sources: [otherText] });
    expect(await screen.findByText("You can continue from a submission once Round 1 is submitted. Round 1 is still open.")).toBeDefined();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(footer().queryByRole("button", { name: "Continue from this submission" })).toBeNull();
  });

  it("treats the round as saved work when its draft cannot be read", async () => {
    vi.spyOn(api, "openWorkRound").mockRejectedValue(new Error("offline"));
    renderDialog({ currentRoundId: "round-auto" }, { rounds: [autoRound], sources: [otherText] });
    expect(await screen.findByText("You can continue from a submission once Round 1 is submitted. Round 1 is still open.")).toBeDefined();
  });

  it("explains why no round can start: open round", async () => {
    vi.spyOn(api, "openWorkRound").mockResolvedValue(openedAt(3));
    renderDialog({}, { rounds: [...rounds, round({ round_id: "round-3", round_ordinal: 3, state: "editable", active: true })] });
    expect(await screen.findByText("You can continue from a submission once Round 3 is submitted. Round 3 is still open.")).toBeDefined();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(footer().queryByRole("button", { name: "Continue from this submission" })).toBeNull();
    expect(footer().getByRole("button", { name: "Close" })).toBeDefined();
  });

  it("explains why no round can start: paused", async () => {
    renderDialog({ assignment: { ...assignment, held: true, hold_reason: "Ontology changed" } as AssignmentView });
    expect(await screen.findByText("The task is paused. Resume it before starting another round.")).toBeDefined();
  });

  it("explains why no round can start: no own submission", async () => {
    renderDialog({ assignment: { ...assignment, last_submission_id: null } as unknown as AssignmentView }, { rounds: [round({ round_id: "round-1", round_ordinal: 1, state: "submitted" })], sources: [] });
    expect(await screen.findByText("There is no submitted work of yours on this text yet.")).toBeDefined();
  });

  it("offers a reload when no submission can be continued for an unknown reason", async () => {
    const { onReload } = renderDialog({}, { sources: [] });
    expect(await screen.findByText("No submission can be continued right now.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reload task state" }));
    expect(onReload).toHaveBeenCalled();
  });

  it("offers Start empty round only for an untouched open task", async () => {
    renderDialog({ assignment: { ...assignment, status: "open", last_submission_id: null } as unknown as AssignmentView }, { rounds: [], sources: [] });
    expect(await screen.findByRole("button", { name: "Start empty round" })).toBeDefined();
    cleanup(); vi.restoreAllMocks();
    renderDialog();
    await screen.findByRole("table", { name: "Rounds" });
    expect(screen.queryByRole("button", { name: "Start empty round" })).toBeNull();
  });

  it("shows the load error with Retry inside the dialog", async () => {
    const list = vi.spyOn(api, "listWorkRounds").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(rounds);
    vi.spyOn(api, "listRoundSources").mockResolvedValue([source]);
    render(<WorkRoundsDialog assignment={assignment} onClose={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} onReload={vi.fn()} />);
    expect(await screen.findByText("offline")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("table", { name: "Rounds" });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("renders one card per round on narrow viewports", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 700px"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderDialog();
    const cards = await screen.findAllByRole("listitem");
    expect(screen.queryByRole("table")).toBeNull();
    const first = cards.find(card => card.textContent?.includes("Round 1"))!;
    const terms = Array.from(first.querySelectorAll("dt")).map(term => term.textContent);
    expect(terms).toEqual(["Round state", "Submission", "Carried"]);
    expect(first.textContent).toContain("Replaced by Round 2");
    expect(within(first).getByRole("button", { name: "Open Round 1" })).toBeDefined();
  });

  it("keeps the plain title for callers without the new props", async () => {
    vi.spyOn(api, "listWorkRounds").mockResolvedValue(rounds);
    vi.spyOn(api, "listRoundSources").mockResolvedValue([]);
    render(<WorkRoundsDialog assignment={assignment} onClose={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} onReload={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Work rounds" })).toBeDefined();
    await screen.findByRole("table", { name: "Rounds" });
  });
});

function input(overrides: Partial<RoundInputView> = {}, withEvidence = true): RoundInputView {
  const original = structuredClone(historical.annotations[0]);
  original.annotation.annotation_id = "ann-original"; original.version = "v-original"; original.text_sha256 = "hash";
  original.annotation.term_id = "HP:0001250"; original.annotation.note = "Seen twice";
  original.annotation.provenance.actor.actor_id = "ann-0004";
  if (withEvidence) {
    original.annotation.evidence_refs = [{ evidence_id: "ev-1", version: "ev-v1" }];
    original.evidence = [{ mention: { evidence_id: "ev-1", segments: [{ start: 4, end: 11 }], cue_segments: [] }, document_id: "target", text_sha256: "hash", version: "ev-v1" }];
  }
  return { input_id: "input", source_submission_id: "sub-2", source_ref: { annotation_id: "ann-original", version: "v-original" }, source_snapshot: original, target_snapshot: null, mapping_status: "carried",
    source_round_ordinal: 2, source_recorded_at: "2026-10-19T00:57:00", source_language: "de", source_version: 1, ...overrides } as RoundInputView;
}
const labelFor = (_layer: string | undefined, term: string) => (term === "HP:0001250" ? "Seizure" : null);

describe("Original evidence dialog", () => {
  it("shows the submission line, facts, text and technical details", async () => {
    vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "target", text: "Had seizure today.", text_sha256: "hash" });
    render(<RoundInputEvidenceDialog projectKey="p" input={input()} onClose={vi.fn()} labelFor={labelFor} sourceName="Round 2" />);
    const box = screen.getByRole("dialog", { name: "Original finding from Round 2" });
    expect(box.querySelector(".round-evidence__meta")!.textContent).toBe("Submitted 19 Oct, 00:57, de v1, ann-0004");
    expect(screen.getByText("Seizure")).toBeDefined();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "Assertion: Present")).toBeDefined();
    expect(screen.getByText("Note: Seen twice")).toBeDefined();
    await waitFor(() => expect(box.querySelector(".text-container")).not.toBeNull());
    expect(screen.getByText("Quote: seizure")).toBeDefined();
    const details = screen.getByText("Technical details").closest("details")!;
    expect(details.textContent).toContain("sub-2");
    expect(details.textContent).toContain("ann-original");
    expect(details.textContent).toContain("v-original");
    expect(within(box.querySelector<HTMLElement>(":scope > .modal-actions")!).getByRole("button", { name: "Close original evidence" })).toBeDefined();
    expect(box.querySelector("[data-dialog-close]")).not.toBeNull();
  });

  it("collapses the text for a finding without a span", async () => {
    vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "target", text: "Had seizure today.", text_sha256: "hash" });
    render(<RoundInputEvidenceDialog projectKey="p" input={input({}, false)} onClose={vi.fn()} labelFor={labelFor} sourceName="Round 2" />);
    expect(screen.getByText("This finding had no text span in Round 2.")).toBeDefined();
    const summary = await screen.findByText("Show Round 2 text");
    expect(summary.closest("details")!.open).toBe(false);
  });

  it("keeps facts and details when the original text is unavailable", async () => {
    vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "target", text: "Wrong", text_sha256: "other" });
    render(<RoundInputEvidenceDialog projectKey="p" input={input()} onClose={vi.fn()} labelFor={labelFor} sourceName="Round 2" />);
    await screen.findByText("The exact original evidence text is unavailable.");
    expect(document.querySelector(".text-container")).toBeNull();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "Assertion: Present")).toBeDefined();
    expect(screen.getByText("Technical details")).toBeDefined();
  });

  it("names the draft before the text change instead of a submission", async () => {
    vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "target", text: "Had seizure today.", text_sha256: "hash" });
    const drafted = input({ source_submission_id: null, source_draft_snapshot_id: 4, source_round_ordinal: null, source_recorded_at: null });
    render(<RoundInputEvidenceDialog projectKey="p" input={drafted} onClose={vi.fn()} labelFor={labelFor} />);
    const box = screen.getByRole("dialog", { name: "Original finding from an earlier round" });
    expect(box.querySelector(".round-evidence__meta")!.textContent).toBe("Draft before the text change, de v1, ann-0004");
    const details = screen.getByText("Technical details").closest("details")!;
    expect(details.textContent).toContain("SourceDraft before the text change");
    expect(details.textContent).not.toContain("Submission");
    await waitFor(() => expect(box.querySelector(".text-container")).not.toBeNull());
  });

  it("keeps the plain title for callers without the new prop", () => {
    vi.spyOn(api, "getVariantText").mockReturnValue(new Promise(() => undefined));
    const legacy = input({ source_round_ordinal: null, source_recorded_at: null, source_language: null, source_version: null });
    render(<RoundInputEvidenceDialog projectKey="p" input={legacy} onClose={vi.fn()} labelFor={labelFor} />);
    expect(screen.getByRole("dialog", { name: "Original finding from an earlier round" })).toBeDefined();
  });
});
