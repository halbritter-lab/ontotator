/**
 * Builders for the stage-column table (documents overview O4b): people, cells and rows of the
 * scenario table. They only compose the shared builders of `fixtures.ts`.
 */
import type { DocumentRowView, NextStepView, PersonRefView, RowStagesView, StageCellView } from "../../src/api/client";
import { group, planRow, stageCell, stages, stepOf } from "./fixtures";

export const ana: PersonRefView = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
export const tom: PersonRefView = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
export const luc: PersonRefView = { pseudonym: "ann-0005", display_name: "Luc Martin", is_me: false };

export const cell = stageCell;

/** A translation row with the given stages and steps (first step = next step). */
export function stagedRow(caseId: string, language: string, options: {
  stages?: Partial<RowStagesView>;
  steps?: NextStepView[];
  overrides?: Partial<DocumentRowView>;
} = {}): DocumentRowView {
  const steps = options.steps ?? [];
  return planRow(caseId, language, steps[0] ?? null, {
    steps,
    in_plan: true,
    stages: stages(options.stages ?? {}),
    ...options.overrides,
  });
}

/** Scenario 7a: one submission, Final "Your choice", action Accept result…. */
export function scenario7a(): DocumentRowView {
  return stagedRow("case-107", "de", {
    stages: {
      review: cell("accepted", "done", { note: "unchanged" }),
      annotation: cell("submitted", "done", { people: [ana], findings: 3, version: 1 }),
      final: cell("choose", "decision", { submitted: 1 }),
    },
    steps: [stepOf("choose_final", { stage: "final" })],
  });
}

/** Scenario 7b: two submissions, Compare results…. */
export function scenario7b(): DocumentRowView {
  return stagedRow("case-107", "en", {
    stages: {
      review: cell("source", "none"),
      annotation: cell("submitted", "done", { people: [ana, tom], submitted: 2, total: 2 }),
      final: cell("choose", "decision", { submitted: 2 }),
    },
    steps: [stepOf("choose_final", { stage: "final" })],
    overrides: { is_source: true },
  });
}

/** A case with its source (not planned) and one translation row. */
export function caseWith(caseId: string, translation: DocumentRowView, source?: DocumentRowView) {
  const en = source ?? stagedRow(caseId, "en", {
    stages: { review: cell("source", "none"), annotation: cell("not_planned", "none") },
    overrides: { is_source: true, in_plan: false, next_step: null, plan_row: { review: false, annotate: false, review_applicable: false, discarded: false, decided: true } },
  });
  return group(caseId, [en, translation]);
}

export type { StageCellView };
