import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ValidationError,
  type AnnotationSnapshot,
  type AxesValues,
  type DocumentSummary,
  type Draft,
  type Submission,
} from "../api/client";
import type { components } from "../api/generated";
import { AnnotationPanel, type EvidenceSnapshot } from "../editor/AnnotationPanel";
import { createMutationQueue, type QueueState } from "../editor/autosave";
import { LayerControls } from "../editor/LayerControls";
import {
  initLayerSelection,
  setActiveLayer,
  setActiveType,
  toggleLayerVisibility,
  type LayerSelection,
} from "../editor/layerState";
import {
  ReviewActions,
  type DecisionPayload,
  type ReviewDecision,
  type TargetProposal,
} from "../editor/ReviewActions";
import { SearchPanel } from "../editor/SearchPanel";
import { SearchManager } from "../editor/searchState";
import { TermName } from "../editor/TermName";
import { TextPane } from "../editor/TextPane";
import { useTermLabels } from "../editor/useTermLabels";
import { termColorIndex, type MentionDisplay, type SelectionPayload } from "../spans/adapter";
import { CaseNavigation } from "./CaseNavigation";

const refKey = (r: { annotation_id: string; version: string }) => JSON.stringify([r.annotation_id, r.version]);

export const initialAxisValues = (
  axes: { id: string; options: string[] }[],
  termId: string,
): Record<string, string | null> => Object.fromEntries(
  axes.map((axis) => [
    axis.id,
    termId.startsWith("HP:") && axis.id === "assertion" && axis.options.includes("present")
      ? "present" : null,
  ]),
);

export type WorkspaceView = components["schemas"]["WorkspaceView"];

export interface CaseScreenProps {
  view: WorkspaceView;
  workspaceId: string;
  onClose: () => void;
  onNavigateCase?: (documentId: string) => Promise<void>;
  documentList?: DocumentSummary[];
}

