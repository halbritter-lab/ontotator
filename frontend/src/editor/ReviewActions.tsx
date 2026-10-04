import React, { useState } from "react";
import type { AnnotationSnapshot } from "../api/client";
import type { components } from "../api/generated";
import { TermName } from "./TermName";

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
  provenance: components["schemas"]["Provenance"];
  evidence_count: number;
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
  evidence = [],
  documentText = "",
}) => {
  const [selectedReplacementId, setSelectedReplacementId] = useState<string>(currentDecision?.replacement?.annotation_id ?? "");
  const [note, setNote] = useState<string>(currentDecision?.note ?? "");
  const [showReplacementSelect, setShowReplacementSelect] = useState<boolean>(
    currentDecision?.outcome === "changed"
  );

  const handleOutcomeClick = (outcome: ReviewDecisionOutcome) => {
    if (currentDecision?.outcome === outcome) {
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
          Review-Entscheidung für diesen Vorschlag
        </h4>
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
          <span className="badge" style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}>
            Ausstehend
          </span>
        )}
      </div>

      <div className="detail-section" aria-label="Vorschlagsdetails">
        <strong><TermName termId={target.term_id ?? target.annotation_id} label={termLabel} /></strong>
        <dl>
          {(() => {
            const rawAxes = target.axes_values ?? (target.axes && "values" in target.axes ? (target.axes as any).values : target.axes) ?? {};
            const entries = Object.entries(rawAxes);
            if (entries.length === 0) {
              return <dd style={{ marginLeft: 0, color: "var(--text-muted)" }}>Keine Achsen definiert</dd>;
            }
            return entries.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt style={{ textTransform: "capitalize" }}>{k}</dt>
                <dd>{typeof v === "string" ? v : (v !== null && v !== undefined ? String(v) : "Nicht angegeben")}</dd>
              </React.Fragment>
            ));
          })()}
        </dl>
        {evidence.length ? evidence.map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
          {ev.mention.segments.map(seg => Array.from(documentText).slice(seg.start, seg.end).join("")).join(" … ")}
        </p>) : <p>Keine Belegstelle (spanlos)</p>}
        <details className="technical-details">
          <summary>Technische Angaben</summary>
          <p>Version: {target.version}</p>
        </details>
      </div>
      {/* Origin Info */}
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>
        Quelle: <strong>{target.provenance.actor.kind}</strong> ({target.provenance.actor.actor_id}) •
        Methode: {target.provenance.method}
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
          ⚠️ Veralteter Begriff kann nicht bestätigt werden. Bitte verwerfen, als unsicher markieren oder durch gültigen Term ersetzen.
        </div>
      )}

      {target.is_unknown && <p role="alert">Unbekannter Begriff kann nicht bestätigt werden.</p>}
      {/* 4 Action Buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "confirmed"}
          style={{
            backgroundColor: currentDecision?.outcome === "confirmed" ? "var(--success)" : "var(--success-light)",
            color: currentDecision?.outcome === "confirmed" ? "#ffffff" : "var(--success)",
            borderColor: currentDecision?.outcome === "confirmed" ? "var(--success)" : "#86efac",
            fontWeight: currentDecision?.outcome === "confirmed" ? 700 : "normal",
            boxShadow: currentDecision?.outcome === "confirmed" ? "0 0 0 2px rgba(34, 197, 94, 0.4)" : undefined,
          }}
          onClick={() => handleOutcomeClick("confirmed")}
          disabled={target.is_obsolete || target.is_unknown}
          title={currentDecision?.outcome === "confirmed" ? "Klicken, um Bestätigung aufzuheben (offen)" : "Vorschlag unverändert annehmen"}
        >
          ✓ Bestätigen
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "rejected"}
          style={{
            backgroundColor: currentDecision?.outcome === "rejected" ? "var(--danger)" : "var(--danger-light)",
            color: currentDecision?.outcome === "rejected" ? "#ffffff" : "var(--danger)",
            borderColor: currentDecision?.outcome === "rejected" ? "var(--danger)" : "#fca5a5",
            fontWeight: currentDecision?.outcome === "rejected" ? 700 : "normal",
            boxShadow: currentDecision?.outcome === "rejected" ? "0 0 0 2px rgba(239, 68, 68, 0.4)" : undefined,
          }}
          onClick={() => handleOutcomeClick("rejected")}
          title={currentDecision?.outcome === "rejected" ? "Klicken, um Ablehnung aufzuheben (offen)" : "Vorschlag ablehnen"}
        >
          ✕ Verwerfen
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "changed"}
          style={{
            backgroundColor: currentDecision?.outcome === "changed" ? "var(--primary)" : "var(--primary-light)",
            color: currentDecision?.outcome === "changed" ? "#ffffff" : "var(--primary)",
            borderColor: currentDecision?.outcome === "changed" ? "var(--primary)" : "#93c5fd",
            fontWeight: currentDecision?.outcome === "changed" ? 700 : "normal",
            boxShadow: currentDecision?.outcome === "changed" ? "0 0 0 2px rgba(59, 130, 246, 0.4)" : undefined,
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
              ? "Gegenfassung im Entwurf weiter bearbeiten"
              : "Vorschlag übernehmen und im Entwurf bearbeiten"
          }
        >
          ✎ Ändern & Bearbeiten
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={currentDecision?.outcome === "uncertain"}
          style={{
            backgroundColor: currentDecision?.outcome === "uncertain" ? "var(--warning)" : "var(--warning-light)",
            color: currentDecision?.outcome === "uncertain" ? "#ffffff" : "var(--warning)",
            borderColor: currentDecision?.outcome === "uncertain" ? "var(--warning)" : "#fde68a",
            fontWeight: currentDecision?.outcome === "uncertain" ? 700 : "normal",
            boxShadow: currentDecision?.outcome === "uncertain" ? "0 0 0 2px rgba(245, 158, 11, 0.4)" : undefined,
          }}
          onClick={() => handleOutcomeClick("uncertain")}
          title={currentDecision?.outcome === "uncertain" ? "Klicken, um Unsicher-Status aufzuheben (offen)" : "Klinisch oder textuell unentscheidbar (kein Goldstandard)"}
        >
          ? Unsicher (Kein Gold)
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
            title="Entscheidung für diesen Vorschlag aufheben (wieder auf offen setzen)"
          >
            ↩ Auswahl aufheben (offen)
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
            border: "1px solid #93c5fd",
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--primary)", marginBottom: 4 }}>
            ✎ Dieser Vorschlag wird durch eine Gegenfassung ersetzt.
          </div>
          {currentDecision.replacement && (
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 8 }}>
              Zugeordnete Annotation:{" "}
              <code>{currentDecision.replacement.annotation_id.slice(0, 14)}</code>
            </div>
          )}
          {currentDecision.replacement && onEditReplacement && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onEditReplacement(currentDecision.replacement!.annotation_id)}
            >
              ✎ Gegenfassung weiter bearbeiten
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
              Gegenfassung aus Entwurf zuordnen...
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
                  Ersatzfassung (Gegenfassung) auswählen:
                </label>
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                  onClick={() => setShowReplacementSelect(false)}
                >
                  ✕ Schließen
                </button>
              </div>
              <select
                id="replacement-select"
                aria-label="Ersatzfassung (Gegenfassung) auswählen"
                className="form-select"
                value={selectedReplacementId}
                onChange={(e) => setSelectedReplacementId(e.target.value)}
                style={{ marginBottom: 8 }}
              >
                <option value="">(Wählen Sie eine Annotation aus dem Entwurf)</option>
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
                Änderung bestätigen
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
          placeholder="Optionale Begründung / Notiz zum Review..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ fontSize: "0.8rem" }}
        />
      </div>
    </div>
  );
};
