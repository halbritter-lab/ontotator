// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NextStepView } from "../../src/api/client";
import { actionLabel, BADGE_LABELS, leadSteps, rowActionLabel, secondaryLine, stepLabel, STEP_FILTER_GROUPS, STEP_LABELS } from "../../src/documents/nextStepLabels";
import { final, row, stageCell, stages, step, stepOf, version, work } from "./fixtures";

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
    expect(BADGE_LABELS.source_changed).toBe("Source changed");
  });

  it("offers every step code in the step filter except the fallback", () => {
    const grouped = STEP_FILTER_GROUPS.flatMap(([, codes]) => codes);
    expect(new Set(grouped)).toEqual(new Set(Object.keys(STEP_LABELS).filter(code => code !== "decide_plan" && code !== "needs_attention")));
  });

  it("labels the secondary line per detail kind", () => {
    const plain = row({ case_id: "case-0101", language: "de" });
    expect(secondaryLine(step({ code: "assign_translation_review", detail: { kind: "version", version: 1, origin: "machine_translation", translation_status: "ready_for_review", task_paused: false } }), plain))
      .toBe("v1 machine translation, ready for review");
    expect(secondaryLine(step({ code: "assign_annotation", detail: { kind: "source_ready", task_paused: false } }), plain)).toBe("Source text, ready to annotate");
    expect(secondaryLine(step({ code: "choose_final", detail: { kind: "annotations_submitted", submitted: 2, total: 2, task_paused: false } }), plain)).toBe("2 of 2 annotations submitted");
    expect(secondaryLine(step({ code: "annotation_in_progress", detail: { kind: "round", round_ordinal: 1, task_paused: false } }), plain)).toBe("Round 1, in progress");
    const excerpt = "The translation drops the negation in the second sentence and the dosage line.";
    expect(secondaryLine(step({ code: "decide_report", detail: { kind: "report", excerpt, reporter: { pseudonym: "ann-0005", display_name: "Ben Roth", is_me: false }, task_paused: true } }), plain))
      .toBe(`“${excerpt.slice(0, 60)}…”, Ben Roth (ann-0005), task paused`);
    const withFinal = row({ case_id: "case-0101", language: "de", final: final({ case_id: "case-0101", language: "de", document_id: "d", submission_id: "s", round_ordinal: 1, author_label: "ann-0004", author: { pseudonym: "ann-0004", display_name: "Annotator", is_me: false } }) });
    expect(secondaryLine(step({ code: "done", kind: "done", detail: { kind: "final", version: 1, round_ordinal: 1, task_paused: false } }), withFinal)).toBe("Final: Annotation, from scratch, Round 1, Annotator (ann-0004)");
    expect(secondaryLine(step({ code: "translation_accepted", kind: "done", detail: { kind: "review_only", version: 1, task_paused: false } }), plain)).toBe("Review only, not annotated");
    expect(secondaryLine(step({ code: "waiting_for_translation_review", kind: "in_progress", detail: { kind: "waiting", version: 2, origin: "correction", translation_status: "ready_for_review", task_paused: false } }), plain))
      .toBe("v2 correction, waiting for review");
    expect(secondaryLine(step({ code: "assign_annotation", kind: "assign", assigned: 1, target: 2, detail: null }), plain)).toBe("1 of 2 assigned");
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
