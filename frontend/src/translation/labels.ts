import type { ClinicalCategory, IssueCode, ReviewDecisionCode } from "./reviewRules";

/** English presentation keyed by domain codes, ready for later translation. */
export const decisionLabels: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "Accepted unchanged",
  accepted_corrected: "Accepted with corrections",
  query: "Query",
  rejected: "Rejected",
};

export const categoryLabels: Readonly<Record<ClinicalCategory, string>> = {
  omission: "Omission",
  addition: "Addition",
  assertion: "Negation or certainty",
  value: "Number or unit",
  anatomy: "Anatomy or laterality",
  terminology: "Terminology",
  source: "Problem in the source",
};

export const issueMessages: Readonly<Record<IssueCode, string>> = {
  TEXT_EMPTY: "The proposed text must not be empty.",
  TEXT_CHANGED: "Accepted unchanged needs text equal to the reviewed text.",
  CLINICAL_CHANGE_NOT_ALLOWED: "Accepted unchanged cannot include a clinical change.",
  TEXT_UNCHANGED: "Accepted with corrections needs changed text.",
  CLINICAL_CHANGE_REQUIRED: "A query or rejection needs a clinical change.",
  CATEGORY_REQUIRED: "A clinical change needs a category.",
  RATIONALE_REQUIRED: "A clinical change needs a rationale.",
  CATEGORIES_WITHOUT_CHANGE: "Categories need a clinical change.",
};

/** One-line explanation shown under each decision option. */
export const decisionDescriptions: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "The translation is correct as it stands. You made no edits.",
  accepted_corrected: "You corrected the translation. Your version is accepted.",
  query: "The meaning may differ clinically and needs clarification. Not accepted.",
  rejected: "The translation changes clinical meaning and cannot be used. Not accepted.",
};

/** What submitting each decision will do, for the confirmation dialog. */
export const decisionConsequences: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "The translation will be accepted unchanged and becomes available for annotation.",
  accepted_corrected: "Your corrected text will be saved as a new version, which is accepted and becomes available for annotation. The machine translation stays as it was.",
  query: "The translation will be marked as reviewed with a query. It will not be accepted for annotation.",
  rejected: "The translation will be marked as reviewed and rejected. It will not be accepted for annotation.",
};

/** What submitting did, for the success message. */
export const decisionOutcomes: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "The translation was accepted unchanged and is available for annotation.",
  accepted_corrected: "Your corrected text was saved as a new version, which is accepted for annotation.",
  query: "The translation is marked as reviewed with a query. It is not accepted for annotation.",
  rejected: "The translation is marked as reviewed and rejected. It is not accepted for annotation.",
};

/** Hint under "Clinically relevant change", following the review rules for each decision. */
export const clinicalChangeHints: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "Not allowed with Accepted unchanged. Clear it or choose another decision.",
  accepted_corrected: "Tick this if your correction changes the clinical meaning.",
  query: "Required for a query.",
  rejected: "Required for a rejection.",
};

const humanize = (code: string): string => {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unnamed check";
};

/** Known automatic translation check codes; unknown codes are turned into words. */
export const checkLabels: Readonly<Record<string, string>> = {
  units_added: "Units added in translation",
  numbers_changed: "Numbers changed in translation",
};

export function checkLabel(code: unknown): string {
  const value = typeof code === "string" ? code : "";
  return Object.prototype.hasOwnProperty.call(checkLabels, value) ? checkLabels[value] : humanize(value);
}

/** Draft explanations; confirmed by the user before release (docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md). */
export const checkExplanations: Readonly<Record<string, string>> = {
  units_added: "The translation run's check found a unit of measurement in the translation that it did not find in the source.",
  numbers_changed: "The translation run's check found numbers in the translation that differ from those in the source.",
};
export const unknownCheckExplanation = "The translation run reported this check as failed. Ontocurator has no description for it; ask the project lead what it checks.";
export const checkNoLocation = "This check does not point to a text location. Compare the source and the translation yourself.";
export const checkDeviationGuidance = "Choose Accepted unchanged and say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit.";

export function checkExplanation(code: string): string {
  return Object.hasOwn(checkExplanations, code) ? checkExplanations[code] : unknownCheckExplanation;
}

export function failedChecksTitle(count: number): string {
  return count === 1 ? "1 automatic check failed" : `${count} automatic checks failed`;
}

/** Translation status of a document after a review, in words. */
export const translationStatusWords: Readonly<Record<string, string>> = {
  translated: "Translated",
  automatic_check_failed: "Automatic check failed",
  ready_for_review: "Ready for review",
  reviewed: "Reviewed",
  accepted: "Accepted",
};

export function translationStatusLabel(status: string): string {
  return Object.prototype.hasOwnProperty.call(translationStatusWords, status) ? translationStatusWords[status] : humanize(status);
}

export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** English date and time without seconds, in the reader's time zone. */
export function formatReviewDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date);
}
