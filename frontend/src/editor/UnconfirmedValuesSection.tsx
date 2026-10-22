import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { TermName } from "./TermName";
import { valuesLine, type UnconfirmedRow } from "./unconfirmedValues";

export interface UnconfirmedValuesSectionProps {
  rows: readonly UnconfirmedRow[];
  optionLabel: (value: string | null) => string;
  /** Why "Confirm" is unavailable (queue conflict, error, offline), else null. */
  confirmUnavailableReason: string | null;
  /** One set_axes for the row; resolves false (never rejects) when nothing was confirmed. */
  onConfirmValues: (row: UnconfirmedRow) => Promise<boolean>;
  onGoTo: (row: UnconfirmedRow) => void;
  /** No confirmable row is left to take the focus: the dialog focuses its next control. */
  onEmpty: () => void;
}

const isConfirmable = (row: UnconfirmedRow) => row.confirmableAxisIds.length > 0;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Unconfirmed values" in the Submit dialog (spec F2): one row per finding, confirmable in place. */
export function UnconfirmedValuesSection({
  rows, optionLabel, confirmUnavailableReason, onConfirmValues, onGoTo, onEmpty,
}: UnconfirmedValuesSectionProps) {
  const headingId = useId();
  const reasonId = useId();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ text: string; count: number } | null>(null);
  const [hadRows, setHadRows] = useState(rows.length > 0);
  if (rows.length > 0 && !hadRows) setHadRows(true);
  // Rows after each await: "Confirm all" and the focus effect read the current list, not the render's.
  const latestRows = useRef(rows);
  latestRows.current = rows;
  const confirmButtons = useRef(new Map<string, HTMLButtonElement>());
  const confirmAllButton = useRef<HTMLButtonElement>(null);
  /** The row whose confirm moves the focus once it has left the list. */
  const focusAfter = useRef<{ id: string; index: number; term: string } | null>(null);
  const refocusAfterAll = useRef(false);

  const announce = (text: string) => setStatus(previous => ({ text, count: (previous?.count ?? 0) + 1 }));
  const unavailable = confirmUnavailableReason !== null;

  useLayoutEffect(() => {
    const pending = focusAfter.current;
    // Done when the row has left the list or stays only with values to choose (a mixed row): its
    // "Confirm" button is gone either way, so the focus moves on.
    const still = pending ? rows.find(row => row.annotationId === pending.id) : undefined;
    if (pending && (!still || !isConfirmable(still))) {
      focusAfter.current = null;
      if (rows.length > 0) announce(`Confirmed ${pending.term}. ${rows.length} left.`);
      const next = rows.slice(pending.index).find(row => isConfirmable(row) && row.annotationId !== pending.id)
        ?? rows.slice(0, pending.index).reverse().find(isConfirmable);
      const button = next ? confirmButtons.current.get(next.annotationId) : undefined;
      if (button) button.focus();
      else onEmpty();
    }
    if (refocusAfterAll.current && !running) {
      refocusAfterAll.current = false;
      if (!confirmAllButton.current?.isConnected) onEmpty();
    }
  }, [rows, running, onEmpty]);

  const confirmOne = async (row: UnconfirmedRow) => {
    if (unavailable || running || busy.has(row.annotationId)) return;
    const pending = { id: row.annotationId, index: latestRows.current.findIndex(item => item.annotationId === row.annotationId), term: row.term };
    focusAfter.current = pending;
    setBusy(previous => new Set(previous).add(row.annotationId));
    setFailed(previous => { const next = new Set(previous); next.delete(row.annotationId); return next; });
    const ok = await onConfirmValues(row).catch(() => false);
    setBusy(previous => { const next = new Set(previous); next.delete(row.annotationId); return next; });
    if (ok) return; // the focus effect moves on and announces once the rows show the update
    if (focusAfter.current === pending) focusAfter.current = null;
    setFailed(previous => new Set(previous).add(row.annotationId));
  };

  const confirmAll = async () => {
    if (unavailable || running) return;
    setRunning(true);
    setFailed(new Set());
    let done = 0;
    for (const row of latestRows.current.filter(isConfirmable)) {
      setBusy(new Set([row.annotationId]));
      const ok = await onConfirmValues(row).catch(() => false);
      if (!ok) {
        setFailed(previous => new Set(previous).add(row.annotationId));
        break;
      }
      done += 1;
    }
    setBusy(new Set());
    refocusAfterAll.current = true;
    setRunning(false);
    const needValue = latestRows.current.filter(row => !isConfirmable(row)).length;
    announce(`Confirmed ${plural(done, "finding", "findings")}.${needValue ? ` ${needValue} need a value.` : ""}`);
  };

  const live = (
    <div className="visually-hidden" aria-live="polite" data-unconfirmed-status>
      {status && <span key={status.count}>{status.text}</span>}
    </div>
  );
  if (rows.length === 0) {
    return <>
      {hadRows && <p role="status" className="unconfirmed-values__done">All values are confirmed.</p>}
      {live}
    </>;
  }

  const confirmable = rows.filter(isConfirmable);
  const findings = plural(rows.length, "finding", "findings");
  return <>
    <section className="unconfirmed-values" aria-labelledby={headingId} data-unconfirmed-values>
      <div className="unconfirmed-values__header">
        <h3 id={headingId}>Unconfirmed values · {findings}</h3>
        {confirmable.length > 0 && (
          <Button ref={confirmAllButton} type="button" variant="secondary" size="sm"
            aria-disabled={unavailable || running ? true : undefined}
            aria-describedby={unavailable ? reasonId : undefined}
            onClick={() => { void confirmAll(); }}>
            Confirm all ({confirmable.length})
          </Button>
        )}
      </div>
      <p className="unconfirmed-values__intro">
        These values were filled in from defaults or are empty. Confirm them here, or go to the finding to change them.
      </p>
      {confirmable.length > 0 && (
        <p className="unconfirmed-values__note">“Confirm all” confirms the default values shown below for all listed findings.</p>
      )}
      {unavailable && <p id={reasonId} className="form-hint">{confirmUnavailableReason}</p>}
      <ul className="unconfirmed-values__list">
        {rows.map(row => {
          const isBusy = busy.has(row.annotationId);
          const isFailed = failed.has(row.annotationId) && !isBusy;
          const blocked = unavailable || running || isBusy;
          return (
            <li key={row.annotationId} className="unconfirmed-values__row" data-unconfirmed-row={row.annotationId}>
              <div className="unconfirmed-values__term">
                <TermName termId={row.termId} label={row.term !== row.termId ? row.term : null} />
              </div>
              {row.quote && <div className="unconfirmed-values__quote">{row.quote}</div>}
              <div className="unconfirmed-values__values">{valuesLine(row, optionLabel)}</div>
              <div className="unconfirmed-values__actions">
                {isBusy && <span className="unconfirmed-values__busy">Confirming…</span>}
                {isFailed && <span className="unconfirmed-values__error">Could not confirm. Try again.</span>}
                {isConfirmable(row) && (
                  <Button
                    ref={element => {
                      if (element) confirmButtons.current.set(row.annotationId, element);
                      else confirmButtons.current.delete(row.annotationId);
                    }}
                    type="button" variant="secondary" size="sm"
                    aria-label={isFailed ? `Retry confirming values of ${row.term}` : `Confirm values of ${row.term}`}
                    aria-disabled={blocked ? true : undefined}
                    aria-describedby={unavailable ? reasonId : undefined}
                    onClick={() => { void confirmOne(row); }}>
                    {isFailed ? "Retry" : "Confirm"}
                  </Button>
                )}
                <Button type="button" size="sm" aria-label={`Go to ${row.term}`}
                  aria-disabled={isBusy ? true : undefined}
                  onClick={() => { if (!isBusy) onGoTo(row); }}>
                  Go to
                </Button>
              </div>
              {row.reason && <div className="unconfirmed-values__reason">{row.reason}</div>}
            </li>
          );
        })}
      </ul>
    </section>
    {live}
  </>;
}
