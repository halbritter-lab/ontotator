import type { ReviewWorkspace, TranslationReviewRecord } from "../src/api/client";

const at = "2026-10-16T12:00:00Z";
export function reviewRecord(changes: Partial<TranslationReviewRecord> = {}): TranslationReviewRecord {
  return { id: 9, project_id: 1, document_id: "target", assignment_id: 17, reviewer_user_id: 1,
    reviewer_pseudonym: "R", reviewer_qualification: "Reviewer", reviewer_languages: ["en", "de"],
    decision: "accepted_corrected", clinical_change: false, categories: [], rationale: null,
    machine_text_sha256: "old", proposed_text: "Submitted correction", proposed_text_sha256: "new",
    status_before: "reviewed", status_after: "accepted", created_variant_id: "created-v7",
    review_policy: "translation-review/v1", created_at: at, ...changes };
}
export function reviewWorkspace(changes: Partial<ReviewWorkspace> = {}): ReviewWorkspace {
  const variant = { document_id: "target", case_id: "case", external_id: "EN 1/7", language: "de", version: 3,
    origin: "correction" as const, derived_from: "previous", translation: null,
    translation_status: "reviewed" as const, status_reason: null, text_sha256: "sha" };
  const ancestor = { ...variant, document_id: "translation-v1", version: 1, origin: "machine_translation" as const,
    derived_from: "source", translation: { provider: "Example MT", model: "Model 1", run_id: "run-1" } };
  return { assignment: { id: 17, project_key: "proj", document_id: "target", user_id: 1, username: "alice",
    pseudonym: "R", task: "translation_review", status: "in_progress", created_at: at, updated_at: at,
    revoked_at: null, last_submission_id: null, external_id: "EN 1/7" },
    variant, translation_ancestor: ancestor, text: "Übersetzt.",
    source: { variant: { ...variant, document_id: "source", external_id: "source", language: "en", origin: "native", version: 1 }, text: "Source 😀\n\nSecond paragraph." },
    comparisons: [], failed_checks: [{ code: "units_added", passed: false, detail: "A unit changed" }],
    draft: { text: "Übersetzt.", form: {}, revision: 6 }, qualification: "Reviewer",
    previous_reviews: [], read_only: false, submitted_record: null, ...changes };
}
