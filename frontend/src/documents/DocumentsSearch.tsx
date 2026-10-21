/**
 * The Documents search field and the page's polite live region as components of their own: typing and
 * announcements re-render only them, not the whole table (a keystroke or an announcement used to
 * re-render every row).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IconButton, IconClose } from "../ui";

/** The search applies this long after the last keystroke (or at once on Enter and blur). */
export const ID_FILTER_DELAY_MS = 300;

export interface DocumentsSearchHandle {
  focus: () => void;
  /** Clears the typed text and any pending apply without pushing a route (the caller pushes its own). */
  reset: () => void;
}

export interface DocumentsSearchProps {
  /** The route's search value. */
  q: string | undefined;
  /** Push the search (`undefined` clears it). */
  onApply: (q: string | undefined) => void;
}

/** "Case ID or text…": typed locally, applied after a pause, on Enter or on blur (one push, not one per keystroke). */
export const DocumentsSearch = forwardRef<DocumentsSearchHandle, DocumentsSearchProps>(function DocumentsSearch({ q, onApply }, ref) {
  const [text, setText] = useState(q ?? "");
  const sent = useRef(q);
  const timer = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const latestApply = useRef(onApply);
  latestApply.current = onApply;

  useEffect(() => {
    // An outside change (Clear all, history) replaces the typed text; our own push does not.
    if (q === sent.current) return;
    sent.current = q;
    window.clearTimeout(timer.current);
    setText(q ?? "");
  }, [q]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const apply = (value: string) => {
    window.clearTimeout(timer.current);
    const next = value || undefined;
    // Already sent (or already the route's value): nothing to push.
    if (next === (sent.current || undefined)) return;
    sent.current = next;
    latestApply.current(next);
  };
  const type = (value: string) => {
    setText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply(value), ID_FILTER_DELAY_MS);
  };
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    reset: () => { window.clearTimeout(timer.current); setText(""); sent.current = undefined; },
  }), []);

  return <div className="documents-search">
    <input ref={input} id="documents-search" type="search" className="form-control" aria-label="Case ID or text" placeholder="Case ID or text…"
      value={text} onChange={event => type(event.target.value)} onBlur={() => apply(text)}
      onKeyDown={event => { if (event.key === "Enter") apply(text); }} />
    {text !== "" && <IconButton size="sm" variant="quiet" label="Clear search" icon={<IconClose />} onClick={() => {
      setText("");
      apply("");
      input.current?.focus();
    }} />}
  </div>;
});

export interface LiveRegionHandle { announce: (message: string) => void }

/** The page's single polite live region; a repeated message is cleared first and set again on the next tick so it is re-announced. */
export const LiveRegion = forwardRef<LiveRegionHandle>(function LiveRegion(_props, ref) {
  const [message, setMessage] = useState("");
  const announced = useRef("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useImperativeHandle(ref, () => ({
    announce: (next: string) => {
      window.clearTimeout(timer.current);
      if (next !== announced.current) { announced.current = next; setMessage(next); return; }
      setMessage("");
      timer.current = window.setTimeout(() => setMessage(next), 0);
    },
  }), []);
  return <p className="visually-hidden" role="status" aria-live="polite">{message}</p>;
});
