import { useId } from "react";
import { Checkbox, Textarea } from "../ui";
import { categoryLabels, clinicalChangeHints, decisionDescriptions, decisionLabels, issueMessages } from "./labels";
import type {
  ClinicalCategory,
  IssueCode,
  ReviewDecisionCode,
  ReviewForm as ReviewFormValue,
} from "./reviewRules";

export interface ReviewFormProps {
  value: Partial<ReviewFormValue>;
  issues: readonly IssueCode[];
  onChange: (next: Partial<ReviewFormValue>) => void;
  readOnly?: boolean;
}

const decisions = Object.keys(decisionLabels) as ReviewDecisionCode[];
const categories = Object.keys(categoryLabels) as ClinicalCategory[];

/**
 * Follow-up fields appear when the review rules make them relevant
 * (`reviewRules.checkReview`), and stay visible while they hold a value that a
 * rule still has to judge, so nothing that blocks submission is ever hidden:
 * - "Clinically relevant change" once a decision is chosen, except for Accepted
 *   unchanged, which forbids it (shown again if it is set, so it can be cleared);
 * - categories while a clinical change is set (it requires one) or any are set;
 * - rationale for every decision except Accepted unchanged (required with a
 *   clinical change, otherwise an optional note), or whenever it has text.
 */
export function ReviewForm({ value, issues, onChange, readOnly = false }: ReviewFormProps) {
  const id = useId();
  const decision = value.decision;
  const clinical = value.clinical_change ?? false;
  const chosen = (value.categories?.length ?? 0) > 0;
  const showClinical = clinical || (decision !== undefined && decision !== "accepted_unchanged");
  const showCategories = clinical || chosen;
  const showRationale = clinical || (decision !== undefined && decision !== "accepted_unchanged") || (value.rationale ?? "") !== "";

  return (
    <fieldset className="review-form" disabled={readOnly}>
      <legend className="review-sr-only">Translation review</legend>
      <fieldset className="review-decisions">
        <legend className="review-form-legend">Decision</legend>
        {decisions.map((option) => (
          <label className="review-decision" htmlFor={`${id}-${option}`} key={option}>
            <input
              id={`${id}-${option}`}
              className="form-checkbox"
              type="radio"
              name={`${id}-decision`}
              value={option}
              aria-labelledby={`${id}-${option}-label`}
              aria-describedby={`${id}-${option}-hint`}
              checked={decision === option}
              onChange={() => {
                if (!readOnly) onChange({ ...value, decision: option });
              }}
            />
            <span className="review-decision-text">
              <span className="review-decision-label" id={`${id}-${option}-label`}>{decisionLabels[option]}</span>
              <span className="review-decision-hint" id={`${id}-${option}-hint`}>{decisionDescriptions[option]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {showClinical && (
        <Checkbox
          id={`${id}-clinical-change`}
          label="Clinically relevant change"
          hint={decision ? clinicalChangeHints[decision] : undefined}
          checked={clinical}
          onChange={(event) => {
            if (readOnly) return;
            onChange(event.target.checked
              ? { ...value, clinical_change: true }
              : { ...value, clinical_change: false, categories: [] });
          }}
        />
      )}
      {showCategories && (
        <fieldset className="review-categories" disabled={readOnly || !clinical}>
          <legend className="review-form-legend">Clinical change categories</legend>
          <p className="review-form-hint">Choose at least one.</p>
          {categories.map((category) => (
            <Checkbox
              key={category}
              id={`${id}-category-${category}`}
              label={categoryLabels[category]}
              checked={value.categories?.includes(category) ?? false}
              onChange={(event) => {
                if (readOnly || !clinical) return;
                const current = value.categories ?? [];
                const next = event.target.checked
                  ? [...current.filter((item) => item !== category), category]
                  : current.filter((item) => item !== category);
                onChange({ ...value, categories: next });
              }}
            />
          ))}
        </fieldset>
      )}
      {showRationale && (
        <Textarea
          id={`${id}-rationale`}
          label="Rationale"
          hint={clinical ? "Required for a clinically relevant change." : "Optional."}
          rows={3}
          value={value.rationale ?? ""}
          onChange={(event) => {
            if (!readOnly) onChange({ ...value, rationale: event.target.value });
          }}
        />
      )}
      {issues.length > 0 && (
        <ol className="review-issues" aria-label="Review issues" aria-live="polite">
          {issues.map((issue, index) => <li key={`${issue}-${index}`}>{issueMessages[issue]}</li>)}
        </ol>
      )}
    </fieldset>
  );
}
