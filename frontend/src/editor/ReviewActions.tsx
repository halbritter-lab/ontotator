import React, { useState } from "react";
import type { AnnotationSnapshot } from "../api/client";
import type { components } from "../api/generated";

export type ReviewDecision = components["schemas"]["ReviewDecision"];
export type ReviewDecisionOutcome = "confirmed" | "rejected" | "changed" | "uncertain";

export interface TargetProposal {
  annotation_id: string;
  version: string;
  term_id?: string;
  hpo_id: string;
  axes?: components["schemas"]["Axes"] | null;
  provenance: components["schemas"]["Provenance"];
  evidence_count: number;
  is_obsolete?: boolean;
  is_unknown?: boolean;
}

export interface DecisionPayload {
  outcome: ReviewDecisionOutcome;
  replacement?: {
    annotation_id: string;
    version: string;
  };
  note?: string;
}

export interface ReviewActionsProps {
  target: TargetProposal;
  currentDecision: ReviewDecision | null;
  draftAnnotations: AnnotationSnapshot[];
  evidence?: components["schemas"]["EvidenceSnapshot"][];
  documentText?: string;
  onDecide: (payload: DecisionPayload) => void;
}

export const ReviewActions: React.FC<ReviewActionsProps> = ({
  target,
  currentDecision,
  draftAnnotations,
  onDecide,
  evidence = [],
  documentText = "",
}) => {
  const [selectedReplacementId, setSelectedReplacementId] = useState<string>(currentDecision?.replacement?.annotation_id ?? "");
  const [note, setNote] = useState<string>(currentDecision?.note ?? "");
  const [showReplacementSelect, setShowReplacementSelect] = useState<boolean>(
    currentDecision?.outcome === "changed"
  );

  const handleOutcomeClick = (outcome: ReviewDecisionOutcome) => {
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
        <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-muted)" }}>
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
        <strong>{target.term_id ?? target.hpo_id}</strong>
        <dl>
          {target.axes?.values && Object.keys(target.axes.values).length > 0 ? (
            Object.entries(target.axes.values).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt style={{ textTransform: "capitalize" }}>{k}</dt>
                <dd>{v ?? "Nicht angegeben"}</dd>
              </React.Fragment>
            ))
          ) : (
            <dd style={{ marginLeft: 0, color: "var(--text-muted)" }}>Keine Achsen definiert</dd>
          )}
        </dl>
        <p>Version: {target.version}</p>
        {evidence.length ? evidence.map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
          {ev.mention.segments.map(seg => Array.from(documentText).slice(seg.start, seg.end).join("")).join(" … ")}
        </p>) : <p>Keine Belegstelle (spanlos)</p>}
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
          style={{
            backgroundColor: "var(--success-light)",
            color: "var(--success)",
            borderColor: "#86efac",
          }}
          onClick={() => handleOutcomeClick("confirmed")}
          disabled={target.is_obsolete || target.is_unknown}
          title="Vorschlag unverändert annehmen"
        >
          ✓ Bestätigen
        </button>

        <button
          type="button"
          className="btn"
          style={{
            backgroundColor: "var(--danger-light)",
            color: "var(--danger)",
            borderColor: "#fca5a5",
          }}
          onClick={() => handleOutcomeClick("rejected")}
          title="Vorschlag ablehnen"
        >
          ✕ Verwerfen
        </button>

        <button
          type="button"
          className="btn"
          style={{
            backgroundColor: "var(--primary-light)",
            color: "var(--primary)",
            borderColor: "#93c5fd",
          }}
          onClick={() => handleOutcomeClick("changed")}
          title="Vorschlag durch korrigierte Gegenfassung ersetzen"
        >
          ✎ Ändern (Gegenfassung)
        </button>

        <button
          type="button"
          className="btn"
          style={{
            backgroundColor: "var(--warning-light)",
            color: "var(--warning)",
            borderColor: "#fde68a",
          }}
          onClick={() => handleOutcomeClick("uncertain")}
          title="Klinisch oder textuell unentscheidbar (kein Goldstandard)"
        >
          ? Unsicher (Kein Gold)
        </button>
      </div>

      {/* Replacement Selection when outcome === "changed" */}
      {showReplacementSelect && (
        <div
          style={{
            padding: 12,
            background: "var(--bg-primary)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-color)",
            marginBottom: 12,
          }}
        >
          <label htmlFor="replacement-select" className="form-label" style={{ fontWeight: 600 }}>
            Ersatzfassung (Gegenfassung) auswählen:
          </label>
          <select
            id="replacement-select"
            className="form-select"
            value={selectedReplacementId}
            onChange={(e) => setSelectedReplacementId(e.target.value)}
            style={{ marginBottom: 8 }}
          >
            <option value="">(Wählen Sie eine Annotation aus dem Entwurf)</option>
            {draftAnnotations.map((snap) => {
              const term = snap.annotation.term_id ?? snap.annotation.hpo_id;
              return (
                <option key={snap.annotation.annotation_id} value={snap.annotation.annotation_id}>
                  {term} (ID: {snap.annotation.annotation_id.slice(0, 10)})
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
