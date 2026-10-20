import { describe, expect, it } from "vitest";
import type { NextStepView } from "../../src/api/client";
import { actionLabel, ownerLabel, secondaryLine, stepLabel, STEP_LABELS } from "../../src/documents/nextStepLabels";
import { final, row, step } from "./fixtures";

describe("next step labels", () => {
  it("labels every step code", () => {
    const expected: Record<NextStepView["code"], string> = {
      decide_report: "Decide on problem report",
      resume_task: "Resume paused task",
      confirm_final: "Confirm final result",
      resolve_rejected: "Resolve rejected translation",
      resolve_queried: "Resolve queried translation",
      translation_not_accepted: "Translation not accepted",
      choose_final: "Choose final result",
      assign_translation_review: "Assign translation review",
      translation_review_in_progress: "Translation review in progress",
      assign_annotation: "Assign annotation",
      annotation_in_progress: "Annotation in progress",
      annotation_review_in_progress: "Annotation review in progress",
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
    expect(actionLabel("choose_final")).toBe("Choose final…");
    expect(actionLabel("assign_translation_review")).toBe("Assign translation review…");
    expect(actionLabel("assign_annotation")).toBe("Assign annotation…");
  });

  it("labels the secondary line per detail kind", () => {
    const plain = row({ case_id: "case-0101", language: "de" });
    expect(secondaryLine(step({ code: "assign_translation_review", detail: { kind: "version", version: 1, origin: "machine_translation", translation_status: "ready_for_review", task_paused: false } }), plain))
      .toBe("v1 machine translation · ready for review");
    expect(secondaryLine(step({ code: "assign_annotation", detail: { kind: "source_ready", task_paused: false } }), plain)).toBe("Source text · ready to annotate");
    expect(secondaryLine(step({ code: "choose_final", detail: { kind: "annotations_submitted", submitted: 2, total: 2, task_paused: false } }), plain)).toBe("2 of 2 annotations submitted");
    expect(secondaryLine(step({ code: "annotation_in_progress", detail: { kind: "round", round_ordinal: 1, task_paused: false } }), plain)).toBe("Round 1 · in progress");
    const excerpt = "The translation drops the negation in the second sentence and the dosage line.";
    expect(secondaryLine(step({ code: "decide_report", detail: { kind: "report", excerpt, reporter: { pseudonym: "ann-0005", display_name: "Ben Roth", is_me: false }, task_paused: true } }), plain))
      .toBe(`“${excerpt.slice(0, 60)}…” · Ben Roth (ann-0005) · task paused`);
    const withFinal = row({ case_id: "case-0101", language: "de", final: final({ case_id: "case-0101", language: "de", document_id: "d", submission_id: "s", round_ordinal: 1, author_label: "ann-0004", author: { pseudonym: "ann-0004", display_name: "Annotator", is_me: false } }) });
    expect(secondaryLine(step({ code: "done", kind: "done", detail: { kind: "final", version: 1, round_ordinal: 1, task_paused: false } }), withFinal)).toBe("Final: Annotation · Round 1 · Annotator (ann-0004)");
    expect(secondaryLine(step({ code: "translation_accepted", kind: "done", detail: { kind: "review_only", version: 1, task_paused: false } }), plain)).toBe("Review only · not annotated");
    expect(secondaryLine(step({ code: "waiting_for_translation_review", kind: "in_progress", detail: { kind: "waiting", version: 2, origin: "correction", translation_status: "ready_for_review", task_paused: false } }), plain))
      .toBe("v2 correction · waiting for review");
    expect(secondaryLine(step({ code: "assign_annotation", kind: "assign", assigned: 1, target: 2, detail: null }), plain)).toBe("1 of 2 assigned");
  });

  it("labels the owner", () => {
    expect(ownerLabel(step({ owner: { kind: "you", person: null, count: 0 } }))).toBe("You");
    expect(ownerLabel(step({ owner: { kind: "person", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false }, count: 1 } }))).toBe("Ana Weber (ann-0004)");
    expect(ownerLabel(step({ code: "annotation_in_progress", stage: "annotation", owner: { kind: "people", person: null, count: 2 } }))).toBe("2 annotators");
    expect(ownerLabel(step({ code: "translation_review_in_progress", stage: "translation_review", owner: { kind: "people", person: null, count: 2 } }))).toBe("2 reviewers");
    expect(ownerLabel(step({ owner: { kind: "none", person: null, count: 0 } }))).toBe("—");
    expect(ownerLabel(null)).toBe("—");
  });
});
