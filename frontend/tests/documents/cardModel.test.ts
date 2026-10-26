// @vitest-environment node
/** The text card's path states (U3, state table). */
import { describe, expect, it } from "vitest";
import { annotationState, cardSegments, defaultSegment, finalizationState, translationState } from "../../src/documents/textCard/cardModel";
import { annotateItem, cardRow } from "./cardFixtures";
import { final, work } from "./fixtures";
import { ana, cell, tom } from "./tableFixtures";

const now = new Date("2026-10-22T12:00:00Z");

describe("Translation", () => {
  it("native text reads source text and done", () => {
    expect(translationState(cardRow({}, { is_source: true }))).toEqual({ state: "source text", tone: "done" });
    expect(translationState(cardRow({ review: cell("source", "none") }))).toEqual({ state: "source text", tone: "done" });
  });
  it("accepted is done", () => {
    expect(translationState(cardRow({ review: cell("accepted", "done", { note: "unchanged" }) }))).toEqual({ state: "accepted", tone: "done" });
  });
  it("machine translation without review reads not reviewed, optional", () => {
    expect(translationState(cardRow({ review: cell("not_planned", "none") }))).toEqual({ state: "not reviewed, optional", tone: "optional" });
    expect(translationState(cardRow({ review: cell("not_accepted", "decision", { note: "review_off" }) }))).toEqual({ state: "not reviewed, optional", tone: "optional" });
  });
  it("in review names the reviewers", () => {
    expect(translationState(cardRow({ review: cell("in_progress", "running", { people: [ana, tom] }) }))).toEqual({ state: "in review (Ana Weber, Tom Reis)", tone: "now" });
    expect(translationState(cardRow({ review: cell("re_review", "running", { people: [ana] }) }))).toEqual({ state: "in review (Ana Weber)", tone: "now" });
  });
  it("other review states keep the short cell label and need work now", () => {
    expect(translationState(cardRow({ review: cell("unassigned", "todo") }))).toEqual({ state: "Unassigned", tone: "now" });
    expect(translationState(cardRow({ review: cell("rejected", "rejected") }))).toEqual({ state: "Rejected", tone: "now" });
  });
});

describe("Annotation", () => {
  it("not planned is optional", () => {
    expect(annotationState(cardRow({ annotation: cell("not_planned", "none") }))).toEqual({ state: "not planned", tone: "optional" });
  });
  it("waits for the translation review", () => {
    expect(annotationState(cardRow({ annotation: cell("after_review", "waiting") }))).toEqual({ state: "after translation review", tone: "later" });
    expect(annotationState(cardRow({ annotation: cell("blocked", "waiting") }))).toEqual({ state: "after translation review", tone: "later" });
  });
  it("annotation with one of max 2 annotators is now (R-13); no proposal count, never 0 of 0", () => {
    const target = cardRow({ annotation: cell("partly_assigned", "todo", { assigned: 1, target: 2 }) }, { proposal_count: 17 });
    expect(annotationState(target)).toEqual({ state: "1 annotator · max 2", tone: "now" });
    expect(annotationState(cardRow({ annotation: cell("unassigned", "todo", { assigned: 0, target: 2 }) }))).toEqual({ state: "No annotator yet · max 2", tone: "now" });
    expect(annotationState(cardRow({ annotation: cell("unassigned", "todo") }, { proposal_count: 28 }))).toEqual({ state: "Unassigned", tone: "now" });
  });
  it("in progress counts the submissions", () => {
    expect(annotationState(cardRow({ annotation: cell("in_progress", "running", { submitted: 1, total: 2 }) }))).toEqual({ state: "1 of 2 submitted", tone: "now" });
  });
  it("without server counts counts the annotate work items, never 0 of 0", () => {
    const work = [annotateItem({ assignment_id: 1, status: "submitted" }), annotateItem({ assignment_id: 2, status: "submitted" })];
    expect(annotationState(cardRow({ annotation: cell("submitted", "done") }, { work }))).toEqual({ state: "2 of 2 submitted", tone: "done" });
    expect(annotationState(cardRow({ annotation: cell("consolidating", "running") }, { work }))).toEqual({ state: "2 of 2 submitted", tone: "done" });
    expect(annotationState(cardRow({ annotation: cell("consolidating", "running") }, { work: [] }))).toEqual({ state: "submitted", tone: "done" });
    expect(annotationState(cardRow({ annotation: cell("in_progress", "running") }, { work: [] }))).toEqual({ state: "in progress", tone: "now" });
  });
  it("submitted and consolidating are done", () => {
    expect(annotationState(cardRow({ annotation: cell("submitted", "done", { submitted: 2, total: 2 }) }))).toEqual({ state: "2 of 2 submitted", tone: "done" });
    expect(annotationState(cardRow({ annotation: cell("consolidating", "running", { submitted: 3, total: 3 }) }))).toEqual({ state: "3 of 3 submitted", tone: "done" });
  });
});

