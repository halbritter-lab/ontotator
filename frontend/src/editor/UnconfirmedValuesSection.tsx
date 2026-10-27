import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { AxisValue } from "../ui/AxisValue";
import { SubmitGroup } from "./SubmitGroup";
import type { UnconfirmedRow } from "./unconfirmedValues";

export interface UnconfirmedValuesSectionProps {
  rows: readonly UnconfirmedRow[];
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

/** "Values not chosen yet" in the Submit dialog (spec F2, S4): one row per finding, "Confirm as shown" in place. */
export function UnconfirmedValuesSection({
  rows, confirmUnavailableReason, onConfirmValues, onGoTo, onEmpty,
}: UnconfirmedValuesSectionProps) {
  const reasonId = useId();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ text: string; count: number } | null>(null);
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
      announce(rows.length > 0 ? `Confirmed ${pending.term}. ${rows.length} left.` : `Confirmed ${pending.term}. All values are confirmed.`);
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
  if (rows.length === 0) return live;

  const confirmable = rows.filter(isConfirmable);
  return <>
    <SubmitGroup heading="Values not chosen yet" data-unconfirmed-values
      // "Confirm all" only where it saves clicks: two or more rows with values shown by default.
      action={confirmable.length > 1 && (
        <Button ref={confirmAllButton} type="button" variant="secondary" size="sm"
          aria-disabled={unavailable || running ? true : undefined}
          aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => { void confirmAll(); }}>
          Confirm all as shown ({confirmable.length})
        </Button>
      )}
      note={unavailable && <p id={reasonId} className="submit-item__line">{confirmUnavailableReason}</p>}>
      {rows.map(row => {
        const isBusy = busy.has(row.annotationId);
        const isFailed = failed.has(row.annotationId) && !isBusy;
        const blocked = unavailable || running || isBusy;
        return (
          <li key={row.annotationId} className="submit-item" data-unconfirmed-row={row.annotationId}>
            <span className="submit-item__what">
              <strong>{row.term}</strong>
              {row.quote && <> <span className="submit-item__quote">“{row.quote}”</span></>}
            </span>
            <span className="submit-item__actions">
              {isBusy && <span className="submit-item__line">Confirming…</span>}
              {isFailed && <span className="submit-item__error">Could not confirm. Try again.</span>}
              {/* Only values shown by default can be confirmed; an empty value ("Not specified") is chosen in the finding. */}
              {isConfirmable(row) && (
                <Button
                  ref={element => {
                    if (element) confirmButtons.current.set(row.annotationId, element);
                    else confirmButtons.current.delete(row.annotationId);
                  }}
                  type="button" variant="secondary" size="sm"
                  aria-label={isFailed ? `Retry confirming ${row.term} as shown` : `Confirm as shown: ${row.term}`}
                  aria-disabled={blocked ? true : undefined}
                  aria-describedby={unavailable ? reasonId : undefined}
                  onClick={() => { void confirmOne(row); }}>
                  {isFailed ? "Retry" : "Confirm as shown"}
                </Button>
              )}
              <Button type="button" size="sm" aria-label={`Go to ${row.term}`}
                aria-disabled={isBusy ? true : undefined}
                onClick={() => { if (!isBusy) onGoTo(row); }}>
                Go to
              </Button>
            </span>
            <span className="submit-item__values">
              {row.values.map(value => <span key={value.axisId} className="submit-item__value" title={value.axisLabel}>
                <span className="visually-hidden">{value.axisLabel}: </span><AxisValue value={value.value} />
              </span>)}
            </span>
            {row.reason && <span className="submit-item__line">{row.reason}</span>}
          </li>
        );
      })}
    </SubmitGroup>
    {live}
  </>;
}
