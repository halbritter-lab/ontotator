/**
 * The lead's own correction of a rejected or queried translation (spec F1, FD1 to FD9): an inline
 * panel that explains the outcome, starts the lead correction (`startLeadCorrection`) and opens the
 * ordinary translation review screen (`#/tasks/{assignment_id}`). Shown from the inline Resolve options
 * under the Documents row ("Correct the translation…"; documents overview Change 13).
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView } from "../api/client";
import { textLabel } from "../app/identity";
import type { Route } from "../app/router";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, InlineMessage } from "../ui";
import { RouteLink } from "./RowCells";

/** The version a correction acts on: the step's version, else the newest version of the row. */
export function correctionDocumentId(row: DocumentRowView): string {
  return row.next_step?.document_id ?? row.versions.find(entry => entry.is_newest_in_chain)?.document_id ?? row.open.document_id;
}

/** The lead's own open lead correction of the row (`lead_correction` on the work item, FD1). */
export function openLeadCorrection(row: DocumentRowView): DocumentRowView["work"][number] | null {
  return row.work.find(item => item.lead_correction && item.is_me && item.status !== "submitted") ?? null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const NOT_AVAILABLE: Readonly<Record<string, string>> = {
  not_newest: "A newer version of this translation exists. Reload the row to see it.",
  not_rejected_or_queried: "This version is no longer rejected or queried. Reload the row to see its current state.",
  review_open: "A translation review of this version is open. Withdraw it under Assignment actions before you correct the translation yourself.",
};

/** Refusals whose generic admin message does not fit starting a correction. */
const START_REFUSED: Readonly<Record<string, string>> = {
  TASK_HELD: "Your earlier review of this version is paused. Resume it under Assignment actions before you correct the translation yourself.",
  NOT_IN_WORK_PLAN: "This translation was discarded. Reload the row to see its current state.",
  VARIANT_REVIEW_STALE: "The text of this version changed. Reload the row to see the current text.",
};

type Failure =
  | { kind: "languages"; missing: string[] }
  | { kind: "qualification" }
  | { kind: "not_available"; text: string }
  | { kind: "error"; error: unknown };

function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.code === "LANGUAGE_CONFIRMATION_REQUIRED") {
    const details = isRecord(error.details) ? error.details : {};
    const own = new Set(strings(details.user_languages));
    const required = strings(details.required_languages);
    const missing = required.filter(language => !own.has(language));
    const fallback = typeof details.document_language === "string" ? [details.document_language] : [];
    return { kind: "languages", missing: missing.length ? missing : fallback };
  }
  if (error instanceof ApiError && error.code === "QUALIFICATION_REQUIRED") return { kind: "qualification" };
  if (error instanceof ApiError && error.code === "LEAD_CORRECTION_NOT_AVAILABLE") {
    const reason = isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : "";
    if (Object.hasOwn(NOT_AVAILABLE, reason)) return { kind: "not_available", text: NOT_AVAILABLE[reason] };
  }
  if (error instanceof ApiError && error.code && Object.hasOwn(START_REFUSED, error.code)) return { kind: "not_available", text: START_REFUSED[error.code] };
  return { kind: "error", error };
}

export interface LeadCorrectionPanelProps {
  row: DocumentRowView;
  projectKey: string;
  /** Opens the task (`{ name: "task", assignmentId }`) or the profile (`{ name: "me" }`). */
  onNavigate: (route: Route) => void;
  onCancel: () => void;
  /** Heading level under the row: 3 in the table (below the hidden h2 "Texts"), 5 in a card. */
  headingLevel?: 3 | 5;
}

export function LeadCorrectionPanel({ row, projectKey, onNavigate, onCancel, headingLevel = 3 }: LeadCorrectionPanelProps): JSX.Element {
  const Heading = `h${headingLevel}` as "h3";
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<Failure, { kind: "languages" }> | null>(null);
  /** Missing profile languages once the server asked for the confirmation (stays until answered). */
  const [missing, setMissing] = useState<string[] | null>(null);
  const [confirmLanguage, setConfirmLanguage] = useState(false);
  const documentId = correctionDocumentId(row);
  const version = row.versions.find(entry => entry.document_id === documentId)?.version ?? 1;
  const unconfirmed = missing !== null && !confirmLanguage;

  useEffect(() => { heading.current?.focus(); }, []);

  const start = async () => {
    if (writing.current || unconfirmed) return;
    writing.current = true; setBusy(true); setFailure(null);
    try {
      const { text_sha256 } = await api.getVariantMetadata(projectKey, documentId);
      const assignment = await api.startLeadCorrection(projectKey, documentId, { expected_text_sha256: text_sha256, confirm_language: missing !== null && confirmLanguage });
      onNavigate({ name: "task", assignmentId: assignment.id });
    } catch (error: unknown) {
      const next = failureOf(error);
      if (next.kind === "languages") { setMissing(next.missing); setConfirmLanguage(false); } else setFailure(next);
    } finally { writing.current = false; setBusy(false); }
  };

  return <div className="documents-resolve" role="group" aria-labelledby={`${id}-title`}>
    <Heading id={`${id}-title`} ref={heading} tabIndex={-1} className="inline-confirm-title">{`Correct the translation, ${textLabel(row)}`}</Heading>
    <p>{`You review v${version} yourself and submit it as Accepted with corrections. The corrected text becomes v${version + 1} and counts as accepted.`}</p>
    {missing !== null && <Checkbox id={`${id}-language`} label={`Correct despite missing ${missing.join(", ")} in your profile`}
      checked={confirmLanguage} onChange={event => setConfirmLanguage(event.target.checked)} />}
    {failure?.kind === "qualification" && <InlineMessage tone="warning">
      A translation review records your qualification. Your profile has none yet.{" "}
      <RouteLink route={{ name: "me" }} onNavigate={onNavigate}>Add your qualification in your profile</RouteLink>
    </InlineMessage>}
    {failure?.kind === "not_available" && <InlineMessage tone="warning">{failure.text}</InlineMessage>}
    {failure?.kind === "error" && <ErrorNotice error={failure.error} />}
    {unconfirmed && <p id={`${id}-unconfirmed`} className="action-reason">Confirm the missing languages.</p>}
    <div className="documents-resolve-actions">
      <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
      <Button size="sm" variant="primary" loading={busy} aria-disabled={unconfirmed || busy ? true : undefined}
        aria-describedby={unconfirmed ? `${id}-unconfirmed` : undefined} onClick={() => { void start(); }}>Open translation review</Button>
    </div>
  </div>;
}
