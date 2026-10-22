import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../../ui";
import type { CarriedState } from "./checkState";
import { CarriedStateBadge } from "./CarriedRowExtras";
import {
  blocksCheckActions, CarriedErrorNotice, CarriedFrame, DismissControl, OriginLine, PAUSED_SENTENCE,
  type CarriedError, type CarriedReadOnly,
} from "./CarriedSection";
import "./carried-inspector.css";

export interface LinkCandidate {
  annotationId: string;
  version: string;
  /** Full option label, e.g. "Seizure · “Krampfanfälle werden …”" or "Seizure · no text span". */
  label: string;
  technicalId: string;
}

export interface ExceptionPanelProps {
  state: CarriedState;
  /** "Carried from Round 2" (`carriedFromLine`); the time is appended from `recordedAt`. */
  origin: string;
  recordedAt?: string | null;
  /** Why no carried finding exists (`missingReason`). */
  reason: string;
  original: { term: ReactNode; values: { label: string; value: string }[]; note?: string; quote: string | null };
  candidates: LinkCandidate[];
  readOnly: CarriedReadOnly;
  onMarkInText?: () => void;
  /** Resolves true only when the link was applied; otherwise the chooser stays open. */
  onLink?: (annotationId: string) => Promise<boolean>;
  /** Resolves true only when the dismissal was applied; otherwise the confirm stays open. */
  onDismiss?: (reason: string) => Promise<boolean>;
  onUndoDismissal?: () => Promise<unknown>;
  onShowOriginal: () => void;
  error?: CarriedError | null;
  /** "Retry" of a network error: retries the queued write. */
  onRetry?: () => void;
  /** "Save note" of an unsaved-note error: saves the open notes; the action is then repeated by hand. */
  onSaveNote?: () => Promise<unknown>;
}

