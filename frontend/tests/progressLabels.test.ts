// @vitest-environment node
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

  it("links every count to the server's query", () => {
    const linked: ProgressStagesView = {
      ...stages,
      translation_review: { ...stages.translation_review, links: {
        to_assign: { plan: ["review", "review_and_annotate"], step: ["assign_translation_review"], stage: [], translation_status: null, paused: null, final: null },
        rejected_or_queried: { plan: ["review", "review_and_annotate"], step: ["resolve_rejected", "resolve_queried"] },
        check_failed_with_reviewer: { plan: ["review", "review_and_annotate"], translation_status: "automatic_check_failed", step: ["translation_review_in_progress"] },
      } },
      annotation: { ...stages.annotation, links: { paused: { plan: ["annotate", "review_and_annotate"], paused: "yes" }, submitted: { plan: ["annotate", "review_and_annotate"], stage: ["final", "done"], paused: "no" } } },
      final: { ...stages.final, links: { final: { plan: ["annotate", "review_and_annotate"], final: "any" } } },
    };
    const cards = stageCards(linked, null);
    const query = (card: number, key: string) => cards[card].rows.find(row => row.key === key)?.query;
    expect(query(0, "to_assign")).toEqual({ plan: "review,review_and_annotate", step: "assign_translation_review" });
    expect(query(0, "rejected_or_queried")).toEqual({ plan: "review,review_and_annotate", step: "resolve_rejected,resolve_queried" });
    expect(query(0, "check_failed_with_reviewer")).toEqual({ plan: "review,review_and_annotate", translation_status: "automatic_check_failed", step: "translation_review_in_progress" });
    expect(query(1, "paused")).toEqual({ plan: "annotate,review_and_annotate", paused: "yes" });
    expect(query(1, "submitted")).toEqual({ plan: "annotate,review_and_annotate", stage: "final,done", paused: "no" });
    expect(query(2, "final")).toEqual({ plan: "annotate,review_and_annotate", final: "any" });
    // A count the server sends no query for has no link (no local query table).
    expect(query(0, "accepted")).toBeUndefined();
    expect(stageCards(stages, null).flatMap(card => card.rows).every(row => row.query === undefined)).toBe(true);
  });

  it("describes the three stage cards", () => {
    const cards = stageCards(stages, 2);
    expect(cards.map(card => card.title)).toEqual(["Translation review", "Annotation", "Final result"]);
    expect(cards.map(card => card.done)).toEqual(["2 of 7 accepted", "2 of 11 fully submitted", "1 of 11 final"]);
    expect(cards.map(card => card.scope)).toEqual([
      "7 translations selected for review",
      "11 language versions selected · 2 annotations per text",
      "11 language versions selected for annotation",
    ]);
    expect(cards[0].rows.map(row => [row.label, row.count])).toEqual([
      ["To assign", 3],
      ["In review", 2],
      ["Check failed, with reviewer", 1],
      ["Rejected or queried · your decision", 0],
      ["Accepted", 2],
    ]);
    expect(cards[1].rows.map(row => [row.label, row.count])).toEqual([
      ["Waiting for translation review", 4],
      ["To assign", 3],
      ["In progress", 1],
      ["Paused by a problem report", 1],
      ["Submitted", 2],
    ]);
    expect(cards[2].rows.map(row => [row.label, row.count])).toEqual([
      ["Not ready (work open)", 9],
      ["To choose · your decision", 1],
      ["To confirm · your decision", 0],
      ["Final", 1],
    ]);
    expect(cards[2].footer).toBe("(1 final, 10 would be omitted)");
    expect(cards[1].scope).toContain("2 annotations per text");
    expect(stageCards(stages, 1)[1].scope).toBe("11 language versions selected · 1 annotation per text");
    expect(stageCards(stages, null)[1].scope).toBe("11 language versions selected");
  });
});