export const CaseScreen: React.FC<CaseScreenProps> = ({
  view,
  workspaceId,
  onClose,
  onNavigateCase,
  documentList,
}) => {
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    annotationId: string; evidenceId: string; layerId: string; typeId: string;
    segments: SelectionPayload["segments"];
  } | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const creatingPending = useRef(false);
  const [draft, setDraft] = useState<Draft>(view.draft);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  const [layerSelection, setLayerSelection] = useState<LayerSelection>(() =>
    initLayerSelection(view.layers ?? [], view.scope)
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(() => {
    if (view.key.mode === "review" && view.targets?.targets?.[0]) {
      const firstTarget = view.targets.targets[0];
      const snap = (view.available_inputs ?? []).find(
        (s) => s.annotation.annotation_id === firstTarget.annotation_id && s.version === firstTarget.version
      );
      const firstEv = snap?.evidence?.[0];
      if (firstEv) {
        return `target:${firstTarget.annotation_id}:${firstTarget.version}:${firstEv.mention.evidence_id}:${firstEv.version}`;
      }
    }
    return null;
  });
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    view.targets?.targets?.[0] ? refKey(view.targets.targets[0]) : null
  );
  const [selectionIntent, setSelectionIntent] = useState<"new_mention" | "extend_mention">("new_mention");
  const [queueState, setQueueState] = useState<QueueState>("saved");
  const [statusText, setStatusText] = useState<string>("Gespeichert");

  // Modals
  const [showSpanlessModal, setShowSpanlessModal] = useState<boolean>(false);
  const [spanlessHpoId, setSpanlessHpoId] = useState<string>("");
  const [completedSubmission, setCompletedSubmission] = useState<Submission | null>(null);
  const [historySubmission, setHistorySubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "text" | "details">("text");

  const displayedTerms = useMemo(() => [
    ...(draft.annotations ?? []),
    ...(view.available_inputs ?? []),
    ...(view.submissions ?? []).flatMap((submission) => submission.snapshots),
  ].map((snapshot) => ({
    layer_id: snapshot.annotation.layer_id,
    term_id: snapshot.annotation.term_id,
  })), [draft.annotations, view.available_inputs, view.submissions]);
  const termLabel = useTermLabels(view.key.package_id, displayedTerms);

  const searchManager = useMemo(() => new SearchManager(api), []);

  useEffect(() => {
    searchManager.setLayer(layerSelection.activeLayerId);
  }, [layerSelection.activeLayerId, searchManager]);

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

  // Visible annotations based on layer visibility
  const visibleAnnotations = useMemo(() => {
    return (draft.annotations ?? []).filter((a) =>
      layerSelection.visibleLayerIds.includes(a.annotation.layer_id)
    );
  }, [draft.annotations, layerSelection.visibleLayerIds]);

  const visibleEvidenceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ann of visibleAnnotations) {
      for (const ref of ann.annotation.evidence_refs ?? []) {
        ids.add(ref.evidence_id);
      }
    }
    return ids;
  }, [visibleAnnotations]);

  const mentionsDisplay: MentionDisplay[] = useMemo(() => {
    return (draft.evidence ?? [])
      .filter((ev) => visibleEvidenceIds.has(ev.mention.evidence_id))
      .map((ev) => {
        const owner = (draft.annotations ?? []).find((a) =>
          (a.annotation.evidence_refs ?? []).some((r) => r.evidence_id === ev.mention.evidence_id)
        );
        const termId = owner?.annotation.term_id ?? "";
        return {
          evidence_id: ev.mention.evidence_id,
          segments: ev.mention.segments.map((s) => ({ start: s.start, end: s.end })),
          kind: "own" as const,
          colorIndex: termColorIndex(termId),
        };
      });
  }, [draft.evidence, visibleEvidenceIds, draft.annotations]);

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
      const termId = snap?.annotation.term_id ?? targetRef.annotation_id;
      const layerId = snap?.annotation.layer_id;
      const statusKey = layerId ? `${layerId}:${termId}` : termId;
      return {
        annotation_id: targetRef.annotation_id,
        version: targetRef.version,
        layer_id: layerId,
        type_id: snap?.annotation.type_id,
        term_id: termId,
        axes: (snap?.annotation.axes_values ?? (snap?.annotation as any)?.axes?.values) as any,
        axes_values: snap?.annotation.axes_values ?? null,
        provenance: snap?.annotation.provenance ?? {
          actor: { actor_id: "unknown", kind: "tool" },
          method: "automated",
        },
        evidence_count: snap?.annotation.evidence_refs?.length ?? 0,
        is_obsolete: (view.term_statuses?.[statusKey] ?? view.term_statuses?.[termId]) === "obsolete",
        is_unknown: (view.term_statuses?.[statusKey] ?? view.term_statuses?.[termId]) === "unknown",
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

  const targetMentions: MentionDisplay[] = useMemo(() => {
    if (view.key.mode !== "review") return [];
    const mentions: MentionDisplay[] = [];
    for (const target of reviewTargets) {
      if (!target.layer_id || !layerSelection.visibleLayerIds.includes(target.layer_id)) continue;
      const dec = decisionsMap[refKey(target)];
      // If target is replaced or rejected, its markings completely disappear from text
      if (dec?.outcome === "changed" || dec?.outcome === "rejected") {
        continue;
      }
      const snap = (view.available_inputs ?? []).find(
        (s) => s.annotation.annotation_id === target.annotation_id && s.version === target.version
      );
      if (!snap) continue;
      const colorIdx = termColorIndex(target.term_id ?? target.annotation_id);
      for (const ev of snap.evidence ?? []) {
        mentions.push({
          evidence_id: `target:${target.annotation_id}:${target.version}:${ev.mention.evidence_id}:${ev.version}`,
          segments: ev.mention.segments,
          kind: "target" as const,
          colorIndex: colorIdx,
        });
      }
    }
    return mentions;
  }, [view.key.mode, reviewTargets, view.available_inputs, layerSelection.visibleLayerIds, decisionsMap, selectedTargetId]);

  const visibleSources = useMemo(() => view.key.mode === "independent" ? [] :
    (view.available_inputs ?? []).filter(s =>
      layerSelection.visibleLayerIds.includes(s.annotation.layer_id) &&
      !(view.targets?.targets ?? []).some(t => t.annotation_id === s.annotation.annotation_id && t.version === s.version)),
    [view.key.mode, view.available_inputs, view.targets, layerSelection.visibleLayerIds]);
  const sourceKey = (s: AnnotationSnapshot) => refKey({ annotation_id: s.annotation.annotation_id, version: s.version });
  const selectedSource = visibleSources.find(s => sourceKey(s) === selectedSourceId);
  const sourceMentions: MentionDisplay[] = visibleSources.flatMap(s => s.evidence.map(ev => ({
    evidence_id: `source:${sourceKey(s)}:${ev.mention.evidence_id}:${ev.version}`,
    sourceId: sourceKey(s),
    segments: ev.mention.segments,
    kind: "source" as const,
    colorIndex: termColorIndex(s.annotation.term_id),
  })));
  const selectSource = (id: string) => {
    setSelectedTargetId(null);
    setSelectedAnnotationId(null);
    setSelectedSourceId(id);
    setSelectedEvidenceId(null);
    setMobilePane("details");
    setSelectionIntent("new_mention");
    cancelPending();
  };

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

  // Helper to mutate an annotation and synchronize any linked review decision
  const mutateAnnotationAndSyncDecision = async (
    annotationId: string,
    mutationAction: () => Promise<Draft>
  ): Promise<Draft> => {
    // Check if this annotation was acting as a replacement for any target
    const prevDecision = (latestDraft.current.decisions ?? []).find(
      (d) => d.replacement?.annotation_id === annotationId && d.outcome === "changed"
    );
    let targetToSync = prevDecision?.target;
    if (!targetToSync) {
      const annSnap = (latestDraft.current.annotations ?? []).find(
        (a) => a.annotation.annotation_id === annotationId
      );
      const sourceRef = annSnap?.annotation.provenance.source_refs?.[0];
      if (sourceRef) {
        const [targetAnnId, targetVer] = sourceRef.split(":");
        if (targetAnnId && targetVer) {
          targetToSync = { annotation_id: targetAnnId, version: targetVer };
        }
      }
    }

    const updatedDraft = await mutationAction();

    if (targetToSync) {
      const updatedAnn = (latestDraft.current.annotations ?? []).find(
        (a) => a.annotation.annotation_id === annotationId
      );
      if (updatedAnn) {
        const mutationId = crypto.randomUUID();
        let envelope: Parameters<typeof api.recordDecision>[1] | undefined;
        await queueRef.current.enqueue(async (expectedRevision) => {
          envelope ??= {
            mutation_id: mutationId,
            expected_revision: expectedRevision,
            payload: {
              target: targetToSync!,
              outcome: "changed",
              replacement: {
                annotation_id: updatedAnn.annotation.annotation_id,
                version: updatedAnn.version,
              },
              note: prevDecision?.note,
            },
          };
          const nextDraft = await api.recordDecision(workspaceId, envelope);
          latestDraft.current = nextDraft;
          setDraft(nextDraft);
          return nextDraft;
        });
      }
    }
    return updatedDraft;
  };

  // Text selection handler
  const handleSelection = async (payload: SelectionPayload) => {
    if (!payload.segments || payload.segments.length === 0) return;
    setMobilePane("details");

    setActionError(null);
    try {
      if (payload.intent === "extend_mention" && selectedEvidenceId) {
        const evidenceId = selectedEvidenceId;
        const annotationId = selectedAnnotationId;
        if (annotationId) {
          await mutateAnnotationAndSyncDecision(annotationId, () =>
            enqueueMutation(current => {
              const existingEv = (current.evidence ?? []).find(ev => ev.mention.evidence_id === evidenceId);
              if (!existingEv) throw new ValidationError("Belegstelle ist nicht mehr vorhanden");
              return {
                command: "edit_mention",
                evidence_id: evidenceId,
                annotation_id: annotationId,
                segments: [...existingEv.mention.segments, ...payload.segments].sort((a, b) => a.start - b.start),
              };
            })
          );
        } else {
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
        }
        setSelectionIntent("new_mention");
      } else {
        const evidenceId = `ev-${Date.now()}`;
        if (selectedAnnotationId) {
          const annId = selectedAnnotationId;
          await mutateAnnotationAndSyncDecision(annId, () =>
            enqueueMutation({
              command: "attach_mention",
              annotation_id: annId,
              evidence_id: evidenceId,
              segments: payload.segments,
            })
          );
          setSelectedEvidenceId(evidenceId);
        } else {
          if (!layerSelection.activeLayerId) {
            setActionError("Keine aktive editierbare Schicht ausgewählt. Bitte Schicht aktivieren.");
            return;
          }
          const activeLayerId = layerSelection.activeLayerId;
          const activeLayerDef = (view.layers ?? []).find(l => l.layer_id === activeLayerId);
          const activeTypeId = layerSelection.activeTypeId ?? activeLayerDef?.annotation_types?.[0]?.type_id ?? "default";
          setSelectedSourceId(null);
          setSelectedTargetId(null);
          setPendingAnnotation({ annotationId: `ann-${crypto.randomUUID()}`, evidenceId,
            layerId: activeLayerId, typeId: activeTypeId, segments: payload.segments });
        }
      }
    } catch (error) { reportError(error); }
  };

  const cancelPending = () => { setPendingAnnotation(null); searchManager.clear(); };

  const createPendingAnnotation = async (termId: string, searchId?: string) => {
    if (!pendingAnnotation || creatingPending.current) return;
    creatingPending.current = true;
    const pending = pendingAnnotation;
    try {
      const type = view.layers?.find(l => l.layer_id === pending.layerId)?.annotation_types.find(t => t.type_id === pending.typeId);
      await enqueueMutation({ command: "create_annotation", annotation_id: pending.annotationId,
        evidence_id: pending.evidenceId, layer_id: pending.layerId, type_id: pending.typeId,
        term_id: termId, search_event_id: searchId, segments: pending.segments,
        axes_values: initialAxisValues(type?.axes ?? [], termId) });
      setPendingAnnotation(null);
      setSelectedTargetId(null);
      setSelectedAnnotationId(pending.annotationId);
      setSelectedEvidenceId(pending.evidenceId);
      searchManager.clear();
    } catch (error) { reportError(error); }
    finally { creatingPending.current = false; }
  };

  const handlePickMention = (evidenceId: string) => {
    if (evidenceId === pendingAnnotation?.evidenceId) return;

    const source = sourceMentions.find(mention => mention.evidence_id === evidenceId);
    if (source) {
      selectSource(source.sourceId);
      setSelectedEvidenceId(evidenceId);
      return;
    }

    if (evidenceId.startsWith("target:")) {
      const matchedTarget = reviewTargets.find((t) =>
        evidenceId.startsWith(`target:${t.annotation_id}:${t.version}:`)
      );
      if (matchedTarget) {
        setSelectedTargetId(refKey(matchedTarget));
        setSelectedAnnotationId(null);
        setSelectedSourceId(null);
        cancelPending();
        setSelectedEvidenceId(evidenceId);
        setMobilePane("details");
      }
      return;
    }

    setSelectedTargetId(null);
    setSelectedSourceId(null);
    cancelPending();
    setSelectedEvidenceId(evidenceId);
    const owner = (draft.annotations ?? []).find((a) =>
      (a.annotation.evidence_refs ?? []).some((r) => r.evidence_id === evidenceId)
    );
    if (owner) {
      setSelectedAnnotationId(owner.annotation.annotation_id);
      setMobilePane("details");
    }
  };

  const handleCreateSpanless = async () => {
    try {
      if (!spanlessHpoId.trim()) return;
      if (!layerSelection.activeLayerId) {
        setActionError("Keine aktive editierbare Schicht ausgewählt. Bitte Schicht aktivieren.");
        return;
      }
      const activeLayerId = layerSelection.activeLayerId;
      const activeLayerDef = (view.layers ?? []).find(l => l.layer_id === activeLayerId);
      const activeTypeId = layerSelection.activeTypeId ?? activeLayerDef?.annotation_types?.[0]?.type_id ?? "default";
      const activeTypeDef = activeLayerDef?.annotation_types?.find(t => t.type_id === activeTypeId);

      const newAnnId = `ann-${Date.now()}`;
      const termId = spanlessHpoId.trim();
      const initialValues = initialAxisValues(activeTypeDef?.axes ?? view.axes_config ?? [], termId);
      await enqueueMutation({
        command: "create_annotation",
        annotation_id: newAnnId,
        layer_id: activeLayerId,
        type_id: activeTypeId,
        term_id: termId,
        segments: [],
        axes_values: initialValues,
      });
      setSelectedSourceId(null);
      setSelectedTargetId(null);
      cancelPending();
      setSelectedAnnotationId(newAnnId);
      setMobilePane("details");
      setSelectedEvidenceId(null);
      setShowSpanlessModal(false);
      setSpanlessHpoId("");
    } catch (error) { reportError(error); }
  };

  const handleUpdateTerm = async (termId: string, searchId?: string) => {
    if (!selectedAnnotationId) return;
    const annId = selectedAnnotationId;
    await mutateAnnotationAndSyncDecision(annId, () =>
      enqueueMutation({
        command: "set_term",
        annotation_id: annId,
        term_id: termId,
        search_event_id: searchId,
      })
    );
  };

  const handleUpdateAxes = async (axesValues: Partial<AxesValues>) => {
    if (!selectedAnnotationId || !selectedAnnotation) return;
    const annotationId = selectedAnnotationId;
    await mutateAnnotationAndSyncDecision(annotationId, () =>
      enqueueMutation({
        command: "set_axes",
        annotation_id: annotationId,
        axes_values: axesValues as Record<string, string | null>,
      })
    );
  };

  const handleDetachMention = async (evidenceId: string) => {
    if (!selectedAnnotationId) return;
    const annId = selectedAnnotationId;
    await mutateAnnotationAndSyncDecision(annId, () =>
      enqueueMutation({
        command: "detach_mention",
        annotation_id: annId,
        evidence_id: evidenceId,
      })
    );
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
    try {
      await queueRef.current.enqueue(async (expectedRevision) => {
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
      });
    } catch (error) { reportError(error); }
  };

  // Adopt a review target into draft annotations and activate editing immediately
  const handleAdoptAndEditTarget = async (target: TargetProposal) => {
    setActionError(null);
    try {
      // 1. If target already has a changed decision with replacement in draft, jump to it
      const existingDecision = decisionsMap[refKey(target)];
      if (existingDecision?.outcome === "changed" && existingDecision.replacement?.annotation_id) {
        const repl = (latestDraft.current.annotations ?? []).find(
          (a) => a.annotation.annotation_id === existingDecision.replacement!.annotation_id
        );
        if (repl) {
          setSelectedTargetId(null);
          setSelectedSourceId(null);
          setSelectedAnnotationId(repl.annotation.annotation_id);
          setSelectedEvidenceId(repl.annotation.evidence_refs?.[0]?.evidence_id ?? null);
          setMobilePane("details");
          return;
        }
      }

      // 2. Clone the target proposal into draft annotations
      const snap = (view.available_inputs ?? []).find(
        (s) => s.annotation.annotation_id === target.annotation_id && s.version === target.version
      );

      const targetLayer = target.layer_id ?? snap?.annotation.layer_id ?? layerSelection.activeLayerId;
      if (!targetLayer) {
        setActionError("Keine Schicht für Vorschlag gefunden.");
        return;
      }
      const layerDef = (view.layers ?? []).find((l) => l.layer_id === targetLayer);
      const targetType = target.type_id ?? snap?.annotation.type_id ?? layerSelection.activeTypeId ?? layerDef?.annotation_types?.[0]?.type_id ?? "default";
      const typeDef = layerDef?.annotation_types?.find((t) => t.type_id === targetType);
      const targetTerm = target.term_id ?? snap?.annotation.term_id ?? target.annotation_id;

      const rawAxes = snap?.annotation.axes_values ?? (snap?.annotation as any)?.axes?.values ?? target.axes_values ?? (target.axes && "values" in target.axes ? (target.axes as any).values : target.axes) ?? {};
      const initialAxes = Object.keys(rawAxes).length > 0
        ? (rawAxes as Record<string, string | null>)
        : initialAxisValues(typeDef?.axes ?? view.axes_config ?? [], targetTerm);

      const newAnnId = `ann-${crypto.randomUUID()}`;
      const evidenceList = snap?.evidence ?? [];
      const firstEvidence = evidenceList[0];
      const firstEvidenceId = firstEvidence ? `ev-${Date.now()}` : undefined;
      const initialSegments = firstEvidence ? firstEvidence.mention.segments : [];

      // Create new annotation in draft
      await enqueueMutation({
        command: "create_annotation",
        annotation_id: newAnnId,
        evidence_id: firstEvidenceId,
        layer_id: targetLayer,
        type_id: targetType,
        term_id: targetTerm,
        axes_values: initialAxes,
        segments: initialSegments,
        source_annotation_id: target.annotation_id,
        source_version: target.version,
      });

      // Attach any additional mentions
      for (let i = 1; i < evidenceList.length; i++) {
        const extraEv = evidenceList[i];
        await enqueueMutation({
          command: "attach_mention",
          annotation_id: newAnnId,
          evidence_id: `ev-${Date.now()}-${i}`,
          segments: extraEv.mention.segments,
        });
      }

      // Find created annotation version
      const createdAnn = (latestDraft.current.annotations ?? []).find(
        (a) => a.annotation.annotation_id === newAnnId
      );
      const createdVersion = createdAnn?.version ?? "v1";

      // Record review decision as changed with new annotation as replacement
      const mutationId = crypto.randomUUID();
      let envelope: Parameters<typeof api.recordDecision>[1] | undefined;
      await queueRef.current.enqueue(async (expectedRevision) => {
        envelope ??= {
          mutation_id: mutationId,
          expected_revision: expectedRevision,
          payload: {
            target: {
              annotation_id: target.annotation_id,
              version: target.version,
            },
            outcome: "changed",
            replacement: {
              annotation_id: newAnnId,
              version: createdVersion,
            },
            note: existingDecision?.note,
          },
        };
        const updatedDraft = await api.recordDecision(workspaceId, envelope);
        latestDraft.current = updatedDraft;
        setDraft(updatedDraft);
        return updatedDraft;
      });

      // Switch inspector to this new annotation
      setSelectedTargetId(null);
      setSelectedSourceId(null);
      setSelectedAnnotationId(newAnnId);
      setSelectedEvidenceId(firstEvidenceId ?? null);
      setMobilePane("details");
    } catch (error) {
      reportError(error);
    }
  };

  // Layer state handlers
  const handleSetActiveLayer = async (layerId: string) => {
    try {
      await queueRef.current.flush();
    } catch (error) {
      reportError(error);
      return;
    }
    const scope = view.scope ?? {
      mode: view.key.mode,
      annotator_id: view.key.annotator_id,
      editable_layer_ids: editableLayerIds,
      reference_layer_ids: [],
    };
    const next = setActiveLayer(layerSelection, view.layers ?? [], scope, layerId);
    setSelectedAnnotationId(null); setSelectedEvidenceId(null); setSelectedSourceId(null);
    setSelectionIntent("new_mention"); cancelPending();
    setLayerSelection(next);
  };

  const handleToggleVisibility = (layerId: string) => {
    const next = toggleLayerVisibility(layerSelection, layerId);
    setSelectedAnnotationId(null); setSelectedEvidenceId(null); setSelectedSourceId(null);
    setSelectionIntent("new_mention"); cancelPending();
    setLayerSelection(next);
  };

  const handleSetActiveType = (typeId: string) => {
    cancelPending();
    setLayerSelection(setActiveType(layerSelection, view.layers ?? [], typeId));
  };

  // Single-layer check logic vs multi-layer check logic
  const isSingleLayer = (view.layers ?? []).length <= 1;
  const editableLayerIds = view.scope?.editable_layer_ids ?? (view.layers ? view.layers.map(l => l.layer_id) : []);

  // Submit and finalize workspace
  const handleSubmitWorkspace = async () => {
    setSubmitError(null);

    const checkedIds = latestDraft.current.checked_layer_ids ?? [];
    const unchecked = editableLayerIds.filter((id) => !checkedIds.includes(id));
    if (!isSingleLayer && unchecked.length > 0) {
      const uncheckedNames = unchecked
        .map((id) => view.layers?.find((l) => l.layer_id === id)?.label ?? id)
        .join(", ");
      setSubmitError(`Bitte markieren Sie alle editierbaren Schichten als geprüft vor der Abgabe: ${uncheckedNames}`);
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
            command: "submit_workspace",
            document_checked: true,
            checked_layer_ids: isSingleLayer ? editableLayerIds : latestDraft.current.checked_layer_ids ?? [],
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

  // Selected annotation axes configuration
  const selectedAnnotationLayerDef = useMemo(() => {
    if (!selectedAnnotation) return null;
    return (view.layers ?? []).find((l) => l.layer_id === selectedAnnotation.annotation.layer_id) ?? null;
  }, [selectedAnnotation, view.layers]);

  const selectedAnnotationTypeDef = useMemo(() => {
    if (!selectedAnnotation || !selectedAnnotationLayerDef) return null;
    return selectedAnnotationLayerDef.annotation_types?.find(
      (t) => t.type_id === selectedAnnotation.annotation.type_id
    ) ?? null;
  }, [selectedAnnotation, selectedAnnotationLayerDef]);

  const currentAxesConfig = useMemo(() => {
    return selectedAnnotationTypeDef?.axes ?? view.axes_config ?? [];
  }, [selectedAnnotationTypeDef, view.axes_config]);

  const linkedTargetForSelectedAnnotation = useMemo(() => {
    if (!selectedAnnotation || view.key.mode !== "review") return null;
    const annId = selectedAnnotation.annotation.annotation_id;
    // 1. Check decisions
    const dec = (draft.decisions ?? []).find(
      (d) => d.replacement?.annotation_id === annId && d.outcome === "changed"
    );
    let targetObj: TargetProposal | undefined;
    if (dec) {
      targetObj = reviewTargets.find(
        (t) => t.annotation_id === dec.target.annotation_id && t.version === dec.target.version
      );
    }
    // 2. Check source_refs
    if (!targetObj) {
      const sourceRef = selectedAnnotation.annotation.provenance.source_refs?.[0];
      if (sourceRef) {
        const [tId, tVer] = sourceRef.split(":");
        targetObj = reviewTargets.find((t) => t.annotation_id === tId && t.version === tVer);
      }
    }
    if (!targetObj) return null;
    return {
      target: targetObj,
      targetKey: refKey(targetObj),
      termId: targetObj.term_id ?? targetObj.annotation_id,
      termLabel: termLabel(targetObj.layer_id, targetObj.term_id ?? targetObj.annotation_id),
    };
  }, [selectedAnnotation, view.key.mode, draft.decisions, reviewTargets, termLabel]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await queueRef.current.flush(); onClose(); } catch (error) { reportError(error); } }}>
            ← Übersicht
          </button>
          {documentList && documentList.length > 0 && onNavigateCase ? (
            <CaseNavigation
              documents={documentList}
              currentDocumentId={view.document.document_id}
              onNavigate={async (docId) => {
                try {
                  await queueRef.current.flush();
                  await onNavigateCase(docId);
                } catch (err) {
                  reportError(err);
                }
              }}
              disabled={queueState === "saving"}
            />
          ) : (
            <span>Fall: {view.document.document_id}</span>
          )}
          <span
            className={`badge ${
              view.key.mode === "review"
                ? "badge-review"
                : view.key.mode === "assisted"
                ? "badge-assisted"
                : "badge-independent"
            }`}
          >
            {view.key.mode === "review"
              ? "Review-Modus"
              : view.key.mode === "assisted"
              ? "Assisted-Modus"
              : "Unabhängige Annotation"}
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
            setSelectedAnnotationId(null); setSelectedEvidenceId(null); setSelectedSourceId(null); cancelPending(); setSelectionIntent("new_mention"); setMobilePane("text");
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
      <nav className="mobile-pane-tabs" aria-label="Ansicht wählen">
        {([ ["list", "Liste"], ["text", "Text"], ["details", "Details"] ] as const).map(([pane, label]) => (
          <button key={pane} type="button" aria-pressed={mobilePane === pane}
            onClick={() => setMobilePane(pane)}>{label}</button>
        ))}
      </nav>
      {/* Main Workspace Layout */}
      <div className={`app-layout mobile-pane-${mobilePane}`}>
        {/* Left: Sidebar (Annotations & Review Targets) */}
        <aside className="sidebar">
          {/* Multi-layer controls (rendered only if >1 layer) */}
          <LayerControls
            layers={view.layers ?? []}
            scope={view.scope ?? { scope_id: "default", mode: view.key.mode, editable_layer_ids: [], reference_layer_ids: [] }}
            selection={layerSelection}
            checkedLayerIds={draft.checked_layer_ids ?? []}
            onToggleVisibility={handleToggleVisibility}
            onSetActiveLayer={handleSetActiveLayer}
            onSetActiveType={handleSetActiveType}
            onCheckLayer={(layerId, checked) => {
              void enqueueMutation({ command: "check_layer", layer_id: layerId, checked }).catch(reportError);
            }}
            disabled={queueState === "saving"}
          />

          {view.key.mode === "review" && (
            <>
              <div className="sidebar-header">
                Review-Ziele ({reviewTargets.length})
              </div>
              <ul className="doc-list" style={{ maxHeight: "40%", borderBottom: "2px solid var(--border-color)" }}>
                {reviewTargets.map((t) => {
                  const isSelected = refKey(t) === selectedTargetId;
                  const dec = decisionsMap[refKey(t)];
                  const isResolved = dec?.outcome === "changed" || dec?.outcome === "rejected";
                  return (
                    <li
                      key={refKey(t)}
                      className={`doc-item ${isSelected ? "selected" : ""} ${isResolved ? "doc-item--resolved" : ""}`}
                      style={{
                        opacity: isResolved && !isSelected ? 0.55 : 1,
                        background: isResolved && !isSelected ? "rgba(0, 0, 0, 0.02)" : undefined,
                      }}
                      onClick={() => {
                        const targetKey = refKey(t);
                        setSelectedTargetId(targetKey);
                        setSelectedAnnotationId(null);
                        setSelectedSourceId(null);
                        cancelPending();
                        setMobilePane("details");
                        const snap = (view.available_inputs ?? []).find(
                          (s) => s.annotation.annotation_id === t.annotation_id && s.version === t.version
                        );
                        const firstEv = snap?.evidence?.[0];
                        if (firstEv) {
                          setSelectedEvidenceId(`target:${t.annotation_id}:${t.version}:${firstEv.mention.evidence_id}:${firstEv.version}`);
                        } else {
                          setSelectedEvidenceId(null);
                        }
                      }}
                    >
                      <div className="doc-id" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: isResolved && !isSelected ? "var(--text-muted)" : undefined }}>
                          <TermName termId={t.term_id ?? t.annotation_id} label={termLabel(t.layer_id, t.term_id ?? t.annotation_id)} />
                        </span>
                        {dec ? (
                          <span
                            className="badge"
                            style={{
                              fontSize: "0.72rem",
                              fontWeight: 600,
                              padding: "2px 6px",
                              backgroundColor:
                                dec.outcome === "confirmed" ? "var(--success-light)"
                                : dec.outcome === "rejected" ? "var(--danger-light)"
                                : dec.outcome === "changed" ? "#e2e8f0"
                                : "var(--warning-light)",
                              color:
                                dec.outcome === "confirmed" ? "var(--success)"
                                : dec.outcome === "rejected" ? "var(--danger)"
                                : dec.outcome === "changed" ? "#475569"
                                : "var(--warning)",
                            }}
                          >
                            {dec.outcome === "confirmed" ? "✓ Bestätigt"
                             : dec.outcome === "rejected" ? "✕ Verworfen"
                             : dec.outcome === "changed" ? "✎ Ersetzt"
                             : "? Unsicher"}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>offen</span>
                        )}
                      </div>
                      <div className="doc-meta" style={{ color: isResolved && !isSelected ? "var(--text-muted)" : undefined }}>
                        {dec?.outcome === "changed" ? (
                          <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
                            ↳ durch Gegenfassung ersetzt
                          </span>
                        ) : dec?.outcome === "rejected" ? (
                          <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
                            ✕ Vorschlag verworfen
                          </span>
                        ) : (
                          <>{t.evidence_count} Belegstelle(n) • {t.provenance.actor.kind}</>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {visibleSources.length > 0 && <section aria-label="Referenzannotationen">
            <div className="sidebar-header">Referenzannotationen ({visibleSources.length})</div>
            {visibleSources.map(s => <button type="button" className="btn btn-secondary" key={sourceKey(s)}
              aria-pressed={sourceKey(s) === selectedSourceId} onClick={() => selectSource(sourceKey(s))}>
              <TermName termId={s.annotation.term_id} label={termLabel(s.annotation.layer_id, s.annotation.term_id)} />
              <span>{view.layers?.find(l => l.layer_id === s.annotation.layer_id)?.label} · Nur lesen</span>
            </button>)}
          </section>}

          <div className="sidebar-header">
            Eigene Annotationen ({visibleAnnotations.length})
          </div>
          <ul className="doc-list">
            {visibleAnnotations.map((annSnap) => {
              const isSelected =
                annSnap.annotation.annotation_id === selectedAnnotationId;
              const evCount = annSnap.annotation.evidence_refs?.length ?? 0;
              const termId = annSnap.annotation.term_id;
              const axesValues = annSnap.annotation.axes_values ?? (annSnap.annotation as any).axes?.values ?? {};
              const firstAxisVal = Object.values(axesValues).find((v): v is string => typeof v === "string" && v.length > 0);
              const layerName = view.layers?.find((l) => l.layer_id === annSnap.annotation.layer_id)?.label;

              return (
                <li
                  key={annSnap.annotation.annotation_id}
                  className={`doc-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedTargetId(null);
                    setSelectedSourceId(null);
                    cancelPending();
                    setSelectedAnnotationId(annSnap.annotation.annotation_id);
                    setMobilePane("details");
                    const firstEv = annSnap.annotation.evidence_refs?.[0]?.evidence_id;
                    setSelectedEvidenceId(firstEv ?? null);
                  }}
                >
                  <div className="doc-id" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <TermName termId={termId} label={termLabel(annSnap.annotation.layer_id, termId)} />
                    {layerName && (view.layers ?? []).length > 1 && (
                      <span className="badge" style={{ fontSize: "0.7rem" }}>{layerName}</span>
                    )}
                  </div>
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
            {!isSingleLayer && (
              <div style={{ marginBottom: 10, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {editableLayerIds.length > 0 && (
                  <div>
                    Geprüft: {(draft.checked_layer_ids ?? []).filter(id => editableLayerIds.includes(id)).length} von {editableLayerIds.length} Schichten
                  </div>
                )}
              </div>
            )}
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
          mentions={[...mentionsDisplay, ...targetMentions, ...sourceMentions, ...(pendingAnnotation ? [{ evidence_id: pendingAnnotation.evidenceId, segments: pendingAnnotation.segments }] : [])]}
          selectedEvidenceId={selectedEvidenceId}
          selectionIntent={selectionIntent}
          onSelection={handleSelection}
          onPick={handlePickMention}
          onChangeIntent={setSelectionIntent}
        />

        {/* Right: Annotation & Search Panel + Review Actions */}
        <div className="inspector-pane">
          {selectedSource ? (
            <section className="detail-pane" aria-label="Referenzdetails">
              <div className="detail-section">
                <h2><TermName termId={selectedSource.annotation.term_id} label={termLabel(selectedSource.annotation.layer_id, selectedSource.annotation.term_id)} /></h2>
                <p>{view.layers?.find(l => l.layer_id === selectedSource.annotation.layer_id)?.label} · Nur lesen</p>
                <p>{selectedSource.annotation.provenance.actor.actor_id} · {selectedSource.annotation.provenance.method}</p>
                {Object.entries(selectedSource.annotation.axes_values ?? {}).map(([axis, value]) => <p key={axis}>{axis}: {value ?? "Nicht angegeben"}</p>)}
                <h3>Belegstellen ({selectedSource.evidence.length})</h3>
                {selectedSource.evidence.map(ev => <p key={ev.version}>
                  {ev.mention.segments.map(seg => Array.from(view.document.text).slice(seg.start, seg.end).join("")).join(" … ")}
                </p>)}
              </div>
            </section>
          ) : pendingAnnotation ? (
            <section className="detail-pane" aria-label="Neue Annotation">
              <div className="detail-section">
                <h2>Begriff für die Markierung wählen</h2>
                <p>Die Annotation wird nach Auswahl eines Begriffs gespeichert.</p>
                <SearchPanel key={pendingAnnotation.annotationId} searchManager={searchManager}
                  annotationId={pendingAnnotation.annotationId} workspaceKey={view.key} layerId={pendingAnnotation.layerId}
                  onSelectCandidate={(candidate, searchId) => { void createPendingAnnotation(candidate.term_id, searchId); }} />
                <button type="button" className="btn btn-secondary" disabled={queueState === "saving"} onClick={cancelPending}>Abbrechen</button>
              </div>
            </section>
          ) : view.key.mode === "review" && selectedTarget ? (
            <ReviewActions
              key={refKey(selectedTarget)}
              target={selectedTarget}
              termLabel={termLabel(selectedTarget.layer_id, selectedTarget.term_id ?? selectedTarget.annotation_id)}
              resolveTermLabel={termLabel}
              evidence={targetSnapshot?.evidence ?? []}
              documentText={view.document.text}
              currentDecision={decisionsMap[refKey(selectedTarget)] ?? null}
              draftAnnotations={draft.annotations ?? []}
              onDecide={handleReviewDecision}
              onAdoptAndEdit={() => { void handleAdoptAndEditTarget(selectedTarget); }}
              onEditReplacement={(repId) => {
                setSelectedTargetId(null);
                setSelectedSourceId(null);
                setSelectedAnnotationId(repId);
                setSelectedEvidenceId(null);
                setMobilePane("details");
              }}
            />
          ) : (
            <AnnotationPanel
              key={selectedAnnotationId ?? "empty"}
              annotation={selectedAnnotation}
              allEvidence={allEvidenceMap}
              workspaceKey={view.key}
              searchManager={searchManager}
              selectedEvidenceId={selectedEvidenceId}
              layerId={selectedAnnotation?.annotation.layer_id}
              termLabel={selectedAnnotation ? termLabel(selectedAnnotation.annotation.layer_id, selectedAnnotation.annotation.term_id) : null}
              axesConfig={currentAxesConfig}
              linkedTarget={linkedTargetForSelectedAnnotation ? {
                targetId: linkedTargetForSelectedAnnotation.targetKey,
                termId: linkedTargetForSelectedAnnotation.termId,
                termLabel: linkedTargetForSelectedAnnotation.termLabel,
              } : null}
              onNavigateTarget={linkedTargetForSelectedAnnotation ? () => {
                setSelectedAnnotationId(null);
                setSelectedSourceId(null);
                setSelectedEvidenceId(null);
                setSelectedTargetId(linkedTargetForSelectedAnnotation.targetKey);
                setMobilePane("details");
              } : undefined}
              onSelectEvidence={(evId) => setSelectedEvidenceId(evId)}
              onUpdateTerm={(...args) => { void handleUpdateTerm(...args).catch(reportError); }}
              onUpdateAxes={(axesValues) => { void handleUpdateAxes(axesValues).catch(reportError); }}
              onAttachMention={(segments) =>
                handleSelection({ segments, intent: "new_mention" })
              }
              onDetachMention={(id) => { void handleDetachMention(id).catch(reportError); }}
              onDeleteAnnotation={(id) => { void handleDeleteAnnotation(id).catch(reportError); }}
              onSetIntent={setSelectionIntent}
            />
          )}
        </div>
      </div>

      {historySubmission && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-label="Historische Abgabe">
          <h2>Abgabe {historySubmission.submission_id}</h2>
          <p>{historySubmission.created_at}</p>
          <p>
            Geprüfte Schichten:{" "}
            {historySubmission.checked_layer_ids && historySubmission.checked_layer_ids.length > 0
              ? historySubmission.checked_layer_ids.join(", ")
              : (historySubmission.document_checked ? "Dokument geprüft" : "Keine")}
          </p>
          {historySubmission.snapshots.map(snap => {
            const axesVal = snap.annotation.axes_values ?? (snap.annotation as any).axes?.values;
            return (
              <div key={refKey({annotation_id:snap.annotation.annotation_id,version:snap.version})}>
                <strong><TermName termId={snap.annotation.term_id} label={termLabel(snap.annotation.layer_id, snap.annotation.term_id)} /></strong>
                <p>
                  {axesVal && Object.keys(axesVal).length > 0
                    ? Object.entries(axesVal)
                        .map(([k, v]) => `${k}: ${v ?? "Nicht angegeben"}`)
                        .join(" · ")
                    : "Keine Achsen"}
                </p>
                {snap.evidence.map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
                  {ev.mention.segments.map(seg => Array.from(view.document.text).slice(seg.start, seg.end).join("")).join(" … ")}
                </p>)}
              </div>
            );
          })}
          {historySubmission.decisions.map(decision => <p key={refKey(decision.target)}>
            {decision.target.annotation_id} ({decision.target.version}): {decision.outcome} {decision.note}
          </p>)}
          <button type="button" className="btn btn-secondary" onClick={() => setHistorySubmission(null)}>
            Schließen
          </button>
        </div>
      </div>}

      {completedSubmission && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-label="Abgabe abgeschlossen">
          <h2>✓ Fall erfolgreich abgegeben!</h2>
          <p>Abgabe-ID: <code>{completedSubmission.submission_id}</code></p>
          <p>Zeitstempel: {completedSubmission.created_at}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={downloadExport}
            >
              📥 Export herunterladen
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCompletedSubmission(null)}
            >
              Im Fall bleiben
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Zurück zur Übersicht
            </button>
          </div>
        </div>
      </div>}

      {showSpanlessModal && (
        <div className="modal-overlay">
          <div className="modal-content" role="dialog" aria-label="Spanlose Annotation erstellen">
            <h2>Spanlose Annotation hinzufügen</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Geben Sie die Kennung des Begriffs ein (z. B. <code>HP:0001250</code> oder <code>1250</code>):
            </p>
            <div className="form-group">
              <input
                id="spanless-hpo-id"
                type="text"
                className="form-control"
                placeholder="HP:0001250"
                value={spanlessHpoId}
                onChange={(e) => setSpanlessHpoId(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowSpanlessModal(false);
                  setSpanlessHpoId("");
                }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateSpanless}
                disabled={!spanlessHpoId.trim()}
                aria-label="Annotation anlegen"
              >
                Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
