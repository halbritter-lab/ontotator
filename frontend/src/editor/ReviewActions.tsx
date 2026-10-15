import React, { useEffect, useRef, useState } from "react";
import type { AnnotationSnapshot } from "../api/client";
import type { components } from "../api/generated";
import { TermName } from "./TermName";
import { AiBadge } from "./AiBadge";

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
  target,
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
  const latest = useRef({ note, currentDecision, onDecide });
  latest.current = { note, currentDecision, onDecide };

  /** Save the note onto the existing decision (no-op if there is no decision or nothing changed). */
  const commitNote = () => {
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
    setNote(value);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    if (currentDecision && noteSaveDelayMs > 0) {
      noteTimer.current = setTimeout(commitNote, noteSaveDelayMs);
    }
  };

  const handleOutcomeClick = (outcome: ReviewDecisionOutcome) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    if (currentDecision?.outcome === outcome) {
      // Toggling off removes the decision; the note text stays in the editor.
      setShowReplacementSelect(false);
      onDecide({
        outcome: null,
        replacement: undefined,
        note: undefined,
      });
      return;
    }

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

  const outcomeColors: Record<ReviewDecisionOutcome, { bg: string; text: string }> = {
    confirmed: { bg: "var(--success-light)", text: "var(--success)" },
    rejected: { bg: "var(--danger-light)", text: "var(--danger)" },
    changed: { bg: "var(--primary-light)", text: "var(--primary)" },
    uncertain: { bg: "var(--warning-light)", text: "var(--warning)" },
  };

  return (
    <div style={{ background: "var(--bg-surface)", padding: 16, borderTop: "1px solid var(--border-color)" }}>
      {/* Current Decision Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-muted)", margin: 0 }}>
          Review decision for this proposal
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {currentDecision ? (
            <span
              className="badge"
              style={{
                backgroundColor: outcomeColors[currentDecision.outcome as ReviewDecisionOutcome]?.bg,
                color: outcomeColors[currentDecision.outcome as ReviewDecisionOutcome]?.text,
                fontSize: "0.8rem",
              }}
            >
              ● {currentDecision.outcome.toUpperCase()}
            </span>
          ) : (
            <span className="badge" style={{ backgroundColor: "var(--surface-sunken)", color: "var(--text-muted)" }}>
              Pending
            </span>
          )}
          {onDeselect && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ padding: "2px 8px", fontSize: "0.75rem", lineHeight: 1 }}
              onClick={onDeselect}
              title="Clear selection"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="detail-section" aria-label="Proposal details">
        <strong><TermName termId={target.term_id ?? target.annotation_id} label={termLabel} /></strong>
        <dl>
          {(() => {
            const rawAxes = target.axes_values ?? (target.axes && "values" in target.axes ? (target.axes as any).values : target.axes) ?? {};
            const entries = Object.entries(rawAxes);
            if (entries.length === 0) {
              return <dd style={{ marginLeft: 0, color: "var(--text-muted)" }}>No axes defined</dd>;
            }
            return entries.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt style={{ textTransform: "capitalize" }}>{k}</dt>
                <dd>{typeof v === "string" ? v : (v !== null && v !== undefined ? String(v) : "Not specified")}</dd>
              </React.Fragment>
            ));
          })()}
        </dl>
        {evidence.length ? evidence.map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
          {ev.mention.segments.map(seg => Array.from(documentText).slice(seg.start, seg.end).join("")).join(" … ")}
        </p>) : <p>No text mention (spanless)</p>}
        <details className="technical-details">
          <summary>Technical details</summary>
          <p>Version: {target.version}</p>
        </details>
      </div>
      {/* Origin Info */}
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>
        {target.provenance ? (
          <>
            <AiBadge provenance={target.provenance} />{" "}
            Source: <strong>{target.provenance.actor.kind}</strong> ({target.provenance.actor.actor_id}) •
            Method: {target.provenance.method}
          </>
        ) : (
          <>Source: <strong>unknown</strong></>
        )}
      </div>

      {/* Obsolete warning */}
      {target.is_obsolete && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--danger)",
            background: "var(--danger-light)",
            padding: "6px 10px",
            borderRadius: "var(--radius)",
            marginBottom: 10,
          }}
        >
          ⚠️ Obsolete term cannot be confirmed. Please reject, mark as uncertain, or replace with a valid term.
        </div>
      )}

      {target.is_unknown && <p role="alert">Unknown term cannot be confirmed.</p>}
      {/* 4 Action Buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "confirmed"}
          style={{
            backgroundColor: currentDecision?.outcome === "confirmed" ? "var(--success)" : "var(--success-light)",
            color: currentDecision?.outcome === "confirmed" ? "var(--on-accent)" : "var(--success)",
            borderColor: currentDecision?.outcome === "confirmed" ? "var(--success)" : "var(--border-strong)",
            fontWeight: currentDecision?.outcome === "confirmed" ? 700 : "normal",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
          }}
          onClick={() => handleOutcomeClick("confirmed")}
          disabled={target.is_obsolete || target.is_unknown}
          title={currentDecision?.outcome === "confirmed" ? "Click to clear confirmation (Key: 1)" : "Accept proposal as-is (Key: 1)"}
        >
          <span>✓ Confirm</span>
          <kbd style={{ fontSize: "var(--size-xs)", opacity: 0.75, background: "rgba(0,0,0,0.08)", padding: "1px 5px", borderRadius: 3 }}>1</kbd>
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "rejected"}
          style={{
            backgroundColor: currentDecision?.outcome === "rejected" ? "var(--danger)" : "var(--danger-light)",
            color: currentDecision?.outcome === "rejected" ? "var(--on-accent)" : "var(--danger)",
            borderColor: currentDecision?.outcome === "rejected" ? "var(--danger)" : "var(--border-strong)",
            fontWeight: currentDecision?.outcome === "rejected" ? 700 : "normal",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
          }}
          onClick={() => handleOutcomeClick("rejected")}
          title={currentDecision?.outcome === "rejected" ? "Click to clear rejection (Key: 2)" : "Reject proposal (Key: 2)"}
        >
          <span>✕ Reject</span>
          <kbd style={{ fontSize: "var(--size-xs)", opacity: 0.75, background: "rgba(0,0,0,0.08)", padding: "1px 5px", borderRadius: 3 }}>2</kbd>
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "changed"}
          style={{
            backgroundColor: currentDecision?.outcome === "changed" ? "var(--primary)" : "var(--primary-light)",
            color: currentDecision?.outcome === "changed" ? "var(--on-accent)" : "var(--primary)",
            borderColor: currentDecision?.outcome === "changed" ? "var(--primary)" : "var(--border-strong)",
            fontWeight: currentDecision?.outcome === "changed" ? 700 : "normal",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
          }}
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
            currentDecision?.outcome === "changed"
              ? "Continue editing replacement in draft (Key: 3)"
              : "Adopt proposal and edit in draft (Key: 3)"
          }
        >
          <span>✎ Edit & Replace</span>
          <kbd style={{ fontSize: "var(--size-xs)", opacity: 0.75, background: "rgba(0,0,0,0.08)", padding: "1px 5px", borderRadius: 3 }}>3</kbd>
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "uncertain"}
          style={{
            backgroundColor: currentDecision?.outcome === "uncertain" ? "var(--warning)" : "var(--warning-light)",
            color: currentDecision?.outcome === "uncertain" ? "var(--on-accent)" : "var(--warning)",
            borderColor: currentDecision?.outcome === "uncertain" ? "var(--warning)" : "var(--border-strong)",
            fontWeight: currentDecision?.outcome === "uncertain" ? 700 : "normal",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
          }}
          onClick={() => handleOutcomeClick("uncertain")}
          title={currentDecision?.outcome === "uncertain" ? "Click to clear uncertain status (Key: 4)" : "Clinically or textually undecidable (Key: 4)"}
        >
          <span>? Uncertain</span>
          <kbd style={{ fontSize: "var(--size-xs)", opacity: 0.75, background: "rgba(0,0,0,0.08)", padding: "1px 5px", borderRadius: 3 }}>4</kbd>
        </button>
      </div>

      {/* Reset Decision Button */}
      {currentDecision && (
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleClearDecision}
            style={{
              width: "100%",
              color: "var(--text-muted)",
              borderColor: "var(--border-color)",
              background: "var(--bg-primary)",
              padding: "6px 12px",
              fontWeight: 500,
            }}
            title="Reset decision for this proposal (back to open)"
          >
            ↩ Reset decision (open)
          </button>
        </div>
      )}

      {/* Changed Outcome Card with Direct Edit Shortcut */}
      {currentDecision?.outcome === "changed" && (
        <div
          style={{
            padding: 12,
            background: "var(--bg-primary)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--primary)", marginBottom: 4 }}>
            ✎ This proposal is replaced by an alternative annotation.
          </div>
          {currentDecision.replacement && (() => {
            const replSnap = draftAnnotations.find(
              (a) => a.annotation.annotation_id === currentDecision.replacement?.annotation_id
            );
            const replTermId = replSnap?.annotation.term_id ?? currentDecision.replacement.annotation_id;
            const replLabel = replSnap ? resolveTermLabel?.(replSnap.annotation.layer_id, replTermId) : null;
            return (
              <div style={{ fontSize: "0.85rem", color: "var(--text-main)", marginBottom: 8 }}>
                Replaced by:{" "}
                <strong>
                  <TermName termId={replTermId} label={replLabel} />
                </strong>
              </div>
            );
          })()}
          {currentDecision.replacement && onEditReplacement && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onEditReplacement(currentDecision.replacement!.annotation_id)}
            >
              ✎ Edit replacement annotation
            </button>
          )}
        </div>
      )}

      {/* Manual Replacement Selection (Fallback / Existing Annotations) */}
      {draftAnnotations.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {!showReplacementSelect ? (
            <button
              type="button"
              className="btn btn-link btn-sm"
              style={{ fontSize: "0.8rem", color: "var(--text-muted)", textDecoration: "underline", padding: 0 }}
              onClick={() => {
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
            </button>
          ) : (
            <div
              style={{
                padding: 12,
                background: "var(--bg-primary)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border-color)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label htmlFor="replacement-select" className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                  Select replacement annotation:
                </label>
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                  onClick={() => setShowReplacementSelect(false)}
                >
                  ✕ Close
                </button>
              </div>
              <select
                id="replacement-select"
                aria-label="Select replacement annotation"
                className="form-select"
                value={selectedReplacementId}
                onChange={(e) => setSelectedReplacementId(e.target.value)}
                style={{ marginBottom: 8 }}
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
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleConfirmChanged}
                disabled={!selectedReplacementId}
              >
                Confirm replacement
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reviewer Note */}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <input
          type="text"
          className="form-control"
          aria-label="Reviewer note"
          placeholder="Optional reviewer note / justification..."
          value={note}
          onChange={(e) => handleNoteChange(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNote(); } }}
          style={{ fontSize: "0.8rem" }}
        />
        {!currentDecision && note.trim() && (
          <div style={{ fontSize: "var(--size-xs)", color: "var(--text-muted)", marginTop: 4 }}>
            The note is saved together with the next decision.
          </div>
        )}
        {currentDecision && (currentDecision.note ?? "") !== note.trim() && (
          <div style={{ fontSize: "var(--size-xs)", color: "var(--text-muted)", marginTop: 4 }}>
            Unsaved note – saved automatically when you leave the field.
          </div>
        )}
      </div>
    </div>
  );
};
