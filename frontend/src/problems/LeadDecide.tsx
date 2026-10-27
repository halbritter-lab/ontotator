import { useEffect, useId, useRef, type ReactNode } from "react";
import type { ProblemReportView } from "../api/client";
import { Button, Toolbar } from "../ui";
import { intentState, type Intent } from "./labels";

export const INTENT_ORDER: readonly Intent[] = ["close", "release", "pause", "restart", "reopen"];

/**
 * The actions of the decision card. Only intents possible now are shown; an open confirmation stays until it closes.
 * An open report that pauses a task leads with the inline "Close and resume …" form (R-16), the rest follow under
 * "Other decisions". A closed report that still pauses tasks leads with "Release pause on …". Each further intent is
 * one button with its consequence line and, when open, its confirmation directly below it.
 */
export function LeadDecide({ report, open, onOpen, onUnavailable, renderConfirm, focusTrigger }: {
  report: ProblemReportView;
  open: Intent | null;
  onOpen: (intent: Intent) => void;
  onUnavailable: (reason: string) => void;
  /** The confirmation of an intent; for "resume_close" the inline answer form with the primary button. */
  renderConfirm: (intent: Intent) => ReactNode;
  /** Set to an intent to move focus back to its button (after Cancel or Escape). */
  focusTrigger: { intent: Intent; n: number } | null;
}): JSX.Element | null {
  const id = useId();
  const state = intentState(report);
  const buttons = useRef(new Map<Intent, HTMLButtonElement>());
  useEffect(() => { if (focusTrigger) buttons.current.get(focusTrigger.intent)?.focus(); }, [focusTrigger]);
  const shown = (intent: Intent) => !state[intent].unavailable || open === intent;
  // The "Close and resume" form stays while it is in use, even when a reload released the pauses (its conflict shows there).
  const resumeClose = open === "resume_close" || (report.state === "open" && !state.resume_close.unavailable);
  const releaseFirst = report.state !== "open" && shown("release");
  const others = INTENT_ORDER.filter(intent => shown(intent) && !(releaseFirst && intent === "release"));

  const block = (intent: Intent, primary = false) => {
    const { label, consequence, unavailable } = state[intent];
    const lineId = `${id}-${intent}-line`, confirmId = `${id}-${intent}-confirm`;
    return <div className="lead-intent">
      <Button variant={primary ? "primary" : "secondary"} size={primary ? "md" : "sm"} ref={element => { if (element) buttons.current.set(intent, element); else buttons.current.delete(intent); }}
        aria-expanded={open === intent} aria-controls={confirmId} aria-describedby={lineId}
        aria-disabled={unavailable ? true : undefined}
        onClick={() => { if (unavailable) onUnavailable(unavailable); else onOpen(intent); }}>{label}</Button>
      <p id={lineId} className="lead-intent-line">{consequence}</p>
      <div id={confirmId}>{open === intent && renderConfirm(intent)}</div>
    </div>;
  };

  if (!resumeClose && !releaseFirst && !others.length) return null;
  return <Toolbar label="Decide on this report" className="lead-decide">
    {resumeClose && renderConfirm("resume_close")}
    {releaseFirst && block("release", true)}
    {(resumeClose || releaseFirst) && others.length > 0 && <hr className="lead-rule" />}
    {resumeClose && others.length > 0 && <h3 className="lead-decide-other">Other decisions</h3>}
    {others.length > 0 && <ul className="lead-intents">{others.map(intent => <li key={intent}>{block(intent)}</li>)}</ul>}
  </Toolbar>;
}
