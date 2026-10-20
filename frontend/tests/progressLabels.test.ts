import { describe, expect, it } from "vitest";
import { countLabel, doneSentence, ledeSentence, stageCards } from "../src/admin/progressLabels";
import type { ProgressStagesView } from "../src/api/client";

const stages: ProgressStagesView = {
  translation_review: { scope: "review", done: 2, total: 7, counts: { to_assign: 3, in_review: 2, check_failed: 1, check_failed_with_reviewer: 1, rejected_or_queried: 0, accepted: 2 } },
  annotation: { scope: "annotate", done: 2, total: 11, counts: { waiting_for_review: 4, to_assign: 3, in_progress: 1, paused: 1, submitted: 2 } },
  final: { scope: "annotate", done: 1, total: 11, counts: { not_ready: 9, to_choose: 1, to_confirm: 0, final: 1, would_be_omitted: 10 } },
};

describe("progress labels", () => {
  it("builds the lede", () => {
    expect(ledeSentence({ cases: 50, translations_to_review: 50, versions_to_annotate: 50, not_in_plan: 100, needs_decision: 0, to_assign: 0 }))
      .toBe("50 cases · 50 translations to review · 50 language versions to annotate (100 not in plan).");
    expect(ledeSentence({ cases: 1, translations_to_review: 1, versions_to_annotate: 1, not_in_plan: 0, needs_decision: 0, to_assign: 0 }))
      .toBe("1 case · 1 translation to review · 1 language version to annotate (0 not in plan).");
  });

  it("builds done sentences", () => {
    expect(doneSentence(2, 7, "accepted")).toBe("2 of 7 accepted");
    expect(doneSentence(0, 0, "final")).toBe("0 of 0 final");
  });

  it("pluralizes counts", () => {
    expect(countLabel(1, "case")).toBe("1 case");
    expect(countLabel(2, "case")).toBe("2 cases");
    expect(countLabel(3, "needs your decision", "need your decision")).toBe("3 need your decision");
    expect(countLabel(1, "needs your decision", "need your decision")).toBe("1 needs your decision");
  });

  it("describes the three stage cards with Documents filters", () => {
    const cards = stageCards(stages, 2);
    expect(cards.map(card => card.title)).toEqual(["Translation review", "Annotation", "Final result"]);
    expect(cards.map(card => card.done)).toEqual(["2 of 7 accepted", "2 of 11 fully submitted", "1 of 11 final"]);
    expect(cards.map(card => card.scope)).toEqual([
      "7 translations selected for review",
      "11 language versions selected · 2 annotations per text",
      "11 language versions selected for annotation",
    ]);
    expect(cards[0].rows.map(row => [row.label, row.count, row.query])).toEqual([
      ["To assign", 3, { step: "assign_translation_review" }],
      ["In review", 2, { step: "translation_review_in_progress" }],
      ["Check failed, with reviewer", 1, { step: "translation_review_in_progress", translation_status: "automatic_check_failed" }],
      ["Rejected or queried · your decision", 0, { decision: "translation" }],
      ["Accepted", 2, { translation_status: "accepted" }],
    ]);
    expect(cards[1].rows.map(row => [row.label, row.count, row.query])).toEqual([
      ["Waiting for translation review", 4, { step: "waiting_for_translation_review" }],
      ["To assign", 3, { step: "assign_annotation" }],
      ["In progress", 1, { step: "annotation_in_progress" }],
      ["Paused by a problem report", 1, { status: "held" }],
      ["Submitted", 2, { status: "submitted" }],
    ]);
    expect(cards[2].rows.map(row => [row.label, row.count, row.query])).toEqual([
      ["Not ready (work open)", 9, { final: "none" }],
      ["To choose · your decision", 1, { step: "choose_final" }],
      ["To confirm · your decision", 0, { step: "confirm_final" }],
      ["Final", 1, { stage: "done" }],
    ]);
    expect(cards[2].footer).toBe("(1 final, 10 would be omitted)");
    expect(cards[1].scope).toContain("2 annotations per text");
    expect(stageCards(stages, 1)[1].scope).toBe("11 language versions selected · 1 annotation per text");
    expect(stageCards(stages, null)[1].scope).toBe("11 language versions selected");
  });
});
