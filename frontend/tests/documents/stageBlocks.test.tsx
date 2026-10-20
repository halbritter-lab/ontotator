import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentRowView } from "../../src/api/client";
import { formatTime } from "../../src/app/submissionLabels";
import { ExpandedRow } from "../../src/documents/ExpandedRow";
import { StageBlocks, type StageBlocksProps } from "../../src/documents/StageBlocks";
import type { RowSubmissionsState } from "../../src/documents/useRowSubmissions";
import { LeadCorrectionContext } from "../../src/documents/LeadCorrectionPanel";
import { final, item, planRow, recordedVersion, rejectedRow, stepOf, submission, submissions, work } from "./fixtures";

afterEach(cleanup);

const now = new Date("2026-10-19T12:00:00Z");
const time = (iso: string) => formatTime(iso, { now });

function renderBlocks(target: DocumentRowView, props: Partial<StageBlocksProps> = {}) {
  return render(<StageBlocks row={target} now={now} {...props} />);
}

const blockTitles = () => screen.getAllByRole("group").map(block => within(block).getByRole("heading").textContent);
const block = (name: string) => screen.getByRole("group", { name });

it("renders blocks only for planned stages", () => {
  const target = planRow("case-0101", "de", stepOf("assign_annotation", { stage: "annotation", assigned: 0, target: 2 }), {
    versions: [recordedVersion({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted" })],
  });
  renderBlocks(target);
  expect(blockTitles()).toEqual(["Translation review", "Annotation", "Final result"]);
  expect(within(block("Annotation")).getByText("0 of 2 assigned")).toBeTruthy();
  expect(screen.queryByText("Not annotated in this plan")).toBeNull();
  cleanup();

  const reviewOnly = planRow("case-0101", "fr", stepOf("translation_review_in_progress"), {
    plan_row: { review: true, annotate: false, review_applicable: true, discarded: false },
  });
  renderBlocks(reviewOnly);
  expect(blockTitles()).toEqual(["Translation review"]);
  expect(screen.getByText("Not annotated in this plan")).toBeTruthy();
  cleanup();

  const source = planRow("case-0101", "en", stepOf("assign_annotation", { stage: "annotation" }), { is_source: true });
  renderBlocks(source);
  expect(blockTitles()).toEqual(["Annotation", "Final result"]);
  expect(within(block("Annotation")).getByText("Not assigned yet")).toBeTruthy();
  cleanup();

  const notInPlan = planRow("case-0101", "es", null, { plan_row: { review: false, annotate: false, review_applicable: true, discarded: false }, in_plan: false });
  renderBlocks(notInPlan);
  expect(screen.queryAllByRole("group")).toHaveLength(0);
  expect(screen.getByText("Not in plan")).toBeTruthy();
  cleanup();

  const discarded = planRow("case-0101", "it", null, { plan_row: { review: true, annotate: true, review_applicable: true, discarded: true }, in_plan: false });
  renderBlocks(discarded);
  expect(screen.queryAllByRole("group")).toHaveLength(0);
  expect(screen.getByText("Discarded")).toBeTruthy();
});

it("marks the current stage with an accent top edge and a status badge", () => {
  const target = planRow("case-0101", "de", stepOf("annotation_in_progress", { stage: "annotation" }), {
    versions: [recordedVersion({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted" })],
    work: [work({ assignment_id: 5, document_id: "case-0101-de", author_label: "ann-0004", status: "in_progress" })],
  });
  renderBlocks(target);
  const current = block("Annotation");
  expect(current.getAttribute("aria-current")).toBe("step");
  expect(current.className).toContain("stage-block--current");
  expect(current.querySelector(".status-pill")!.textContent).toBe("In progress");
  const translation = block("Translation review");
  expect(translation.getAttribute("aria-current")).toBeNull();
  expect(translation.querySelector(".status-pill")!.textContent).toBe("Accepted");
  expect(block("Final result").querySelector(".status-pill")!.textContent).toBe("Not started");
  cleanup();

  renderBlocks(planRow("case-0101", "de", stepOf("resolve_rejected", { stage: "translation_review" })));
  expect(block("Translation review").querySelector(".status-pill")!.textContent).toBe("Your decision");
  expect(block("Translation review").getAttribute("aria-current")).toBe("step");
  cleanup();

  renderBlocks(planRow("case-0101", "de", stepOf("assign_translation_review")));
  expect(block("Translation review").querySelector(".status-pill")!.textContent).toBe("To assign");
  cleanup();

  renderBlocks(planRow("case-0101", "de", stepOf("done", { stage: "done" }), { final: final({ case_id: "case-0101", language: "de", document_id: "case-0101-de", submission_id: "s1" }) }));
  expect(screen.getAllByRole("group").map(entry => entry.querySelector(".status-pill")!.textContent)).toEqual(["Done", "Done", "Done"]);
  expect(screen.getAllByRole("group").every(entry => entry.getAttribute("aria-current") === null)).toBe(true);
});

it("lists people, times and links per block", () => {
  const v1 = recordedVersion({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "accepted_unchanged", is_newest_in_chain: false });
  const v2 = recordedVersion({ document_id: "case-0101-de-v2", chain_id: "case-0101-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "case-0101-de", translation_status: "accepted" });
  const target = planRow("case-0101", "de", stepOf("annotation_in_progress", { stage: "annotation" }), {
    versions: [v1, v2],
    work: [
      work({ assignment_id: 1, document_id: v1.document_id, author_label: "rev-0007", task: "translation_review", status: "submitted", person: { pseudonym: "rev-0007", display_name: "Ben Roth", is_me: false } }),
      work({ assignment_id: 2, document_id: v2.document_id, version: 2, author_label: "ann-0004", status: "submitted", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }),
      work({ assignment_id: 3, document_id: v2.document_id, version: 2, author_label: "ann-0005", status: "in_progress", held: true, round_ordinal: 2 }),
    ],
  });
  const rows = [submission({ submission_id: "s-ana", document_id: v2.document_id, version: 2, author_label: "ann-0004", recorded_at: "2026-10-18T09:15:00Z" })];
  const onOpenTextVersions = vi.fn();
  const onShowTranslationReviews = vi.fn();
  const onAssign = vi.fn();
  renderBlocks(target, { submissions: rows, onOpenTextVersions, onShowTranslationReviews, onAssign });

  const translation = block("Translation review");
  expect(within(translation).getByText("v2 · Accepted")).toBeTruthy();
  expect(within(translation).getByText("Ben Roth (rev-0007) · Submitted · v1")).toBeTruthy();
  fireEvent.click(within(translation).getByRole("button", { name: "Text versions (2)" }));
  expect(onOpenTextVersions).toHaveBeenCalled();
  fireEvent.click(within(translation).getByRole("button", { name: "Translation reviews" }));
  expect(onShowTranslationReviews).toHaveBeenCalledWith("case-0101-de-v2");

  const annotation = block("Annotation");
  const people = within(annotation).getAllByRole("listitem").map(entry => entry.textContent);
  expect(people).toEqual([`Ana Weber (ann-0004) · Annotation · Submitted ${time("2026-10-18T09:15:00Z")}`, "ann-0005 · Annotation · In progress · Round 2Paused"]);
  fireEvent.click(within(annotation).getByRole("button", { name: "Assignment actions" }));
  expect(onOpenTextVersions).toHaveBeenCalledTimes(2);
  fireEvent.click(within(annotation).getByRole("button", { name: "Assign annotation review…" }));
  expect(onAssign).toHaveBeenCalledWith(target, "review");

  expect(within(block("Final result")).getByText("No final result yet.")).toBeTruthy();
  cleanup();

  const withFinal = planRow("case-0101", "en", stepOf("done", { stage: "done" }), {
    is_source: true,
    final: final({ case_id: "case-0101", language: "en", document_id: "case-0101-en", submission_id: "s1", author_label: "ann-0004", round_ordinal: 1, selected_at: "2026-10-18T10:05:00Z", author: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }),
  });
  const onFocusSubmissions = vi.fn();
  renderBlocks(withFinal, { onFocusSubmissions });
  const finalBlock = block("Final result");
  expect(within(finalBlock).getByText(`Annotation · Round 1 · Ana Weber (ann-0004) · chosen ${time("2026-10-18T10:05:00Z")}`)).toBeTruthy();
  fireEvent.click(within(finalBlock).getByRole("button", { name: "Submissions" }));
  expect(onFocusSubmissions).toHaveBeenCalled();
});

it("lists report and source-change lines under Issues", () => {
  const target = planRow("case-0101", "de", stepOf("decide_report", { stage: "translation_review", report_id: "rep-1" }), {
    issues: [
      item({ code: "TASK_ON_HOLD", cause_id: "TASK_ON_HOLD:4", category: "report-or-pause", report_id: "rep-1", author_label: "ann-0004" }),
      item({ code: "TRANSLATION_CHECK_FAILED", cause_id: "TRANSLATION_CHECK_FAILED:case-0101-de", category: "translation", document_id: "case-0101-de", version: 1 }),
    ],
    notes: [item({ code: "SOURCE_UPDATE_UNREVIEWED", cause_id: "SOURCE_UPDATE_UNREVIEWED:case-0101-de", document_id: "case-0101-de", version: 1 })],
  });
  const state: RowSubmissionsState = { data: submissions("case-0101", "de"), error: null, loading: false, reload: vi.fn(), retry: vi.fn() };
  const { container } = render(<ExpandedRow row={target} projectKey="p" query={{}} submissions={state} onNavigate={vi.fn()} now={now} />);
  const issues = screen.getByRole("heading", { name: "Issues" }).parentElement!;
  expect(within(issues).getAllByRole("listitem").map(entry => entry.textContent)).toEqual([
    "Task paused (ann-0004). Open report",
    "The source text changed. Review source change",
  ]);
  // Translation lines move into the Translation review block.
  expect(within(block("Translation review")).getByText(/failed the automatic translation check/)).toBeTruthy();
  // Issues come after the pipeline blocks.
  const blocks = container.querySelector(".stage-blocks")!;
  expect(blocks.compareDocumentPosition(issues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("renders translationSlot inside the Translation review block", () => {
  const target = planRow("case-0101", "de", stepOf("resolve_rejected", { document_id: "case-0101-de" }));
  renderBlocks(target, { translationSlot: <p>Slot content</p> });
  expect(within(block("Translation review")).getByText("Slot content")).toBeTruthy();
  expect(within(block("Annotation")).queryByText("Slot content")).toBeNull();
  cleanup();

  // No Translation review block: the slot is not rendered.
  const annotationOnly = planRow("case-0101", "en", stepOf("assign_annotation", { stage: "annotation" }), { is_source: true });
  renderBlocks(annotationOnly, { translationSlot: <p>Slot content</p> });
  expect(screen.queryByText("Slot content")).toBeNull();
});

it("offers Correct the translation yourself… only for resolve_rejected and resolve_queried", async () => {
  const onNavigate = vi.fn();
  const renderHosted = (target: DocumentRowView, props: Partial<StageBlocksProps> = {}) =>
    render(<LeadCorrectionContext.Provider value={{ projectKey: "p", onNavigate }}><StageBlocks row={target} now={now} {...props} /></LeadCorrectionContext.Provider>);
  const correct = () => within(block("Translation review")).queryByRole("button", { name: "Correct the translation yourself…" });

  for (const decision of ["rejected", "query"] as const) {
    renderHosted(rejectedRow("case-0101", "de", { decision }));
    expect(correct()).not.toBeNull();
    cleanup();
  }
  // Other steps, no lead host (not the lead's Documents page), or the Resolve options already in the block.
  renderHosted(planRow("case-0101", "de", stepOf("assign_translation_review", { document_id: "case-0101-de" })));
  expect(correct()).toBeNull();
  cleanup();
  renderBlocks(rejectedRow("case-0101", "de"));
  expect(correct()).toBeNull();
  cleanup();
  renderHosted(rejectedRow("case-0101", "de"), { translationSlot: <p>Resolve options</p> });
  expect(correct()).toBeNull();
  cleanup();

  // The panel opens inside the block; Cancel returns to the link.
  renderHosted(rejectedRow("case-0101", "de", { version: 2 }));
  fireEvent.click(correct()!);
  const panel = within(block("Translation review")).getByRole("group", { name: "Correct the translation, case-0101 · de" });
  expect(within(panel).getByText(/You review v2 yourself/)).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Correct the translation, case-0101 · de" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(correct()));
  cleanup();

  // While the lead holds the correction: "Continue your correction" opens the task.
  renderHosted(rejectedRow("case-0101", "de", { correcting: true }));
  expect(correct()).toBeNull();
  fireEvent.click(within(block("Translation review")).getByRole("button", { name: "Continue your correction" }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 });
});
