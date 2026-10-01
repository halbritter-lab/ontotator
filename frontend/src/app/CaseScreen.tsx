import React, { useMemo, useRef, useState } from "react";
import {
  api,
  type AnnotationSnapshot,
  type Draft,
  type Submission,
} from "../api/client";
import type { components } from "../api/generated";
import { AnnotationPanel, type Axes, type EvidenceSnapshot } from "../editor/AnnotationPanel";
import { createMutationQueue, type QueueState } from "../editor/autosave";
import {
  ReviewActions,
  type DecisionPayload,
  type ReviewDecision,
  type TargetProposal,
} from "../editor/ReviewActions";
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
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    view.targets?.targets?.[0]?.annotation_id ?? null
  );
  const [selectionIntent, setSelectionIntent] = useState<"new_mention" | "extend_mention">("new_mention");
  const [queueState, setQueueState] = useState<QueueState>("saved");
  const [statusText, setStatusText] = useState<string>("Gespeichert");
  const [documentChecked, setDocumentChecked] = useState<boolean>(draft.document_checked);

  // Modals
  const [showSpanlessModal, setShowSpanlessModal] = useState<boolean>(false);
  const [spanlessHpoId, setSpanlessHpoId] = useState<string>("");
  const [completedSubmission, setCompletedSubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const searchManager = useMemo(() => new SearchManager(api), []);

  // Dedicated mutation queue for this workspace
  const queueRef = useRef(
    createMutationQueue({
      initialRevision: view.draft.revision,
      onState: (state) => {
        setQueueState(state);
        if (state === "saved") setStatusText("Gespeichert");
        else if (state === "saving") setStatusText("Speichert...");
        else if (state === "conflict") setStatusText("Revisionskonflikt");
        else if (state === "error") setStatusText("Speicherfehler");
      },
    })
  );

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

  // Review mode targets
  const reviewTargets: TargetProposal[] = useMemo(() => {
    if (view.key.mode !== "review" || !view.targets) return [];
    return (view.targets.targets ?? []).map((targetRef) => {
      // Find snapshot in available_inputs
      const snap = (view.available_inputs ?? []).find(
        (i) => i.annotation.annotation_id === targetRef.annotation_id && i.version === targetRef.version
      );
      return {
        annotation_id: targetRef.annotation_id,
        version: targetRef.version,
        hpo_id: snap?.annotation.hpo_id ?? targetRef.annotation_id,
        axes: snap?.annotation.axes ?? null,
        provenance: snap?.annotation.provenance ?? {
          actor: { actor_id: "unknown", kind: "tool" },
          method: "automated",
        },
        evidence_count: snap?.annotation.evidence_refs?.length ?? 0,
        is_obsolete: false,
      };
    });
  }, [view.key.mode, view.targets, view.available_inputs]);

  const decisionsMap = useMemo(() => {
    const map: Record<string, ReviewDecision> = {};
    for (const d of draft.decisions ?? []) {
      map[d.target.annotation_id] = d;
    }
    return map;
  }, [draft.decisions]);

  const selectedTarget = useMemo(() => {
    if (!selectedTargetId) return null;
    return reviewTargets.find((t) => t.annotation_id === selectedTargetId) ?? null;
  }, [reviewTargets, selectedTargetId]);

  // Execute mutation through the queue
  const enqueueMutation = async (payload: Record<string, unknown>): Promise<Draft> => {
    return queueRef.current.enqueue(async (expectedRevision) => {
      const mutationId = `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const updatedDraft = await api.applyCommand(workspaceId, {
        mutation_id: mutationId,
        expected_revision: expectedRevision,
        payload,
      });
      setDraft(updatedDraft);
      return updatedDraft;
    });
  };

  // Text selection handler
  const handleSelection = async (payload: SelectionPayload) => {
    if (!payload.segments || payload.segments.length === 0) return;

    if (payload.intent === "extend_mention" && selectedEvidenceId) {
      const existingEv = allEvidenceMap[selectedEvidenceId];
      if (!existingEv) return;

      const existingSegments = existingEv.mention.segments.map((s) => ({
        start: s.start,
        end: s.end,
      }));
      const newSegments = [...existingSegments, ...payload.segments].sort(
        (a, b) => a.start - b.start
      );

      await enqueueMutation({
        command: "edit_mention",
        evidence_id: selectedEvidenceId,
        annotation_id: selectedAnnotationId,
        segments: newSegments,
      });
      setSelectionIntent("new_mention");
    } else {
      const evidenceId = `ev-${Date.now()}`;
      if (selectedAnnotationId) {
        await enqueueMutation({
          command: "attach_mention",
          annotation_id: selectedAnnotationId,
          evidence_id: evidenceId,
          segments: payload.segments,
        });
        setSelectedEvidenceId(evidenceId);
      } else {
        const newAnnId = `ann-${Date.now()}`;
        const defaultHpoId = "HP:0000118";
        await enqueueMutation({
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

  const handlePickMention = (evidenceId: string) => {
    setSelectedEvidenceId(evidenceId);
    const owner = (draft.annotations ?? []).find((a) =>
      (a.annotation.evidence_refs ?? []).some((r) => r.evidence_id === evidenceId)
    );
    if (owner) {
      setSelectedAnnotationId(owner.annotation.annotation_id);
    }
  };

  const handleCreateSpanless = async () => {
    if (!spanlessHpoId.trim()) return;
    const newAnnId = `ann-${Date.now()}`;
    await enqueueMutation({
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

  const handleUpdateTerm = async (hpoId: string) => {
    if (!selectedAnnotationId) return;
    await enqueueMutation({
      command: "set_term",
      annotation_id: selectedAnnotationId,
      hpo_id: hpoId,
    });
  };

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
    await enqueueMutation({
      command: "set_axes",
      annotation_id: selectedAnnotationId,
      axes: newAxes,
    });
  };

  const handleDetachMention = async (evidenceId: string) => {
    if (!selectedAnnotationId) return;
    await enqueueMutation({
      command: "detach_mention",
      annotation_id: selectedAnnotationId,
      evidence_id: evidenceId,
    });
    if (selectedEvidenceId === evidenceId) {
      setSelectedEvidenceId(null);
    }
  };

  const handleDeleteAnnotation = async (annotationId: string) => {
    await enqueueMutation({
      command: "delete_draft_annotation",
      annotation_id: annotationId,
    });
    if (selectedAnnotationId === annotationId) {
      setSelectedAnnotationId(null);
      setSelectedEvidenceId(null);
    }
  };

  // Review Decision Handler
  const handleReviewDecision = async (payload: DecisionPayload) => {
    if (!selectedTarget) return;

    await queueRef.current.enqueue(async (expectedRevision) => {
      const mutationId = `mut-dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const updatedDraft = await api.recordDecision(workspaceId, {
        mutation_id: mutationId,
        expected_revision: expectedRevision,
        payload: {
          target: {
            annotation_id: selectedTarget.annotation_id,
            version: selectedTarget.version,
          },
          outcome: payload.outcome,
          replacement: payload.replacement,
          note: payload.note,
        },
      });
      setDraft(updatedDraft);
      return updatedDraft;
    });
  };

  // Submit and finalize workspace
  const handleSubmitWorkspace = async () => {
    setSubmitError(null);

    if (!documentChecked) {
      setSubmitError("Bitte bestätigen Sie zuerst, dass der Fall vollständig durchgesehen wurde.");
      return;
    }

    if (view.key.mode === "review") {
      const missingTargets = reviewTargets.filter((t) => !decisionsMap[t.annotation_id]);
      if (missingTargets.length > 0) {
        setSubmitError(
          `Es sind noch ${missingTargets.length} unentschiedene Review-Ziele offen. Bitte treffen Sie für jeden Vorschlag eine Entscheidung.`
        );
        return;
      }
    }

    try {
      const submission = await queueRef.current.enqueue(async (expectedRevision) => {
        const mutationId = `mut-sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        return api.submitWorkspace(workspaceId, {
          mutation_id: mutationId,
          expected_revision: expectedRevision,
          payload: {
            command: "submit_workspace",
            document_checked: true,
          },
        });
      });
      setCompletedSubmission(submission);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(`Abgabe fehlgeschlagen: ${msg}`);
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
              queueState === "saved"
                ? "status-saved"
                : queueState === "conflict" || queueState === "error"
                ? "status-error"
                : "status-saving"
            }`}
          >
            ● {statusText} (Rev {draft.revision})
          </span>

          {queueState === "error" && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => queueRef.current.retry()}
            >
              🔄 Erneut versuchen
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSpanlessModal(true)}
          >
            + Spanlose Annotation
          </button>

          <a
            href={api.getExportUrl(workspaceId)}
            className="btn btn-secondary btn-sm"
            download
          >
            📥 Export (.zip)
          </a>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="app-layout">
        {/* Left: Sidebar (Annotations & Review Targets) */}
        <aside className="sidebar">
          {view.key.mode === "review" && (
            <>
              <div className="sidebar-header">
                Review-Ziele ({reviewTargets.length})
              </div>
              <ul className="doc-list" style={{ maxHeight: "40%", borderBottom: "2px solid var(--border-color)" }}>
                {reviewTargets.map((t) => {
                  const isSelected = t.annotation_id === selectedTargetId;
                  const dec = decisionsMap[t.annotation_id];
                  return (
                    <li
                      key={t.annotation_id}
                      className={`doc-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedTargetId(t.annotation_id)}
                    >
                      <div className="doc-id" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{t.hpo_id}</span>
                        {dec ? (
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--primary)" }}>
                            {dec.outcome}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>offen</span>
                        )}
                      </div>
                      <div className="doc-meta">
                        {t.evidence_count} Belegstelle(n) • {t.provenance.actor.kind}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="sidebar-header">
            Eigene Annotationen ({(draft.annotations ?? []).length})
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

          {/* Submission Box at bottom of sidebar */}
          <div style={{ padding: 14, borderTop: "1px solid var(--border-color)", background: "var(--bg-primary)" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "0.8rem", cursor: "pointer", marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={documentChecked}
                onChange={(e) => setDocumentChecked(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>Dokument vollständig geprüft</span>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ width: "100%", padding: "8px 0" }}
              onClick={handleSubmitWorkspace}
            >
              ✓ Fall abschließen & abgeben
            </button>
            {submitError && (
              <div style={{ fontSize: "0.75rem", color: "var(--danger)", marginTop: 6 }}>
                {submitError}
              </div>
            )}
          </div>
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

        {/* Right: Annotation & Search Panel + Review Actions */}
        <div style={{ display: "flex", flexDirection: "column", width: 380, borderLeft: "1px solid var(--border-color)" }}>
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

          {view.key.mode === "review" && selectedTarget && (
            <ReviewActions
              target={selectedTarget}
              currentDecision={decisionsMap[selectedTarget.annotation_id] ?? null}
              draftAnnotations={draft.annotations ?? []}
              onDecide={handleReviewDecision}
            />
          )}
        </div>
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

      {/* Modal on 409 Conflict */}
      {queueState === "conflict" && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--danger)", marginBottom: 12 }}>
              ⚠️ Revisionskonflikt
            </h2>
            <p style={{ fontSize: "0.9rem", color: "var(--text-main)", marginBottom: 16 }}>
              Der Stand dieses Arbeitsbereichs wurde an anderer Stelle (z. B. in einem zweiten Browser-Tab)
              geändert. Um Datenverlust zu vermeiden, wurden weitere automatische Speicherversuche gestoppt.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onClose}
              >
                Fall neu laden (lokalen Stand verwerfen)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal on successful completion/submission */}
      {completedSubmission && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--success)", marginBottom: 12 }}>
              ✓ Fall erfolgreich abgeschlossen!
            </h2>
            <p style={{ fontSize: "0.9rem", color: "var(--text-main)", marginBottom: 12 }}>
              Die Annotationen und Entscheidungen wurden verbindlich festgeschrieben.
            </p>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 16, background: "var(--bg-primary)", padding: 10, borderRadius: "var(--radius)" }}>
              <div><strong>Abgabe-ID:</strong> {completedSubmission.submission_id}</div>
              <div><strong>Zeitstempel:</strong> {completedSubmission.created_at}</div>
              <div><strong>Snapshots:</strong> {completedSubmission.snapshots?.length ?? 0}</div>
              <div><strong>Entscheidungen:</strong> {completedSubmission.decisions?.length ?? 0}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <a
                href={api.getExportUrl(workspaceId)}
                className="btn btn-primary"
                download
              >
                📥 Paket herunterladen
              </a>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                Zur Fallauswahl
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
