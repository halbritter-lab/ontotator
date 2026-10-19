import { useId, useLayoutEffect, useRef, useState } from "react";
import { ApiError, type DecisionBarView, type DocumentRowView, type FinalSelectionSummary, type RowSubmissionView, type RowSubmissions } from "../api/client";
import type { components } from "../api/generated";
import { submissionLabel, type SubmissionKind } from "../app/submissionLabels";
import { Checkbox, InlineConfirm, type InlineConfirmOutcome } from "../ui";
import { decisionCategoryLabels, workText } from "./labels";
import { rowKeyOf } from "./RowCells";
import { OWN_RESULT_REASON, waitingLines } from "./SelectionNotice";
import { rowSubmissionLabel, submissionVersion } from "./SubmissionsTable";

export type FinalConfirmKind = "use" | "replace" | "keep";

/** One cause line as shown in the selection notice when the Keep confirmation opened. */
export interface CauseLine { text: string; hint?: string }

/**
 * Everything a final-result confirmation needs, captured when it opens and never refreshed
 * silently: the PUT body (`submission_id`, `expected_revision`, acknowledged cause ids) and
 * the labels and notes it shows.
 */
export interface FinalConfirmRequest {
  rowKey: string;
  caseId: string;
  language: string;
  kind: FinalConfirmKind;
  documentId: string;
  submissionId: string;
  expectedRevision: number;
  /** Keep: every acknowledgeable cause id shown at open; Use and Replace: none. */
  causeIds: string[];
  triggerId: string;
  /** The chosen (Use, Replace) or kept (Keep) result. */
  label: string;
  /** Replace: the current final result. */
  oldLabel: string | null;
  /** Work summary when work on the row is still open. */
  stillOpen: string | null;
  /** The chosen result belongs to an abandoned or superseded round. */
  roundNote: "abandoned" | "superseded" | null;
  own: boolean;
  /** Keep: the cause lines shown at open. */
  causeLines: CauseLine[];
  /** Keep: waiting lines at open, for the success message. */
  waiting: string[];
}

/** Outcome of a failed save as page state (callbacks are attached when rendering). */
export type FinalConfirmFailure =
  | { kind: "conflict"; changedBy: string | null; changedAt: string | null; ownResult: boolean }
  | { kind: "error" }
  | { kind: "session" };

const isOpenWork = (item: DocumentRowView["work"][number]) => item.status !== "submitted";

/** "Still open: …" text for the row, or null when all work is submitted. */
function stillOpenText(row: DocumentRowView): string | null {
  return row.work.some(isOpenWork) ? workText(row.work) : null;
}

/** Label of the row's current final result; the submission row when loaded, else the summary. */
export function finalLabel(row: DocumentRowView, data: RowSubmissions | null): string {
  const final = row.final as FinalSelectionSummary;
  const loaded = data?.submissions.find(item => item.submission_id === final.submission_id);
  if (loaded) return rowSubmissionLabel(loaded, row.language, row.parallel_roots);
  return submissionLabel({
    kind: (final.kind ?? "annotation") as SubmissionKind,
    ordinal: final.round_ordinal,
    author: final.author_label ?? "",
    isMe: final.is_mine,
    language: row.language,
    version: final.version != null ? submissionVersion(final.version, final.chain_name, row.parallel_roots) : null,
    recordedAt: final.recorded_at ?? final.selected_at ?? final.updated_at ?? new Date().toISOString(),
  });
}

/** Use (no final yet) or Replace (another submission is final) for one submission. */
export function selectRequest(row: DocumentRowView, data: RowSubmissions | null, submission: RowSubmissionView, triggerId: string): FinalConfirmRequest {
  const replace = row.final != null;
  const state = submission.round_state;
  return {
    rowKey: rowKeyOf(row), caseId: row.case_id, language: row.language,
    kind: replace ? "replace" : "use",
    documentId: submission.document_id,
    submissionId: submission.submission_id,
    expectedRevision: row.final?.revision ?? 0,
    causeIds: [],
    triggerId,
    label: rowSubmissionLabel(submission, row.language, row.parallel_roots),
    oldLabel: replace ? finalLabel(row, data) : null,
    stillOpen: stillOpenText(row),
    roundNote: state === "abandoned" || state === "superseded" ? state : null,
    own: submission.is_me,
    causeLines: [],
    waiting: [],
  };
}

/** Keep the current final result and acknowledge every cause shown at open. */
export function keepRequest(row: DocumentRowView, data: RowSubmissions | null, causeIds: readonly string[], triggerId: string, causeLines: readonly CauseLine[]): FinalConfirmRequest {
  const final = row.final as FinalSelectionSummary;
  return {
    rowKey: rowKeyOf(row), caseId: row.case_id, language: row.language,
    kind: "keep",
    documentId: final.document_id,
    submissionId: final.submission_id,
    expectedRevision: final.revision,
    causeIds: [...causeIds],
    triggerId,
    label: finalLabel(row, data),
    oldLabel: null,
    stillOpen: null,
    roundNote: null,
    own: final.is_mine,
    causeLines: [...causeLines],
    waiting: waitingLines(row, data),
  };
}

/** PUT body of `/final-selections` for a confirmation. */
export function selectionPayload(request: FinalConfirmRequest): components["schemas"]["FinalSelectionRequest"] {
  return {
    document_id: request.documentId,
    submission_id: request.submissionId,
    expected_revision: request.expectedRevision,
    acknowledged_cause_ids: request.kind === "keep" ? [...request.causeIds] : [],
  };
}

