// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NextStepView } from "../../src/api/client";
import { actionLabel, leadSteps, rowActionLabel, stepLabel, STEP_LABELS } from "../../src/documents/nextStepLabels";
import { row, stageCell, stages, stepOf, version, work } from "./fixtures";

describe("next step labels", () => {
  it("labels every step code", () => {
    const expected: Record<NextStepView["code"], string> = {
      decide_plan: "Decide the plan",
      decide_report: "Decide on problem report",
      resume_task: "Resume paused task",
      confirm_final: "Confirm final result",
      handle_text_change: "Handle text change",
      carry_text_change: "Carry to v2",
      resolve_rejected: "Resolve rejected translation",
      resolve_queried: "Resolve queried translation",
      translation_not_accepted: "Translation not accepted",
      choose_final: "Choose final result",
      assign_translation_review: "Assign translation review",
      review_source_change: "Review source change",
      translation_review_in_progress: "Translation review in progress",
      assign_annotation: "Assign annotation",
      annotation_in_progress: "Annotation in progress",
      consolidation_in_progress: "Consolidation in progress",
      waiting_for_translation_review: "Waiting for translation review",
      done: "Done",
      translation_accepted: "Translation accepted",
      needs_attention: "Needs attention",
    };
    expect(STEP_LABELS).toEqual(expected);
    for (const [code, label] of Object.entries(expected)) expect(stepLabel(code as NextStepView["code"])).toBe(label);
    expect(actionLabel("accept_or_review")).toBe("Assign review or accept…");
    expect(actionLabel("decide_report")).toBe("Decide on report…");
    expect(actionLabel("resume_task")).toBe("Resume task…");
    expect(actionLabel("review_changes")).toBe("Review changes…");
    expect(actionLabel("resolve")).toBe("Resolve…");
    expect(actionLabel("choose_final")).toBe("Compare results…");
    expect(actionLabel("assign_translation_review")).toBe("Assign review…");
    expect(actionLabel("assign_annotation")).toBe("Assign annotation…");
    expect(actionLabel("plan")).toBe("Plan…");
    // Text changes (documents overview "Copy › Actions").
    expect(actionLabel("handle_text_change")).toBe("Handle text change…");
    expect(actionLabel("carry_text_change")).toBe("Carry to v2…");
    expect(actionLabel("assign_source_review")).toBe("Assign review…");
  });

  it("names Choose final as Accept result… for one submission and Compare results… otherwise (V6, VD16)", () => {
    const choose = stepOf("choose_final");
    const one = row({ case_id: "c", language: "de", stages: stages({ final: stageCell("choose", "decision", { submitted: 1 }) }) });
    const two = row({ case_id: "c", language: "de", stages: stages({ final: stageCell("choose", "decision", { submitted: 2 }) }) });
    expect(rowActionLabel(choose, one)).toBe("Accept result…");
    expect(rowActionLabel(choose, two)).toBe("Compare results…");
    expect(rowActionLabel(stepOf("assign_annotation"), one)).toBe("Assign annotation…");
  });

  it("follows the server's stages.final.detail.label_rule, the same rule as the final-result panel (VD16)", () => {
    const choose = stepOf("choose_final");
    // A consolidation of all submissions: two submitted, yet the panel accepts the consolidation.
    const consolidated = row({ case_id: "c", language: "de", stages: stages({ final: stageCell("choose", "decision", { submitted: 2, label_rule: "accept" }) }) });
    const single = row({ case_id: "c", language: "de", stages: stages({ final: stageCell("choose", "decision", { submitted: 1, label_rule: "compare" }) }) });
    expect(rowActionLabel(choose, consolidated)).toBe("Accept result…");
    expect(rowActionLabel(choose, single)).toBe("Compare results…");
  });

  it("reads Accept result… when every compared finding matches (issue 198)", () => {
    const choose = stepOf("choose_final");
    const at = (matching: number, compared: number) => row({ case_id: "c", language: "de", stages: stages({ final: stageCell("choose", "decision", { submitted: 2, label_rule: "compare", matching, compared }) }) });
    expect(rowActionLabel(choose, at(4, 4))).toBe("Accept result…");
    expect(rowActionLabel(choose, at(0, 0))).toBe("Accept result…");
    expect(rowActionLabel(choose, at(3, 4))).toBe("Compare results…");
    // Like the card: a final already chosen, or annotations still open (partial agreement), compare.
    expect(rowActionLabel(choose, { ...at(4, 4), final: { submission_id: "s1" } as never })).toBe("Compare results…");
    const work = (status: string) => ({ task: "annotate", status, moved_to_version: null }) as never;
    expect(rowActionLabel(choose, { ...at(4, 4), work: [work("submitted"), work("submitted"), work("in_progress")] })).toBe("Compare results…");
    expect(rowActionLabel(choose, { ...at(4, 4), work: [work("submitted"), work("submitted")] })).toBe("Accept result…");
  });

  it("names the text-change actions by target version and person when one row has several (VD18)", () => {
    const versions = [version({ document_id: "d1", version: 1, is_newest_in_chain: false }), version({ document_id: "d3", version: 3 })];
    const tom = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
    const luc = { pseudonym: "ann-0005", display_name: "Luc Martin", is_me: false };
    const handleTom = stepOf("handle_text_change", { assignment_id: 1, document_id: "d3" });
    const handleLuc = stepOf("handle_text_change", { assignment_id: 2, document_id: "d3" });
    const carry = stepOf("carry_text_change", { assignment_id: 3, submission_id: "s", document_id: "d3" });
    const one = row({ case_id: "c", language: "de", versions, steps: [handleTom, carry],
      work: [work({ assignment_id: 1, document_id: "d1", person: tom }), work({ assignment_id: 3, document_id: "d1", status: "submitted", person: luc })] });
    expect(rowActionLabel(handleTom, one)).toBe("Handle text change…");
    expect(rowActionLabel(carry, one)).toBe("Carry to v3…");
    const several = { ...one, steps: [handleTom, handleLuc], work: [...one.work, work({ assignment_id: 2, document_id: "d1", person: luc })] };
    expect(rowActionLabel(handleTom, several)).toBe("Handle text change…, Tom Reis");
    expect(rowActionLabel(handleLuc, several)).toBe("Handle text change…, Luc Martin");
  });

  it("lists the lead-owned steps with an action in server order", () => {
    const steps = [stepOf("decide_report"), stepOf("annotation_in_progress"), stepOf("choose_final"), stepOf("needs_attention")];
    const target = row({ case_id: "c", language: "de", next_step: steps[0], steps });
    expect(leadSteps(target).map(entry => entry.code)).toEqual(["decide_report", "choose_final"]);
    expect(leadSteps(row({ case_id: "c", language: "de", next_step: steps[0], steps: [] })).map(entry => entry.code)).toEqual(["decide_report"]);
  });
});
