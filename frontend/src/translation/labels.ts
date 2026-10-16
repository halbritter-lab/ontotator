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
