import { useId } from "react";
import type { TranslationReviewRecord } from "../api/client";
import { personLabel } from "../app/identity";
import { InlineMessage, StatusBadge } from "../ui";
import { categoryLabels, checkDeviationGuidance, checkExplanation, checkLabel, checkNoLocation, decisionConsequences, decisionLabels, failedChecksTitle, formatReviewDate, translationStatusLabel } from "./labels";
import type { ClinicalCategory, ReviewDecisionCode } from "./reviewRules";

type CheckRow = { code: string; passed: boolean; detail: string | null };
function checkRows(raw: readonly unknown[]): CheckRow[] {
  return raw.map((value) => {
    const check = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    return { code: typeof check.code === "string" ? check.code : "", passed: check.passed === true,
      detail: check.detail === undefined || check.detail === null ? null : String(check.detail) };
  });
}

/**
 * Calm summary of the translation run's automatic checks. Check records carry no
 * position in the text, so failures are described, not linked.
 */
export function ChecksSummary({ failed, all }: { failed: readonly unknown[]; all: readonly unknown[] | null }): JSX.Element {
  const id = useId();
  const failures = checkRows(failed), every = checkRows(all ?? failed);
  return <section className="translation-checks" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="translation-section-title">Automatic translation checks</h2>
    {failures.length > 0
      ? <InlineMessage tone="warning" title={failedChecksTitle(failures.length)}>
          {failures.map((check, index) => <section key={index} className="translation-check" aria-labelledby={`${id}-check-${index}`}>
            <h3 id={`${id}-check-${index}`}>{checkLabel(check.code)}</h3>
            <dl className="translation-check-facts">
              <div><dt>What it means</dt><dd>{checkExplanation(check.code)}</dd></div>
              {check.detail && <div><dt>From the translation run</dt><dd><span className="translation-check-detail">“{check.detail}”</span></dd></div>}
            </dl>
            <p>{checkNoLocation}</p>
            <dl className="translation-check-facts">
              <div><dt>If the translation is right anyway</dt><dd>{checkDeviationGuidance}</dd></div>
              {check.code && <div><dt>Technical code</dt><dd><code>{check.code}</code></dd></div>}
            </dl>
          </section>)}
        </InlineMessage>
      : <p className="translation-checks-calm">{every.length > 0 ? "All automatic checks passed." : "No automatic checks were recorded for this translation."}</p>}
    {every.length > 0 && <details className="translation-checks-all">
      <summary>Show all checks</summary>
      <ul className="translation-check-list">{every.map((check, index) => <li key={index}>
        <StatusBadge tone={check.passed ? "success" : "warning"}>{check.passed ? "Passed" : "Failed"}</StatusBadge>{" "}
        {checkLabel(check.code)}{check.detail ? <span className="translation-check-detail">: {check.detail}</span> : null}
        {check.code && <dl className="translation-check-code-line"><dt>Technical code</dt><dd><code className="translation-check-code">{check.code}</code></dd></dl>}
      </li>)}</ul>
    </details>}
  </section>;
}

const categoryList = (values: readonly ClinicalCategory[]) => values.map((value) => categoryLabels[value] ?? value).join(", ");

/** Immutable summary of a submitted review, in place of disabled controls. */
export function ReviewSummary({ record, heading }: { record: TranslationReviewRecord; heading: string }): JSX.Element {
  return <section className="review-summary" aria-labelledby={`review-summary-${record.id}`}>
    <h2 id={`review-summary-${record.id}`} className="translation-section-title">{heading}</h2>
    <dl className="review-summary-list">
      <div><dt>Decision</dt><dd>{decisionLabels[record.decision] ?? record.decision}</dd></div>
      <div><dt>Clinically relevant change</dt><dd>{record.clinical_change ? `Yes: ${categoryList(record.categories)}` : "No"}</dd></div>
      <div><dt>Rationale</dt><dd className="review-summary-rationale">{record.rationale?.trim() ? record.rationale : "None given"}</dd></div>
      <div><dt>Status of the reviewed version</dt><dd>{translationStatusLabel(record.status_after)}</dd></div>
      <div><dt>Reviewer</dt><dd>{personLabel({ pseudonym: record.reviewer_pseudonym })}{record.reviewer_qualification ? `, ${record.reviewer_qualification}` : ""}</dd></div>
      <div><dt>Submitted</dt><dd><time dateTime={record.created_at}>{formatReviewDate(record.created_at)}</time></dd></div>
    </dl>
  </section>;
}

const excerpt = (text: string, limit = 160) => {
  const points = Array.from(text.trim());
  return points.length > limit ? `${points.slice(0, limit).join("").trimEnd()}…` : points.join("");
};

/** Body of the submit confirmation: what is decided and what follows. */
export function SubmitSummary({ decision, clinical, categories, rationale }: {
  decision: ReviewDecisionCode; clinical: boolean; categories: readonly ClinicalCategory[]; rationale: string | null | undefined;
}): JSX.Element {
  return <div className="review-confirm">
    <dl className="review-summary-list">
      <div><dt>Decision</dt><dd>{decisionLabels[decision]}</dd></div>
      <div><dt>Clinically relevant change</dt><dd>{clinical ? `Yes: ${categoryList(categories)}` : "No"}</dd></div>
      {rationale?.trim() ? <div><dt>Rationale</dt><dd className="review-summary-rationale">{excerpt(rationale)}</dd></div> : null}
    </dl>
    <p>{decisionConsequences[decision]}</p>
    <p className="review-confirm-final">A submitted review cannot be changed later.</p>
  </div>;
}
