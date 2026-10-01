import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ValidationError,
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

const refKey = (r: { annotation_id: string; version: string }) => JSON.stringify([r.annotation_id, r.version]);

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
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    view.targets?.targets?.[0] ? refKey(view.targets.targets[0]) : null
  );
  const [selectionIntent, setSelectionIntent] = useState<"new_mention" | "extend_mention">("new_mention");
  const [queueState, setQueueState] = useState<QueueState>("saved");
  const [statusText, setStatusText] = useState<string>("Gespeichert");
  const [documentChecked, setDocumentChecked] = useState<boolean>(draft.document_checked);

  // Modals
  const [showSpanlessModal, setShowSpanlessModal] = useState<boolean>(false);
  const [spanlessHpoId, setSpanlessHpoId] = useState<string>("");
  const [completedSubmission, setCompletedSubmission] = useState<Submission | null>(null);
  const [historySubmission, setHistorySubmission] = useState<Submission | null>(null);
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
      const termId = snap?.annotation.term_id ?? snap?.annotation.hpo_id ?? targetRef.annotation_id;
      return {
        annotation_id: targetRef.annotation_id,
        version: targetRef.version,
        term_id: termId,
        hpo_id: termId,
        axes: snap?.annotation.axes ?? null,
        provenance: snap?.annotation.provenance ?? {
          actor: { actor_id: "unknown", kind: "tool" },
          method: "automated",
        },
        evidence_count: snap?.annotation.evidence_refs?.length ?? 0,
        is_obsolete: view.term_statuses?.[termId] === "obsolete",
        is_unknown: view.term_statuses?.[termId] === "unknown",
      };
    });
  }, [view.key.mode, view.targets, view.available_inputs, view.term_statuses]);

  const decisionsMap = useMemo(() => {
    const map: Record<string, ReviewDecision> = {};
    for (const d of draft.decisions ?? []) {
      map[refKey(d.target)] = d;
    }
    return map;
  }, [draft.decisions]);

  const selectedTarget = useMemo(() => {
    if (!selectedTargetId) return null;
    return reviewTargets.find((t) => refKey(t) === selectedTargetId) ?? null;
  }, [reviewTargets, selectedTargetId]);

  const targetSnapshot = (view.available_inputs ?? []).find(s => selectedTarget &&
    s.annotation.annotation_id === selectedTarget.annotation_id && s.version === selectedTarget.version);
  const targetMentions: MentionDisplay[] = (targetSnapshot?.evidence ?? []).map(ev => ({
    evidence_id: `target:${ev.mention.evidence_id}:${ev.version}`,
    segments: ev.mention.segments,
  }));
  const reportError = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));
  const downloadExport = async () => {
    try { await queueRef.current.flush(); await api.downloadExport(workspaceId); }
    catch (error) { reportError(error); }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (["saving", "dirty", "error"].includes(queueRef.current.getState())) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Execute mutation through the queue
  const enqueueMutation = async (payload: Record<string, unknown> | ((current: Draft) => Record<string, unknown>)): Promise<Draft> => {
    setActionError(null);
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.applyCommand>[1] | undefined;
    return queueRef.current.enqueue(async (expectedRevision) => {
      envelope ??= { mutation_id: mutationId, expected_revision: expectedRevision, payload: typeof payload === "function" ? payload(latestDraft.current) : payload };
      const updatedDraft = await api.applyCommand(workspaceId, envelope);
      latestDraft.current = updatedDraft;
      setDraft(updatedDraft);
      return updatedDraft;
    });
  };

  // Text selection handler
  const handleSelection = async (payload: SelectionPayload) => {
    if (!payload.segments || payload.segments.length === 0) return;

    setActionError(null);
    try {
    if (payload.intent === "extend_mention" && selectedEvidenceId) {
      const evidenceId = selectedEvidenceId;
      const annotationId = selectedAnnotationId;
      await enqueueMutation(current => {
        const existingEv = (current.evidence ?? []).find(ev => ev.mention.evidence_id === evidenceId);
        if (!existingEv) throw new ValidationError("Belegstelle ist nicht mehr vorhanden");
        return {
          command: "edit_mention",
          evidence_id: evidenceId,
          annotation_id: annotationId,
          segments: [...existingEv.mention.segments, ...payload.segments].sort((a, b) => a.start - b.start),
        };
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
        const defaultTermId = "HP:0000118";
        const initialValues: Record<string, string | null> = {};
        for (const axis of view.axes_config ?? []) {
          initialValues[axis.id] = null;
        }
        await enqueueMutation({
          command: "create_annotation",
          annotation_id: newAnnId,
          term_id: defaultTermId,
          hpo_id: defaultTermId,
          evidence_id: evidenceId,
          segments: payload.segments,
          axes: {
            definition_name: view.axes_definition ?? "editor-axes/v1",
            values: initialValues,
          },
        });
        setSelectedAnnotationId(newAnnId);
        setSelectedEvidenceId(evidenceId);
      }
    }
    } catch (error) { reportError(error); }
  };

  const handlePickMention = (evidenceId: string) => {
    if (evidenceId.startsWith("target:")) return;
    setSelectedEvidenceId(evidenceId);
    const owner = (draft.annotations ?? []).find((a) =>
      (a.annotation.evidence_refs ?? []).some((r) => r.evidence_id === evidenceId)
    );
    if (owner) {
      setSelectedAnnotationId(owner.annotation.annotation_id);
    }
  };

  const handleCreateSpanless = async () => {
    try {
      if (!spanlessHpoId.trim()) return;
      const newAnnId = `ann-${Date.now()}`;
      const termId = spanlessHpoId.trim();
      const initialValues: Record<string, string | null> = {};
      for (const axis of view.axes_config ?? []) {
        initialValues[axis.id] = null;
      }
      await enqueueMutation({
        command: "create_annotation",
        annotation_id: newAnnId,
        term_id: termId,
        hpo_id: termId,
        segments: [],
        axes: {
          definition_name: view.axes_definition ?? "editor-axes/v1",
          values: initialValues,
        },
      });
      setSelectedAnnotationId(newAnnId);
      setSelectedEvidenceId(null);
      setShowSpanlessModal(false);
      setSpanlessHpoId("");
    } catch (error) { reportError(error); }
  };

  const handleUpdateTerm = async (termId: string, searchId?: string) => {
    if (!selectedAnnotationId) return;
    await enqueueMutation({
      command: "set_term",
      annotation_id: selectedAnnotationId,
      term_id: termId,
      hpo_id: termId,
      search_event_id: searchId,
    });
  };

  const handleUpdateAxes = async (axesUpdate: Partial<Axes>) => {
    if (!selectedAnnotationId || !selectedAnnotation) return;
    const annotationId = selectedAnnotationId;
    await enqueueMutation(current => {
      const existing = (current.annotations ?? []).find(a => a.annotation.annotation_id === annotationId)?.annotation.axes;
      return {
        command: "set_axes",
        annotation_id: annotationId,
        axes: {
          definition_name: axesUpdate.definition_name ?? existing?.definition_name ?? view.axes_definition ?? "editor-axes/v1",
          values: axesUpdate.values !== undefined ? axesUpdate.values : (existing?.values ?? {}),
        },
      };
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

    setActionError(null);
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.recordDecision>[1] | undefined;
    try { await queueRef.current.enqueue(async (expectedRevision) => {
      const replacement = payload.replacement && (latestDraft.current.annotations ?? []).find(a => a.annotation.annotation_id === payload.replacement!.annotation_id);
      envelope ??= {
        mutation_id: mutationId,
        expected_revision: expectedRevision,
        payload: {
          target: {
            annotation_id: selectedTarget.annotation_id,
            version: selectedTarget.version,
          },
          outcome: payload.outcome,
          replacement: replacement ? { annotation_id: replacement.annotation.annotation_id, version: replacement.version } : payload.replacement,
          note: payload.note,
        },
      };
      const updatedDraft = await api.recordDecision(workspaceId, envelope);
      latestDraft.current = updatedDraft;
      setDraft(updatedDraft);
      return updatedDraft;
    }); } catch (error) { reportError(error); }
  };

  // Submit and finalize workspace
  const handleSubmitWorkspace = async () => {
    setSubmitError(null);

    if (!documentChecked) {
      setSubmitError("Bitte bestätigen Sie zuerst, dass der Fall vollständig durchgesehen wurde.");
      return;
    }

    try {
      await queueRef.current.flush();
    } catch (error) { reportError(error); return; }

    if (view.key.mode === "review") {
      const missingTargets = reviewTargets.filter((t) => !(latestDraft.current.decisions ?? []).some(d => refKey(d.target) === refKey(t)));
      if (missingTargets.length > 0) {
        setSubmitError(
          `Es sind noch ${missingTargets.length} unentschiedene Review-Ziele offen. Bitte treffen Sie für jeden Vorschlag eine Entscheidung.`
        );
        return;
      }
    }

    try {
      const mutationId = crypto.randomUUID();
      let envelope: Parameters<typeof api.submitWorkspace>[1] | undefined;
      const submission = await queueRef.current.enqueue(async (expectedRevision) => {
        envelope ??= {
          mutation_id: mutationId,
          expected_revision: expectedRevision,
          payload: {
            document_checked: true,
          },
        };
        return api.submitWorkspace(workspaceId, envelope);
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
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await queueRef.current.flush(); onClose(); } catch (error) { reportError(error); } }}>
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

          <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
            setSelectedAnnotationId(null); setSelectedEvidenceId(null); setSelectionIntent("new_mention");
          }}>Neue Annotation markieren</button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSpanlessModal(true)}
          >
            + Spanlose Annotation
          </button>

          <button
            onClick={downloadExport}
            className="btn btn-secondary btn-sm"
          >
            📥 Export (.zip)
          </button>
        </div>
      </header>

      {actionError && <div role="alert" style={{ color: "var(--danger)", padding: 12 }}>{actionError}</div>}
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
                  const isSelected = refKey(t) === selectedTargetId;
                  const dec = decisionsMap[refKey(t)];
                  return (
                    <li
                      key={refKey(t)}
                      className={`doc-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedTargetId(refKey(t))}
                    >
                      <div className="doc-id" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{t.term_id ?? t.hpo_id}</span>
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
              const termId = annSnap.annotation.term_id ?? annSnap.annotation.hpo_id;
              const firstAxisVal = annSnap.annotation.axes?.values
                ? Object.values(annSnap.annotation.axes.values).find((v) => v !== null)
                : null;

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
                  <div className="doc-id">{termId}</div>
                  <div className="doc-meta">
                    {evCount === 0 ? "Spanlos" : `${evCount} Belegstelle(n)`}
                    {firstAxisVal && ` • ${firstAxisVal}`}
                  </div>
                </li>
              );
            })}
          </ul>

          {(view.submissions ?? []).length > 0 && <div className="detail-section">
            <h3>Bisherige Abgaben</h3>
            {view.submissions!.map(submission => <button type="button" className="btn btn-secondary btn-sm"
              key={submission.submission_id} onClick={() => setHistorySubmission(submission)}>
              {submission.created_at} · {submission.submission_id}
            </button>)}
          </div>}
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
          mentions={[...mentionsDisplay, ...targetMentions]}
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
            axesConfig={view.axes_config}
            axesDefinition={view.axes_definition}
            onSelectEvidence={(evId) => setSelectedEvidenceId(evId)}
            onUpdateTerm={(...args) => { void handleUpdateTerm(...args).catch(reportError); }}
            onUpdateAxes={(axes) => { void handleUpdateAxes(axes).catch(reportError); }}
            onAttachMention={(segments) =>
              handleSelection({ segments, intent: "new_mention" })
            }
            onDetachMention={(id) => { void handleDetachMention(id).catch(reportError); }}
            onDeleteAnnotation={(id) => { void handleDeleteAnnotation(id).catch(reportError); }}
            onSetIntent={setSelectionIntent}
          />

          {view.key.mode === "review" && selectedTarget && (
            <ReviewActions
              key={refKey(selectedTarget)}
              target={selectedTarget}
              evidence={targetSnapshot?.evidence ?? []}
              documentText={view.document.text}
              currentDecision={decisionsMap[refKey(selectedTarget)] ?? null}
              draftAnnotations={draft.annotations ?? []}
              onDecide={handleReviewDecision}
            />
          )}
        </div>
      </div>

      {historySubmission && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-label="Historische Abgabe">
          <h2>Abgabe {historySubmission.submission_id}</h2>
          <p>{historySubmission.created_at}</p>
          <p>Dokument vollständig geprüft: {historySubmission.document_checked ? "Ja" : "Nein"}</p>
          {historySubmission.snapshots.map(snap => <div key={refKey({annotation_id:snap.annotation.annotation_id,version:snap.version})}>
            <strong>{snap.annotation.term_id ?? snap.annotation.hpo_id}</strong>
            <p>
              {snap.annotation.axes?.values && Object.keys(snap.annotation.axes.values).length > 0
                ? Object.entries(snap.annotation.axes.values)
                    .map(([k, v]) => `${k}: ${v ?? "Nicht angegeben"}`)
                    .join(" · ")
                : "Keine Achsen"}
            </p>
            {snap.evidence.map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
              {ev.mention.segments.map(seg => Array.from(view.document.text).slice(seg.start, seg.end).join("")).join(" … ")}
            </p>)}
          </div>)}
          {historySubmission.decisions.map(decision => <p key={refKey(decision.target)}>
            {decision.target.annotation_id} ({decision.target.version}): {decision.outcome} {decision.note}
          </p>)}
          <button type="button" className="btn btn-secondary" onClick={() => setHistorySubmission(null)}>Schließen</button>
        </div>
      </div>}
      {/* Modal for adding spanless annotation */}
      {showSpanlessModal && (
        <div className="modal-overlay" onClick={() => setShowSpanlessModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 12 }}>
              Spanlose Annotation anlegen
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 16 }}>
              Erfassen Sie einen Befund, der im Fall dokumentiert oder
              ausgeschlossen ist, aber keine direkte Textstelle markiert.
            </p>
            <div className="form-group">
              <label htmlFor="spanless-hpo-id" className="form-label">
                Ontologie-Kennung (z. B. HP:0001252, MONDO:0001250)
              </label>
              <input
                id="spanless-hpo-id"
                type="text"
                className="form-control"
                placeholder="z.B. HP:0001252 oder MONDO:0001250"
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
              <button
                onClick={downloadExport}
                className="btn btn-primary"
                  >
                📥 Paket herunterladen
              </button>
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
