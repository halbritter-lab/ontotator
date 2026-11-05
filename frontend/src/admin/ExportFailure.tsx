import { InlineMessage } from "../ui";
import { ERROR_MESSAGES } from "./errors";

const record = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exportFailureReasons: Record<string, string> = {
  UNKNOWN_TERM: "The term is not in the project's pinned ontology.",
  OBSOLETE_TERM: "The term is obsolete in the project's pinned ontology.",
  INCOMPLETE_AXES: "Required clinical axis values are missing.",
  TARGET_NOT_FOUND: "The original finding version is missing.",
};

/**
 * A failed export job: the message for the job's error code (`result.error.code`) when one is known,
 * otherwise `fallback`; the raw error stays behind "Technical diagnostics".
 */
export function ExportFailure({ result, error, fallback = "Export could not be created. Open diagnostics for the technical details." }: {
  result: Record<string, unknown> | null; error: string | null; fallback?: string;
}): JSX.Element {
  const failure = record(result?.error);
  const code = typeof failure?.code === "string" ? failure.code : undefined;
  const details = record(failure?.details);
  const cause = record(details?.cause);
  if (code === "EXPORT_UNRESOLVED_INVALID" && details && typeof cause?.code === "string") {
    const causeDetails = record(cause.details);
    return <InlineMessage tone="error">
      <p>{ERROR_MESSAGES.EXPORT_UNRESOLVED_INVALID}</p>
      <p>Document: {String(details.document_id)}, Submission: {String(details.submission_id)}</p>
      <p>Finding: {String(details.annotation_id)}, Version: {String(details.version)}</p>
      <p>{exportFailureReasons[cause.code] || ERROR_MESSAGES[cause.code] || "The finding does not meet the project profile."} ({cause.code})</p>
      {typeof cause.details === "string" && <p>{cause.details}</p>}
      {typeof causeDetails?.term_id === "string" && <p>Term: {causeDetails.term_id}</p>}
      <p>If this review is not available to reopen, ask the project lead or server operator to correct its imported history.</p>
    </InlineMessage>;
  }
  const known = code !== undefined && code !== "EXPORT_UNRESOLVED_INVALID" ? ERROR_MESSAGES[code] : undefined;
  return <InlineMessage tone="error">
    <p>{known ?? fallback}</p>
    {known !== undefined && typeof details?.document_id === "string" && <p>Document: {details.document_id}</p>}
    <details><summary>Technical diagnostics</summary><pre>{error || "The export failed without further details."}</pre></details>
  </InlineMessage>;
}
