import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import React, { useEffect, useRef, useState } from "react";
import { ProposalSource } from "./ProposalSource";
import type { EditorProposal, AnnotationSnapshot } from "../api/client";
import type { components } from "../api/generated";
import { TermName } from "./TermName";
import { AiBadge } from "./AiBadge";
import { IconCheck, IconClose, IconPencil, IconQuestion, IconUndo, IconWarning } from "../ui/icons";

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
}) => {
  const [selectedReplacementId, setSelectedReplacementId] = useState<string>(currentDecision?.replacement?.annotation_id ?? "");
  const [localNote, setLocalNote] = useState<string>(currentDecision?.note ?? "");
  const note = controlledNote ?? localNote;
  const setNote = (value: string) => {
    if (onNoteChange) onNoteChange(value);
    else setLocalNote(value);
  };
  const [showReplacementSelect, setShowReplacementSelect] = useState<boolean>(
    currentDecision?.outcome === "changed"
  );
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ note, currentDecision, onDecide, readOnly });
  latest.current = { note, currentDecision, onDecide, readOnly };

  /** Save the note onto the existing decision (no-op if there is no decision or nothing changed). */
  const commitNote = () => {
    if (latest.current.readOnly) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    const { note: current, currentDecision: decision, onDecide: decide } = latest.current;
    if (!decision) return;
    const normalized = current.trim() || undefined;
    if ((decision.note ?? undefined) === normalized) return;
    decide({
      outcome: decision.outcome as ReviewDecisionOutcome,
      replacement: decision.replacement ?? undefined,
      note: normalized,
    });
  };
  // Flush a pending note save when the panel unmounts (e.g. selecting another target).
  useEffect(() => () => { if (noteTimer.current) commitNote(); }, []);

  const handleNoteChange = (value: string) => {
    if (readOnly) return;
    setNote(value);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    if (currentDecision && noteSaveDelayMs > 0) {
      noteTimer.current = setTimeout(commitNote, noteSaveDelayMs);
    }
  };

  const handleOutcomeClick = (outcome: ReviewDecisionOutcome) => {
    if (readOnly) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;

    if (outcome === "changed") {
      setShowReplacementSelect(true);
      // If there's an existing draft replacement or first draft annotation
      const repl = draftAnnotations.find(
        (a) => a.annotation.annotation_id !== target.annotation_id
      );
      if (repl && !selectedReplacementId) {
        setSelectedReplacementId(repl.annotation.annotation_id);
      }
      return;
    }

    setShowReplacementSelect(false);
    onDecide({
      outcome,
      replacement: undefined,
      note: note.trim() || undefined,
    });
  };

  const handleClearDecision = () => {
    if (readOnly) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    setShowReplacementSelect(false);
    onDecide({
      outcome: null,
      replacement: undefined,
      note: undefined,
    });
  };

  const handleConfirmChanged = () => {
    if (readOnly) return;
    const replSnap = draftAnnotations.find(
      (a) => a.annotation.annotation_id === selectedReplacementId
    );
    if (!replSnap) return;

    onDecide({
      outcome: "changed",
      replacement: {
        annotation_id: replSnap.annotation.annotation_id,
        version: replSnap.version,
      },
      note: note.trim() || undefined,
    });
  };

  const outcomeLabels: Record<ReviewDecisionOutcome, string> = {
    confirmed: "Confirmed",
    rejected: "Rejected",
    changed: "Replaced",
    uncertain: "Uncertain",
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

      <div className="detail-section review-actions__proposal" aria-label="Proposal details">
        <strong className="review-actions__term"><TermName termId={target.term_id ?? target.annotation_id} label={termLabel} /></strong>
        <dl className="axis-list">
          {(() => {
            const rawAxes = target.axes_values ?? (target.axes && "values" in target.axes ? (target.axes as any).values : target.axes) ?? {};
            const entries = Object.entries(rawAxes);
            if (entries.length === 0) {
              return <dd className="axis-list__empty">No axes defined</dd>;
            }
            return entries.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{typeof v === "string" ? v : (v !== null && v !== undefined ? String(v) : "Not specified")}</dd>
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
          <span>Obsolete term cannot be confirmed. Please reject, mark as uncertain, or replace with a valid term.</span>
        </div>
      )}

      {target.is_unknown && <p role="alert">Unknown term cannot be confirmed.</p>}
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
          variant="secondary" className="decision-btn decision-btn--changed"
          disabled={readOnly}
          aria-pressed={pressed("changed")}
          onClick={() => {
            if (currentDecision?.outcome === "changed" && currentDecision.replacement?.annotation_id && onEditReplacement) {
              onEditReplacement(currentDecision.replacement.annotation_id);
            } else if (onAdoptAndEdit) {
              onAdoptAndEdit();
            } else {
              handleOutcomeClick("changed");
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
          title="Set reviewer uncertainty (Key: 4)"
        >
          <span className="decision-btn__label"><IconQuestion />Uncertain</span>
          <kbd className="kbd">4</kbd>
        </Button>
      </div>

      {/* Reset Decision Button */}
      {currentDecision && (
        <div className="review-actions__row">
          <Button
            type="button"
            variant="quiet" size="sm"
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

      {/* Manual Replacement Selection (Fallback / Existing Annotations) */}
      {draftAnnotations.length > 0 && (
        <div className="review-actions__row">
          {!showReplacementSelect ? (
            <Button
              type="button"
              className="link-button"
              disabled={readOnly}
              onClick={() => {
                if (readOnly) return;
                setShowReplacementSelect(true);
                const repl = draftAnnotations.find(
                  (a) => a.annotation.annotation_id !== target.annotation_id
                );
                if (repl && !selectedReplacementId) {
                  setSelectedReplacementId(repl.annotation.annotation_id);
                }
              }}
            >
              Assign replacement from draft...
            </Button>
          ) : (
            <div className="review-actions__block">
              <div className="review-actions__block-head">
                <label htmlFor="replacement-select" className="form-label">
                  Select replacement annotation:
                </label>
                <Button
                  type="button"
                  variant="quiet" size="sm"
                  onClick={() => setShowReplacementSelect(false)}
                >
                  <IconClose />
                  Close
                </Button>
              </div>
              <Select label={null}
                id="replacement-select"
                aria-label="Select replacement annotation"
                className="form-select"
                disabled={readOnly}
                value={selectedReplacementId}
                onChange={(e) => setSelectedReplacementId(e.target.value)}
              >
                <option value="">(Select an annotation from draft)</option>
                {draftAnnotations
                  .filter((snap) => {
                    if (target.layer_id && snap.annotation.layer_id !== target.layer_id) return false;
                    if (target.type_id && snap.annotation.type_id !== target.type_id) return false;
                    return true;
                  })
                  .map((snap) => {
                    const term = snap.annotation.term_id;
                    const label = resolveTermLabel?.(snap.annotation.layer_id, term);
                    return (
                      <option key={snap.annotation.annotation_id} value={snap.annotation.annotation_id}>
                        {label ? `${label} (${term})` : term} · {snap.annotation.annotation_id.slice(0, 10)}
                      </option>
                    );
                  })}
              </Select>
              <Button
                type="button"
                variant="primary" size="sm"
                onClick={handleConfirmChanged}
                disabled={readOnly || !selectedReplacementId}
              >
                Confirm replacement
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Reviewer Note */}
      <div className="form-group review-actions__note">
        <input
          type="text"
          className="form-control"
          aria-label="Reviewer note"
          readOnly={readOnly}
          placeholder="Optional reviewer note / justification..."
          value={note}
          onChange={(e) => handleNoteChange(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNote(); } }}
        />
        {!currentDecision && note.trim() && (
          <div className="field-hint">
            The note is saved together with the next decision.
          </div>
        )}
        {currentDecision && (currentDecision.note ?? "") !== note.trim() && (
          <div className="field-hint">
            Unsaved note – saved automatically when you leave the field.
          </div>
        )}
      </div>
    </div>
  );
};
