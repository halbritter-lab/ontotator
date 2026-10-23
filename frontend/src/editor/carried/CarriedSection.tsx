import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Time } from "../../app/Time";
import { Button, IconCheck, InlineConfirm, InlineMessage, Kbd, Textarea } from "../../ui";
import { SESSION_ENDED_MESSAGE } from "../autosave";
import type { CarriedState } from "./checkState";
import { CarriedStateBadge } from "./CarriedRowExtras";
import "./carried-inspector.css";

/** The check action a write belongs to. */
export type CarriedAction = "check" | "dismiss" | "link" | "undo";

/** Error shown inside the carried section (spec "Loading and errors"); `action` names the write that failed. */
export type CarriedError = { kind: "stale" | "network" | "session" | "rejected" | "note"; action?: CarriedAction; message?: string };

export type CarriedReadOnly = false | "submitted" | "paused" | "older";

/** Visible text of a section error; `rejected` carries the mapped server message (`admin/errors.ts`). */
export function carriedErrorMessage(error: CarriedError): string {
  switch (error.kind) {
    case "stale":
      return "This finding changed before the check was saved. Check it again.";
    case "network":
      return "Could not save the check. Nothing changed.";
    case "session":
      return SESSION_ENDED_MESSAGE;
    case "note":
      return "Save the note first.";
    default:
      return error.message ?? "Could not save the check. Nothing changed.";
  }
}

/** The original write is still queued for these kinds; "Retry" (or a new login) is the only write path. */
export const blocksCheckActions = (error: CarriedError | null | undefined): boolean =>
  error?.kind === "network" || error?.kind === "session";

export const PAUSED_SENTENCE = "Checks are unavailable while the task is paused.";

/** Origin line with the submission time as `<time>`: "Carried from Round 2 (submitted 19 Oct, 00:57)". */
export function OriginLine({ origin, recordedAt }: { origin: string; recordedAt?: string | null }): JSX.Element {
  return <>{origin}{recordedAt ? <> (submitted <Time iso={recordedAt} />)</> : null}</>;
}

/** `<section>` frame shared by the carried section and the exception panel. */
export function CarriedFrame({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const headingId = `${useId()}-carried`;
  return (
    <section aria-labelledby={headingId} className={["carried-section", className].filter(Boolean).join(" ")}>
      <h3 id={headingId} className="carried-section__title">Carried finding</h3>
      {children}
    </section>
  );
}

/** Error notice of a section; "Retry" only for network errors, `noteAction` (saves the note) for unsaved notes. */
export function CarriedErrorNotice({ error, onRetry, noteAction }: {
  error: CarriedError;
  onRetry?: () => void;
  noteAction?: ReactNode;
}): JSX.Element {
  return (
    <InlineMessage tone="error">
      <p className="carried-error__text">{carriedErrorMessage(error)}</p>
      {error.kind === "network" && onRetry && (
        <div className="carried-error__actions"><Button size="sm" onClick={onRetry}>Retry</Button></div>
      )}
      {error.kind === "note" && noteAction && <div className="carried-error__actions">{noteAction}</div>}
    </InlineMessage>
  );
}

/**
 * Quiet dismissal trigger plus its `InlineConfirm` with a required reason. The trigger keeps focus
 * semantics: `aria-disabled` while another check action is busy; Cancel and Escape return focus to it.
 */
export function DismissControl({ label, blocked, onDismiss, onBusyChange, dataDismiss = false }: {
  label: string;
  blocked: boolean;
  /** Resolves true only when the dismissal was applied; otherwise the confirm stays open with the reason. */
  onDismiss: (reason: string) => Promise<boolean>;
  onBusyChange?: (busy: boolean) => void;
  dataDismiss?: boolean;
}): JSX.Element {
  const fieldId = `${useId()}-reason`;
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  const setBusyBoth = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
  const close = () => { returnFocus.current = true; setOpen(false); setReason(""); setMissing(false); };
  const empty = !reason.trim();
  const showMissing = () => { setMissing(true); field.current?.focus(); };
  const confirm = () => {
    if (busy) return;
    const text = reason.trim();
    if (!text) { showMissing(); return; }
    setBusyBoth(true);
    onDismiss(text).then(
      applied => { setBusyBoth(false); if (applied) { setOpen(false); setReason(""); setMissing(false); } },
      () => setBusyBoth(false),
    );
  };

  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        aria-expanded={open}
        aria-disabled={blocked || undefined}
        data-carried-dismiss={dataDismiss ? "" : undefined}
        onClick={() => { if (!blocked && !open) setOpen(true); }}
      >
        {label}
      </Button>
      {open && (
        <div className="carried-confirm">
          <InlineConfirm
            title="Dismiss carried finding"
            message="It is removed from this text and recorded as dismissed with your reason."
            confirmLabel="Dismiss"
            busy={busy}
            onConfirm={confirm}
            onCancel={close}
            // Empty reason: the button stays focusable but unavailable; activation names the missing reason.
            confirmUnavailable={empty ? { reasonId: missing ? `${fieldId}-error` : undefined } : null}
            onConfirmUnavailable={showMissing}
          >
            <Textarea
              ref={field}
              id={fieldId}
              label="Why does this finding not apply to this text?"
              required
              rows={3}
              value={reason}
              error={missing ? "Give a reason to dismiss this finding." : undefined}
              onChange={event => { setReason(event.target.value); if (event.target.value.trim()) setMissing(false); }}
            />
          </InlineConfirm>
        </div>
      )}
    </>
  );
}