/** Inline chooser below "Link to an existing finding…": a radio group, never a select. */
function LinkChooser({ candidates, blocked, onLink, onBusyChange }: {
  candidates: LinkCandidate[];
  blocked: boolean;
  onLink: (annotationId: string) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const name = useId();
  const legendId = `${name}-legend`;
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open) {
      const first = body.current?.querySelector<HTMLElement>("input[type=radio], [data-chooser-empty]");
      first?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  const cancel = () => { if (busy) return; returnFocus.current = true; setOpen(false); setSelected(null); };
  const confirm = () => {
    const choice = selected ?? candidates[0]?.annotationId ?? null;
    if (busy || blocked || !choice) return;
    setBusy(true);
    onBusyChange(true);
    onLink(choice).then(
      applied => {
        setBusy(false); onBusyChange(false);
        // Linked: close and return focus to the trigger (it stays rendered), never to the body.
        if (applied) { returnFocus.current = true; setOpen(false); setSelected(null); }
      },
      () => { setBusy(false); onBusyChange(false); },
    );
  };

  return (
    <>
      <Button
        ref={trigger}
        data-carried-link=""
        aria-expanded={open}
        aria-disabled={(blocked && !busy) || undefined}
        onClick={() => { if (!blocked && !open) setOpen(true); }}
      >
        Link to an existing finding…
      </Button>
      {open && (
        <div ref={body} className="carried-chooser">
          {candidates.length === 0 ? (
            <p data-chooser-empty="" tabIndex={-1} className="carried-chooser__empty">
              No finding of this type exists on this text. Mark it in the text first.
            </p>
          ) : (
            <fieldset className="carried-chooser__options" aria-labelledby={legendId}>
              <legend id={legendId} className="carried-chooser__legend">Link to an existing finding</legend>
              {candidates.map((candidate, index) => {
                const id = `${name}-${index}`;
                const checked = (selected ?? candidates[0].annotationId) === candidate.annotationId;
                return (
                  <div key={candidate.annotationId} className="carried-chooser__option">
                    <label className="carried-chooser__label" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        name={name}
                        value={candidate.annotationId}
                        checked={checked}
                        onChange={() => setSelected(candidate.annotationId)}
                      />
                      <span>{candidate.label}</span>
                    </label>
                    <details className="carried-chooser__details">
                      <summary>Technical details</summary>
                      <code>{candidate.technicalId}</code>
                    </details>
                  </div>
                );
              })}
            </fieldset>
          )}
          <div className="carried-chooser__actions">
            <Button size="sm" aria-disabled={busy || undefined} onClick={cancel}>Cancel</Button>
            {candidates.length > 0 && (
              <Button size="sm" variant="primary" loading={busy} aria-disabled={blocked || undefined} onClick={confirm}>
                Link and mark as checked
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Inspector section of a carried input without a carried finding (spec section 3; Resolved 3). */
export function ExceptionPanel({
  state, origin, recordedAt, reason, original, candidates, readOnly, onMarkInText, onLink, onDismiss,
  onUndoDismissal, onShowOriginal, error = null, onRetry, onSaveNote,
}: ExceptionPanelProps): JSX.Element {
  const [savingNote, setSavingNote] = useState(false);
  const [busy, setBusy] = useState<null | "link" | "dismiss" | "undo">(null);
  const blocked = busy !== null || blocksCheckActions(error);
  const dismissed = state.variant === "dismissed";

  const undo = () => {
    if (!onUndoDismissal || blocked) return;
    setBusy("undo");
    onUndoDismissal().then(() => setBusy(null), () => setBusy(null));
  };
  const linkChooser = onLink && (
    <LinkChooser
      candidates={candidates}
      blocked={blocked && busy !== "link"}
      onLink={onLink}
      onBusyChange={value => setBusy(value ? "link" : null)}
    />
  );

  return (
    <CarriedFrame className="carried-exception">
      <div className="carried-section__badge"><CarriedStateBadge variant={state.variant} /></div>
      <p className="carried-origin"><OriginLine origin={origin} recordedAt={recordedAt} /></p>
      {dismissed ? (
        <>
          {state.resolution?.reason && <p className="carried-reason">Dismissal reason: {state.resolution.reason}</p>}
          <p className="carried-hint">{readOnly ? "Dismissed" : "Dismissed by You"}</p>
        </>
      ) : (
        <p className="carried-reason">{reason}</p>
      )}
      <div className="carried-original">
        <h4 className="carried-subtitle">Original</h4>
        <p className="carried-original__term">{original.term}</p>
        {original.values.length > 0 && (
          <ul className="carried-original__values">
            {original.values.map(value => <li key={value.label}>{`${value.label}: ${value.value}`}</li>)}
          </ul>
        )}
        {original.note && <p className="carried-original__note">{original.note}</p>}
        <p className="carried-original__quote">{original.quote ? `“${original.quote}”` : "No text span"}</p>
        <Button size="sm" onClick={onShowOriginal}>Show original evidence</Button>
      </div>
      {readOnly === "paused" && <p className="carried-hint">{PAUSED_SENTENCE}</p>}
      {error && <CarriedErrorNotice error={error} onRetry={onRetry} noteAction={onSaveNote && !readOnly && (
        <Button size="sm" variant="primary" loading={savingNote} onClick={() => {
          if (savingNote) return;
          setSavingNote(true);
          onSaveNote().then(() => setSavingNote(false), () => setSavingNote(false));
        }}>
          Save note
        </Button>
      )} />}
      {!readOnly && dismissed && (
        <div className="carried-actions">
          {onUndoDismissal && (
            <Button data-carried-undo="" loading={busy === "undo"} aria-disabled={blocked || undefined} onClick={undo}>Undo dismissal</Button>
          )}
          {linkChooser}
        </div>
      )}
      {!readOnly && !dismissed && (
        <div className="carried-actions">
          {state.unchecked && onMarkInText && (
            <Button
              variant="primary"
              data-carried-primary=""
              aria-disabled={blocked || undefined}
              onClick={() => { if (!blocked) onMarkInText(); }}
            >
              Mark in text
            </Button>
          )}
          {linkChooser}
          {state.unchecked && onDismiss && (
            <DismissControl
              label="Dismiss with reason…"
              dataDismiss
              blocked={blocked && busy !== "dismiss"}
              onDismiss={onDismiss}
              onBusyChange={value => setBusy(value ? "dismiss" : null)}
            />
          )}
        </div>
      )}
    </CarriedFrame>
  );
}
