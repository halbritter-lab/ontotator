import { useId, useState } from "react";
import type { TranslationReviewRecord } from "../api/client";
import { personLabel } from "../app/identity";
import { submissionGuidelineLabel } from "../guidelines/submissionLabel";
import { Button, IconCheck, IconChevronRight, IconWarning, StatusBadge } from "../ui";
import { allChecksLine, calmCheckText, categoryLabels, checkBandText, checkDeviationGuidance, checkExplanation, checkLabel, checkNoLocation, decisionConsequences, decisionLabels, formatReviewDate, translationStatusLabel } from "./labels";
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
 * One-line summary of the translation run's automatic checks with a Details disclosure.
 * Check records carry no position in the text, so failures are described, not linked.
 * The disclosure starts collapsed on every mount and is never stored.
 */
export function ChecksSummary({ failed, all }: { failed: readonly unknown[]; all: readonly unknown[] | null }): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const failures = checkRows(failed), every = checkRows(all ?? failed);
  const passed = every.filter(check => check.passed).length;
  // The band and Details agree: whenever the band names a failure, Details exists and counts it.
  const hasDetails = failures.length > 0 || every.length > 0;
  const failedCount = Math.max(failures.length, every.length - passed);
  const bandText = failures.length > 0 ? checkBandText(failures.map(check => check.code)) : "";
  const split = bandText.indexOf(": ");
  return <section className={`translation-checks${failures.length > 0 ? " translation-checks--failed" : ""}`} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="review-sr-only">Automatic translation checks</h2>
    <div className="translation-checks-band">
      {failures.length > 0
        ? <p className="translation-checks-line"><IconWarning /><span><strong>{bandText.slice(0, split + 1)}</strong>{bandText.slice(split + 1)}</span></p>
        : every.length > 0
          ? <p className="translation-checks-line translation-checks-calm"><IconCheck /><span>{calmCheckText(every.length)}</span></p>
          : <p className="translation-checks-line translation-checks-calm">No automatic checks were recorded for this translation.</p>}
      {hasDetails && <Button variant="quiet" size="sm" className="translation-checks-toggle" aria-expanded={open} aria-controls={`${id}-details`}
        icon={<IconChevronRight className="translation-checks-chevron" />} onClick={() => setOpen(value => !value)}>{open ? "Hide details" : "Details"}</Button>}
    </div>
    {hasDetails && <div id={`${id}-details`} className="translation-check-details" hidden={!open}>
      {open && <>
        {failures.map((check, index) => <section key={index} className="translation-check" aria-labelledby={`${id}-check-${index}`}>
          <h3 id={`${id}-check-${index}`}>{checkLabel(check.code)}</h3>
          <p>{checkExplanation(check.code)} {checkNoLocation}</p>
          <dl className="translation-check-facts">
            {check.detail && <div><dt>From the translation run</dt><dd><span className="translation-check-detail">“{check.detail}”</span></dd></div>}
            <div><dt>If the translation is right anyway</dt><dd>{checkDeviationGuidance(check.code)}</dd></div>
          </dl>
          {check.code && <details className="translation-check-technical"><summary>Technical details</summary>
            <p>Technical code: <code className="translation-check-code">{check.code}</code></p></details>}
        </section>)}
        <div className="translation-checks-all-line">
          <span>{allChecksLine(passed, failedCount)}</span>
          {every.length > 0 && <><span aria-hidden="true">·</span><details className="translation-checks-all">
            <summary>Show all checks</summary>
            <ul className="translation-check-list">{every.map((check, index) => <li key={index}>
              <StatusBadge tone={check.passed ? "success" : "warning"}>{check.passed ? "Passed" : "Failed"}</StatusBadge>{" "}
              {checkLabel(check.code)}{check.detail ? <span className="translation-check-detail">: {check.detail}</span> : null}
              {check.code && <dl className="translation-check-code-line"><dt>Technical code</dt><dd><code className="translation-check-code">{check.code}</code></dd></dl>}
            </li>)}</ul>
          </details></>}
        </div>
      </>}
    </div>}
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
      <div><dt>Guidelines</dt><dd>{submissionGuidelineLabel(record.guideline_version, record.guideline_withdrawn, null).replace(/^Guidelines:? /, "")}</dd></div>
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
