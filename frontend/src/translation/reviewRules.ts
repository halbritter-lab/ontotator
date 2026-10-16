/** Pure counterpart of domain/translation_review.py; raw form validation stays server-side. */
export type ReviewDecisionCode = "accepted_unchanged" | "accepted_corrected" | "query" | "rejected";
export type ClinicalCategory = "omission" | "addition" | "assertion" | "value" | "anatomy" | "terminology" | "source";
export type IssueCode = "TEXT_EMPTY" | "TEXT_CHANGED" | "CLINICAL_CHANGE_NOT_ALLOWED" | "TEXT_UNCHANGED"
  | "CLINICAL_CHANGE_REQUIRED" | "CATEGORY_REQUIRED" | "RATIONALE_REQUIRED" | "CATEGORIES_WITHOUT_CHANGE";

export interface ReviewForm {
  readonly decision: ReviewDecisionCode;
  readonly clinical_change: boolean;
  readonly categories?: readonly ClinicalCategory[];
  readonly rationale?: string | null;
}

// Python str.strip whitespace: JS trim additionally removes BOM and misses NEL/1C–1F.
const pythonWhitespaceOnly = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;

function canonicalText(text: string): string {
  return text.replace(/^\ufeff+/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

export function checkReview(form: ReviewForm, machineText: string, proposedText: string): IssueCode[] {
  const proposed = canonicalText(proposedText);
  const changed = proposed !== canonicalText(machineText);
  const issues: IssueCode[] = [];
  if (pythonWhitespaceOnly.test(proposed)) issues.push("TEXT_EMPTY");
  switch (form.decision) {
    case "accepted_unchanged":
      if (changed) issues.push("TEXT_CHANGED");
      if (form.clinical_change) issues.push("CLINICAL_CHANGE_NOT_ALLOWED");
      break;
    case "accepted_corrected":
      if (!changed) issues.push("TEXT_UNCHANGED");
      break;
    case "query":
    case "rejected":
      if (!form.clinical_change) issues.push("CLINICAL_CHANGE_REQUIRED");
      break;
  }
  const hasCategories = (form.categories?.length ?? 0) > 0;
  if (form.clinical_change && !hasCategories) issues.push("CATEGORY_REQUIRED");
  if (form.clinical_change && pythonWhitespaceOnly.test(form.rationale ?? "")) issues.push("RATIONALE_REQUIRED");
  if (!form.clinical_change && hasCategories) issues.push("CATEGORIES_WITHOUT_CHANGE");
  return issues;
}
