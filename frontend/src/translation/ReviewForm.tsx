import { useId } from "react";
import { Checkbox, Textarea } from "../ui";
import { categoryLabels, decisionLabels, issueMessages } from "./labels";
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

export function ReviewForm({ value, issues, onChange, readOnly = false }: ReviewFormProps) {
  const id = useId();

  return (
    <fieldset disabled={readOnly}>
      <legend>Translation review</legend>
      <fieldset>
        <legend>Decision</legend>
        {decisions.map((decision) => (
          <div className="form-group" key={decision}>
            <label className="form-checkbox-row" htmlFor={`${id}-${decision}`}>
              <input
                id={`${id}-${decision}`}
                className="form-checkbox"
                type="radio"
                name={`${id}-decision`}
                value={decision}
                checked={value.decision === decision}
                onChange={() => {
                  if (!readOnly) onChange({ ...value, decision });
                }}
              />
              <span>{decisionLabels[decision]}</span>
            </label>
          </div>
        ))}
      </fieldset>
      <Checkbox
        id={`${id}-clinical-change`}
        label="Clinically relevant change"
        checked={value.clinical_change ?? false}
        onChange={(event) => {
          if (readOnly) return;
          onChange(event.target.checked
            ? { ...value, clinical_change: true }
            : { ...value, clinical_change: false, categories: [] });
        }}
      />
      <fieldset disabled={readOnly || !value.clinical_change}>
        <legend>Clinical change categories</legend>
        {categories.map((category) => (
          <Checkbox
            key={category}
            id={`${id}-category-${category}`}
            label={categoryLabels[category]}
            checked={value.categories?.includes(category) ?? false}
            onChange={(event) => {
              if (readOnly || !value.clinical_change) return;
              const current = value.categories ?? [];
              const next = event.target.checked
                ? [...current.filter((item) => item !== category), category]
                : current.filter((item) => item !== category);
              onChange({ ...value, categories: next });
            }}
          />
        ))}
      </fieldset>
      <Textarea
        id={`${id}-rationale`}
        label="Rationale"
        value={value.rationale ?? ""}
        onChange={(event) => {
          if (!readOnly) onChange({ ...value, rationale: event.target.value });
        }}
      />
      {issues.length > 0 && (
        <ol aria-label="Review issues" aria-live="polite">
          {issues.map((issue, index) => <li key={`${issue}-${index}`}>{issueMessages[issue]}</li>)}
        </ol>
      )}
    </fieldset>
  );
}