/** "{label} is now the final result." / "Kept {label}. Still open: {waiting lines}." */
export function successMessage(request: FinalConfirmRequest): string {
  if (request.kind !== "keep") return `${request.label} is now the final result.`;
  const waiting = request.waiting.map(line => line.replace(/^Waiting: /, ""));
  return `Kept ${request.label}.${waiting.length ? ` Still open: ${waiting.join(" ")}` : ""}`;
}

const BAR_COUNTS: readonly (readonly [keyof DecisionBarView, string])[] = [
  ["total", "Needs your decision"],
  ["report_or_pause", decisionCategoryLabels["report-or-pause"]],
  ["confirm_final", decisionCategoryLabels["confirm-final"]],
  ["translation", decisionCategoryLabels.translation],
  ["missing_final", decisionCategoryLabels["missing-final"]],
  ["no_final", "No final result"],
];

/** Changed bar counts, e.g. "Needs your decision: 3 (was 4). Final result to confirm: 0 (was 1)." */
export function barChanges(before: DecisionBarView, after: DecisionBarView): string {
  return BAR_COUNTS.filter(([field]) => before[field] !== after[field])
    .map(([field, label]) => `${label}: ${after[field]} (was ${before[field]}).`).join(" ");
}

/** Maps a failed save to the confirmation outcome: 401 session, 409 conflict, anything else error. */
export function failureOf(error: unknown): FinalConfirmFailure {
  if (error instanceof ApiError && error.status === 401) return { kind: "session" };
  if (error instanceof ApiError && error.status === 409) {
    const details = typeof error.details === "object" && error.details !== null ? error.details : {};
    const text = (value: unknown) => (typeof value === "string" && value ? value : null);
    return { kind: "conflict", changedBy: text(details.selected_by), changedAt: text(details.updated_at), ownResult: error.code === "OWN_RESULT_NOT_SELECTABLE" };
  }
  return { kind: "error" };
}

export const CHECK_REQUIRED = "Check the box to confirm you reviewed these changes.";

export interface FinalConfirmProps {
  request: FinalConfirmRequest;
  busy: boolean;
  failure: FinalConfirmFailure | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Conflict: reload the row and close. */
  onReview: () => void;
}

/** The inline Use / Replace / Keep confirmation of the Documents page. */
export function FinalConfirm({ request, busy, failure, onConfirm, onCancel, onReview }: FinalConfirmProps): JSX.Element {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const keep = request.kind === "keep";
  const hintId = `${id}-check-required`;

  // The primary button stays enabled but reads as unavailable until the box is checked.
  useLayoutEffect(() => {
    const primary = root.current?.querySelector<HTMLButtonElement>(".inline-confirm-actions .btn-primary");
    if (!primary || busy) return;
    if (keep && !checked) primary.setAttribute("aria-disabled", "true");
    else primary.removeAttribute("aria-disabled");
    if (keep && needsCheck && !checked) primary.setAttribute("aria-describedby", hintId);
    else primary.removeAttribute("aria-describedby");
  });

  const target = `${request.caseId} · ${request.language}`;
  const title = request.kind === "use" ? "Use as final result" : request.kind === "replace" ? "Replace final result" : "Keep final result";
  const confirmLabel = request.kind === "use" ? "Use as final" : request.kind === "replace" ? "Replace" : "Keep as final";
  const lead = request.kind === "use"
    ? `Use ${request.label} as the final result for ${target}?`
    : request.kind === "replace"
      ? `Replace ${request.oldLabel} with ${request.label}? The previous choice stays in the history.`
      : `Keep ${request.label} as the final result for ${target}?`;
  const notes = keep ? [] : [
    request.stillOpen ? `Still open: ${request.stillOpen}.` : null,
    request.roundNote ? `This result belongs to ${request.roundNote === "abandoned" ? "an abandoned" : "a superseded"} round; you will be asked to confirm it again after choosing.` : null,
    request.own ? "This is your own result." : null,
  ].filter((note): note is string => note !== null);

  const message = <>
    <p>{lead}</p>
    {notes.map(note => <p key={note}>{note}</p>)}
    {keep && request.causeLines.length > 0 && <ul className="selection-notice-lines">
      {request.causeLines.map(line => <li key={line.text}>{line.text}{line.hint && <span className="selection-notice-hint">{line.hint}</span>}</li>)}
    </ul>}
  </>;

  const outcome: InlineConfirmOutcome | null = failure === null ? null
    : failure.kind === "conflict" ? { kind: "conflict", changedBy: failure.changedBy, changedAt: failure.changedAt, onReview }
      : failure.kind === "error" ? { kind: "error", onRetry: onConfirm }
        : { kind: "session" };

  return <div ref={root} className="final-confirm">
    <InlineConfirm
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      busy={busy}
      outcome={outcome}
      conflictMessage={failure?.kind === "conflict" && failure.ownResult ? `${OWN_RESULT_REASON} Nothing was saved.` : undefined}
      onCancel={onCancel}
      onConfirm={() => {
        if (keep && !checked) { setNeedsCheck(true); return; }
        onConfirm();
      }}
    >
      {keep && <>
        <Checkbox id={`${id}-reviewed`} label="I reviewed these changes and keep this exact result" checked={checked}
          onChange={event => { setChecked(event.target.checked); if (event.target.checked) setNeedsCheck(false); }} />
        {needsCheck && !checked && <p id={hintId} className="inline-confirm-notice" role="alert">{CHECK_REQUIRED}</p>}
      </>}
    </InlineConfirm>
  </div>;
}
