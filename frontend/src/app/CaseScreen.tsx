import React, { useMemo, useState } from "react";
import {
  api,
  type AnnotationSnapshot,
  type Draft,
} from "../api/client";
import type { components } from "../api/generated";
import { AnnotationPanel, type Axes, type EvidenceSnapshot } from "../editor/AnnotationPanel";
import { SearchManager } from "../editor/searchState";
import { TextPane } from "../editor/TextPane";
import type { MentionDisplay, SelectionPayload } from "../spans/adapter";

export type WorkspaceView = components["schemas"]["WorkspaceView"];

export interface CaseScreenProps {
  view: WorkspaceView;
  workspaceId: string;
  onClose: () => void;
}

export const CaseScreen: React.FC<CaseScreenProps> = ({
  view,
  workspaceId,
  onClose,
}) => {
  const [draft, setDraft] = useState<Draft>(view.draft);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectionIntent, setSelectionIntent] = useState<"new_mention" | "extend_mention">("new_mention");
  const [statusMessage, setStatusMessage] = useState<string>("Gespeichert");
  const [showSpanlessModal, setShowSpanlessModal] = useState<boolean>(false);
  const [spanlessHpoId, setSpanlessHpoId] = useState<string>("");

  const searchManager = useMemo(() => new SearchManager(api), []);

  const allEvidenceMap = useMemo(() => {
    const map: Record<string, EvidenceSnapshot> = {};
    for (const ev of draft.evidence ?? []) {
      map[ev.mention.evidence_id] = ev;
    }
    return map;
  }, [draft.evidence]);

  const mentionsDisplay: MentionDisplay[] = useMemo(() => {
    return (draft.evidence ?? []).map((ev) => ({
      evidence_id: ev.mention.evidence_id,
      segments: ev.mention.segments.map((s) => ({ start: s.start, end: s.end })),
    }));
  }, [draft.evidence]);

  const selectedAnnotation: AnnotationSnapshot | null = useMemo(() => {
    if (!selectedAnnotationId) return null;
    return (
      (draft.annotations ?? []).find(
        (a) => a.annotation.annotation_id === selectedAnnotationId
      ) ?? null
    );
  }, [draft.annotations, selectedAnnotationId]);

  // Helper for applying mutations to workspace draft
  const mutate = async (payload: Record<string, unknown>) => {
    setStatusMessage("Speichert...");
    const mutationId = `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const updatedDraft = await api.applyCommand(workspaceId, {
        mutation_id: mutationId,
        expected_revision: draft.revision,
        payload,
      });
      setDraft(updatedDraft);
      setStatusMessage("Gespeichert");
      return updatedDraft;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Fehler: ${msg}`);
      throw err;
    }
  };

  // Text selection handler
  const handleSelection = async (payload: SelectionPayload) => {
    if (!payload.segments || payload.segments.length === 0) return;

    if (payload.intent === "extend_mention" && selectedEvidenceId) {
      // Append segment to currently selected evidence
      const existingEv = allEvidenceMap[selectedEvidenceId];
      if (!existingEv) return;

      const existingSegments = existingEv.mention.segments.map((s) => ({
        start: s.start,
        end: s.end,
      }));
      const newSegments = [...existingSegments, ...payload.segments].sort(
        (a, b) => a.start - b.start
      );

      await mutate({
        command: "edit_mention",
        evidence_id: selectedEvidenceId,
        annotation_id: selectedAnnotationId,
        segments: newSegments,
      });
      setSelectionIntent("new_mention");
    } else {
      // New mention
      const evidenceId = `ev-${Date.now()}`;
      if (selectedAnnotationId) {
        // Attach to currently selected annotation
        await mutate({
          command: "attach_mention",
          annotation_id: selectedAnnotationId,
          evidence_id: evidenceId,
          segments: payload.segments,
        });
        setSelectedEvidenceId(evidenceId);
      } else {
        // Create brand new annotation with this mention
        const newAnnId = `ann-${Date.now()}`;
        // Default to Phenotypic abnormality root if no candidate selected yet
        const defaultHpoId = "HP:0000118";
        await mutate({
          command: "create_annotation",
          annotation_id: newAnnId,
          hpo_id: defaultHpoId,
          evidence_id: evidenceId,
          segments: payload.segments,
          axes: {
            definition_name: "editor-axes/v1",
            assertion: null,
            experiencer: null,
            temporality: null,
          },
        });
        setSelectedAnnotationId(newAnnId);
        setSelectedEvidenceId(evidenceId);
      }
    }
  };

  // Pick existing mention from text
  const handlePickMention = (evidenceId: string) => {
    setSelectedEvidenceId(evidenceId);
    // Find which annotation owns this evidence
    const owner = (draft.annotations ?? []).find((a) =>
      (a.annotation.evidence_refs ?? []).some((r) => r.evidence_id === evidenceId)
    );
    if (owner) {
      setSelectedAnnotationId(owner.annotation.annotation_id);
    }
  };

  // Add spanless annotation
  const handleCreateSpanless = async () => {
    if (!spanlessHpoId.trim()) return;
    const newAnnId = `ann-${Date.now()}`;
    await mutate({
      command: "create_annotation",
      annotation_id: newAnnId,
      hpo_id: spanlessHpoId.trim(),
      segments: [],
      axes: {
        definition_name: "editor-axes/v1",
        assertion: null,
        experiencer: null,
        temporality: null,
      },
    });
    setSelectedAnnotationId(newAnnId);
    setSelectedEvidenceId(null);
    setShowSpanlessModal(false);
    setSpanlessHpoId("");
  };

  // Update term
  const handleUpdateTerm = async (hpoId: string) => {
    if (!selectedAnnotationId) return;
    await mutate({
      command: "set_term",
      annotation_id: selectedAnnotationId,
      hpo_id: hpoId,
    });
  };

  // Update axes
  const handleUpdateAxes = async (axesUpdate: Partial<Axes>) => {
    if (!selectedAnnotationId || !selectedAnnotation) return;
    const currentAxes = selectedAnnotation.annotation.axes ?? {
      definition_name: "editor-axes/v1",
      assertion: null,
      experiencer: null,
      temporality: null,
    };
    const newAxes: Axes = {
      ...currentAxes,
      ...axesUpdate,
      definition_name: "editor-axes/v1",
    };
    await mutate({
      command: "set_axes",
      annotation_id: selectedAnnotationId,
      axes: newAxes,
    });
  };

  // Detach mention
  const handleDetachMention = async (evidenceId: string) => {
    if (!selectedAnnotationId) return;
    await mutate({
      command: "detach_mention",
      annotation_id: selectedAnnotationId,
      evidence_id: evidenceId,
    });
    if (selectedEvidenceId === evidenceId) {
      setSelectedEvidenceId(null);
    }
  };

  // Delete annotation
  const handleDeleteAnnotation = async (annotationId: string) => {
    await mutate({
      command: "delete_draft_annotation",
      annotation_id: annotationId,
    });
    if (selectedAnnotationId === annotationId) {
      setSelectedAnnotationId(null);
      setSelectedEvidenceId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            ← Zurück
          </button>
          <span>Fall: {view.document.document_id}</span>
          <span
            className={`badge ${
              view.key.mode === "review" ? "badge-review" : "badge-independent"
            }`}
          >
            {view.key.mode === "review" ? "Review-Modus" : "Unabhängige Annotation"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className={`status-badge ${
              statusMessage === "Gespeichert"
                ? "status-saved"
                : statusMessage.startsWith("Fehler")
                ? "status-error"
                : "status-saving"
            }`}
          >
            ● {statusMessage} (Rev {draft.revision})
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSpanlessModal(true)}
          >
            + Spanlose Annotation
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="app-layout">
        {/* Left: Annotations List */}
        <aside className="sidebar">
          <div className="sidebar-header" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Annotationen ({(draft.annotations ?? []).length})</span>
          </div>
          <ul className="doc-list">
            {(draft.annotations ?? []).map((annSnap) => {
              const isSelected =
                annSnap.annotation.annotation_id === selectedAnnotationId;
              const evCount = annSnap.annotation.evidence_refs?.length ?? 0;
              const assertion = annSnap.annotation.axes?.assertion;

              return (
                <li
                  key={annSnap.annotation.annotation_id}
                  className={`doc-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedAnnotationId(annSnap.annotation.annotation_id);
                    const firstEv = annSnap.annotation.evidence_refs?.[0]?.evidence_id;
                    setSelectedEvidenceId(firstEv ?? null);
                  }}
                >
                  <div className="doc-id">{annSnap.annotation.hpo_id}</div>
                  <div className="doc-meta">
                    {evCount === 0 ? "Spanlos" : `${evCount} Belegstelle(n)`}
                    {assertion && ` • ${assertion}`}
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Center: Text View */}
        <TextPane
          text={view.document.text}
          mentions={mentionsDisplay}
          selectedEvidenceId={selectedEvidenceId}
          selectionIntent={selectionIntent}
          onSelection={handleSelection}
          onPick={handlePickMention}
          onChangeIntent={setSelectionIntent}
        />

        {/* Right: Annotation & Search Panel */}
        <AnnotationPanel
          annotation={selectedAnnotation}
          allEvidence={allEvidenceMap}
          workspaceKey={view.key}
          searchManager={searchManager}
          selectedEvidenceId={selectedEvidenceId}
          onSelectEvidence={(evId) => setSelectedEvidenceId(evId)}
          onUpdateTerm={handleUpdateTerm}
          onUpdateAxes={handleUpdateAxes}
          onAttachMention={(segments) =>
            handleSelection({ segments, intent: "new_mention" })
          }
          onDetachMention={handleDetachMention}
          onDeleteAnnotation={handleDeleteAnnotation}
          onSetIntent={setSelectionIntent}
        />
      </div>

      {/* Modal for adding spanless annotation */}
      {showSpanlessModal && (
        <div className="modal-overlay" onClick={() => setShowSpanlessModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 12 }}>
              Spanlose Annotation anlegen
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 16 }}>
              Erfassen Sie einen klinischen HPO-Befund, der im Fall dokumentiert oder
              ausgeschlossen ist, aber keine direkte Textstelle markiert.
            </p>
            <div className="form-group">
              <label htmlFor="spanless-hpo-id" className="form-label">
                HPO-ID (z. B. HP:0001252)
              </label>
              <input
                id="spanless-hpo-id"
                type="text"
                className="form-control"
                placeholder="HP:..."
                value={spanlessHpoId}
                onChange={(e) => setSpanlessHpoId(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowSpanlessModal(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateSpanless}
                disabled={!spanlessHpoId.trim()}
              >
                Annotation anlegen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
