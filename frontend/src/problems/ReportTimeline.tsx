import { useId } from "react";
import type { ProblemReportView } from "../api/client";
import { Time } from "../app/Time";
import { historyItems, type HistoryItem } from "./labels";
import "./problems.css";

function formValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "Not specified";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function Draft({ draft }: { draft: NonNullable<HistoryItem["draft"]> }): JSX.Element {
  return <details className="report-draft">
    <summary>Translation draft kept from before the restart</summary>
    {draft.text !== undefined && <p className="report-text">{draft.text}</p>}
    {draft.form && <dl className="report-facts">{Object.entries(draft.form).map(([key, value]) => <div key={key}>
      <dt>{key.replaceAll("_", " ")}</dt><dd className="report-text">{formValue(value)}</dd>
    </div>)}</dl>}
  </details>;
}

/** The report history (oldest first) for the lead page and the reporter dialog; wording follows `report.viewer_is_lead`. */
export function ReportTimeline({ report, headingLevel }: { report: ProblemReportView; headingLevel?: 2 | 3 | 4 }): JSX.Element {
  const headingId = useId();
  const Heading = headingLevel ? (`h${headingLevel}` as const) : null;
  return <>
    {Heading && <Heading id={headingId}>History</Heading>}
    <ol className="report-timeline" aria-labelledby={Heading ? headingId : undefined}>
      {historyItems(report).map(item => {
        // The sentence may already end with the quote label ("… Reason shown to their owners:").
        const labelInSentence = item.quoteLabel !== undefined && item.sentence.endsWith(`${item.quoteLabel}:`);
        return <li key={item.key} className="report-timeline-item">
          <p className="report-timeline-sentence">{item.sentence} {item.at && <Time iso={item.at} />}</p>
          {item.quote !== undefined && <>
            {!labelInSentence && <p className="report-quote-label">{item.quoteLabel}</p>}
            <blockquote className="report-text">{item.quote}</blockquote>
          </>}
          {item.draft && <Draft draft={item.draft} />}
        </li>;
      })}
    </ol>
  </>;
}
