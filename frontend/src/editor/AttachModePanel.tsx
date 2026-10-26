import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import type { AttachCandidate, AttachFinding } from "./modifiers";
import "./modifiers.css";

export interface AttachModePanelProps {
  termLabel: string;
  termId: string;
  /** Text of the marked span; null when there is none. */
  markQuote: string | null;
  /** Nearest finding in the mark's sentence (spec "Attach mode" 3). */
  nearest: AttachCandidate | null;
  /** A target chosen by click or Enter that already has this modifier with another span (spec 7). */
  focused: AttachFinding | null;
  /** The term on a finding already: its span's quote, or null without span; undefined when absent. */
  existing: (annotationId: string) => { segmentsQuote: string | null } | undefined;
  /** No target at all: the mode does not start (spec 9). */
  noFindings: boolean;
  /** add_modifier on that finding (also links a spanless modifier). */
  onAttach: (annotationId: string) => void;
  /** set_modifier_segments on that finding. */
  onReplace: (annotationId: string) => void;
  onCancel: () => void;
  /** Narrow layout only: the banner with its Cancel sits on the Document tab, out of sight. */
  showCancel?: boolean;
  /** An extra line (M7's convert mode). */
  note?: ReactNode;
}

/** Copy of the attach mode in one place (spec "Attach mode" 4, 7–9). */
export const attachCopy = {
  banner: (term: string) => `Attach ${term}: click its finding in the list or in the text (↑ ↓ Enter in the list). Esc cancels.`,
  noNearest: "No finding in this sentence. Choose one in the findings list or in the text.",
  noFindings: (term: string) => `${term} is a modifier. Create the finding first, then add ${term} under Modifiers.`,
  replaceLine: (finding: string, term: string, quote: string) => `${finding} already has ${term} (“${quote}”). Attaching replaces its text span.`,
  targetName: (term: string, finding: string) => `Attach ${term} to ${finding}`,
  attached: (term: string, finding: string) => `Attached ${term} to ${finding}. Next: mark more text, or add another modifier with “+ Add modifier…”.`,
  linked: (quote: string, term: string, finding: string) => `Linked “${quote}” to ${term} of ${finding}.`,
  /** Convert mode (E-c, R3): the inspector's extra line and the status after attaching. */
  convertNote: (term: string, quote: string | null) => quote
    ? `The standalone finding ${term} is then deleted; its text “${quote}” goes with the modifier.`
    : `The standalone finding ${term} is then deleted.`,
  converted: (term: string, finding: string) => `Turned ${term} into a modifier of ${finding}.`,
  /** M2 M-5: attaching to a proposal runs Edit & Replace; named before (panel) and after (status line). */
  proposalNote: (finding: string) => `${finding} is a tool proposal: attaching replaces it with your copy (Edit & Replace).`,
  replaced: (finding: string, term: string, quote: string) => `${finding} replaced by your copy with ${term}${quote ? ` “${quote}”` : ""}.`,
};

/** The inspector while the attach mode is on (a labelled region "Attach Severe"). The banner over the text owns the
 * instruction and the one Cancel (Esc); the inspector only offers the nearest target. */
export function AttachModePanel({ termLabel, termId, markQuote, nearest, focused, existing, noFindings, onAttach, onReplace, onCancel, showCancel = false, note }: AttachModePanelProps): JSX.Element {
  const enter = <span aria-hidden="true"> <Kbd>Enter</Kbd></span>;
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (noFindings) ok.current?.focus({ preventScroll: true }); }, [noFindings]);
  if (noFindings) {
    return <section className="detail-pane" aria-label={`Attach ${termLabel}`}>
      <div className="detail-section mod-attach-panel">
        <p>{attachCopy.noFindings(termLabel)}</p>
        <div className="mod-attach-actions"><Button ref={ok} variant="primary" onClick={onCancel}>OK</Button></div>
      </div>
    </section>;
  }
  const replaceTarget = focused && existing(focused.annotationId)?.segmentsQuote ? focused : null;
  const target = replaceTarget ?? nearest;
  const there = target ? existing(target.annotationId) : undefined;
  return <section className="detail-pane" aria-label={`Attach ${termLabel}`}>
    <div className="detail-section mod-attach-panel">
      <h2 className="term-heading">{termLabel}{" "}<span className="mod-tag">Modifier</span></h2>
      <p className="mod-line-id">{termId}{markQuote ? ` · “${markQuote}”` : ""}</p>
      {note}
      {nearest
        ? <p><strong>Nearest in this sentence:</strong> {nearest.term}{nearest.quote ? ` · “${nearest.quote}”` : ""}</p>
        : <p>{attachCopy.noNearest}</p>}
      {target && there?.segmentsQuote && <p>{attachCopy.replaceLine(target.term, termLabel, there.segmentsQuote)}</p>}
      <div className="mod-attach-actions">
        {target && (there?.segmentsQuote
          ? <Button variant="primary" onClick={() => onReplace(target.annotationId)}>Replace text span{enter}</Button>
          : there && markQuote
            ? <Button variant="primary" onClick={() => onAttach(target.annotationId)}>Link “{markQuote}” to {termLabel}{enter}</Button>
            : <Button variant="primary" onClick={() => onAttach(target.annotationId)}>Attach to {target.term}{enter}</Button>)}
        {showCancel && <Button aria-keyshortcuts="Escape" onClick={onCancel}>Cancel<span aria-hidden="true"> <Kbd>Esc</Kbd></span></Button>}
      </div>
    </div>
  </section>;
}
