import React, { useState } from "react";
import type { AnnotationSnapshot, SearchCandidate } from "../api/client";
import type { components } from "../api/generated";
import type { CodepointSegment } from "../spans/adapter";
import { SearchPanel } from "./SearchPanel";
import { TermName } from "./TermName";
import type { SearchManager, WorkspaceKey } from "./searchState";

export type AxesValues = Record<string, string | null>;
export type Axes = AxesValues;
export type EvidenceSnapshot = components["schemas"]["EvidenceSnapshot"];
export type AxisDefinition = components["schemas"]["AxisDefinition"];

export interface AnnotationPanelProps {
  annotation: AnnotationSnapshot | null;
  allEvidence: Record<string, EvidenceSnapshot>;
  workspaceKey: WorkspaceKey;
  searchManager: SearchManager;
  selectedEvidenceId: string | null;
  layerId?: string;
  axesConfig?: AxisDefinition[];
  axesDefinition?: string;
  termLabel?: string | null;
  linkedTarget?: {
    targetId: string;
    termId: string;
    termLabel?: string | null;
  } | null;
  onNavigateTarget?: () => void;
  onDeselect?: () => void;
  onSelectEvidence: (evidenceId: string) => void;
  onUpdateTerm: (termId: string, searchId?: string) => void;
  onUpdateAxes: (axes: Partial<Axes>) => void;
  onAttachMention: (segments: CodepointSegment[]) => void;
  onDetachMention: (evidenceId: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSetIntent: (intent: "new_mention" | "extend_mention") => void;
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  annotation,
  allEvidence,
  workspaceKey,
  searchManager,
  selectedEvidenceId,
  layerId,
  axesConfig,
  termLabel,
  linkedTarget,
  onNavigateTarget,
  onDeselect,
  onSelectEvidence,
  onUpdateTerm,
  onUpdateAxes,
  onDetachMention,
  onDeleteAnnotation,
  onSetIntent,
}) => {
  const [showSearch, setShowSearch] = useState(false);

  if (!annotation) {
    return (
      <div className="detail-pane">
        <div className="detail-section" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>📝</div>
          <h3 style={{ marginBottom: 6 }}>Keine Annotation ausgewählt</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Wählen Sie eine vorhandene Annotation oder Markierung im Text aus,
            oder markieren Sie eine Textstelle, um eine neue Annotation anzulegen.
          </p>
        </div>
      </div>
    );
  }

  const ann = annotation.annotation;
  const currentTerm = ann.term_id;
  const axesValues = ann.axes_values ?? (ann as any).axes?.values ?? {};

  const evidenceRefs = ann.evidence_refs ?? [];
  const linkedEvidence = evidenceRefs
    .map((ref) => allEvidence[ref.evidence_id])
    .filter(Boolean);

  const handleSelectCandidate = (candidate: SearchCandidate, searchId?: string) => {
    onUpdateTerm(candidate.term_id, searchId);
    setShowSearch(false);
  };


  return (
    <div className="detail-pane">
      {/* Target Proposal Counter-Annotation Banner */}
      {linkedTarget && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--primary-light)",
            borderBottom: "1px solid #93c5fd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.82rem",
          }}
        >
          <div>
            <span style={{ fontWeight: 600, color: "var(--primary)" }}>↳ Gegenfassung für Vorschlag: </span>
            <span style={{ color: "var(--text-main)", fontWeight: 500 }}>
              {linkedTarget.termLabel ? `${linkedTarget.termLabel} (${linkedTarget.termId})` : linkedTarget.termId}
            </span>
          </div>
          {onNavigateTarget && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ padding: "2px 8px", fontSize: "0.75rem", background: "var(--bg-primary)" }}
              onClick={onNavigateTarget}
            >
              Zum Review-Ziel
            </button>
          )}
        </div>
      )}

      {/* 1. Header with Ontology Term */}
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
              Ontologie-Term
            </span>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "2px 0 4px" }}>
              <TermName termId={currentTerm} label={termLabel} />
            </h2>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowSearch(!showSearch)}
            >
              {showSearch ? "Suche schließen" : "Begriff ändern"}
            </button>
            {onDeselect && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onDeselect}
                title="Auswahl aufheben"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {showSearch && (
          <div style={{ marginTop: 12 }}>
            <SearchPanel
              searchManager={searchManager}
              annotationId={ann.annotation_id}
              layerId={layerId ?? ann.layer_id}
              workspaceKey={workspaceKey}
              currentTermId={currentTerm}
              onSelectCandidate={handleSelectCandidate}
            />
          </div>
        )}
      </div>

      {/* 2. Dynamic Context Axes (hidden if empty or undefined) */}
      {axesConfig && axesConfig.length > 0 && (
        <div className="detail-section" data-testid="axes-section">
          <h3>Kontext-Achsen</h3>
          {axesConfig.map((axis) => {
            const val = axesValues[axis.id] ?? "";
            const isRequired = !axis.allow_empty;
            const options = [
              ...(axis.allow_empty ? [{ value: "", label: "Nicht angegeben" }] : []),
              ...axis.options.map((option) => ({ value: option, label: ({
                present: "Vorhanden", absent: "Nicht vorhanden", uncertain: "Unsicher",
                patient: "Patient:in", other: "Andere Person", current: "Aktuell",
                historical: "Früher", future: "Zukünftig",
              } as Record<string, string>)[option] ?? option })),
            ];
            const updateAxis = (value: string) => onUpdateAxes({
              ...axesValues,
              [axis.id]: value === "" ? null : value,
            });

            return (
              <fieldset key={axis.id} className="form-group axis-field">
                <legend className="form-label">
                  {axis.label} {isRequired && <span style={{ color: "var(--danger)" }}>* (Pflichtfeld)</span>}
                </legend>
                {options.length <= 4 ? (
                  <div className="axis-options">
                    {options.map((option) => (
                      <label key={option.value} className="axis-option">
                        <input type="radio" name={`axis-${ann.annotation_id}-${axis.id}`}
                          value={option.value} checked={val === option.value}
                          onChange={() => updateAxis(option.value)} />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <select id={`axis-select-${axis.id}`} aria-label={axis.label}
                    className="form-select" value={val} onChange={(e) => updateAxis(e.target.value)}>
                    {axis.allow_empty && <option value="">Nicht angegeben</option>}
                    {!axis.allow_empty && <option value="" disabled>Bitte auswählen</option>}
                    {axis.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                )}
              </fieldset>
            );
          })}
        </div>
      )}

      {/* 3. Evidence Mentions */}
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3>Belegstellen ({linkedEvidence.length})</h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onSetIntent("new_mention")}
            title="Markieren Sie Text für eine weitere Erwähnung dieses Begriffs"
          >
            + Weitere Belegstelle
          </button>
        </div>

        {linkedEvidence.length === 0 ? (
          <div
            style={{
              padding: "10px 12px",
              background: "#f8fafc",
              border: "1px dashed var(--border-color)",
              borderRadius: "var(--radius)",
              fontSize: "0.85rem",
              color: "var(--text-muted)",
            }}
          >
            ℹ️ <strong>Spanlose Annotation:</strong> Dieser Befund hat aktuell keine verknüpften Textbelegstellen.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {linkedEvidence.map((ev, idx) => {
              const isSelected = ev.mention.evidence_id === selectedEvidenceId;
              const segments = ev.mention.segments ?? [];
              const ranges = segments.map((s) => `[${s.start}:${s.end}]`).join(", ");

              return (
                <div
                  key={ev.mention.evidence_id}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius)",
                    background: isSelected ? "var(--primary-light)" : "var(--bg-surface)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{ cursor: "pointer", flex: 1 }}
                    onClick={() => onSelectEvidence(ev.mention.evidence_id)}
                  >
                    <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                      Belegstelle #{idx + 1}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      Offsets: {ranges}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        onSelectEvidence(ev.mention.evidence_id);
                        onSetIntent("extend_mention");
                      }}
                      title="Ausgewählte Belegstelle um weiteres Segment im Text ergänzen"
                    >
                      + Segment
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onDetachMention(ev.mention.evidence_id)}
                      title="Belegstelle von dieser Annotation trennen"
                    >
                      Entfernen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Delete Annotation */}
      <div className="detail-section" style={{ marginTop: "auto" }}>
        <button
          type="button"
          className="btn btn-danger"
          style={{ width: "100%" }}
          onClick={() => onDeleteAnnotation(ann.annotation_id)}
        >
          🗑️ Annotation löschen
        </button>
      </div>
    </div>
  );
};
