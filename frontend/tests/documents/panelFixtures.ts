/**
 * Builders for the final-result panel tests (documents overview "Final-result panel"): rows whose
 * next step opens the panel and the panel views the API returns for them.
 */
import type { DocumentRowView, FinalPanelSubmissionView, FinalPanelView, PersonRefView, RowSubmissions } from "../../src/api/client";
import { agreement, final, finalPanel, item, panelSubmission, row, stepOf, submissions, version } from "./fixtures";

export const ana: PersonRefView = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
export const tom: PersonRefView = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
export const luc: PersonRefView = { pseudonym: "rev-0005", display_name: "Luc Martin", is_me: false };

/** A row whose lead step is "Accept result…" / "Compare results…" (choose_final). */
export function chooseRow(caseId: string, language: string, overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const step = stepOf("choose_final");
  return row({
    case_id: caseId, language,
    versions: [version({ document_id: `${caseId}-${language}`, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted" })],
    next_step: step, steps: [step], categories: ["missing-final"], missing_final: { counts: true, reason: null },
    ...overrides,
  });
}

/** A row with a final on v1 and a corrected v2 ("Review changes…", confirm_final). */
export function reviewRow(caseId: string, language: string, overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const step = stepOf("confirm_final");
  const v1 = version({ document_id: `${caseId}-${language}`, chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false });
  const v2 = version({ document_id: `${caseId}-${language}-v2`, external_id: `${caseId}-${language}`, chain_id: `${caseId}-${language}`, chain_name: "DeepL", version: 2, origin: "correction", derived_from: `${caseId}-${language}`, translation_status: "accepted" });
  return row({
    case_id: caseId, language, versions: [v1, v2],
    final: final({ case_id: caseId, language, document_id: v1.document_id, submission_id: `${caseId}-s1`, author_label: "ann-0003", chain_name: "DeepL", revision: 2 }),
    issues: [item({ code: "SELECTED_TEXT_CORRECTED", cause_id: `SELECTED_TEXT_CORRECTED:${v1.document_id}:${v2.document_id}:accepted`, category: "confirm-final", document_id: v2.document_id, version: 2 })],
    next_step: step, steps: [step], categories: ["confirm-final"],
    ...overrides,
  });
}

/** Ana's Round 1 on v1 of the row. */
export function anaSubmission(caseId: string, language: string, overrides: Partial<FinalPanelSubmissionView> = {}): FinalPanelSubmissionView {
  return panelSubmission({
    submission_id: `${caseId}-s1`, document_id: `${caseId}-${language}`, author_label: "ann-0003", author: ana,
    round_id: `${caseId}-r1`, round_ordinal: 1, is_latest_in_round: true, finding_count: 3, recorded_at: "2026-10-20T12:01:00Z",
    ...overrides,
  });
}

/** Tom's Round 1 on v1 of the row. */
export function tomSubmission(caseId: string, language: string, overrides: Partial<FinalPanelSubmissionView> = {}): FinalPanelSubmissionView {
  return panelSubmission({
    submission_id: `${caseId}-s2`, document_id: `${caseId}-${language}`, author_label: "ann-0004", author: tom,
    round_id: `${caseId}-r2`, round_ordinal: 1, is_latest_in_round: true, finding_count: 4, recorded_at: "2026-10-20T13:30:00Z",
    ...overrides,
  });
}

/** One submission, "Accept result…". */
export function acceptPanel(caseId: string, language: string, overrides: Partial<FinalPanelSubmissionView> = {}): FinalPanelView {
  const only = anaSubmission(caseId, language, overrides);
  return finalPanel({ submissions: [only], label_rule: "accept", accept_submission_id: only.submission_id });
}

/** Ana (5 findings, 1 only here) and Tom (4, 0): "4 of 6 findings match · 1 differs in context only". */
export function comparePanel(caseId: string, language: string): FinalPanelView {
  return finalPanel({
    submissions: [anaSubmission(caseId, language, { finding_count: 5, only_here: 1 }), tomSubmission(caseId, language, { only_here: 0 })],
    agreement: agreement({ compared_version: 1, total: 6, matching: 4, context_differences: 1 }),
    label_rule: "compare",
  });
}

/** The row's submissions (rounds for cause wording) matching a panel view. */
export function panelRowSubmissions(caseId: string, language: string, view: FinalPanelView, overrides: Partial<RowSubmissions> = {}): RowSubmissions {
  return submissions(caseId, language, { submissions: view.submissions ?? [], ...overrides });
}
