import { IconButton } from "../ui/IconButton";
import { Textarea } from "../ui/Textarea";
import { Button } from "../ui/Button";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ProposalSource } from "./ProposalSource";
import type { EditorProposal, AnnotationSnapshot } from "../api/client";
import type { components } from "../api/generated";
import { TermName } from "./TermName";
import { AiBadge } from "./AiBadge";
import { IconCheck, IconClose, IconPencil, IconQuestion, IconUndo, IconWarning } from "../ui/icons";
import { axisOptionLabel, findingAxes } from "./axisLabels";
import type { AxisDefinition } from "./AnnotationPanel";

export type ReviewDecision = components["schemas"]["ReviewDecision"];
export type ReviewDecisionOutcome = "confirmed" | "rejected" | "changed" | "uncertain";

export interface TargetProposal {
  annotation_id: string;
  version: string;
  layer_id?: string;
  type_id?: string;
  term_id?: string;
  axes?: Record<string, unknown> | null;
  axes_values?: Record<string, string | null> | null;
  axes_defaulted?: string[];
  /** Null when the proposal's snapshot is missing, so its origin is unknown. */
  provenance: components["schemas"]["Provenance"] | null;
  evidence_count: number;
  /** Text of the first mention, for telling equally named proposals apart. */
  quote?: string;
  is_obsolete?: boolean;
  is_unknown?: boolean;
}

export interface DecisionPayload {
  outcome: ReviewDecisionOutcome | null;
  replacement?: {
    annotation_id: string;
    version: string;
  };
  note?: string;
}

export interface ReviewActionsProps {
  source?: EditorProposal;
  readOnly?: boolean;
  target: TargetProposal;
  termLabel?: string | null;
  resolveTermLabel?: (layerId: string, termId: string) => string | null;
  currentDecision: ReviewDecision | null;
  draftAnnotations: AnnotationSnapshot[];
  evidence?: components["schemas"]["EvidenceSnapshot"][];
  documentText?: string;
  onDecide: (payload: DecisionPayload) => void;
  onAdoptAndEdit?: () => void;
  onEditReplacement?: (annotationId: string) => void;
  onDeselect?: () => void;
  /** Controlled reviewer note (kept by the parent so it survives re-selection and decision resets). */
  note?: string;
  onNoteChange?: (note: string) => void;
  /** Delay for auto-saving an edited note onto an existing decision. */
  noteSaveDelayMs?: number;
  /** Parent requests note validation/focus after an unresolved keyboard action. */
  requireNote?: boolean;
  draftUnresolved?: boolean;
  busy?: boolean;
  axesConfig?: AxisDefinition[];
  requireChosenAxes?: boolean;
  onDraftUnresolved?: () => void;
}

type NoteSaveSession = {
  timer: ReturnType<typeof setTimeout> | null;
  note: string;
  decision: ReviewDecision | null;
  decide: ReviewActionsProps["onDecide"];
  readOnly: boolean;
  drafting: boolean;
};

function cancelNoteSave(session: NoteSaveSession) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
}

function saveNote(session: NoteSaveSession) {
  cancelNoteSave(session);
  const { note, decision, decide, readOnly } = session;
  if (readOnly || session.drafting || !decision) return;
  const normalized = note.trim() || undefined;
  if (decision.outcome === "uncertain" && !normalized) return;
  if ((decision.note ?? undefined) === normalized) return;
  decide({ outcome: decision.outcome, replacement: decision.replacement ?? undefined, note: normalized });
}