export interface WhatToCheck {
  textSpan: string;
  values: string[];
  noteFirstLine?: string;
  noteFull?: string;
}

export interface CarriedSectionProps {
  state: CarriedState;
  /** "Carried from Round 2" (`carriedFromLine`); the time is appended from `recordedAt`. */
  origin: string;
  recordedAt?: string | null;
  whatToCheck: WhatToCheck;
  readOnly: CarriedReadOnly;
  onMarkChecked?: () => Promise<unknown>;
  onShowOriginal: () => void;
  onNextUnchecked?: () => void;
  onDismiss?: (reason: string) => Promise<boolean>;
  error?: CarriedError | null;
  onRetry?: () => void;
  /** When set with `onSaveNoteAndCheck`, "Mark as checked" saves the note first. */
  noteUnsaved?: boolean;
  onSaveNoteAndCheck?: () => Promise<unknown>;
}

/** Inspector section of a selected carried finding (spec section 2). Presentational; async callbacks only. */
export function CarriedSection({
  state, origin, recordedAt, whatToCheck, readOnly, onMarkChecked, onShowOriginal, onNextUnchecked,
  onDismiss, error = null, onRetry, noteUnsaved = false, onSaveNoteAndCheck,
}: CarriedSectionProps): JSX.Element {
  const [busy, setBusy] = useState<null | "check" | "note" | "dismiss">(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const noteId = `${useId()}-note`;
  const collapsed = useRef<HTMLParagraphElement>(null);
  const previous = useRef(state.variant);

  // Focus moves to the collapsed line only on the transition unchecked → checked.
  useEffect(() => {
    const before = previous.current;
    previous.current = state.variant;
    if (state.variant === "checked" && before !== "checked" && before !== "dismissed") collapsed.current?.focus();
  }, [state.variant]);

  const blocked = busy !== null || blocksCheckActions(error);
  const run = (kind: "check" | "note", action?: () => Promise<unknown>) => {
    if (!action || blocked) return;
    setBusy(kind);
    action().then(() => setBusy(null), () => setBusy(null));
  };
  const markChecked = () => (noteUnsaved && onSaveNoteAndCheck ? run("note", onSaveNoteAndCheck) : run("check", onMarkChecked));
  const showOriginal = <Button size="sm" onClick={onShowOriginal}>Show original evidence</Button>;
  const errorNotice = error && (
    <CarriedErrorNotice
      error={error}
      onRetry={onRetry}
      // Only a failed "Mark as checked" offers to save the note and check; dismissals are retried by hand.
      noteAction={onSaveNoteAndCheck && !readOnly && error.action === "check" && (
        <Button size="sm" variant="primary" loading={busy === "note"} aria-disabled={(blocked && busy !== "note") || undefined} onClick={() => run("note", onSaveNoteAndCheck)}>
          Save note and mark as checked
        </Button>
      )}
    />
  );

  if (readOnly) {
    return (
      <CarriedFrame>
        <div className="carried-section__badge"><CarriedStateBadge variant={state.variant} /></div>
        <p className="carried-origin"><OriginLine origin={origin} recordedAt={recordedAt} /></p>
        {readOnly === "paused" && <p className="carried-hint">{PAUSED_SENTENCE}</p>}
        <div className="carried-actions">{showOriginal}</div>
      </CarriedFrame>
    );
  }

  if (state.variant === "checked") {
    return (
      <CarriedFrame className="is-collapsed">
        <div className="carried-collapsed">
          <p ref={collapsed} tabIndex={-1} data-carried-collapsed="" className="carried-collapsed__line">
            <IconCheck />
            <span>Checked, <OriginLine origin={origin} recordedAt={recordedAt} /></span>
          </p>
          <div className="carried-collapsed__actions">
            {showOriginal}
            {onNextUnchecked && (
              <Button size="sm" aria-keyshortcuts="N" onClick={onNextUnchecked}>
                Next unchecked <Kbd>N</Kbd>
              </Button>
            )}
          </div>
        </div>
        {errorNotice}
      </CarriedFrame>
    );
  }

  const changedLine = state.variant === "changed"
    ? "You changed this finding after checking it. Check it again."
    : state.variant === "removed"
    ? "The linked finding was deleted"
    : null;
  const hasFullNote = !!whatToCheck.noteFull && whatToCheck.noteFull.trim() !== (whatToCheck.noteFirstLine ?? "").trim();

  return (
    <CarriedFrame>
      <div className="carried-section__badge"><CarriedStateBadge variant={state.variant} /></div>
      {changedLine && <p className="carried-section__changed">{changedLine}</p>}
      <p className="carried-origin"><OriginLine origin={origin} recordedAt={recordedAt} /></p>
      {state.variant !== "dismissed" && (
        <>
          <h4 className="carried-subtitle">What to check</h4>
          <dl className="carried-check-list">
            <dt>Text span</dt>
            <dd>{whatToCheck.textSpan}</dd>
            <dt>Values</dt>
            <dd>{whatToCheck.values.map(line => <span key={line} className="carried-check-list__line">{line}</span>)}</dd>
            {whatToCheck.noteFirstLine && <>
              <dt>Note</dt>
              <dd>{whatToCheck.noteFirstLine}</dd>
            </>}
          </dl>
        </>
      )}
      {errorNotice}
      {state.unchecked && (
        <div className="carried-actions">
          <Button
            variant="primary"
            data-carried-primary=""
            loading={busy === "check" || busy === "note"}
            aria-disabled={blocked || undefined}
            onClick={markChecked}
          >
            Mark as checked
          </Button>
          {showOriginal}
        </div>
      )}
      {!state.unchecked && <div className="carried-actions">{showOriginal}</div>}
      {state.unchecked && <p className="carried-hint">Any later change to this finding needs a new check.</p>}
      {/* After the actions so "Mark as checked" stays the first Tab stop in the section. */}
      {hasFullNote && (
        <div className="carried-note">
          <Button variant="quiet" size="sm" aria-expanded={noteOpen} aria-controls={noteId} onClick={() => setNoteOpen(value => !value)}>
            {noteOpen ? "Hide full note" : "Show full note"}
          </Button>
          <p id={noteId} hidden={!noteOpen} className="carried-note__full">{whatToCheck.noteFull}</p>
        </div>
      )}
      {state.unchecked && onDismiss && (
        <div className="carried-dismiss">
          <DismissControl
            label="Does not apply…"
            blocked={blocked && busy !== "dismiss"}
            onDismiss={onDismiss}
            onBusyChange={value => setBusy(value ? "dismiss" : null)}
          />
        </div>
      )}
    </CarriedFrame>
  );
}
