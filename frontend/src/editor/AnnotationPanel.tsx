import React, { useState } from "react";
import type { AnnotationSnapshot, SearchCandidate } from "../api/client";
import type { components } from "../api/generated";
import type { CodepointSegment } from "../spans/adapter";
import { SearchPanel } from "./SearchPanel";
import { TermName } from "./TermName";
import type { SearchLanguageControl } from "./searchLanguages";
import type { SearchManager, WorkspaceKey } from "./searchState";
import { IconClose, IconTrash } from "../ui/icons";

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
  /** Open the ontology tree at this annotation's term. */
  onShowInTree?: () => void;
  onSelectEvidence: (evidenceId: string) => void;
  onUpdateTerm: (termId: string, searchId?: string) => void;
  onUpdateAxes: (axes: Partial<Axes>) => void;
  onAttachMention: (segments: CodepointSegment[]) => void;
  onDetachMention: (evidenceId: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSetIntent: (intent: "new_mention" | "extend_mention") => void;
  /** Document text, used to quote mention snippets. */
  documentText?: string;
  /** True while "+ Add Mention" mode waits for a text selection. */
  isAttachingMention?: boolean;
  /** Language selection of the term search, when the layer's ontology has translations. */
  searchLanguages?: SearchLanguageControl;
}

/** Quote the text covered by codepoint segments; discontinuous parts are joined with " … ". */
export function quoteSegments(text: string, segments: { start: number; end: number }[], maxLength = 160): string {
  const chars = Array.from(text);
  const quoted = segments
    .map((seg) => chars.slice(Math.max(0, seg.start), Math.min(chars.length, seg.end)).join(""))
    .join(" … ");
  return quoted.length > maxLength ? `${quoted.slice(0, maxLength - 1)}…` : quoted;
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
  onShowInTree,
  onSelectEvidence,
  onUpdateTerm,
  onUpdateAxes,
  onDetachMention,
  onDeleteAnnotation,
  onSetIntent,
  documentText = "",
  isAttachingMention = false,
  searchLanguages,
}) => {
  const [showSearch, setShowSearch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDetachId, setConfirmDetachId] = useState<string | null>(null);

  if (!annotation) {
    return (
      <div className="detail-pane">
        <div className="detail-section detail-empty">
          <h3>No annotation selected</h3>
          <p>
            Select an existing annotation or mention in the text,
            or highlight text to create a new annotation.
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
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.82rem",
          }}
        >
          <div>
            <span style={{ fontWeight: 600, color: "var(--primary)" }}>↳ Replacement for proposal: </span>
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
              View review target
            </button>
          )}
        </div>
      )}

      {/* 1. Header with Ontology Term */}
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
              Ontology Term
            </span>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "2px 0 4px" }}>
              <TermName termId={currentTerm} label={termLabel} />
            </h2>
            {onShowInTree && currentTerm && (
              <button
                type="button"
                className="btn btn-secondary btn-sm annotation-tree-button"
                onClick={onShowInTree}
                title="Show this term in the ontology tree: broader and narrower terms"
              >
                Show in tree
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowSearch(!showSearch)}
            >
              {showSearch ? "Close search" : "Change term"}
            </button>
            {onDeselect && (
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-icon"
                onClick={onDeselect}
                title="Clear selection"
                aria-label="Clear selection"
              >
                <IconClose />
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
              languages={searchLanguages}
            />
          </div>
        )}
      </div>

      {/* 2. Dynamic Context Axes (hidden if empty or undefined) */}
      {axesConfig && axesConfig.length > 0 && (
        <div className="detail-section" data-testid="axes-section">
          <h3>Context Axes</h3>
          {axesConfig.map((axis) => {
            const val = axesValues[axis.id] ?? "";
            const isRequired = !axis.allow_empty;
            const options = [
              ...(axis.allow_empty ? [{ value: "", label: "Not specified" }] : []),
              ...axis.options.map((option) => ({ value: option, label: ({
                present: "Present", absent: "Absent", uncertain: "Uncertain",
                patient: "Patient", other: "Other person", current: "Current",
                historical: "Historical", future: "Future",
              } as Record<string, string>)[option] ?? option })),
            ];
            const updateAxis = (value: string) => onUpdateAxes({
              ...axesValues,
              [axis.id]: value === "" ? null : value,
            });

            return (
              <fieldset key={axis.id} className="form-group axis-field">
                <legend className="form-label">
                  {axis.label} {isRequired && <span style={{ color: "var(--danger)" }}>* (Required)</span>}
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
                    {axis.allow_empty && <option value="">Not specified</option>}
                    {!axis.allow_empty && <option value="" disabled>Please select</option>}
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
          <h3>Mentions ({linkedEvidence.length})</h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onSetIntent("new_mention")}
            aria-pressed={isAttachingMention}
            title="Highlight text to add an additional mention for this term"
          >
            {isAttachingMention ? "Select text…" : "+ Add Mention"}
          </button>
        </div>

        {linkedEvidence.length === 0 ? (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px dashed var(--border-color)",
              borderRadius: "var(--radius)",
              fontSize: "0.85rem",
              color: "var(--text-muted)",
            }}
          >
            ℹ️ <strong>Spanless Annotation:</strong> This finding currently has no linked text mentions.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {linkedEvidence.map((ev, idx) => {
              const isSelected = ev.mention.evidence_id === selectedEvidenceId;
              const segments = ev.mention.segments ?? [];
              const ranges = segments.map((s) => `[${s.start}:${s.end}]`).join(", ");
              const snippet = quoteSegments(documentText, segments);

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
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Mention #{idx + 1}
                    </div>
                    <div
                      className="mention-snippet"
                      title={`Offsets: ${ranges}`}
                      style={{ fontSize: "0.85rem", fontWeight: 600 }}
                    >
                      {snippet ? `“${snippet}”` : `Offsets: ${ranges}`}
                    </div>
                  </div>
                  {confirmDetachId === ev.mention.evidence_id ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }} role="group" aria-label="Confirm mention removal">
                      <span style={{ fontSize: "0.75rem" }}>Remove?</span>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => { setConfirmDetachId(null); onDetachMention(ev.mention.evidence_id); }}
                      >
                        Yes, remove
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDetachId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        onSelectEvidence(ev.mention.evidence_id);
                        onSetIntent("extend_mention");
                      }}
                      title="Add another text segment to this mention"
                    >
                      + Segment
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setConfirmDetachId(ev.mention.evidence_id)}
                      title="Detach mention from this annotation"
                    >
                      Remove
                    </button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Delete Annotation */}
      <div className="detail-section" style={{ marginTop: "auto" }}>
        {confirmDelete ? (
          <div role="group" aria-label="Confirm deletion" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "0.85rem" }}>Delete this annotation and all its mentions?</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn btn-danger"
                style={{ flex: 1 }}
                onClick={() => { setConfirmDelete(false); onDeleteAnnotation(ann.annotation_id); }}
              >
                Yes, delete
              </button>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            style={{ width: "100%" }}
            onClick={() => setConfirmDelete(true)}
          >
            <IconTrash />
            Delete Annotation
          </button>
        )}
      </div>
    </div>
  );
};