export const ReviewActions: React.FC<ReviewActionsProps> = ({
  source,
  target,
  readOnly = false,
  termLabel,
  resolveTermLabel,
  currentDecision,
  draftAnnotations,
  onDecide,
  onAdoptAndEdit,
  onEditReplacement,
  onDeselect,
  evidence = [],
  documentText = "",
  note: controlledNote,
  onNoteChange,
  noteSaveDelayMs = 800,
  requireNote = false,
  draftUnresolved = false,
  busy = false,
  axesConfig,
  requireChosenAxes = false,
  onDraftUnresolved,
}) => {
  const targetIdentity = JSON.stringify([target.annotation_id, target.version]);
  const [localNote, setLocalNote] = useState({ targetIdentity, value: currentDecision?.note ?? "" });
  const [attemptedUnresolved, setAttemptedUnresolved] = useState<string | null>(null);
  const note = controlledNote ?? (localNote.targetIdentity === targetIdentity ? localNote.value : currentDecision?.note ?? "");
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  const drafting = draftUnresolved || attemptedUnresolved === targetIdentity;
  const needsNote = requireNote || drafting || currentDecision?.outcome === "uncertain";
  const noteInvalid = !readOnly && needsNote && !note.trim();
  // Each exact target owns its save session. A delayed callback/unmount can only
  // save that target through its original parent callback, even after re-selection.
  const noteSession = useMemo<NoteSaveSession>(() => ({ timer: null, note: "", decision: null, decide: onDecide, readOnly, drafting: false }), [targetIdentity]);
  Object.assign(noteSession, { note, decision: currentDecision, decide: onDecide, readOnly, drafting });
  useEffect(() => () => { if (noteSession.timer) saveNote(noteSession); }, [noteSession]);
  useEffect(() => {
    if (requireNote && !readOnly) { cancelNoteSave(noteSession); noteInput.current?.focus(); }
  }, [requireNote, readOnly, targetIdentity]);
  useEffect(() => {
    if (currentDecision?.outcome === "uncertain" && currentDecision.note === note.trim()) setAttemptedUnresolved(null);
  }, [currentDecision]);

  const handleNoteChange = (value: string) => {
    if (readOnly) return;
    noteSession.note = value;
    if (onNoteChange) onNoteChange(value);
    else setLocalNote({ targetIdentity, value });
    cancelNoteSave(noteSession);
    if (!drafting && currentDecision && noteSaveDelayMs > 0 && !(currentDecision.outcome === "uncertain" && !value.trim())) {
      noteSession.timer = setTimeout(() => saveNote(noteSession), noteSaveDelayMs);
    }
  };

  const handleOutcomeClick = (outcome: ReviewDecisionOutcome) => {
    if (readOnly) return;
    cancelNoteSave(noteSession);
    if (outcome === "uncertain") {
      noteSession.drafting = true;
      setAttemptedUnresolved(targetIdentity);
      onDraftUnresolved?.();
      noteInput.current?.focus();
      return;
    }
    setAttemptedUnresolved(null);
    onDecide({ outcome, replacement: undefined, note: note.trim() || undefined });
  };

  const handleClearDecision = () => {
    if (readOnly) return;
    cancelNoteSave(noteSession);
    setAttemptedUnresolved(null);
    onDecide({ outcome: null, replacement: undefined, note: undefined });
  };

  const outcomeLabels: Record<ReviewDecisionOutcome, string> = {
    confirmed: "Confirmed",
    rejected: "Rejected",
    changed: "Replaced",
    uncertain: "Unresolved",
  };
  const pressed = (outcome: ReviewDecisionOutcome) => currentDecision?.outcome === outcome;

  return (
    <div className="review-actions">
      {/* Current Decision Header */}
      <div className="review-actions__head">
        <h4 className="review-actions__title">Review decision for this proposal</h4>
        <div className="review-actions__state">
          {currentDecision ? (
            <span className={`badge decision-tag decision-tag--${currentDecision.outcome}`}>
              {outcomeLabels[currentDecision.outcome as ReviewDecisionOutcome] ?? currentDecision.outcome}
            </span>
          ) : (
            <span className="badge decision-tag decision-tag--open">Pending</span>
          )}
          {onDeselect && (
            <IconButton label="Clear selection" icon={<IconClose />} variant="quiet" size="sm" onClick={onDeselect} />
          )}
        </div>
      </div>

      <div className="detail-section review-actions__proposal" aria-label="Proposal details" tabIndex={-1}>
        <strong className="review-actions__term"><TermName termId={target.term_id ?? target.annotation_id} label={termLabel} /></strong>
        <dl className="axis-list">
          {(() => {
            const rawAxes = target.axes_values ?? (target.axes && "values" in target.axes ? (target.axes as any).values : target.axes) ?? {};
            const entries = findingAxes(rawAxes, axesConfig);
            if (entries.length === 0) {
              return <dd className="axis-list__empty">No axes defined</dd>;
            }
            return entries.map(({ id, label, value }) => (
              <React.Fragment key={id}>
                <dt>{label}</dt>
                <dd>{axisOptionLabel(value)} {target.axes_defaulted?.includes(id) && <span className="badge">Defaulted</span>}</dd>
              </React.Fragment>
            ));
          })()}
        </dl>
        {evidence.length ? evidence.map(ev => <p className="review-actions__quote" key={`${ev.mention.evidence_id}:${ev.version}`}>
          {ev.mention.segments.map(seg => Array.from(documentText).slice(seg.start, seg.end).join("")).join(" … ")}
        </p>) : <p className="review-actions__quote">No text mention (spanless)</p>}
        <details className="technical-details">
          <summary>Technical details</summary>
          <p>Version: {target.version}</p>
        </details>
      </div>
      <ProposalSource source={source} />
      {!!target.axes_defaulted?.length && <div className="field-hint">
        <p>This proposal is immutable. Its defaulted values cannot be confirmed directly. An Unresolved decision and its reviewer note keep the original clinical values.</p>
        {requireChosenAxes && <p role="alert">This project requires every axis to be chosen. Defaulted values on this immutable proposal still block submission. Ask the project lead to resolve this rule conflict, or make a clinically justified replacement decision.</p>}
        <p>Edit &amp; Replace is a separate review decision: it creates an editable copy and replaces the existing decision. Use it only when you intend to replace the proposal.</p>
      </div>}
      {/* Origin Info */}
      <div className="review-actions__origin">
        {target.provenance ? (
          <>
            <AiBadge provenance={target.provenance} source={source} />{" "}
            Source: <strong>{target.provenance.actor.kind}</strong> ({target.provenance.actor.actor_id}) •
            Method: {target.provenance.method}
          </>
        ) : (
          <>Source: <strong>unknown</strong></>
        )}
      </div>

      {/* Obsolete warning */}
      {target.is_obsolete && (
        <div className="review-actions__warning">
          <IconWarning />
          <span>Obsolete terms cannot be submitted, including as unresolved. Reject this proposal or replace it with a valid term.</span>
        </div>
      )}

      {target.is_unknown && <p role="alert">Unknown terms cannot be submitted, including as unresolved. Reject this proposal or replace it with a valid term.</p>}
      {/* 4 Action Buttons: a quiet ruled grid; the chosen outcome is filled. */}
      <div className="decision-grid">
        <Button
          type="button"
          variant="secondary" className="decision-btn decision-btn--confirmed"
          aria-pressed={pressed("confirmed")}
          onClick={() => handleOutcomeClick("confirmed")}
          disabled={readOnly || target.is_obsolete || target.is_unknown}
          title="Confirm proposal as-is (Key: 1)"
        >
          <span className="decision-btn__label"><IconCheck />Confirm</span>
          <kbd className="kbd">1</kbd>
        </Button>

        <Button
          type="button"
          variant="secondary" className="decision-btn decision-btn--rejected"
          aria-pressed={pressed("rejected")}
          disabled={readOnly} onClick={() => handleOutcomeClick("rejected")}
          title="Reject proposal (Key: 2)"
        >
          <span className="decision-btn__label"><IconClose />Reject</span>
          <kbd className="kbd">2</kbd>
        </Button>

        <Button
          type="button"
          variant="secondary" className="decision-btn decision-btn--changed" data-repair="edit-proposal"
          disabled={readOnly || !(onAdoptAndEdit || (currentDecision?.outcome === "changed" && onEditReplacement))}
          aria-pressed={pressed("changed")}
          onClick={() => {
            if (currentDecision?.outcome === "changed" && currentDecision.replacement?.annotation_id && onEditReplacement) {
              onEditReplacement(currentDecision.replacement.annotation_id);
            } else if (onAdoptAndEdit) {
              onAdoptAndEdit();
            } else {
              return;
            }
          }}
          title={
            pressed("changed")
              ? "Continue editing replacement in draft (Key: 3)"
              : "Adopt proposal and edit in draft (Key: 3)"
          }
        >
          <span className="decision-btn__label"><IconPencil />Edit & Replace</span>
          <kbd className="kbd">3</kbd>
        </Button>

        <Button
          type="button"
          variant="secondary" className="decision-btn decision-btn--uncertain"
          aria-pressed={pressed("uncertain")}
          disabled={readOnly} onClick={() => handleOutcomeClick("uncertain")}
          title="Mark proposal as unresolved; reviewer note required (Key: 4)"
        >
          <span className="decision-btn__label"><IconQuestion />Unresolved</span>
          <kbd className="kbd">4</kbd>
        </Button>
      </div>

      <p className="field-hint">A reviewer decision, separate from clinical uncertainty. A note is required.</p>
      <p className="field-hint">Unresolved proposals are included in exports with a separate reviewer flag and note. Clinical axis values are unchanged.</p>

      {/* Reset Decision Button */}
      {currentDecision && (
        <div className="review-actions__row">
          <Button
            type="button"
            size="sm"
            disabled={readOnly} onClick={handleClearDecision}
            title="Reset decision for this proposal (back to open)"
          >
            <IconUndo />
            Reset decision (open) <kbd className="kbd">0</kbd>
          </Button>
        </div>
      )}

      {/* Changed Outcome Card with Direct Edit Shortcut */}
      {currentDecision?.outcome === "changed" && (
        <div className="review-actions__block">
          <div className="review-actions__block-title">
            This proposal is replaced by an alternative annotation.
          </div>
          {currentDecision.replacement && (() => {
            const replSnap = draftAnnotations.find(
              (a) => a.annotation.annotation_id === currentDecision.replacement?.annotation_id
            );
            const replTermId = replSnap?.annotation.term_id ?? currentDecision.replacement.annotation_id;
            const replLabel = replSnap ? resolveTermLabel?.(replSnap.annotation.layer_id, replTermId) : null;
            return (
              <div className="review-actions__block-body">
                Replaced by:{" "}
                <strong>
                  <TermName termId={replTermId} label={replLabel} />
                </strong>
              </div>
            );
          })()}
          {currentDecision.replacement && onEditReplacement && (
            <Button
              type="button"
              variant="primary" size="sm"
              onClick={() => onEditReplacement(currentDecision.replacement!.annotation_id)}
            >
              <IconPencil />
              Edit replacement annotation
            </Button>
          )}
        </div>
      )}

      <div className="review-actions__note">
        <Textarea rows={3} id={noteId} ref={noteInput} label="Reviewer note" aria-label="Reviewer note"
          required={needsNote} readOnly={readOnly} value={note}
          error={noteInvalid ? "A reviewer note is required for an unresolved decision." : undefined}
          hint={drafting ? "The reason is saved only with Save decision." : !noteInvalid && !currentDecision && note.trim() ? "The note is saved together with the next decision."
            : !noteInvalid && currentDecision && (currentDecision.note ?? "") !== note.trim()
              ? "Unsaved note – saved automatically when you leave the field." : undefined}
          onChange={e => handleNoteChange(e.target.value)} onBlur={() => saveNote(noteSession)}
 />
        {drafting && <div className="review-actions__row">
          <p role="status">Unresolved decision not saved. Enter a reason, then save the decision.</p>
          <Button disabled={readOnly || busy || !note.trim()} onClick={() => {
            cancelNoteSave(noteSession);
            if (!note.trim()) return;
            onDecide({ outcome: "uncertain", replacement: undefined, note: note.trim() });
          }}>Save decision</Button>
        </div>}
      </div>
    </div>
  );
};