describe("Finalization", () => {
  it("waits before the annotation is done", () => {
    for (const state of ["none", "after_annotation", "after_review"]) {
      expect(finalizationState(cardRow({ final: cell(state, "waiting") }), now)).toEqual({ state: "waiting", tone: "later" });
    }
  });
  it("2 of 2 submitted is done and finalization is ready to compare", () => {
    const target = cardRow({ annotation: cell("submitted", "done", { submitted: 2, total: 2 }), final: cell("choose", "decision", { submitted: 2 }) });
    expect(annotationState(target).tone).toBe("done");
    expect(finalizationState(target, now)).toEqual({ state: "ready to compare", tone: "now" });
  });
  it("a preselected result (submitted consolidation, accept rule) is ready to accept, not to compare", () => {
    const target = cardRow({ final: cell("choose", "decision", { submitted: 3, label_rule: "accept" }) });
    expect(finalizationState(target, now)).toEqual({ state: "ready to accept", tone: "now" });
  });
  it("consolidating shows 2 of 3 groups open", () => {
    const stages = { annotation: cell("consolidating", "running"), final: cell("after_annotation", "waiting") };
    expect(finalizationState(cardRow(stages, { consolidation_progress: { open: 2, total: 3 } }), now)).toEqual({ state: "consolidating (2 of 3 groups open)", tone: "now" });
    expect(finalizationState(cardRow(stages), now)).toEqual({ state: "consolidating", tone: "now" });
  });
  it("confirm reads ready to accept", () => {
    expect(finalizationState(cardRow({ final: cell("confirm", "decision") }), now)).toEqual({ state: "ready to accept", tone: "now" });
  });
  it("accepted shows the date", () => {
    const chosen = final({ case_id: "case-200", language: "de", document_id: "case-200-de", submission_id: "s-1", selected_at: "2026-10-18T10:05:00Z" });
    expect(finalizationState(cardRow({ final: cell("final", "done") }, { final: chosen }), now)).toEqual({ state: "accepted 18 Oct", tone: "done" });
    expect(finalizationState(cardRow({ final: cell("final", "done", { at: "2026-10-03T09:00:00Z" }) }), now)).toEqual({ state: "accepted 3 Oct", tone: "done" });
  });
  it("old text keeps the cell label", () => {
    expect(finalizationState(cardRow({ final: cell("old_text", "decision") }), now)).toEqual({ state: "Final is on old text", tone: "now" });
  });
});

describe("segments", () => {
  it("are Translation, Annotation, Finalization", () => {
    const segments = cardSegments(cardRow({ annotation: cell("partly_assigned", "todo", { assigned: 1, target: 2 }) }), now);
    expect(segments.map(segment => segment.title)).toEqual(["Translation", "Annotation", "Finalization"]);
    expect(segments.map(segment => segment.id)).toEqual(["translation", "annotation", "finalization"]);
  });
  it("defaultSegment picks the segment that needs work now", () => {
    const target = cardRow({ review: cell("not_planned", "none"), annotation: cell("partly_assigned", "todo", { assigned: 1, target: 2 }), final: cell("after_annotation", "waiting") },
      { work: [annotateItem({ assignment_id: 1, person: tom })] });
    expect(defaultSegment(cardSegments(target, now))).toBe("annotation");
    // Nothing needs work now: the first part that is not done.
    expect(defaultSegment(cardSegments(cardRow({ review: cell("accepted", "done"), annotation: cell("after_review", "waiting") }), now))).toBe("annotation");
    // Everything done: Finalization.
    const done = cardRow({ review: cell("accepted", "done"), annotation: cell("submitted", "done", { submitted: 1, total: 1 }), final: cell("final", "done") },
      { work: [work({ assignment_id: 2, document_id: "case-200-de", status: "submitted" })] });
    expect(defaultSegment(cardSegments(done, now))).toBe("finalization");
  });
});
