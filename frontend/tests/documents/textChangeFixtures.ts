/**
 * Rows of the text-change dialogs (documents overview O7): an open annotation on v1 with v2 as
 * the target (scenario 12), a submitted annotation on v1 (scenario 13) and the preview counts.
 */
import type { CarryPerson, DocumentRowView, NextStepView, TextChangePreview } from "../../src/api/client";
import { row, stepOf, version, work } from "./fixtures";
import { ana, tom } from "./tableFixtures";

export const V1 = "case-112-de-v1";
export const V2 = "case-112-de-v2";

const versions = (caseId: string) => [
  version({ document_id: `${caseId}-de-v1`, external_id: `${caseId}-de`, chain_id: "de", chain_name: "DeepL", version: 1, origin: "machine_translation", is_newest_in_chain: false }),
  version({ document_id: `${caseId}-de-v2`, external_id: `${caseId}-de`, chain_id: "de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: `${caseId}-de-v1` }),
];

export function handleStep(overrides: Partial<NextStepView> = {}): NextStepView {
  return stepOf("handle_text_change", { stage: "annotation", assignment_id: 41, document_id: V2, owner: { kind: "you", person: null, count: 0, people: [] }, ...overrides });
}

/** Tom Reis has an open annotation on v1; the text is now v2. */
export function openOnOldText(options: { held?: boolean } = {}): { row: DocumentRowView; step: NextStepView } {
  const step = handleStep();
  return {
    step,
    row: row({
      case_id: "case-112", language: "de", versions: versions("case-112"), steps: [step], next_step: step,
      work: [work({ assignment_id: 41, document_id: V1, version: 1, status: "in_progress", author_label: tom.pseudonym, person: tom, held: options.held ?? false })],
    }),
  };
}

export function carryStep(overrides: Partial<NextStepView> = {}): NextStepView {
  return stepOf("carry_text_change", { stage: "annotation", assignment_id: 51, submission_id: "sub-ana-1", document_id: "case-113-de-v2", ...overrides });
}

/** Ana Weber submitted on v1 (Round 1); the text is now v2. */
export function submittedOnOldText(): { row: DocumentRowView; step: NextStepView } {
  const step = carryStep();
  return {
    step,
    row: row({
      case_id: "case-113", language: "de", versions: versions("case-113"), steps: [step], next_step: step,
      work: [work({ assignment_id: 51, document_id: "case-113-de-v1", version: 1, status: "submitted", author_label: ana.pseudonym, person: ana, round_ordinal: 1 })],
    }),
  };
}

export const carryPeople: CarryPerson[] = [
  { username: "ana", display_name: "Ana Weber", author: true, has_work: true },
  { username: "luc", display_name: "Luc Martin", author: false, has_work: true },
  { username: "mia", display_name: "Mia Kranz", author: false, has_work: false },
];

export function preview(overrides: Partial<TextChangePreview> = {}): TextChangePreview {
  return { from_version: 1, to_version: 2, findings: 3, placed: 3, unplaced: 0, in_changed_passages: 0, persons: carryPeople, ...overrides };
}
