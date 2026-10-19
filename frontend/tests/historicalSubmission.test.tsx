import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type Submission, type SubmissionHistoryDetail } from "../src/api/client";
import { HistoricalSubmissionDialog } from "../src/editor/HistoricalSubmissionDialog";
import { fromHistoryDetail, fromSubmission } from "../src/editor/historicalSubmission";
import { historical } from "./variantFixtures";
import { workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const snapshot = structuredClone(historical.annotations[0]);
const evidence = { mention: { evidence_id: "ev-1", segments: [{ start: 8, end: 11 }], cue_segments: [] }, document_id: "target", text_sha256: "text", version: "ev-v1" };
const withSpan = { ...snapshot, evidence: [evidence], annotation: { ...snapshot.annotation, evidence_refs: [{ evidence_id: "ev-1", version: "ev-v1" }] } };
const decision = { decision_id: "d-1", target: { annotation_id: "old", version: "annotation-v1" }, outcome: "confirmed" as const, note: "Fine", reviewer_id: "lead" };

const submission: Submission = {
  format_version: "ontocurator-submission/v2", submission_id: "sub-raw", origin_key: workspaceFixture("target").view.key,
  targets: { target_set_id: "empty", targets: [] }, draft_revision: 1, snapshots: [withSpan], decisions: [decision],
  document_checked: true, created_at: "2026-10-19T00:16:00Z",
};

const gone = { ...snapshot, annotation: { ...snapshot.annotation, annotation_id: "gone", term_id: "HP:gone" } };
const input = (id: string, source: typeof snapshot, target: typeof snapshot | null) => ({ input_id: id, source_submission_id: "sub-1",
  source_ref: { annotation_id: source.annotation.annotation_id, version: source.version }, source_snapshot: source, target_snapshot: target,
  mapping_status: "carried" as const, source_round_ordinal: 2 });
const carryDetail: SubmissionHistoryDetail = {
  summary: { submission_id: "sub-carried", document_id: "target", author_label: "alice", created_at: "2026-10-19T00:57:00Z", mode: "independent", round_id: "round-3" },
  annotations: [snapshot], evidence: [evidence], decisions: [], checked_layer_ids: ["phenotype"], document_checked: false,
  reanchor_inputs: [], reanchor_resolutions: [],
  round_inputs: [input("in-1", snapshot, snapshot), input("in-2", gone, null)],
  round_input_resolutions: [
    { input_id: "in-1", outcome: "completed", annotation_ref: { annotation_id: "old", version: snapshot.version } },
    { input_id: "in-2", outcome: "dismissed", reason: "Not in this text" },
  ],
};

describe("historical submission adapters", () => {
  it("maps a raw Submission without carried states", () => {
    const view = fromSubmission(submission, "Submission 1");
    expect(view).toMatchObject({ submissionId: "sub-raw", heading: "Submission 1", documentId: "target", recordedAt: "2026-10-19T00:16:00Z",
      decisions: [decision], documentChecked: true, checkedLayerIds: [], carried: null });
    expect(view.annotations).toEqual([withSpan]);
    expect(view.evidence).toEqual([evidence]);
  });

  it("maps a carry-forward history detail with read-only check states", () => {
    const view = fromHistoryDetail(carryDetail, "Round 3 · 19 Oct, 00:57", value => `Term ${value.annotation.term_id}`);
    expect(view).toMatchObject({ submissionId: "sub-carried", heading: "Round 3 · 19 Oct, 00:57", documentId: "target", checkedLayerIds: ["phenotype"] });
    expect(view.annotations).toEqual([snapshot]);
    expect(view.evidence).toEqual([evidence]);
    expect(view.carried?.items).toEqual([
      { term: "Term HP:old", state: "checked", reason: undefined, origin: "Carried from Round 2" },
      { term: "Term HP:gone", state: "dismissed", reason: "Not in this text", origin: "Carried from Round 2" },
    ]);
  });

  it("has no carried section for a detail without round inputs", () => {
    expect(fromHistoryDetail({ ...carryDetail, round_inputs: [], round_input_resolutions: [] }, "Round 1", () => "").carried).toBeNull();
  });
});

describe("HistoricalSubmissionDialog", () => {
  it("renders the view with its heading, quotes, footer Close and header close", () => {
    const onClose = vi.fn();
    render(<HistoricalSubmissionDialog view={fromSubmission(submission, "Round 1 · 19 Oct, 00:16")} documentText="Patient seizures." currentDocumentId="target"
      projectKey="pkg" termLabel={() => "Seizure"} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(dialog).getByRole("heading", { name: "Round 1 · 19 Oct, 00:16" })).toBeDefined();
    expect(within(dialog).getByText("Seizure")).toBeDefined();
    expect(within(dialog).getByText("sei")).toBeDefined();
    fireEvent.click(within(dialog.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
    fireEvent.click(dialog.querySelector("[data-dialog-close]") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("lists carried findings read-only with the dismissal reason", () => {
    render(<HistoricalSubmissionDialog view={fromHistoryDetail(carryDetail, "Round 3", value => value.annotation.term_id)} documentText="Patient seizures."
      currentDocumentId="target" termLabel={() => null} onClose={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Carried findings" });
    expect(within(section).getByText("Checked")).toBeDefined();
    expect(within(section).getByText("Dismissed")).toBeDefined();
    expect(within(section).getByText("Dismissal reason: Not in this text")).toBeDefined();
    expect(within(section).queryByRole("button")).toBeNull();
  });

  it("fetches the text of a submission on another text version for its quotes", async () => {
    const text = vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "target", text: "Earlier XYZ text", text_sha256: "text" } as never);
    render(<HistoricalSubmissionDialog view={fromSubmission(submission, "Round 1")} documentText="Current text." currentDocumentId="current"
      projectKey="pkg" termLabel={() => null} onClose={vi.fn()} />);
    expect(screen.getByText("Loading the submitted text…")).toBeDefined();
    expect(await screen.findByText("XYZ")).toBeDefined();
    expect(text).toHaveBeenCalledWith("pkg", "target");
  });
});
