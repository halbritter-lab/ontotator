import { useEffect, useId, useRef, type ReactNode } from "react";
import type { ProblemReportView } from "../api/client";
import { Button, Toolbar } from "../ui";
import { intentState, type Intent } from "./labels";

export const INTENT_ORDER: readonly Intent[] = ["close", "release", "pause", "restart", "reopen"];

/**
 * The "Decide" toolbar: while the report is open and pauses a task, one primary "Close and resume …" (R-16), then
 * under "Other decisions" the five intents; each with its visible consequence line and, when open, its confirmation
 * directly below it. Unavailable intents stay focusable (`aria-disabled`) and announce why.
 */
export function LeadDecide({ report, open, onOpen, onUnavailable, renderConfirm, focusTrigger }: {
  report: ProblemReportView;
  open: Intent | null;
  onOpen: (intent: Intent) => void;
  onUnavailable: (reason: string) => void;
  renderConfirm: (intent: Intent) => ReactNode;
  /** Set to an intent to move focus back to its button (after Cancel or Escape). */
  focusTrigger: { intent: Intent; n: number } | null;
}): JSX.Element {
  const id = useId();
  const state = intentState(report);
  const buttons = useRef(new Map<Intent, HTMLButtonElement>());
  useEffect(() => { if (focusTrigger) buttons.current.get(focusTrigger.intent)?.focus(); }, [focusTrigger]);
  // An open "Close and resume" confirmation stays even when a reload released the pauses (its conflict shows there).
  const primary = open === "resume_close" || (report.state === "open" && !state.resume_close.unavailable);
  return <Toolbar label="Decide on this report" className="lead-decide">
    {(primary ? ["resume_close" as const, ...INTENT_ORDER] : INTENT_ORDER).map(intent => {
      const { label, consequence, unavailable } = state[intent];
      const lineId = `${id}-${intent}-line`, confirmId = `${id}-${intent}-confirm`;
      return <div key={intent} className="lead-intent">
        {primary && intent === "close" && <p className="lead-decide-other">Other decisions</p>}
        <Button variant={intent === "resume_close" ? "primary" : undefined} ref={element => { if (element) buttons.current.set(intent, element); else buttons.current.delete(intent); }}
          aria-expanded={open === intent} aria-controls={confirmId} aria-describedby={lineId}
          aria-disabled={unavailable ? true : undefined}
          onClick={() => { if (unavailable) onUnavailable(unavailable); else onOpen(intent); }}>{label}</Button>
        <p id={lineId} className="lead-intent-line">
          {consequence}{unavailable && <span className="action-reason"> Unavailable: {unavailable}</span>}
        </p>
        <div id={confirmId}>{open === intent && renderConfirm(intent)}</div>
      </div>;
    })}
  </Toolbar>;
}
