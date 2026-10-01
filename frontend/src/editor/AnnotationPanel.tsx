import React, { useState } from "react";
import type { AnnotationSnapshot, SearchCandidate } from "../api/client";
import type { components } from "../api/generated";
import type { CodepointSegment } from "../spans/adapter";
import { SearchPanel } from "./SearchPanel";
import type { SearchManager, WorkspaceKey } from "./searchState";

export type Axes = components["schemas"]["Axes"];
export type EvidenceSnapshot = components["schemas"]["EvidenceSnapshot"];

export interface AnnotationPanelProps {
  annotation: AnnotationSnapshot | null;
  allEvidence: Record<string, EvidenceSnapshot>;
  workspaceKey: WorkspaceKey;
  searchManager: SearchManager;
  selectedEvidenceId: string | null;
  onSelectEvidence: (evidenceId: string) => void;
  onUpdateTerm: (hpoId: string) => void;
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
  const axes = ann.axes ?? {
    definition_name: "editor-axes/v1" as const,
    assertion: null,
    experiencer: null,
    temporality: null,
  };

  const evidenceRefs = ann.evidence_refs ?? [];
  const linkedEvidence = evidenceRefs
    .map((ref) => allEvidence[ref.evidence_id])
    .filter(Boolean);

  const handleSelectCandidate = (candidate: SearchCandidate) => {
    onUpdateTerm(candidate.hpo_id);
    setShowSearch(false);
  };

  return (
    <div className="detail-pane">
      {/* 1. Header with HPO Term */}
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
              HPO-Phänotyp
            </span>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "2px 0 4px" }}>
              {ann.hpo_id}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSearch(!showSearch)}
          >
            {showSearch ? "Suche schließen" : "Begriff ändern"}
          </button>
        </div>

        {showSearch && (
          <div style={{ marginTop: 12 }}>
            <SearchPanel
              searchManager={searchManager}
              annotationId={ann.annotation_id}
              workspaceKey={workspaceKey}
              currentHpoId={ann.hpo_id}
              onSelectCandidate={handleSelectCandidate}
            />
          </div>
        )}
      </div>

      {/* 2. Clinical Axes */}
      <div className="detail-section">
        <h3>Klinische Befund-Achsen</h3>

        {/* Assertion */}
        <div className="form-group">
          <label htmlFor="assertion-select" className="form-label">
            Vorhandensein (Assertion)
          </label>
          <select
            id="assertion-select"
            className="form-select"
            value={axes.assertion ?? ""}
            onChange={(e) => {
              const val = e.target.value as "present" | "absent" | "uncertain" | "";
              onUpdateAxes({ assertion: val === "" ? null : val });
            }}
          >
            <option value="">(Nicht angegeben / keine Auswahl)</option>
            <option value="present">Bestätigt vorhanden (present)</option>
            <option value="absent">Ausdrücklich ausgeschlossen (absent)</option>
            <option value="uncertain">Klinisch unsicher / Verdacht (uncertain)</option>
          </select>
        </div>

        {/* Experiencer */}
        <div className="form-group">
          <label htmlFor="experiencer-select" className="form-label">
            Betroffene Person (Experiencer)
          </label>
          <select
            id="experiencer-select"
            className="form-select"
            value={axes.experiencer ?? ""}
            onChange={(e) => {
              const val = e.target.value as "patient" | "other" | "";
              onUpdateAxes({ experiencer: val === "" ? null : val });
            }}
          >
            <option value="">(Nicht angegeben / Patient)</option>
            <option value="patient">Patient/in selbst</option>
            <option value="other">Angehörige/r / andere Person</option>
          </select>
        </div>

        {/* Temporality */}
        <div className="form-group">
          <label htmlFor="temporality-select" className="form-label">
            Zeitlicher Bezug (Temporality)
          </label>
          <select
            id="temporality-select"
            className="form-select"
            value={axes.temporality ?? ""}
            onChange={(e) => {
              const val = e.target.value as "current" | "historical" | "future" | "";
              onUpdateAxes({ temporality: val === "" ? null : val });
            }}
          >
            <option value="">(Nicht angegeben / Aktuell)</option>
            <option value="current">Aktueller Befund</option>
            <option value="historical">Historisch / Frühere Anamnese</option>
            <option value="future">Zukünftig / Risikofaktor</option>
          </select>
        </div>
      </div>

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
