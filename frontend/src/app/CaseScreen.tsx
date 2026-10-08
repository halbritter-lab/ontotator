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
import { AiBadge } from "../editor/AiBadge";
import { AnnotationPanel, quoteSegments, type EvidenceSnapshot } from "../editor/AnnotationPanel";
import {
  createMutationQueue,
  DiscardedChangesError,
  isNetworkError,
  UnsavedChangesError,
  type MutationQueue,
  type QueueState,
} from "../editor/autosave";
import { newEvidenceId } from "../editor/ids";
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
  type ReviewDecisionOutcome,
  type TargetProposal,
} from "../editor/ReviewActions";
import { useSearchLanguages } from "../editor/searchLanguages";
import { SearchPanel } from "../editor/SearchPanel";
import { SearchManager } from "../editor/searchState";
import { TermName } from "../editor/TermName";
import { TextPane } from "../editor/TextPane";
import { TreeBrowser } from "../editor/TreeBrowser";
import { useMinWidth } from "../editor/useMinWidth";
import { useTermLabels } from "../editor/useTermLabels";
import { termColorIndex, type MentionDisplay, type SelectionPayload } from "../spans/adapter";
import { CaseNavigation } from "./CaseNavigation";
import { adjacentCase } from "./caseOrder";

const refKey = (r: { annotation_id: string; version: string }) => JSON.stringify([r.annotation_id, r.version]);

/**
 * Initial axis values for a new annotation: every axis starts unspecified (null).
 * No clinical defaults (e.g. assertion "present") are ever pre-filled.
 */
export const initialAxisValues = (
  axes: { id: string; options: string[] }[],
  _termId?: string,
): Record<string, string | null> => Object.fromEntries(axes.map((axis) => [axis.id, null]));

