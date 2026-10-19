import { useEffect, useId, useRef, type ReactNode } from "react";
import { formatDateTime } from "../app/labels";
import { fullTimestamp } from "../app/submissionLabels";
import { Button } from "./Button";
import { useShortcut } from "./shortcuts";

export type InlineConfirmOutcome =
  | { kind: "conflict"; changedBy?: string | null; changedAt?: string | null; onReview: () => void }
  | { kind: "error"; onRetry: () => void }
  | { kind: "session" };

export interface InlineConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  outcome?: InlineConfirmOutcome | null;
  headingLevel?: 3 | 4;
  /** Replaces the default conflict sentence; the "Changed by … at …" suffix stays. */
  conflictMessage?: ReactNode;
}

const defaultConflictMessage = "The final result or its warnings changed since you opened this. Nothing was saved. Review the current state.";

/**
 * A confirmation bound to an item on the page (for example a table row) instead of a modal.
 * Placement (a full-width row, a block below a card) and the one-per-page policy belong to the caller.
 */
export function InlineConfirm({
  title, message, confirmLabel, cancelLabel = "Cancel", tone = "primary", busy = false,
  onConfirm, onCancel, children, outcome = null, headingLevel = 4, conflictMessage,
}: InlineConfirmProps): JSX.Element {
  const id = useId();
  const headingId = `${id}-title`;
  const messageId = `${id}-message`;
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (outcome?.kind === "conflict") notice.current?.focus(); }, [outcome?.kind]);
  // Escape acts only while focus is inside; while busy it is consumed without cancelling.
  useShortcut("Escape", event => {
    if (!(event.target instanceof Node) || !root.current?.contains(event.target)) return false;
    if (!busy) onCancel();
  }, { allowInInputs: true, root });
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const conflict = outcome?.kind === "conflict" ? outcome : null;
  const failed = outcome?.kind === "error" ? outcome : null;
  return <div ref={root} role="group" aria-labelledby={headingId} aria-describedby={messageId} className="inline-confirm">
    <Heading id={headingId} ref={heading} tabIndex={-1} className="inline-confirm-title">{title}</Heading>
    <div id={messageId} className="inline-confirm-message">{message}</div>
    {!conflict && children}
    {conflict && <p ref={notice} tabIndex={-1} className="inline-confirm-notice" role="alert">
      {conflictMessage ?? defaultConflictMessage}
      {conflict.changedBy && conflict.changedAt && <> Changed by {conflict.changedBy} at <time dateTime={conflict.changedAt} title={fullTimestamp(conflict.changedAt)}>{formatDateTime(conflict.changedAt)}</time>.</>}
    </p>}
    {outcome?.kind === "error" && <p className="inline-confirm-notice" role="alert">Could not save. Nothing changed.</p>}
    {outcome?.kind === "session" && <p className="inline-confirm-notice" role="alert">Your session ended. Nothing was saved. Sign in and confirm again.</p>}
    <p className="visually-hidden" role="status">{busy ? "Saving…" : ""}</p>
    <div className="inline-confirm-actions">
      {conflict ? <>
        <Button onClick={conflict.onReview}>Review again</Button>
        <Button onClick={onCancel}>Close</Button>
      </> : <>
        <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) onCancel(); }}>{cancelLabel}</Button>
        {failed && <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) failed.onRetry(); }}>Retry</Button>}
        <Button variant={tone} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    </div>
  </div>;
}