const normalizeAxes = (axes: Record<string, string | null | undefined> | null | undefined) =>
  Object.fromEntries(
    Object.entries(axes ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const segmentsKey = (evidence: { mention: { segments: { start: number; end: number }[] } }[]) =>
  JSON.stringify(
    evidence
      .map((ev) => [...ev.mention.segments].sort((a, b) => a.start - b.start).map((s) => [s.start, s.end]))
      .map((segs) => JSON.stringify(segs))
      .sort(),
  );

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object") return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  const editable = el.getAttribute?.("contenteditable");
  return editable !== null && editable !== undefined && editable !== "false";
};

export const SHORTCUTS: { keys: string; description: string; reviewOnly?: boolean }[] = [
  { keys: "j / k", description: "Next / previous review proposal", reviewOnly: true },
  { keys: "1", description: "Confirm selected proposal", reviewOnly: true },
  { keys: "2", description: "Reject selected proposal", reviewOnly: true },
  { keys: "3", description: "Adopt proposal as editable copy", reviewOnly: true },
  { keys: "4", description: "Mark selected proposal as uncertain", reviewOnly: true },
  { keys: "Esc", description: "Clear selection / cancel adding a mention" },
  { keys: "Alt + ← / →", description: "Previous / next case" },
  { keys: "Shift + arrows, then release Shift", description: "Select text with the keyboard to create a mention" },
  { keys: "← / →  (Ctrl: by word)", description: "Move the focused mention edge (Tab to an edge handle of the selected annotation)" },
  { keys: "?", description: "Show / hide this help" },
];

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

export type WorkspaceView = components["schemas"]["WorkspaceView"];

export interface CaseScreenProps {
  view: WorkspaceView;
  workspaceId: string;
  onClose: () => void;
  onNavigateCase?: (documentId: string) => Promise<void>;
  documentList?: DocumentSummary[];
  /** Re-open this case from the server (used to resolve revision conflicts). */
  onReload?: () => Promise<void>;
  /** Called after a successful submission (e.g. to refresh the case list). */
  onSubmitted?: () => void | Promise<void>;
  /** This annotator's stored choice: the ontology tree stays open as a side panel. */
  treePinned?: boolean;
  /** Called when the annotator pins or releases the tree, to store the choice. */
  onTreePinnedChange?: (pinned: boolean) => void;
}

export const CaseScreen: React.FC<CaseScreenProps> = ({
  view,
  workspaceId,
  onClose,
  onNavigateCase,
  documentList,
  onReload,
  onSubmitted,
  treePinned = false,
  onTreePinnedChange,
}) => {
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    annotationId: string;
    evidenceId?: string;
    layerId: string;
    typeId: string;
    segments: SelectionPayload["segments"];
    isSpanless?: boolean;
  } | null>(null);
  const [isAttachingMention, setIsAttachingMention] = useState(false);
  const [textResyncToken, setTextResyncToken] = useState(0);
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
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectionIntent, setSelectionIntent] = useState<"new_mention" | "extend_mention">("new_mention");
  const [queueState, setQueueState] = useState<QueueState>("saved");
  const [queueError, setQueueError] = useState<unknown>(null);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [textCheckedConfirmed, setTextCheckedConfirmed] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  // Reviewer notes typed in the UI, keyed by target; kept even when a decision is reset.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const noteDraftsRef = useRef(noteDrafts);
  noteDraftsRef.current = noteDrafts;

  // Modals
  const [completedSubmission, setCompletedSubmission] = useState<Submission | null>(null);
  const [historySubmission, setHistorySubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "text" | "details">("text");
  // The ontology tree. One entry is one walk; a new nonce starts a new one.
  const [treeWalk, setTreeWalk] = useState<{
    nonce: number;
    annotationId: string;
    layerId: string;
    termId: string;
    /** Whether to move the keyboard focus into the tree when it has loaded. */
    focus: boolean;
  } | null>(null);
  const treeNonce = useRef(0);
  const [treePinnedNow, setTreePinnedNow] = useState(treePinned);
  // Below this width there is no room for a docked tree next to text and annotation panel.
  const wideEnoughToPin = useMinWidth(1100);

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

  // Search languages: stored per annotator, offered per ontology of the layer.
  const languagesForOntology = useSearchLanguages(api, view.key.annotator_id);
  const searchLanguagesFor = (layerId: string | null | undefined) => {
    const ontologyId = (view.layers ?? []).find((layer) => layer.layer_id === layerId)?.ontology_id;
    const definition = (view.ontologies ?? []).find((item) => item.ontology_id === ontologyId);
    return languagesForOntology(definition?.sha256);
  };

  // Dedicated mutation queue for this workspace
  const queueRef = useRef<MutationQueue>(null as unknown as MutationQueue);
  if (!queueRef.current) queueRef.current = (
    createMutationQueue({
      initialRevision: view.draft.revision,
      onState: (state) => {
        setQueueState(state);
        setQueueError(state === "error" || state === "conflict" ? queueRef.current?.getLastError() ?? null : null);
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
        provenance: snap?.annotation.provenance ?? null,
        evidence_count: snap?.annotation.evidence_refs?.length ?? 0,
        quote: snap?.evidence?.[0] ? quoteSegments(view.document.text, snap.evidence[0].mention.segments, 40) : undefined,
        is_obsolete: (view.term_statuses?.[statusKey] ?? view.term_statuses?.[termId]) === "obsolete",
        is_unknown: (view.term_statuses?.[statusKey] ?? view.term_statuses?.[termId]) === "unknown",
      };
    });
  }, [view.key.mode, view.targets, view.available_inputs, view.term_statuses, view.document.text]);

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
  // Keep the selected sidebar entry visible, wherever the selection came from
  // (text click, "Replaced by", keyboard navigation).
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  // Same precedence as the inspector pane: reference, then proposal, then annotation.
  const selectedListKey = selectedSourceId ? `source:${selectedSourceId}`
    : selectedTargetId ? `target:${selectedTargetId}`
    : selectedAnnotationId ? `annotation:${selectedAnnotationId}`
    : null;
  useEffect(() => {
    if (!selectedListKey) return;
    const entry = Array.from(
      sidebarScrollRef.current?.querySelectorAll<HTMLElement>("[data-list-key]") ?? [],
    ).find((el) => el.dataset.listKey === selectedListKey);
    // jsdom has no scrollIntoView.
    entry?.scrollIntoView?.({ block: "nearest" });
    // In the tab layout the list is hidden while another tab is open: catch up when it returns.
  }, [selectedListKey, mobilePane]);
  const sourceMentions: MentionDisplay[] = useMemo(() => visibleSources.flatMap(s => s.evidence.map(ev => ({
    evidence_id: `source:${sourceKey(s)}:${ev.mention.evidence_id}:${ev.version}`,
    sourceId: sourceKey(s),
    segments: ev.mention.segments,
    kind: "source" as const,
    colorIndex: termColorIndex(s.annotation.term_id),
  }))), [visibleSources]);
  const selectSource = (id: string) => {
    setSelectedTargetId(null);
    setSelectedAnnotationId(null);
    setSelectedSourceId(id);
    setSelectedEvidenceId(null);
    setMobilePane("details");
    setSelectionIntent("new_mention");
    cancelPending();
  };

  const reportError = (error: unknown) => {
    if (error instanceof DiscardedChangesError) return; // user explicitly discarded these edits
    setActionError(error instanceof Error ? error.message : String(error));
  };

  /** In-app confirmation dialog (resolves true when confirmed). */
  const askConfirm = (title: string, message: string, confirmLabel = "Continue") =>
    new Promise<boolean>((resolve) => setConfirmRequest({ title, message, confirmLabel, resolve }));
  const closeConfirm = (ok: boolean) => {
    const request = confirmRequest;
    setConfirmRequest(null);
    request?.resolve(ok);
  };

  /**
   * Flush pending edits before leaving the case. If they cannot be saved (conflict or
   * server unreachable) the user may explicitly discard them and leave anyway.
   */
  const leaveCase = async (action: () => void | Promise<void>): Promise<void> => {
    try {
      await queueRef.current.flush();
    } catch (error) {
      if (!(error instanceof UnsavedChangesError)) { reportError(error); return; }
      const pending = queueRef.current.pendingCount();
      const ok = await askConfirm(
        error.state === "conflict" ? "Case was changed elsewhere" : "Changes not saved",
        error.state === "conflict"
          ? `This case was changed in another window or session. ${pending} unsaved edit(s) in this window will be discarded.`
          : `${pending} edit(s) could not be saved because the server is unreachable. Leaving discards them.`,
        "Discard edits and leave",
      );
      if (!ok) return;
      queueRef.current.discardPending();
    }
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  };

  /** Resolve a revision conflict by reloading the case from the server. */
  const reloadCase = async () => {
    if (!onReload) return;
    const pending = queueRef.current.pendingCount();
    if (pending > 0) {
      const ok = await askConfirm(
        "Reload case",
        `Reloading loads the current server version. ${pending} unsaved edit(s) in this window will be discarded.`,
        "Discard edits and reload",
      );
      if (!ok) return;
    }
    queueRef.current.discardPending();
    setIsReloading(true);
    try {
      await onReload();
    } catch (error) {
      reportError(error);
    } finally {
      setIsReloading(false);
    }
  };

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => {
      setIsOffline(false);
      if (queueRef.current.getState() === "error") void queueRef.current.retry();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  const statusText =
    queueState === "conflict" ? "Changed elsewhere – reload required"
    : queueState === "error" ? (isNetworkError(queueError) || isOffline ? "Offline – changes not saved" : "Save error – changes not saved")
    : queueState === "saving" ? "Saving..."
    : queueState === "dirty" ? "Unsaved changes"
    : isOffline ? "Offline"
    : "Saved";
  const statusIsError = queueState === "conflict" || queueState === "error" || isOffline;

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

  const handleDeselectAll = () => {
    setSelectedAnnotationId(null);
    setSelectedTargetId(null);
    setSelectedSourceId(null);
    setSelectedEvidenceId(null);
    setIsAttachingMention(false);
    cancelPending();
  };

  const targetKeyOf = (t: { annotation_id: string; version: string }) => refKey(t);
  const targetSnapshotOf = (t: { annotation_id: string; version: string }) =>
    (view.available_inputs ?? []).find(
      (snap) => snap.annotation.annotation_id === t.annotation_id && snap.version === t.version,
    );
  /** Review target an annotation was adopted from (via provenance.source_refs). */
  const sourceTargetOf = (snap: AnnotationSnapshot) => {
    const refs = snap.annotation.provenance.source_refs ?? [];
    return reviewTargets.find((t) => refs.includes(`${t.annotation_id}:${t.version}`)) ?? null;
  };
  /** Current reviewer note for a target: unsaved UI text wins over the stored decision note. */
  const currentNoteFor = (targetKey: string): string | undefined => {
    const draftNote = noteDraftsRef.current[targetKey];
    const stored = (latestDraft.current.decisions ?? []).find((d) => refKey(d.target) === targetKey)?.note;
    const value = draftNote ?? stored ?? "";
    return value.trim() || undefined;
  };
  /** Whether an adopted copy differs from its source proposal (term, type, axes or mentions). */
  const copyDiffersFromTarget = (copy: AnnotationSnapshot, target: { annotation_id: string; version: string }) => {
    const source = targetSnapshotOf(target);
    if (!source) return true;
    if (copy.annotation.term_id !== source.annotation.term_id) return true;
    if (copy.annotation.type_id !== source.annotation.type_id) return true;
    if (JSON.stringify(normalizeAxes(copy.annotation.axes_values)) !== JSON.stringify(normalizeAxes(source.annotation.axes_values))) return true;
    const copyEvidence = (copy.annotation.evidence_refs ?? [])
      .map((ref) => (latestDraft.current.evidence ?? []).find((ev) => ev.mention.evidence_id === ref.evidence_id))
      .filter((ev): ev is NonNullable<typeof ev> => !!ev);
    return segmentsKey(copyEvidence) !== segmentsKey(source.evidence ?? []);
  };

  const enqueueDecision = (
    target: { annotation_id: string; version: string },
    outcome: ReviewDecisionOutcome | null,
    replacementId?: string,
    note?: string,
  ): Promise<Draft> => {
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.recordDecision>[1] | undefined;
    return queueRef.current.enqueue(async (expectedRevision) => {
      if (!envelope) {
        const replacement = replacementId
          ? (latestDraft.current.annotations ?? []).find((a) => a.annotation.annotation_id === replacementId)
          : undefined;
        envelope = {
          mutation_id: mutationId,
          expected_revision: expectedRevision,
          payload: {
            target: { annotation_id: target.annotation_id, version: target.version },
            outcome,
            replacement: replacement
              ? { annotation_id: replacement.annotation.annotation_id, version: replacement.version }
              : undefined,
            note,
          },
        };
      }
      const nextDraft = await api.recordDecision(workspaceId, envelope);
      latestDraft.current = nextDraft;
      setDraft(nextDraft);
      return nextDraft;
    });
  };

  /**
   * After an annotation edit, keep a "changed" review decision bound to the latest
   * replacement version. Explicit confirmed/rejected/uncertain decisions are never
   * overridden, and an adopted copy only records "changed" once it actually differs.
   */
  const syncReplacementDecision = async (annotationId: string) => {
    if (view.key.mode !== "review") return;
    const current = latestDraft.current;
    const ann = (current.annotations ?? []).find((a) => a.annotation.annotation_id === annotationId);
    if (!ann) return;
    const decisions = current.decisions ?? [];
    let decision = decisions.find((d) => d.outcome === "changed" && d.replacement?.annotation_id === annotationId);
    let target: { annotation_id: string; version: string } | null = decision?.target ?? null;
    if (!target) {
      const source = sourceTargetOf(ann);
      if (!source) return;
      decision = decisions.find((d) => refKey(d.target) === refKey(source));
      if (decision) return; // explicit decision exists (or replaced by another annotation): leave it alone
      if (!copyDiffersFromTarget(ann, source)) return;
      target = { annotation_id: source.annotation_id, version: source.version };
    }
    if (decision?.replacement?.version === ann.version) return; // already bound to this version
    await enqueueDecision(target, "changed", annotationId, currentNoteFor(refKey(target)));
  };

  // Mutate an annotation and synchronize any linked review decision
  const mutateAnnotationAndSyncDecision = async (
    annotationId: string,
    mutationAction: () => Promise<Draft>
  ): Promise<Draft> => {
    const updatedDraft = await mutationAction();
    await syncReplacementDecision(annotationId);
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
              if (!existingEv) throw new ValidationError("Mention evidence is no longer present");
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
            if (!existingEv) throw new ValidationError("Mention evidence is no longer present");
            return {
              command: "edit_mention",
              evidence_id: evidenceId,
              annotation_id: annotationId,
              segments: [...existingEv.mention.segments, ...payload.segments].sort((a, b) => a.start - b.start),
            };
          });
        }
        setSelectionIntent("new_mention");
      } else if (isAttachingMention && selectedAnnotationId) {
        const evidenceId = newEvidenceId();
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
        setIsAttachingMention(false);
      } else {
        if (!layerSelection.activeLayerId) {
          setActionError("No active editable layer selected. Please activate a layer.");
          return;
        }
        const activeLayerId = layerSelection.activeLayerId;
        const activeLayerDef = (view.layers ?? []).find(l => l.layer_id === activeLayerId);
        const activeTypeId = layerSelection.activeTypeId ?? activeLayerDef?.annotation_types?.[0]?.type_id ?? "default";
        const evidenceId = newEvidenceId();
        handleDeselectAll();
        setPendingAnnotation({
          annotationId: `ann-${crypto.randomUUID()}`,
          evidenceId,
          layerId: activeLayerId,
          typeId: activeTypeId,
          segments: payload.segments,
          isSpanless: false,
        });
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
      await enqueueMutation({
        command: "create_annotation",
        annotation_id: pending.annotationId,
        evidence_id: pending.evidenceId,
        layer_id: pending.layerId,
        type_id: pending.typeId,
        term_id: termId,
        search_event_id: searchId,
        segments: pending.segments,
        axes_values: initialAxisValues(type?.axes ?? [], termId),
      });
      setPendingAnnotation(null);
      setSelectedTargetId(null);
      setSelectedSourceId(null);
      setSelectedAnnotationId(pending.annotationId);
      setSelectedEvidenceId(pending.evidenceId ?? null);
      searchManager.clear();
    } catch (error) { reportError(error); }
    finally { creatingPending.current = false; }
  };

  const handlePickMention = (evidenceId: string) => {
    if (evidenceId === pendingAnnotation?.evidenceId) return;

    const source = sourceMentions.find(mention => mention.evidence_id === evidenceId);
    if (source && source.sourceId) {
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

  const handleStartSpanless = () => {
    if (!layerSelection.activeLayerId) {
      setActionError("No active editable layer selected. Please activate a layer.");
      return;
    }
    const activeLayerId = layerSelection.activeLayerId;
    const activeLayerDef = (view.layers ?? []).find(l => l.layer_id === activeLayerId);
    const activeTypeId = layerSelection.activeTypeId ?? activeLayerDef?.annotation_types?.[0]?.type_id ?? "default";

    handleDeselectAll();
    setPendingAnnotation({
      annotationId: `ann-${crypto.randomUUID()}`,
      layerId: activeLayerId,
      typeId: activeTypeId,
      segments: [],
      isSpanless: true,
    });
    setMobilePane("details");
  };

  // One path for every term change, from the search and from the tree: through the
  // mutation queue, then the review post-processing.
  const setTermOf = (annotationId: string, termId: string, searchId?: string) =>
    mutateAnnotationAndSyncDecision(annotationId, () =>
      enqueueMutation({
        command: "set_term",
        annotation_id: annotationId,
        term_id: termId,
        search_event_id: searchId,
      })
    );

  const handleUpdateTerm = async (termId: string, searchId?: string) => {
    if (!selectedAnnotationId) return;
    await setTermOf(selectedAnnotationId, termId, searchId);
  };

  // --- Ontology tree -----------------------------------------------------------
  // The annotation the inspector shows as editable right now (same precedence as the pane itself).
  const treeAnnotation =
    !selectedSource && !pendingAnnotation && !(view.key.mode === "review" && selectedTarget)
      ? selectedAnnotation
      : null;
  // Docked as a side panel instead of shown as a dialog.
  const treeDocked = !!treeWalk && treePinnedNow && wideEnoughToPin;
  // The annotation the open walk belongs to, as it is in the draft now.
  const treeWalkAnnotation = treeWalk
    ? (draft.annotations ?? []).find((a) => a.annotation.annotation_id === treeWalk.annotationId) ?? null
    : null;

  const startTreeWalk = (annotation: AnnotationSnapshot, focus: boolean) => {
    treeNonce.current += 1;
    setTreeWalk({
      nonce: treeNonce.current,
      annotationId: annotation.annotation.annotation_id,
      layerId: annotation.annotation.layer_id,
      termId: annotation.annotation.term_id,
      focus,
    });
  };

  const handleShowInTree = () => {
    if (!treeAnnotation || !treeAnnotation.annotation.term_id) return;
    startTreeWalk(treeAnnotation, true);
  };

  // "Use this term": the same set_term as a search selection, bound to the walk's event.
  // A failure is thrown to the tree, which shows it (the page's own error line is behind the dialog).
  const handleUseTreeTerm = async (termId: string, browseId: string) => {
    if (!treeWalk) return;
    await setTermOf(treeWalk.annotationId, termId, browseId);
    if (!treeDocked) setTreeWalk(null);
  };

  // Pinning a dialog docks the same walk. Releasing the pin closes the panel.
  const handleToggleTreePin = () => {
    const next = !treePinnedNow;
    setTreePinnedNow(next);
    onTreePinnedChange?.(next);
    if (!next) setTreeWalk(null);
  };

  // A docked tree follows the selection: another own annotation with a term starts a new
  // walk there. Anything else (a proposal, a reference, nothing) leaves the tree as it is.
  const followAnnotationId = treeAnnotation?.annotation.term_id ? treeAnnotation.annotation.annotation_id : null;
  useEffect(() => {
    if (!treeDocked || !treeWalk || !treeAnnotation || !followAnnotationId) return;
    if (followAnnotationId === treeWalk.annotationId) return;
    startTreeWalk(treeAnnotation, false);
    // Only a change of the selected annotation moves the tree, not an edit of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followAnnotationId, treeDocked]);

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

  // A mention edge was dragged (or moved by keyboard) in the text.
  const handleResizeMention = async (evidenceId: string, segments: Array<{ start: number; end: number }>) => {
    // A keyboard resize is reported after a pause, so the selection may have moved on:
    // save to the annotation the mention belongs to, preferring the selected one.
    const owners = (latestDraft.current.annotations ?? [])
      .filter((a) => (a.annotation.evidence_refs ?? []).some((r) => r.evidence_id === evidenceId))
      .map((a) => a.annotation.annotation_id);
    const annId = owners.find((id) => id === selectedAnnotationId) ?? (owners.length === 1 ? owners[0] : null);
    if (!annId) {
      setTextResyncToken((token) => token + 1);
      return;
    }
    try {
      const updated = await mutateAnnotationAndSyncDecision(annId, () =>
        enqueueMutation({
          command: "edit_mention",
          annotation_id: annId,
          evidence_id: evidenceId,
          segments,
        })
      );
      // Shared evidence is copied on write and gets a new id: keep the selection on it.
      const refs = (updated.annotations ?? []).find((a) => a.annotation.annotation_id === annId)
        ?.annotation.evidence_refs ?? [];
      if (selectedEvidenceId === evidenceId && !refs.some((r) => r.evidence_id === evidenceId)) {
        setSelectedEvidenceId(refs.find((r) => r.evidence_id.startsWith(`${evidenceId}-cow-`))?.evidence_id ?? null);
      }
    } catch (error) {
      // The text already shows the new edge: put it back to the saved state.
      setTextResyncToken((token) => token + 1);
      reportError(error);
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

  // Review Decision Handler: always carries the current reviewer note.
  const handleReviewDecision = async (payload: DecisionPayload, forTarget?: TargetProposal | null) => {
    const target = forTarget ?? selectedTarget;
    if (!target) return;
    setActionError(null);
    const key = targetKeyOf(target);
    let note: string | undefined;
    if (payload.outcome === null) {
      // Removing a decision must not silently lose the note text: keep it in the editor.
      const keep = noteDraftsRef.current[key] ?? decisionsMap[key]?.note ?? "";
      if (keep) setNoteDrafts((prev) => ({ ...prev, [key]: keep }));
      note = undefined;
    } else {
      note = payload.note !== undefined ? (payload.note.trim() || undefined) : currentNoteFor(key);
    }
    try {
      await enqueueDecision(target, payload.outcome, payload.replacement?.annotation_id, note);
      if (payload.outcome !== null) {
        setNoteDrafts((prev) => {
          if (!(key in prev)) return prev;
          if ((prev[key].trim() || undefined) !== note) return prev;
          const rest = { ...prev };
          delete rest[key];
          return rest;
        });
      }
    } catch (error) { reportError(error); }
  };

  // Adopt a review target as an editable draft copy and switch to editing it.
  // The "changed" decision is recorded only once the copy actually differs.
  const handleAdoptAndEditTarget = async (target: TargetProposal) => {
    setActionError(null);
    const key = targetKeyOf(target);
    const existingDecision = (latestDraft.current.decisions ?? []).find((d) => refKey(d.target) === key);
    const openCopy = (annotationId: string) => {
      const repl = (latestDraft.current.annotations ?? []).find((a) => a.annotation.annotation_id === annotationId);
      setSelectedTargetId(null);
      setSelectedSourceId(null);
      setSelectedAnnotationId(annotationId);
      setSelectedEvidenceId(repl?.annotation.evidence_refs?.[0]?.evidence_id ?? null);
      setMobilePane("details");
    };

    // 1. Already replaced: jump to the replacement.
    const replacementId = existingDecision?.outcome === "changed" ? existingDecision.replacement?.annotation_id : undefined;
    if (replacementId && (latestDraft.current.annotations ?? []).some((a) => a.annotation.annotation_id === replacementId)) {
      openCopy(replacementId);
      return;
    }
    const existingCopy = (latestDraft.current.annotations ?? []).find((a) => {
      const src = sourceTargetOf(a);
      return src !== null && refKey(src) === key;
    });

    // 2. An explicit decision exists: ask before replacing it.
    if (existingDecision && existingDecision.outcome !== "changed") {
      const ok = await askConfirm(
        "Replace existing decision?",
        `This proposal is already marked as ${existingDecision.outcome}. Editing a copy resets that decision; it becomes "changed" once the copy differs from the proposal.`,
        "Reset decision and edit copy",
      );
      if (!ok) return;
      try {
        await enqueueDecision(target, null);
      } catch (error) { reportError(error); return; }
    }

    if (existingCopy) {
      openCopy(existingCopy.annotation.annotation_id);
      return;
    }

    // 3. Clone the target proposal into the draft.
    const snap = targetSnapshotOf(target);
    const targetLayer = target.layer_id ?? snap?.annotation.layer_id ?? layerSelection.activeLayerId;
    if (!targetLayer) {
      setActionError("No layer found for proposal.");
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
    const firstEvidenceId = firstEvidence ? newEvidenceId() : undefined;
    let created = false;
    try {
      await enqueueMutation({
        command: "create_annotation",
        annotation_id: newAnnId,
        evidence_id: firstEvidenceId,
        layer_id: targetLayer,
        type_id: targetType,
        term_id: targetTerm,
        axes_values: initialAxes,
        segments: firstEvidence ? firstEvidence.mention.segments : [],
        source_annotation_id: target.annotation_id,
        source_version: target.version,
      });
      created = true;
      for (let i = 1; i < evidenceList.length; i++) {
        await enqueueMutation({
          command: "attach_mention",
          annotation_id: newAnnId,
          evidence_id: newEvidenceId(),
          segments: evidenceList[i].mention.segments,
        });
      }
    } catch (error) {
      if (error instanceof DiscardedChangesError) return;
      let rolledBack = false;
      if (created && queueRef.current.getState() !== "conflict") {
        try {
          await enqueueMutation({ command: "delete_draft_annotation", annotation_id: newAnnId });
          rolledBack = true;
        } catch { /* reported below */ }
      }
      const message = error instanceof Error ? error.message : String(error);
      setActionError(
        created
          ? `Adopting the proposal failed (${message}). ${rolledBack ? "The incomplete copy was removed." : "An incomplete copy may remain in the draft - please check or delete it."}`
          : `Adopting the proposal failed: ${message}`,
      );
      return;
    }
    openCopy(newAnnId);
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
  // Only the selected curated annotation's mentions can be resized, and not while
  // another text interaction (attaching a mention, choosing a term) is in progress.
  const resizableEvidenceIds = selectedAnnotation && !isAttachingMention && !pendingAnnotation
    && editableLayerIds.includes(selectedAnnotation.annotation.layer_id)
    ? (selectedAnnotation.annotation.evidence_refs ?? []).map((r) => r.evidence_id)
    : [];

  const openReviewTargets = reviewTargets.filter(
    (t) => !(draft.decisions ?? []).some((d) => refKey(d.target) === refKey(t)),
  );
  // Confirmed proposals are submitted as they are, next to the draft's own annotations.
  const confirmedCount = (draft.decisions ?? []).filter((d) => d.outcome === "confirmed").length;

  // Step 1: validate, save pending edits and open the confirmation dialog.
  const handleSubmitWorkspace = async () => {
    setSubmitError(null);

    const checkedIds = latestDraft.current.checked_layer_ids ?? [];
    const unchecked = editableLayerIds.filter((id) => !checkedIds.includes(id));
    if (!isSingleLayer && unchecked.length > 0) {
      const uncheckedNames = unchecked
        .map((id) => view.layers?.find((l) => l.layer_id === id)?.label ?? id)
        .join(", ");
      setSubmitError(`Please mark all editable layers as verified before submitting: ${uncheckedNames}`);
      return;
    }

    try {
      await queueRef.current.flush();
    } catch (error) { reportError(error); return; }

    setTextCheckedConfirmed(false);
    setSubmitDialogOpen(true);
  };

  // Step 2: submit after the explicit "entire text checked" confirmation.
  const confirmSubmit = async () => {
    if (!textCheckedConfirmed) return;
    if (view.key.mode === "review") {
      const missingTargets = reviewTargets.filter((t) => !(latestDraft.current.decisions ?? []).some(d => refKey(d.target) === refKey(t)));
      if (missingTargets.length > 0) {
        setSubmitError(
          `There are still ${missingTargets.length} undecided review proposals. Please make a decision for each proposal before submitting.`
        );
        return;
      }
    }
    setSubmitDialogOpen(false);
    try {
      const mutationId = crypto.randomUUID();
      let envelope: Parameters<typeof api.submitWorkspace>[1] | undefined;
      const submission = await queueRef.current.enqueue(async (expectedRevision) => {
        envelope ??= {
          mutation_id: mutationId,
          expected_revision: expectedRevision,
          payload: {
            command: "submit_workspace",
            // Explicitly confirmed by the user in the submit dialog.
            document_checked: true,
            checked_layer_ids: isSingleLayer ? editableLayerIds : latestDraft.current.checked_layer_ids ?? [],
          },
        };
        return api.submitWorkspace(workspaceId, envelope);
      });
      setCompletedSubmission(submission);
      try {
        await onSubmitted?.();
      } catch {
        // list refresh is best effort
      }
    } catch (err: unknown) {
      if (err instanceof DiscardedChangesError) return;
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(`Submission failed: ${msg}`);
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

  // In review mode, cases without proposals are skipped.
  const prevDoc = documentList ? adjacentCase(documentList, view.document.document_id, -1) : null;
  const nextDoc = documentList ? adjacentCase(documentList, view.document.document_id, 1) : null;

  const modalOpen = !!(confirmRequest || completedSubmission || historySubmission || submitDialogOpen || showShortcutHelp)
    || (!!treeWalk && !treeDocked);
  const navigateTo = (docId: string) => {
    if (!onNavigateCase) return;
    void leaveCase(() => onNavigateCase(docId));
  };

  useEffect(() => {
    const handleCaseNavShortcuts = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target) || modalOpen) return;
      if (e.altKey && e.key === "ArrowRight") {
        if (nextDoc && onNavigateCase && queueState !== "saving") {
          e.preventDefault();
          navigateTo(nextDoc.document_id);
        }
      } else if (e.altKey && e.key === "ArrowLeft") {
        if (prevDoc && onNavigateCase && queueState !== "saving") {
          e.preventDefault();
          navigateTo(prevDoc.document_id);
        }
      }
    };
    window.addEventListener("keydown", handleCaseNavShortcuts);
    return () => window.removeEventListener("keydown", handleCaseNavShortcuts);
  });

  useEffect(() => {
    const handleReviewShortcuts = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === "Escape") {
        if (showShortcutHelp) { e.preventDefault(); setShowShortcutHelp(false); return; }
        if (modalOpen) return;
        if (isAttachingMention) { e.preventDefault(); setIsAttachingMention(false); return; }
        if (selectedAnnotationId || selectedTargetId || selectedSourceId) {
          e.preventDefault();
          handleDeselectAll();
        }
        return;
      }
      if (e.key === "?") {
        if (confirmRequest || completedSubmission || historySubmission || submitDialogOpen) return;
        e.preventDefault();
        setShowShortcutHelp((v) => !v);
        return;
      }
      if (e.repeat || modalOpen) return;

      if (view.key.mode === "review" && reviewTargets.length > 0) {
        if (e.key === "j" || e.key === "J") {
          e.preventDefault();
          const currIdx = reviewTargets.findIndex((t) => refKey(t) === selectedTargetId);
          const nextIdx = currIdx < reviewTargets.length - 1 ? currIdx + 1 : 0;
          const nextT = reviewTargets[nextIdx];
          setSelectedTargetId(refKey(nextT));
          setSelectedAnnotationId(null);
          setSelectedSourceId(null);
          return;
        } else if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          const currIdx = reviewTargets.findIndex((t) => refKey(t) === selectedTargetId);
          const prevIdx = currIdx > 0 ? currIdx - 1 : reviewTargets.length - 1;
          const prevT = reviewTargets[prevIdx];
          setSelectedTargetId(refKey(prevT));
          setSelectedAnnotationId(null);
          setSelectedSourceId(null);
          return;
        }
      }

      if (view.key.mode !== "review" || !selectedTarget) return;

      const currDec = decisionsMap[refKey(selectedTarget)];
      if (e.key === "1") {
        if (selectedTarget.is_obsolete || selectedTarget.is_unknown) return;
        e.preventDefault();
        const nextOutcome = currDec?.outcome === "confirmed" ? null : "confirmed";
        void handleReviewDecision({ outcome: nextOutcome });
      } else if (e.key === "2") {
        e.preventDefault();
        const nextOutcome = currDec?.outcome === "rejected" ? null : "rejected";
        void handleReviewDecision({ outcome: nextOutcome });
      } else if (e.key === "3") {
        e.preventDefault();
        void handleAdoptAndEditTarget(selectedTarget);
      } else if (e.key === "4") {
        e.preventDefault();
        const nextOutcome = currDec?.outcome === "uncertain" ? null : "uncertain";
        void handleReviewDecision({ outcome: nextOutcome });
      }
    };
    window.addEventListener("keydown", handleReviewShortcuts);
    return () => window.removeEventListener("keydown", handleReviewShortcuts);
  });

  const textMentions: MentionDisplay[] = useMemo(() => [
    ...mentionsDisplay,
    ...targetMentions,
    ...sourceMentions,
    ...(pendingAnnotation && !pendingAnnotation.isSpanless && pendingAnnotation.evidenceId
      ? [{ evidence_id: pendingAnnotation.evidenceId, segments: pendingAnnotation.segments }]
      : []),
  ], [mentionsDisplay, targetMentions, sourceMentions, pendingAnnotation]);

  const cancelAttach = useMemo(() => () => setIsAttachingMention(false), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { void leaveCase(onClose); }}
            title="Back to dashboard"
          >
            ← Dashboard
          </button>
          {documentList && documentList.length > 0 && onNavigateCase ? (
            <CaseNavigation
              documents={documentList}
              currentDocumentId={view.document.document_id}
              onNavigate={(docId) => leaveCase(() => onNavigateCase(docId))}
              disabled={queueState === "saving"}
            />
          ) : (
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Case: {view.document.document_id}</span>
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
              ? "Review proposals"
              : view.key.mode === "assisted"
              ? "Assisted annotation"
              : "Annotate from scratch"}
          </span>
          <span
            className="badge"
            data-testid="annotator-identity"
            title="Your annotations and decisions are saved under these initials"
            style={{ background: "var(--bg-secondary)", color: "var(--text-main)", fontSize: "0.78rem" }}
          >
            Annotating as <strong>{view.key.annotator_id}</strong>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            role="status"
            title={`Revision ${draft.revision}`}
            className={`status-badge ${
              statusIsError
                ? "status-error"
                : queueState === "saved"
                ? "status-saved"
                : "status-saving"
            }`}
          >
            ● {statusText}
          </span>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowShortcutHelp(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            ⌨ ?
          </button>

          {queueState === "error" && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => queueRef.current.retry()}
            >
              🔄 Retry
            </button>
          )}

          <button
            onClick={downloadExport}
            className="btn btn-secondary btn-sm"
            title="Export case data as ZIP"
          >
            📥 Export (.zip)
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSubmitWorkspace}
            title="Finish and submit case"
            style={{ fontWeight: 600, padding: "5px 12px" }}
          >
            ✓ Finish & Submit Case
          </button>
        </div>
      </header>

      {queueState === "conflict" && (
        <div
          role="alert"
          aria-label="Revision conflict"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", background: "var(--warning-light)", borderBottom: "1px solid var(--border-color)" }}
        >
          <span>
            <strong>Case was changed elsewhere.</strong> Your latest edit was not saved. Reload the case to continue;
            unsaved edits in this window ({queueRef.current.pendingCount()}) will be discarded.
          </span>
          {onReload ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void reloadCase(); }} disabled={isReloading}>
              {isReloading ? "Reloading..." : "Reload case"}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void leaveCase(onClose); }}>
              Back to dashboard
            </button>
          )}
        </div>
      )}

      {(actionError || submitError) && (
        <div role="alert" style={{ color: "var(--danger)", padding: 12, background: "var(--danger-light)", borderBottom: "1px solid var(--border-color)" }}>
          {actionError ?? submitError}
        </div>
      )}
      <nav className="mobile-pane-tabs" aria-label="Select view">
        {([ ["list", "List"], ["text", "Document"], ["details", "Details"] ] as const).map(([pane, label]) => (
          <button key={pane} type="button" aria-pressed={mobilePane === pane}
            onClick={() => setMobilePane(pane)}>{label}</button>
        ))}
      </nav>
      {/* Main Workspace Layout */}
      <div className={`app-layout mobile-pane-${mobilePane}${treeDocked ? " tree-pinned" : ""}`}>
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

          <div className="sidebar-scroll" ref={sidebarScrollRef}>
            {view.key.mode === "review" && (
              <div className="sidebar-section">
                <div className="sidebar-header">
                  Review Proposals ({reviewTargets.length})
                </div>
                <ul className="doc-list" style={{ borderBottom: "2px solid var(--border-color)" }}>
                  {reviewTargets.map((t) => {
                    const isSelected = refKey(t) === selectedTargetId;
                    const dec = decisionsMap[refKey(t)];
                    const isResolved = dec?.outcome === "changed" || dec?.outcome === "rejected";
                    return (
                      <li
                        key={refKey(t)}
                        data-list-key={`target:${refKey(t)}`}
                        className={`doc-item ${isSelected ? "selected" : ""} ${isResolved ? "doc-item--resolved" : ""}`}
                        style={{
                          opacity: isResolved && !isSelected ? 0.55 : 1,
                          background: isResolved && !isSelected ? "rgba(0, 0, 0, 0.02)" : undefined,
                        }}
                        onClick={() => {
                          const targetKey = refKey(t);
                          if (selectedTargetId === targetKey) {
                            handleDeselectAll();
                            return;
                          }
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
                              {dec.outcome === "confirmed" ? "✓ Confirmed"
                               : dec.outcome === "rejected" ? "✕ Rejected"
                               : dec.outcome === "changed" ? "✎ Replaced"
                               : "? Uncertain"}
                            </span>
                          ) : (
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>open</span>
                          )}
                        </div>
                        <div className="doc-meta" style={{ color: isResolved && !isSelected ? "var(--text-muted)" : undefined }}>
                          {dec?.outcome === "changed" ? (
                            (() => {
                              const replSnap = (draft.annotations ?? []).find(
                                (a) => a.annotation.annotation_id === dec.replacement?.annotation_id
                              );
                              const replTermId = replSnap?.annotation.term_id ?? dec.replacement?.annotation_id ?? "";
                              const replLabel = replSnap ? termLabel(replSnap.annotation.layer_id, replTermId) : null;
                              const displayText = replLabel ? `${replLabel} (${replTermId})` : replTermId;
                              return (
                                <div style={{ marginTop: 2 }}>
                                  <button
                                    type="button"
                                    className="btn btn-link btn-sm"
                                    style={{
                                      padding: 0,
                                      fontSize: "0.75rem",
                                      color: "var(--primary)",
                                      textDecoration: "underline",
                                      cursor: "pointer",
                                      textAlign: "left",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (dec.replacement?.annotation_id) {
                                        setSelectedTargetId(null);
                                        setSelectedSourceId(null);
                                        setSelectedAnnotationId(dec.replacement.annotation_id);
                                        setSelectedEvidenceId(replSnap?.annotation.evidence_refs?.[0]?.evidence_id ?? null);
                                        setMobilePane("details");
                                      }
                                    }}
                                    title="Jump to replacement annotation in draft"
                                  >
                                    ↳ Replaced by: <strong>{displayText}</strong> ↗
                                  </button>
                                  {" "}<AiBadge provenance={t.provenance} />
                                </div>
                              );
                            })()
                          ) : dec?.outcome === "rejected" ? (
                            <>
                              <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
                                ✕ Proposal rejected
                              </span>
                              {" "}<AiBadge provenance={t.provenance} />
                            </>
                          ) : (
                            <>
                              {t.evidence_count === 0 ? "Spanless" : `“${t.quote ?? ""}”`}
                              {t.evidence_count > 1 && ` +${t.evidence_count - 1} more`}
                              {t.provenance?.actor.kind === "tool"
                                ? <>{" "}<AiBadge provenance={t.provenance} /></>
                                : ` • ${t.provenance?.actor.kind ?? "origin unknown"}`}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {visibleSources.length > 0 && <section aria-label="Reference annotations">
              <div className="sidebar-header">Reference Annotations ({visibleSources.length})</div>
              {visibleSources.map(s => <button type="button" className="reference-item" key={sourceKey(s)}
                data-list-key={`source:${sourceKey(s)}`}
                aria-pressed={sourceKey(s) === selectedSourceId} onClick={() => selectSource(sourceKey(s))}>
                <TermName termId={s.annotation.term_id} label={termLabel(s.annotation.layer_id, s.annotation.term_id)} />
                <span className="doc-meta">
                  {view.layers?.find(l => l.layer_id === s.annotation.layer_id)?.label} · Read-only{" "}
                  <AiBadge provenance={s.annotation.provenance} />
                </span>
              </button>)}
            </section>}

            <div className="sidebar-section">
              <div className="sidebar-header sidebar-header--actions">
                <span>Curated Annotations ({visibleAnnotations.length})</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleStartSpanless}
                  title="Create new annotation via ontology search"
                  style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                >
                  + New Annotation
                </button>
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
                      data-list-key={`annotation:${annSnap.annotation.annotation_id}`}
                      className={`doc-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        if (selectedAnnotationId === annSnap.annotation.annotation_id) {
                          handleDeselectAll();
                          return;
                        }
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
                        {evCount === 0 ? "Spanless" : `${evCount} mention(s)`}
                        {firstAxisVal && ` • ${firstAxisVal}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {(view.submissions ?? []).length > 0 && <div className="detail-section">
            <h3>Previous Submissions</h3>
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
                    Verified: {(draft.checked_layer_ids ?? []).filter(id => editableLayerIds.includes(id)).length} of {editableLayerIds.length} layers
                  </div>
                )}
              </div>
            )}
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
          mentions={textMentions}
          isAttachingMention={isAttachingMention}
          onCancelAttach={cancelAttach}
          selectedEvidenceId={selectedEvidenceId}
          selectionIntent={selectionIntent}
          onSelection={handleSelection}
          onPick={handlePickMention}
          onChangeIntent={setSelectionIntent}
          resizableEvidenceIds={resizableEvidenceIds}
          onResizeMention={(evidenceId, segments) => { void handleResizeMention(evidenceId, segments); }}
          resyncToken={textResyncToken}
        />

        {/* Right: Annotation & Search Panel + Review Actions */}
        <div className="inspector-pane">
          {selectedSource ? (
            <section className="detail-pane" aria-label="Reference details">
              <div className="detail-section">
                <h2><TermName termId={selectedSource.annotation.term_id} label={termLabel(selectedSource.annotation.layer_id, selectedSource.annotation.term_id)} /></h2>
                <p>{view.layers?.find(l => l.layer_id === selectedSource.annotation.layer_id)?.label} · Read-only</p>
                <p>
                  <AiBadge provenance={selectedSource.annotation.provenance} />{" "}
                  {selectedSource.annotation.provenance.actor.actor_id} · {selectedSource.annotation.provenance.method}
                </p>
                {Object.entries(selectedSource.annotation.axes_values ?? {}).map(([axis, value]) => <p key={axis}>{axis}: {value ?? "Not specified"}</p>)}
                <h3>Mentions ({selectedSource.evidence.length})</h3>
                {selectedSource.evidence.map(ev => <p key={ev.version}>
                  {ev.mention.segments.map(seg => Array.from(view.document.text).slice(seg.start, seg.end).join("")).join(" … ")}
                </p>)}
              </div>
            </section>
          ) : pendingAnnotation ? (
            <section className="detail-pane" aria-label="New Annotation">
              <div className="detail-section">
                <h2>
                  {pendingAnnotation.isSpanless
                    ? "Select term for new annotation"
                    : "Select term for highlighted text"}
                </h2>
                <p>
                  {pendingAnnotation.isSpanless
                    ? "Select a term from the ontology for the new annotation."
                    : "The annotation will be saved upon selecting a term."}
                </p>
                <SearchPanel key={pendingAnnotation.annotationId} searchManager={searchManager}
                  annotationId={pendingAnnotation.annotationId} workspaceKey={view.key} layerId={pendingAnnotation.layerId}
                  languages={searchLanguagesFor(pendingAnnotation.layerId)}
                  onSelectCandidate={(candidate, searchId) => { void createPendingAnnotation(candidate.term_id, searchId); }} />
                <button type="button" className="btn btn-secondary" disabled={queueState === "saving"} onClick={cancelPending}>Cancel</button>
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
              onDecide={(payload) => { void handleReviewDecision(payload, selectedTarget); }}
              note={noteDrafts[refKey(selectedTarget)] ?? decisionsMap[refKey(selectedTarget)]?.note ?? ""}
              onNoteChange={(value) => {
                const k = refKey(selectedTarget);
                noteDraftsRef.current = { ...noteDraftsRef.current, [k]: value };
                setNoteDrafts((prev) => ({ ...prev, [k]: value }));
              }}
              onAdoptAndEdit={() => { void handleAdoptAndEditTarget(selectedTarget); }}
              onEditReplacement={(repId) => {
                setSelectedTargetId(null);
                setSelectedSourceId(null);
                setSelectedAnnotationId(repId);
                setSelectedEvidenceId(null);
                setMobilePane("details");
              }}
              onDeselect={handleDeselectAll}
            />
          ) : (
            <AnnotationPanel
              key={selectedAnnotationId ?? "empty"}
              annotation={selectedAnnotation}
              allEvidence={allEvidenceMap}
              workspaceKey={view.key}
              searchManager={searchManager}
              selectedEvidenceId={selectedEvidenceId}
              documentText={view.document.text}
              isAttachingMention={isAttachingMention}
              layerId={selectedAnnotation?.annotation.layer_id}
              searchLanguages={searchLanguagesFor(selectedAnnotation?.annotation.layer_id)}
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
              onDeselect={handleDeselectAll}
              onShowInTree={handleShowInTree}
              onSelectEvidence={(evId) => setSelectedEvidenceId(evId)}
              onUpdateTerm={(...args) => { void handleUpdateTerm(...args).catch(reportError); }}
              onUpdateAxes={(axesValues) => { void handleUpdateAxes(axesValues).catch(reportError); }}
              onAttachMention={(segments) =>
                handleSelection({ segments, intent: "new_mention" })
              }
              onDetachMention={(id) => { void handleDetachMention(id).catch(reportError); }}
              onDeleteAnnotation={(id) => { void handleDeleteAnnotation(id).catch(reportError); }}
              onSetIntent={(intent) => {
                if (intent === "new_mention") {
                  setIsAttachingMention(true);
                  setMobilePane("text");
                } else {
                  setSelectionIntent(intent);
                  setMobilePane("text");
                }
              }}
            />
          )}
        </div>

        {/* Ontology tree: always at this place in the layout, so that pinning does not restart the walk. */}
        {treeWalk && (
          <TreeBrowser
            key={treeWalk.nonce}
            variant={treeDocked ? "panel" : "dialog"}
            workspaceKey={view.key}
            annotationId={treeWalk.annotationId}
            layerId={treeWalk.layerId}
            startTermId={treeWalk.termId}
            currentTermId={treeWalkAnnotation?.annotation.term_id ?? null}
            canAssign={!!treeAnnotation && treeAnnotation.annotation.annotation_id === treeWalk.annotationId}
            focusOnOpen={treeWalk.focus}
            pinned={treePinnedNow}
            canPin={wideEnoughToPin}
            onTogglePin={handleToggleTreePin}
            onClose={() => setTreeWalk(null)}
            onUseTerm={handleUseTreeTerm}
          />
        )}
      </div>

      {historySubmission && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-label="Historical submission">
          <h2>Submission {historySubmission.submission_id}</h2>
          <p>{historySubmission.created_at}</p>
          <p>
            Verified layers:{" "}
            {historySubmission.checked_layer_ids && historySubmission.checked_layer_ids.length > 0
              ? historySubmission.checked_layer_ids.join(", ")
              : (historySubmission.document_checked ? "Document verified" : "None")}
          </p>
          {historySubmission.snapshots.map(snap => {
            const axesVal = snap.annotation.axes_values ?? (snap.annotation as any).axes?.values;
            return (
              <div key={refKey({annotation_id:snap.annotation.annotation_id,version:snap.version})}>
                <strong><TermName termId={snap.annotation.term_id} label={termLabel(snap.annotation.layer_id, snap.annotation.term_id)} /></strong>
                <p>
                  {axesVal && Object.keys(axesVal).length > 0
                    ? Object.entries(axesVal)
                        .map(([k, v]) => `${k}: ${v ?? "Not specified"}`)
                        .join(" · ")
                    : "No axes"}
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
            Close
          </button>
        </div>
      </div>}

      {completedSubmission && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-label="Case submitted">
          <h2>✓ Case successfully submitted!</h2>
          <p>Submission ID: <code>{completedSubmission.submission_id}</code></p>
          <p>Timestamp: {completedSubmission.created_at}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            {nextDoc && onNavigateCase && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCompletedSubmission(null);
                  void leaveCase(() => onNavigateCase(nextDoc.document_id));
                }}
              >
                Review next case (Case {nextDoc.position}) →
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadExport}
            >
              📥 Download export
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCompletedSubmission(null)}
            >
              Stay in case
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setCompletedSubmission(null); void leaveCase(onClose); }}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>}

      {submitDialogOpen && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-modal="true" aria-label="Submit case">
          <h2>Submit case {view.document.document_id}?</h2>
          <ul style={{ margin: "8px 0 12px", paddingLeft: 18, fontSize: "0.9rem" }}>
            {view.key.mode === "review" ? (
              <li>
                {confirmedCount + (draft.annotations ?? []).length} annotation(s) will be submitted
                ({confirmedCount} confirmed proposal(s), {(draft.annotations ?? []).length} curated)
              </li>
            ) : (
              <li>{(draft.annotations ?? []).length} annotation(s) in this case</li>
            )}
            {view.key.mode === "review" && (
              <li>
                {reviewTargets.length - openReviewTargets.length} of {reviewTargets.length} review proposal(s) decided
                {openReviewTargets.length > 0 && <strong style={{ color: "var(--danger)" }}> – {openReviewTargets.length} still open</strong>}
              </li>
            )}
            {!isSingleLayer && (
              <li>
                Verified layers: {(draft.checked_layer_ids ?? []).filter((id) => editableLayerIds.includes(id)).length} of {editableLayerIds.length}
              </li>
            )}
          </ul>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={textCheckedConfirmed}
              onChange={(e) => setTextCheckedConfirmed(e.target.checked)}
            />
            <span>Entire text checked for further findings</span>
          </label>
          {view.key.mode === "review" && openReviewTargets.length > 0 && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
              Decide every review proposal before submitting.
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!textCheckedConfirmed || (view.key.mode === "review" && openReviewTargets.length > 0)}
              onClick={() => { void confirmSubmit(); }}
            >
              Submit case
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setSubmitDialogOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      </div>}

      {confirmRequest && <div className="modal-overlay">
        <div className="modal-content" role="dialog" aria-modal="true" aria-label={confirmRequest.title}>
          <h2>{confirmRequest.title}</h2>
          <p>{confirmRequest.message}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => closeConfirm(true)}>
              {confirmRequest.confirmLabel}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => closeConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      </div>}

      {showShortcutHelp && <div className="modal-overlay" onClick={() => setShowShortcutHelp(false)}>
        <div className="modal-content" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
          <h2>Keyboard shortcuts</h2>
          <table style={{ fontSize: "0.9rem", borderCollapse: "collapse" }}>
            <tbody>
              {SHORTCUTS.filter((sc) => !sc.reviewOnly || view.key.mode === "review").map((sc) => (
                <tr key={sc.keys}>
                  <td style={{ padding: "3px 12px 3px 0" }}><kbd>{sc.keys}</kbd></td>
                  <td>{sc.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Shortcuts are disabled while typing in a field or when a dialog is open.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setShowShortcutHelp(false)}>Close</button>
        </div>
      </div>}
    </div>
  );
};
