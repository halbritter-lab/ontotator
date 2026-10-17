import { PendingReanchorPanel, useReanchorContext } from "../variants/ReanchorPanel";
import { ComparePane } from "../variants/ComparePane";
import { Toolbar } from "../ui/Toolbar";
import { VariantSelectors } from "../variants/VariantSelectors";
import { ReadOnlyAnnotationView } from "../variants/ReadOnlyAnnotationView";
import { useCaseVersions } from "../variants/useCaseVersions";
import { VariantDetails, variantDescription } from "../variants/CaseViewer";
import { annotationOptions, pickVariant, refForKey } from "../variants/versionState";
import { ErrorNotice } from "../admin/ErrorNotice";
import type { AnnotationVersion } from "../api/client";
import type { Route } from "./router";
import { InlineMessage } from "../ui/InlineMessage";
import { Button } from "../ui/Button";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  isSessionProblem,
  onSessionRestored,
  ValidationError,
  ApiError,
  type TaskSummary,
  type AnnotationSnapshot,
  type AxesValues,
  type DocumentSummary,
  type Draft,
  type Submission,
} from "../api/client";
import type { components } from "../api/generated";
import { ProposalMetadataProvider, ProposalSource, proposalFor } from "../editor/ProposalSource";
import { AiBadge } from "../editor/AiBadge";
import { AnnotationPanel, quoteSegments, type EvidenceSnapshot } from "../editor/AnnotationPanel";
import {
  createMutationQueue,
  DiscardedChangesError,
  isNetworkError,
  SESSION_ENDED_MESSAGE,
  UnsavedChangesError,
  type MutationQueue,
  type QueueState,
} from "../editor/autosave";
import { newEvidenceId } from "../editor/ids";
import { StatusBadge } from "../ui/StatusBadge";
import { defaultedResults, resultSnapshots } from "../editor/decisionSemantics";
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
import { useTermLabels } from "../editor/useTermLabels";
import { type MentionDisplay, type SelectionPayload } from "../spans/adapter";
import { markColourSlot } from "../editor/markColours";
import { IconCheck, IconClose, IconKeyboard, IconPencil, IconQuestion, IconRetry } from "../ui/icons";
import { isNegated } from "../editor/negation";
import { Dialog } from "../ui/Dialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { IconButton } from "../ui/IconButton";
import { openShortcutHelp, ShortcutHelpHost } from "../ui/ShortcutHelp";
import { useShortcut, useShortcutHint } from "../ui/shortcuts";
import { CaseNavigation } from "./CaseNavigation";
import { adjacentCase, orderTasks } from "./caseOrder";
import type { RouteLeaveGuard } from "./router";

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

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

export type WorkspaceView = components["schemas"]["WorkspaceView"];

export interface CaseScreenProps {
  readOnly?: boolean;
  versionContext?: { canBrowseVersions: boolean; username: string; assignmentId: number; onNavigate: (route: Route) => void };
  routeLeaveRef?: React.MutableRefObject<RouteLeaveGuard | null>;
  assignmentNavigation?: { tasks: TaskSummary[]; current: TaskSummary; onNavigate: (assignmentId: number) => void };
  onReadonlyRequired?: () => void;
  view: WorkspaceView;
  workspaceId: string;
  onClose: () => void;
  onNavigateCase?: (documentId: string) => Promise<void>;
  documentList?: DocumentSummary[];
  /** Re-open this case from the server (used to resolve revision conflicts). */
  onReload?: () => Promise<void>;
  /** Called after a successful submission (e.g. to refresh the case list). */
  onSubmitted?: () => void | Promise<void>;
  /** The logged-in user's display name, shown with the pseudonym. */
  annotatorName?: string;
  leaveGuardRef?: React.MutableRefObject<((proceed: () => void) => void) | null>;
}

export const CaseScreen: React.FC<CaseScreenProps> = ({
  view,
  workspaceId,
  onClose,
  onNavigateCase,
  documentList,
  onReload,
  onSubmitted,
  annotatorName,
  leaveGuardRef,
  readOnly: serverReadOnly = false, routeLeaveRef, assignmentNavigation, onReadonlyRequired, versionContext,
}) => {
  const versionIdentity = JSON.stringify([versionContext?.username, versionContext?.assignmentId, versionContext?.canBrowseVersions, workspaceId, view.key]);
  const { versions, versionError, setVersionError, retryVersions } = useCaseVersions(view.key.project_key, view.document.document_id, versionContext, versionIdentity);
  const [displayed, setDisplayed] = useState<{ identity: string; selection: string; label: string; value: AnnotationVersion | null } | null>(null);
  const display = displayed?.identity === versionIdentity ? displayed : null;
  const [comparisonIdentity, setComparisonIdentity] = useState<string | null>(null);
  const compareOpen = !!versionContext?.canBrowseVersions && comparisonIdentity === versionIdentity;
  const [leftTextElement, setLeftTextElement] = useState<HTMLDivElement | null>(null);
  const reanchorContext = useReanchorContext(view.document.text, leftTextElement, JSON.stringify([versionIdentity,display?.selection ?? "draft"]));
  const compareButton = useRef<HTMLButtonElement | null>(null);
  const closeComparison = () => { setComparisonIdentity(null); compareButton.current?.focus(); };
  const comparison = compareOpen && versions && versionContext ? <ComparePane
    projectKey={view.key.project_key} username={versionContext.username} caseDetail={versions.detail}
    leftDocumentId={view.document.document_id} leftText={view.document.text} leftElement={leftTextElement}
    editing={!serverReadOnly && display === null} leftContext={JSON.stringify([versionIdentity, display?.selection ?? "draft"])} onClose={closeComparison} /> : null;
  const [versionBusy, setVersionBusy] = useState(false);
  const versionGeneration = useRef(0);
  useEffect(() => { versionGeneration.current++; setVersionBusy(false); return () => { versionGeneration.current++; }; }, [versionIdentity]);
  const readOnly = serverReadOnly || display !== null;
  // A ref also protects callbacks retained before this task became read-only.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const assertWritable = () => {
    if (readOnlyRef.current) throw new DiscardedChangesError("This submitted task is read-only.");
  };
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
  const [logoutProceed, setLogoutProceed] = useState<(() => void) | null>(null);
  const [logoutSaving, setLogoutSaving] = useState(false);
  const logoutRejectedBaseline = useRef(0);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  // "Finish & Submit" was clicked and waits for pending saves before it validates.
  const [submitPending, setSubmitPending] = useState(false);
  const [textCheckedConfirmed, setTextCheckedConfirmed] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  // Reviewer notes typed in the UI, keyed by target; kept even when a decision is reset.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const noteDraftsRef = useRef(noteDrafts);
  noteDraftsRef.current = noteDrafts;

  // Modals
  const [completedSubmission, setCompletedSubmission] = useState<Submission | null>(null);
  const completedNextAssignment = useRef<number | undefined>(undefined);
  const [historySubmission, setHistorySubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "text" | "details">("text");
  // The ontology tree, docked under the annotation panel while a walk is open. One entry
  // is one walk; a new nonce starts a new one.
  const [treeWalk, setTreeWalk] = useState<{
    nonce: number;
    annotationId: string;
    layerId: string;
    termId: string;
    /** Whether to move the keyboard focus into the tree when it has loaded. */
    focus: boolean;
  } | null>(null);
  const treeNonce = useRef(0);

  const displayedTerms = useMemo(() => [
    ...(draft.annotations ?? []),
    ...(display?.value?.annotations ?? []),
    ...(view.available_inputs ?? []),
    ...(view.submissions ?? []).flatMap((submission) => submission.snapshots),
  ].map((snapshot) => ({
    layer_id: snapshot.annotation.layer_id,
    term_id: snapshot.annotation.term_id,
  })), [draft.annotations, display?.value, view.available_inputs, view.submissions]);
  const termLabel = useTermLabels(view.key.project_key, displayedTerms);

  const searchManager = useMemo(() => new SearchManager(api), []);
  useEffect(() => {
    if (!readOnly) return;
    setPendingAnnotation(null);
    setIsAttachingMention(false);
    setSelectionIntent("new_mention");
    setSubmitDialogOpen(false);
    searchManager.clear();
  }, [readOnly, searchManager]);

  useEffect(() => {
    searchManager.setLayer(layerSelection.activeLayerId);
  }, [layerSelection.activeLayerId, searchManager]);

  // Search languages: stored per annotator, offered per ontology of the layer.
  const languagesForOntology = useSearchLanguages(api, view.key.annotator_id, view.key.project_key);
  const searchLanguagesFor = (layerId: string | null | undefined) => {
    const ontologyId = (view.layers ?? []).find((layer) => layer.layer_id === layerId)?.ontology_id;
    const definition = (view.ontologies ?? []).find((item) => item.ontology_id === ontologyId);
    return languagesForOntology(definition?.sha256);
  };

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (versionContext?.canBrowseVersions) return;
    if (comparisonIdentity !== null) {
      setComparisonIdentity(null);
      rootRef.current?.querySelector<HTMLElement>(".text-container")?.focus();
    }
    setDisplayed(null);
  }, [versionContext?.canBrowseVersions]);

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
          colorIndex: markColourSlot({ termId, layerId: owner?.annotation.layer_id, kind: "own" }),
          negated: owner ? isNegated(owner.annotation) : false,
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

  const sourceForTarget = (target: {annotation_id: string; version: string}) =>
    (view.available_inputs ?? []).find(p => p.annotation.annotation_id === target.annotation_id && p.version === target.version);

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
      const colorIdx = markColourSlot({
        termId: target.term_id ?? target.annotation_id,
        layerId: target.layer_id,
        kind: "target",
      });
      for (const ev of snap.evidence ?? []) {
        mentions.push({
          evidence_id: `target:${target.annotation_id}:${target.version}:${ev.mention.evidence_id}:${ev.version}`,
          segments: ev.mention.segments,
          kind: "target" as const,
          colorIndex: colorIdx,
          negated: isNegated(snap.annotation),
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
  // The inspector shows something else: start at its top. Without this it keeps the scroll
  // position of what it showed before -- next to a docked tree the pane is short, so a new
  // annotation would appear scrolled to where its candidate was, its term name out of sight.
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const inspectorKey = pendingAnnotation ? `pending:${pendingAnnotation.annotationId}` : selectedListKey;
  useLayoutEffect(() => {
    if (inspectorRef.current) inspectorRef.current.scrollTop = 0;
  }, [inspectorKey]);
  const sourceMentions: MentionDisplay[] = useMemo(() => visibleSources.flatMap(s => s.evidence.map(ev => ({
    evidence_id: `source:${sourceKey(s)}:${ev.mention.evidence_id}:${ev.version}`,
    sourceId: sourceKey(s),
    segments: ev.mention.segments,
    kind: "source" as const,
    colorIndex: markColourSlot({ termId: s.annotation.term_id, layerId: s.annotation.layer_id, kind: "source" }),
    negated: isNegated(s.annotation),
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

  const assignmentFailure = (error: unknown): never => {
    if (error instanceof ApiError && error.code === "ASSIGNMENT_SUBMITTED" && !readOnlyRef.current) {
      readOnlyRef.current = true;
      onReadonlyRequired?.();
    }
    throw error;
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

  useEffect(() => {
    if (!leaveGuardRef) return;
    leaveGuardRef.current = (proceed) => {
      const queue = queueRef.current;
      if (queue.pendingCount() === 0 && queue.getState() !== "saving") proceed();
      else {
        logoutRejectedBaseline.current = queue.rejectedCount();
        setLogoutProceed(() => proceed);
      }
    };
    return () => { leaveGuardRef.current = null; };
  }, [leaveGuardRef]);

  const saveAndLogout = async () => {
    if (!logoutProceed || logoutSaving) return;
    setLogoutSaving(true);
    try {
      await queueRef.current.flush();
      if (queueRef.current.rejectedCount() !== logoutRejectedBaseline.current) {
        setActionError((current) => current ?? "A change could not be saved; you are still logged in.");
        return;
      }
      logoutProceed();
    } catch (error) {
      reportError(error);
    } finally {
      setLogoutSaving(false);
      setLogoutProceed(null);
    }
  };

  /**
   * Flush pending edits before leaving the case. If they cannot be saved (conflict or
   * server unreachable) the user may explicitly discard them and leave anyway.
   */
  const leaveInProgress = useRef(false);
  const leaveCase = async (action: () => void | Promise<void>): Promise<boolean> => {
    // Local version changes and App routes share the same unsaved-work dialog.
    // A concurrent transition must not replace its resolver and orphan the first.
    if (leaveInProgress.current) return false;
    leaveInProgress.current = true;
    try {
      const rejectedBefore = queueRef.current.rejectedCount();
      if (rejectedBefore > 0) {
        setActionError("A change could not be saved. Reload the case before leaving.");
        return false;
      }
      try {
        await queueRef.current.flush();
        if (queueRef.current.rejectedCount() !== rejectedBefore) {
          setActionError("A change could not be saved. Reload the case before leaving.");
          return false;
        }
      } catch (error) {
        if (!(error instanceof UnsavedChangesError)) { reportError(error); return false; }
        const pending = queueRef.current.pendingCount();
        const ok = await askConfirm(
          error.state === "conflict" ? "Case was changed elsewhere" : "Changes not saved",
          error.state === "conflict"
            ? `This case was changed in another window or session. ${pending} unsaved edit(s) in this window will be discarded.`
            : error.sessionEnded
            ? `${SESSION_ENDED_MESSAGE} Leaving now discards ${pending} edit(s).`
            : `${pending} edit(s) could not be saved because the server is unreachable. Leaving discards them.`,
          "Discard edits and leave",
        );
        if (!ok) return false;
        queueRef.current.discardPending();
      }
      try {
        await action();
        return true;
      } catch (error) {
        reportError(error);
        return false;
      }
    } finally { leaveInProgress.current = false; }
  };
  const latestLeave = useRef(leaveCase);
  latestLeave.current = leaveCase;
  useEffect(() => {
    if (!routeLeaveRef) return;
    const guard = () => latestLeave.current(() => {});
    routeLeaveRef.current = guard;
    return () => { if (routeLeaveRef.current === guard) routeLeaveRef.current = null; };
  }, [routeLeaveRef]);

  const chooseAnnotationVersion = async (selection: string) => {
    if (!versions || versionBusy || selection === (display?.selection ?? "draft")) return;
    if (selection !== "draft" && selection !== "text" && !refForKey(selection, versions.refs)) return;
    setVersionBusy(true);
    const request = ++versionGeneration.current;
    let load: Promise<void> | undefined;
    try {
      await leaveCase(() => {
        if (request !== versionGeneration.current) return;
        if (selection === "draft") { setDisplayed(null); readOnlyRef.current = serverReadOnly; return; }
        const ref = refForKey(selection, versions.refs);
        readOnlyRef.current = true;
        setDisplayed({ identity: versionIdentity, selection, label: ref?.label ?? "Text only", value: null });
        setVersionError(null);
        if (!ref) return;
        load = api.getAnnotationVersion(view.key.project_key, view.document.document_id, ref.kind, ref.id).then(value => {
          if (request === versionGeneration.current) setDisplayed({ identity: versionIdentity, selection, label: ref.label, value });
        }, error => { if (request === versionGeneration.current) setVersionError(error); });
      });
      // The fetch cannot hold the leave guard; departures cancel its generation.
      await load;
    } finally { if (request === versionGeneration.current) setVersionBusy(false); }
  };
  const navigateVariant = (documentId: string) => {
    if (versionBusy || !versions || !versionContext || !versions.detail.variants.some(row => row.document_id === documentId)) return;
    // App's history journal invokes the registered leaveCase guard exactly once.
    versionContext.onNavigate({ name: "projectCase", key: view.key.project_key, caseId: versions.detail.case_id, variant: documentId });
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
    // Logged in again as the same user: save what waited for the session.
    const unsubscribe = onSessionRestored(() => {
      void queueRef.current.retry();
    });
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      unsubscribe();
    };
  }, []);

  const statusText =
    queueState === "conflict" ? "Changed elsewhere – reload required"
    : queueState === "error" ? (
      isSessionProblem(queueError) ? "Session ended – changes kept"
      : isNetworkError(queueError) || isOffline ? "Offline – changes not saved"
      : "Save error – changes not saved"
    )
    : queueState === "saving" ? "Saving..."
    : queueState === "dirty" ? "Unsaved changes"
    : isOffline ? "Offline"
    : "Saved";
  const statusIsError = queueState === "conflict" || queueState === "error" || isOffline;

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
    assertWritable();
    setActionError(null);
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.applyCommand>[1] | undefined;
    return queueRef.current.enqueue(async (expectedRevision) => {
      assertWritable();
      envelope ??= { mutation_id: mutationId, expected_revision: expectedRevision, payload: typeof payload === "function" ? payload(latestDraft.current) : payload };
      const updatedDraft = await api.applyCommand(workspaceId, envelope).catch(assignmentFailure);
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
    if (JSON.stringify([...(copy.annotation.axes_defaulted ?? [])].sort()) !== JSON.stringify([...(source.annotation.axes_defaulted ?? [])].sort())) return true;
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
    if (readOnlyRef.current) return Promise.reject(new DiscardedChangesError());
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.recordDecision>[1] | undefined;
    return queueRef.current.enqueue(async (expectedRevision) => {
      assertWritable();
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
      const nextDraft = await api.recordDecision(workspaceId, envelope).catch(assignmentFailure);
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
    if (!selectedAnnotationId) return;
    await setTermOf(selectedAnnotationId, termId, searchId);
  };

  // --- Ontology tree -----------------------------------------------------------
  // The annotation the inspector shows as editable right now (same precedence as the pane itself).
  const treeAnnotation =
    !selectedSource && !pendingAnnotation && !(view.key.mode === "review" && selectedTarget)
      ? selectedAnnotation
      : null;
  // While the term of a new annotation is being searched there is nothing for the tree to
  // show, and the candidates need the room: the tree steps aside (same walk, out of sight)
  // and the search has the whole column. It is back once a term is chosen or the search is
  // given up.
  const treeCollapsed = !!treeWalk && !!pendingAnnotation;
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
  // A failure is thrown to the tree, which shows it where the term was chosen. The tree stays open.
  const handleUseTreeTerm = async (termId: string, browseId: string) => {
    if (readOnlyRef.current) return;
    if (!treeWalk) return;
    await setTermOf(treeWalk.annotationId, termId, browseId);
  };

  // Closing changes nothing else: the tree is gone until "Show in tree" is used again. A
  // keyboard focus that was in the tree goes back to that button instead of getting lost.
  const handleCloseTree = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".tree-host")) {
      inspectorRef.current?.querySelector<HTMLElement>(".annotation-tree-button")?.focus();
    }
    setTreeWalk(null);
  };

  // An open tree follows the selection: another own annotation with a term starts a new
  // walk there. Anything else (a proposal, a reference, nothing) leaves the tree as it is.
  const followAnnotationId = treeAnnotation?.annotation.term_id ? treeAnnotation.annotation.annotation_id : null;
  useEffect(() => {
    if (!treeWalk || !treeAnnotation || !followAnnotationId) return;
    if (followAnnotationId === treeWalk.annotationId) return;
    startTreeWalk(treeAnnotation, false);
    // Only a change of the selected annotation moves the tree, not an edit of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followAnnotationId]);

  const handleUpdateAxes = async (axesValues: Partial<AxesValues>, confirmedAxisId?: string) => {
    if (readOnlyRef.current) return;
    if (!selectedAnnotationId || !selectedAnnotation) return;
    const annotationId = selectedAnnotationId;
    await mutateAnnotationAndSyncDecision(annotationId, () =>
      enqueueMutation({
        command: "set_axes",
        annotation_id: annotationId,
        axes_values: axesValues as Record<string, string | null>,
        chosen_axis_ids: confirmedAxisId ? [confirmedAxisId] : Object.keys(axesValues).filter(
          (axis) => axesValues[axis] != null && axesValues[axis] !== "" && axesValues[axis] !== selectedAnnotation.annotation.axes_values?.[axis]
        ),
      })
    );
  };

  const handleDetachMention = async (evidenceId: string) => {
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
    const target = forTarget ?? selectedTarget;
    if (!target) return;
    setActionError(null);
    const key = targetKeyOf(target);
    const abandonedCopies = (latestDraft.current.annotations ?? []).filter((a) =>
      a.annotation.provenance.source_refs?.includes(`${target.annotation_id}:${target.version}`)
      && a.annotation.annotation_id !== payload.replacement?.annotation_id);
    if (abandonedCopies.length > 0) {
      const ok = await askConfirm(
        "Discard adopted copy?",
        "Changing this decision removes the editable copy adopted from this proposal, including its edits. Independently added findings are kept.",
        "Discard copy and change decision",
      );
      if (!ok) return;
    }
    let note: string | undefined;
    let resetNote: string | undefined;
    if (payload.outcome === null) {
      // Removing a decision must not silently lose the note text: keep it in the editor.
      resetNote = noteDraftsRef.current[key] ?? decisionsMap[key]?.note ?? "";
      if (resetNote) setNoteDrafts((prev) => ({ ...prev, [key]: resetNote! }));
      note = undefined;
    } else {
      note = payload.note !== undefined ? (payload.note.trim() || undefined) : currentNoteFor(key);
    }
    try {
      await enqueueDecision(target, payload.outcome, payload.replacement?.annotation_id, note);
      if (payload.outcome === null) {
        // An earlier queued note save may clear its draft while reset is waiting.
        // Restore the captured text without overwriting newer typing.
        setNoteDrafts(prev => key in prev ? prev : { ...prev, [key]: resetNote ?? "" });
      } else {
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
    if (readOnlyRef.current) return;
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

    if (existingCopy && (latestDraft.current.annotations ?? []).some((a) => a.annotation.annotation_id === existingCopy.annotation.annotation_id)) {
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

  const editableLayerIds = view.scope?.editable_layer_ids ?? (view.layers ? view.layers.map(l => l.layer_id) : []);
  // Only the selected curated annotation's mentions can be resized, and not while
  // another text interaction (attaching a mention, choosing a term) is in progress.
  const resizableEvidenceIds = !readOnly && selectedAnnotation && !isAttachingMention && !pendingAnnotation
    && editableLayerIds.includes(selectedAnnotation.annotation.layer_id)
    ? (selectedAnnotation.annotation.evidence_refs ?? []).map((r) => r.evidence_id)
    : [];

  const openReviewTargets = reviewTargets.filter(
    (t) => !(draft.decisions ?? []).some((d) => refKey(d.target) === refKey(t)),
  );
  // Confirmed proposals are submitted as they are, next to the draft's own annotations.
  const confirmedCount = (draft.decisions ?? []).filter((d) => d.outcome === "confirmed").length;

  const completionResults = resultSnapshots(draft, view.available_inputs ?? []);
  const defaulted = defaultedResults(completionResults);
  const defaultedKeys = new Set(defaulted.map(s => refKey({ annotation_id: s.annotation.annotation_id, version: s.version })));
  const [focusDefaultedAxes, setFocusDefaultedAxes] = useState(false);
  useEffect(() => {
    if (!focusDefaultedAxes || submitDialogOpen) return;
    const panel = inspectorRef.current?.querySelector<HTMLElement>('[data-testid="axes-section"], .review-actions__proposal');
    if (panel) { panel.tabIndex = -1; panel.focus(); setFocusDefaultedAxes(false); }
  }, [focusDefaultedAxes, submitDialogOpen, selectedAnnotationId, selectedTargetId]);
  const reviewDefaulted = () => {
    const first = defaulted[0];
    if (!first) return;
    const layerId = first.annotation.layer_id;
    setLayerSelection(previous => ({ ...previous, activeLayerId: layerId,
      activeTypeId: first.annotation.type_id,
      visibleLayerIds: previous.visibleLayerIds.includes(layerId) ? previous.visibleLayerIds : [...previous.visibleLayerIds, layerId] }));
    const target = reviewTargets.find(t => refKey(t) === refKey({ annotation_id: first.annotation.annotation_id, version: first.version }));
    setSelectedTargetId(target ? refKey(target) : null);
    setSelectedAnnotationId(target ? null : first.annotation.annotation_id);
    setSelectedSourceId(null); setSelectedEvidenceId(null); cancelPending();
    setMobilePane("details"); setSubmitDialogOpen(false); setFocusDefaultedAxes(true);
  };

  // Step 1: save pending edits, validate the saved draft and open the confirmation dialog.
  const handleSubmitWorkspace = async () => {
    if (readOnlyRef.current) return;
    setSubmitError(null);

    // Validate only after pending saves have finished;
    // the draft from before them would give a stale validation result.
    const rejectedBefore = queueRef.current.rejectedCount();
    setSubmitPending(true);
    try {
      await queueRef.current.flush();
    } catch (error) { reportError(error); return; } finally { setSubmitPending(false); }
    // A save the server refused shows its own error, but a later edit clears that one;
    // keep the reason why the case was not submitted.
    if (queueRef.current.rejectedCount() !== rejectedBefore) {
      setSubmitError("A change could not be saved; the case was not submitted.");
      return;
    }

    setTextCheckedConfirmed(false);
    setSubmitDialogOpen(true);
  };

  // Step 2: submit after the explicit "entire text checked" confirmation.
  const confirmSubmit = async () => {
    if (readOnlyRef.current) return;
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
        assertWritable();
        envelope ??= {
          mutation_id: mutationId,
          expected_revision: expectedRevision,
          payload: {
            command: "submit_workspace",
            // Explicitly confirmed by the user in the submit dialog.
            document_checked: true,
          },
        };
        return api.submitWorkspace(workspaceId, envelope).catch(assignmentFailure);
      });
      completedNextAssignment.current = adjacentTask.next;
      setCompletedSubmission(submission);
      try {
        await onSubmitted?.();
      } catch {
        // list refresh is best effort
      }
    } catch (err: unknown) {
      if (err instanceof DiscardedChangesError) return;
      const msg = err instanceof Error ? err.message : String(err);
      reportError(err);
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

  const assignmentTasks = assignmentNavigation?.tasks.filter(task => task.project_key === assignmentNavigation.current.project_key && task.task === assignmentNavigation.current.task);
  const adjacentTask = assignmentNavigation ? orderTasks(assignmentNavigation.tasks, assignmentNavigation.current) : {};
  const navigateAssignment = (id: number) => assignmentNavigation?.onNavigate(id);
  // Legacy direct component callers retain their document navigation contract.
  const prevDoc = documentList ? adjacentCase(documentList, view.document.document_id, -1) : null;
  const nextDoc = documentList ? adjacentCase(documentList, view.document.document_id, 1) : null;

  const navigateTo = (docId: string) => {
    if (!onNavigateCase) return;
    void leaveCase(() => onNavigateCase(docId));
  };

  const shortcutOptions = { scope: "screen" as const, root: rootRef };
  useShortcut(["Alt+ArrowLeft", "Alt+ArrowRight"], (event) => {
    if (assignmentNavigation) {
      const id = event.key === "ArrowLeft" ? adjacentTask.previous : adjacentTask.next;
      if (id === undefined || queueState === "saving") return false;
      navigateAssignment(id);
      return;
    }
    const document = event.key === "ArrowLeft" ? prevDoc : nextDoc;
    if (!document || !onNavigateCase || queueState === "saving") return false;
    navigateTo(document.document_id);
  }, { ...shortcutOptions, group: "Navigation", description: "Previous / next case" });
  useShortcut("Escape", () => {
    if (isAttachingMention) { setIsAttachingMention(false); return; }
    if (!selectedAnnotationId && !selectedTargetId && !selectedSourceId) return false;
    handleDeselectAll();
  }, { ...shortcutOptions, allowRepeat: true, group: "General", description: "Clear selection / cancel adding a mention" });
  useShortcut(["j", "k"], (event) => {
    const current = reviewTargets.findIndex((target) => refKey(target) === selectedTargetId);
    const index = event.key.toLowerCase() === "j"
      ? (current < reviewTargets.length - 1 ? current + 1 : 0)
      : (current > 0 ? current - 1 : reviewTargets.length - 1);
    setSelectedTargetId(refKey(reviewTargets[index]));
    setSelectedAnnotationId(null);
    setSelectedSourceId(null);
  }, { ...shortcutOptions, enabled: view.key.mode === "review" && reviewTargets.length > 0,
    group: "Review", description: "Next / previous review proposal" });
  const reviewShortcutOptions = { ...shortcutOptions, enabled: !readOnly && view.key.mode === "review" && !!selectedTarget, group: "Review" };
  useShortcut("1", () => {
    if (!selectedTarget || selectedTarget.is_obsolete || selectedTarget.is_unknown) return false;
    void handleReviewDecision({ outcome: "confirmed" });
  }, { ...reviewShortcutOptions, description: "Confirm selected proposal" });
  useShortcut("2", () => {
    if (!selectedTarget) return false;
    void handleReviewDecision({ outcome: "rejected" });
  }, { ...reviewShortcutOptions, description: "Reject selected proposal" });
  useShortcut("3", () => {
    if (!selectedTarget) return false;
    void handleAdoptAndEditTarget(selectedTarget);
  }, { ...reviewShortcutOptions, description: "Adopt proposal as editable copy" });
  useShortcut("4", () => {
    if (!selectedTarget) return false;
    void handleReviewDecision({ outcome: "uncertain" });
  }, { ...reviewShortcutOptions, description: "Mark selected proposal as uncertain" });
  useShortcut("0", () => { void handleReviewDecision({ outcome: null }); }, { ...reviewShortcutOptions, description: "Reset selected review decision to open" });
  useShortcutHint(["Shift + arrows, then release Shift"], "Select text with the keyboard to create a mention");
  useShortcutHint(["←", "→", "Ctrl + ← / →"], "Move the focused mention edge (Tab to an edge handle of the selected annotation)");

  const textMentions: MentionDisplay[] = useMemo(() => [
    ...mentionsDisplay,
    ...targetMentions,
    ...sourceMentions,
    ...(pendingAnnotation && !pendingAnnotation.isSpanless && pendingAnnotation.evidenceId
      ? [{ evidence_id: pendingAnnotation.evidenceId, segments: pendingAnnotation.segments }]
      : []),
  ], [mentionsDisplay, targetMentions, sourceMentions, pendingAnnotation]);

  const cancelAttach = useMemo(() => () => setIsAttachingMention(false), []);

  const versionControls = versions && versionContext?.canBrowseVersions ? <details className="case-version-controls"><summary>Versions</summary>
    <VariantSelectors caseDetail={versions.detail} currentDocumentId={view.document.document_id}
      annotationOptions={annotationOptions(versions.refs, true)} selectedAnnotation={display?.selection ?? "draft"}
      disabled={versionBusy && display !== null} onLanguage={language => { const id = pickVariant(versions.detail, language); if (id) navigateVariant(id); }}
      onVersion={navigateVariant} onAnnotation={selection => { void chooseAnnotationVersion(selection); }} />
    {versions.detail.variants.find(row => row.document_id === view.document.document_id) && <span className="badge">{variantDescription(versions.detail.variants.find(row => row.document_id === view.document.document_id)!)}</span>}
    <Button ref={compareButton} aria-expanded={compareOpen} onClick={() => { if (compareOpen) closeComparison(); else setComparisonIdentity(versionIdentity); }}>Compare</Button>
    <VariantDetails detail={versions.detail} documentId={view.document.document_id} />
  </details> : null;

  return (
    <ProposalMetadataProvider scope={`${workspaceId}:${JSON.stringify(view.key)}`} projectKey={view.key.project_key} proposals={view.available_inputs ?? []} metadata={view.proposal_sets ?? []} allowPublicFetch={false}>
    <div ref={rootRef} className={compareOpen ? "case-comparing" : undefined} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <Toolbar className="case-toolbar" label="Case">
        <div className="app-title">
          <Button
            type="button"
            variant="quiet" size="sm"
            onClick={() => { if (assignmentNavigation) onClose(); else void leaveCase(onClose); }}
            title={assignmentNavigation ? "Back to my tasks" : "Back to dashboard"}
          >
            {assignmentNavigation ? "← My tasks" : "← Dashboard"}
          </Button>
          {assignmentNavigation && assignmentTasks?.length ? (
            <CaseNavigation documents={assignmentTasks.map((task, index) => ({ document_id: task.document_id,
              position: index + 1, language: task.language, text_length: 0, status: task.status === "submitted" ? "completed" : task.status === "in_progress" ? "in_progress" : "not_started" }))}
              currentDocumentId={view.document.document_id}
              navigationIds={assignmentTasks.map(task => String(task.assignment_id))}
              currentNavigationId={String(assignmentNavigation.current.assignment_id)}
              onNavigate={async id => navigateAssignment(Number(id))} disabled={queueState === "saving"} />
          ) : documentList && documentList.length > 0 && onNavigateCase ? (
            <CaseNavigation
              documents={documentList}
              currentDocumentId={view.document.document_id}
              onNavigate={async (docId) => { await leaveCase(() => onNavigateCase(docId)); }}
              disabled={queueState === "saving"}
            />
          ) : (
            <span className="case-label">Case: {view.document.document_id}</span>
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
          {/* The display name has a bounded width (full text in the title), so the header
              does not need another line; the pseudonym is never shortened. */}
          <span
            className="badge identity-badge"
            data-testid="annotator-identity"
            title={`${annotatorName ? `${annotatorName} (${view.key.annotator_id})` : view.key.annotator_id}: your annotations and decisions are saved under this pseudonym`}
          >
            Annotating as{" "}
            <strong>
              {annotatorName ? (
                <>
                  <span className="identity-name" data-testid="annotator-name">{annotatorName}</span>{" "}
                  ({view.key.annotator_id})
                </>
              ) : view.key.annotator_id}
            </strong>
          </span>
        </div>
        <div className="app-actions">
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
            <span className="status-dot" aria-hidden="true" />
            {statusText}
          </span>

          <IconButton label="Keyboard shortcuts" icon={<IconKeyboard />} onClick={openShortcutHelp}
            variant="quiet" size="sm" title="Keyboard shortcuts (?)" />

          {queueState === "error" && (
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => queueRef.current.retry()}
            >
              <IconRetry />
              Retry
            </Button>
          )}

          <Button
            type="button"
            variant="primary" size="sm"
            onClick={handleSubmitWorkspace}
            disabled={readOnly || submitPending}
            aria-busy={submitPending}
            title={submitPending ? "Saving changes before submitting" : "Finish and submit case"}
          >
            <IconCheck />
            Finish & Submit Case
          </Button>
        </div>
      </Toolbar>

      {!!versionError && <><ErrorNotice error={versionError} /><Button onClick={retryVersions}>Retry version list</Button></>}
      {display && <InlineMessage tone="info"><span>Viewing {display.label} (read-only)</span>
        <Button disabled={versionBusy} onClick={() => { void chooseAnnotationVersion("draft"); }}>Back to my draft</Button>
      </InlineMessage>}
      {serverReadOnly && <InlineMessage tone="info">Submitted. The project lead can reopen it for changes.</InlineMessage>}
      {queueState === "conflict" && (
        <InlineMessage tone="error" aria-label="Revision conflict">
          <span>
            <strong>Case was changed elsewhere.</strong> Your latest edit was not saved. Reload the case to continue;
            unsaved edits in this window ({queueRef.current.pendingCount()}) will be discarded.
          </span>
          {onReload ? (
            <Button type="button" variant="primary" size="sm" onClick={() => { void reloadCase(); }} disabled={isReloading}>
              {isReloading ? "Reloading..." : "Reload case"}
            </Button>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => { if (assignmentNavigation) onClose(); else void leaveCase(onClose); }}>
              {assignmentNavigation ? "Back to my tasks" : "Back to dashboard"}
            </Button>
          )}
        </InlineMessage>
      )}

      {(actionError || submitError) && (
        <InlineMessage tone="error">{actionError ?? submitError}
          {queueRef.current.rejectedCount() > 0 && onReload && <Button type="button" variant="secondary" size="sm"
            disabled={isReloading} onClick={() => { void reloadCase(); }}>Reload case</Button>}
        </InlineMessage>
      )}
      <div className="case-reading-layout">
      {display ? <div className="comparison-reading">
        <ReadOnlyAnnotationView header={versionControls} text={view.document.text} annotations={display.value?.annotations ?? []}
          evidence={display.value?.evidence ?? []} labelFor={termLabel} onTextElement={setLeftTextElement}
          proposalContext={display.value && versions && refForKey(display.selection,versions.refs)?.kind === "proposals"
            ? {projectKey:view.key.project_key,documentId:view.document.document_id,scope:JSON.stringify([versionIdentity,display.selection]),setId:refForKey(display.selection,versions.refs)!.id} : undefined} />
      </div> : <>
      <nav className="mobile-pane-tabs" aria-label="Select view">
        {([ ["list", "List"], ["text", "Document"], ["details", "Details"] ] as const).map(([pane, label]) => (
          <button key={pane} type="button" aria-pressed={mobilePane === pane}
            onClick={() => setMobilePane(pane)}>{label}</button>
        ))}
      </nav>
      {/* Main Workspace Layout */}
      <div className={`app-layout mobile-pane-${mobilePane}${treeWalk && !treeCollapsed ? " tree-open" : ""}`}>
        {/* Left: Sidebar (Annotations & Review Targets) */}
        <aside className="sidebar density-compact">
          {/* Multi-layer controls (rendered only if >1 layer) */}
          <LayerControls
            readOnly={readOnly}
            layers={view.layers ?? []}
            scope={view.scope ?? { scope_id: "default", mode: view.key.mode, editable_layer_ids: [], reference_layer_ids: [] }}
            selection={layerSelection}
            onToggleVisibility={handleToggleVisibility}
            onSetActiveLayer={handleSetActiveLayer}
            onSetActiveType={handleSetActiveType}
            disabled={queueState === "saving"}
          />

          <div className="sidebar-scroll" ref={sidebarScrollRef}>
            <PendingReanchorPanel projectKey={view.key.project_key} documentId={view.document.document_id} scope={versionIdentity}
              enabled={view.key.mode === "review" && !display} onContext={reanchorContext.reveal} />
            {view.key.mode === "review" && (
              <div className="sidebar-section">
                <div className="sidebar-header">
                  Review Proposals ({reviewTargets.length})
                </div>
                <ul className="doc-list">
                  {reviewTargets.map((t) => {
                    const isSelected = refKey(t) === selectedTargetId;
                    const dec = decisionsMap[refKey(t)];
                    const isResolved = dec?.outcome === "changed" || dec?.outcome === "rejected";
                    return (
                      <li
                        key={refKey(t)}
                        data-list-key={`target:${refKey(t)}`}
                        className={`doc-item ${isSelected ? "selected" : ""} ${isResolved ? "doc-item--resolved" : ""}`}
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
                        <div className="doc-id doc-row">
                          <TermName termId={t.term_id ?? t.annotation_id} label={termLabel(t.layer_id, t.term_id ?? t.annotation_id)} />
                          {defaultedKeys.has(refKey(t)) && <StatusBadge tone="warning">Defaulted axes</StatusBadge>}
                          {dec ? (
                            <span className={`decision-tag decision-tag--${dec.outcome}`}>
                              {dec.outcome === "confirmed" ? <><IconCheck />Confirmed</>
                               : dec.outcome === "rejected" ? <><IconClose />Rejected</>
                               : dec.outcome === "changed" ? <><IconPencil />Replaced</>
                               : <><IconQuestion />Uncertain</>}
                            </span>
                          ) : (
                            <span className="decision-tag decision-tag--open">open</span>
                          )}
                        </div>
                        <div className="doc-meta">
                          {dec?.outcome === "changed" ? (
                            (() => {
                              const replSnap = (draft.annotations ?? []).find(
                                (a) => a.annotation.annotation_id === dec.replacement?.annotation_id
                              );
                              const replTermId = replSnap?.annotation.term_id ?? dec.replacement?.annotation_id ?? "";
                              const replLabel = replSnap ? termLabel(replSnap.annotation.layer_id, replTermId) : null;
                              const displayText = replLabel ? `${replLabel} (${replTermId})` : replTermId;
                              return (
                                <div className="doc-meta__line">
                                  <Button
                                    type="button"
                                    className="replaced-link"
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
                                    Replaced by: <strong>{displayText}</strong>
                                  </Button>
                                  {" "}<AiBadge provenance={t.provenance} source={sourceForTarget(t)} />
                                </div>
                              );
                            })()
                          ) : dec?.outcome === "rejected" ? (
                            <>
                              <span className="doc-meta__note">Proposal rejected</span>
                              {" "}<AiBadge provenance={t.provenance} source={sourceForTarget(t)} />
                            </>
                          ) : (
                            <>
                              {t.evidence_count === 0 ? "Spanless" : `“${t.quote ?? ""}”`}
                              {t.evidence_count > 1 && ` +${t.evidence_count - 1} more`}
                              {t.provenance?.actor.kind === "tool"
                                ? <>{" "}<AiBadge provenance={t.provenance} source={sourceForTarget(t)} /></>
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
                  <AiBadge provenance={s.annotation.provenance} source={s} />
                </span>
              </button>)}
            </section>}

            <div className="sidebar-section">
              <div className="sidebar-header sidebar-header--actions">
                <span>Curated Annotations ({visibleAnnotations.length})</span>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  disabled={readOnly} onClick={handleStartSpanless}
                  title="Create new annotation via ontology search"
                >
                  + New Annotation
                </Button>
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
                      <div className="doc-id doc-row">
                        <TermName termId={termId} label={termLabel(annSnap.annotation.layer_id, termId)} />
                        {defaultedKeys.has(refKey({ annotation_id: annSnap.annotation.annotation_id, version: annSnap.version })) && <StatusBadge tone="warning">Defaulted axes</StatusBadge>}
                        {layerName && (view.layers ?? []).length > 1 && (
                          <span className="decision-tag decision-tag--open">{layerName}</span>
                        )}
                      </div>
                      <div className="doc-meta">
                        {evCount === 0 ? "Spanless" : `${evCount} mention(s)`}
                        {firstAxisVal && ` • ${firstAxisVal}`}
                        {" "}<AiBadge provenance={annSnap.annotation.provenance} source={proposalFor(annSnap, view.available_inputs ?? [])} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {(view.submissions ?? []).length > 0 && <div className="detail-section">
            <h3>Previous Submissions</h3>
            {view.submissions!.map(submission => <Button type="button" variant="secondary" size="sm"
              key={submission.submission_id} onClick={() => setHistorySubmission(submission)}>
              {submission.created_at} · {submission.submission_id}
            </Button>)}
          </div>}

          {/* Submission Box at bottom of sidebar */}
          <div className="sidebar-footer">
            {submitError && (
              <div className="sidebar-footer__error">
                {submitError}
              </div>
            )}
          </div>
        </aside>

        {/* Center: Text View */}
        <TextPane
          header={versionControls}
          onTextElement={setLeftTextElement}
          contextSegments={reanchorContext.contextSegments}
          text={view.document.text}
          mentions={textMentions}
          isAttachingMention={isAttachingMention}
          onCancelAttach={cancelAttach}
          selectedEvidenceId={selectedEvidenceId}
          selectionIntent={selectionIntent}
          onSelection={handleSelection}
          onPick={handlePickMention}
          onChangeIntent={intent => { if (!readOnlyRef.current) setSelectionIntent(intent); }}
          readOnly={readOnly}
          resizableEvidenceIds={resizableEvidenceIds}
          onResizeMention={(evidenceId, segments) => { void handleResizeMention(evidenceId, segments); }}
          resyncToken={textResyncToken}
        />

        {/* Right: Annotation & Search Panel + Review Actions */}
        <div className="inspector-pane density-compact" ref={inspectorRef}>
          {selectedSource ? (
            <section className="detail-pane" aria-label="Reference details">
              <ProposalSource source={selectedSource} />
              <div className="detail-section">
                <h2><TermName termId={selectedSource.annotation.term_id} label={termLabel(selectedSource.annotation.layer_id, selectedSource.annotation.term_id)} /></h2>
                <p>{view.layers?.find(l => l.layer_id === selectedSource.annotation.layer_id)?.label} · Read-only</p>
                <p>
                  <AiBadge provenance={selectedSource.annotation.provenance} source={selectedSource} />{" "}
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
                <Button type="button" variant="secondary" disabled={queueState === "saving"} onClick={cancelPending}>Cancel</Button>
              </div>
            </section>
          ) : view.key.mode === "review" && selectedTarget ? (
            <ReviewActions
              source={targetSnapshot}
              readOnly={readOnly}
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
                if (readOnlyRef.current) return;
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
              source={proposalFor(selectedAnnotation, view.available_inputs ?? [])}
              readOnly={readOnly}
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
              onConfirmAxis={(axisId) => { void handleUpdateAxes(selectedAnnotation!.annotation.axes_values ?? {}, axisId).catch(reportError); }}
              onAttachMention={(segments) =>
                handleSelection({ segments, intent: "new_mention" })
              }
              onDetachMention={(id) => { void handleDetachMention(id).catch(reportError); }}
              onDeleteAnnotation={(id) => { void handleDeleteAnnotation(id).catch(reportError); }}
              onSetIntent={(intent) => {
                if (readOnlyRef.current) return;
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

        {/* Ontology tree: docked into the layout, after the annotation panel. */}
        {treeWalk && (
          <TreeBrowser
            key={treeWalk.nonce}
            collapsed={treeCollapsed}
            workspaceKey={view.key}
            annotationId={treeWalk.annotationId}
            layerId={treeWalk.layerId}
            startTermId={treeWalk.termId}
            currentTermId={treeWalkAnnotation?.annotation.term_id ?? null}
            canAssign={!readOnly && !!treeAnnotation && treeAnnotation.annotation.annotation_id === treeWalk.annotationId}
            focusOnOpen={treeWalk.focus}
            onClose={handleCloseTree}
            onUseTerm={handleUseTreeTerm}
          />
        )}
      </div>

      </>}
      {comparison}
      </div>
      {historySubmission && <Dialog open title="Historical submission" heading={<>Submission {historySubmission.submission_id}</>} onClose={() => setHistorySubmission(null)}>
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
        <Button type="button" variant="secondary" onClick={() => setHistorySubmission(null)}>
          Close
        </Button>
      </Dialog>}

      {completedSubmission && <Dialog open title="Case submitted" heading="✓ Case successfully submitted!">
        <p>Submission ID: <code>{completedSubmission.submission_id}</code></p>
        <p>Timestamp: {completedSubmission.created_at}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          {assignmentNavigation && completedNextAssignment.current !== undefined && <Button type="button" variant="primary"
            onClick={() => navigateAssignment(completedNextAssignment.current!)}>Next task</Button>}
          {nextDoc && onNavigateCase && (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setCompletedSubmission(null);
                void leaveCase(() => onNavigateCase(nextDoc.document_id));
              }}
            >
              Review next case (Case {nextDoc.position}) →
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCompletedSubmission(null)}
          >
            Stay in case
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { if (assignmentNavigation) onClose(); else { setCompletedSubmission(null); void leaveCase(onClose); } }}
          >
            {assignmentNavigation ? "Back to my tasks" : "Back to dashboard"}
          </Button>
        </div>
      </Dialog>}

      <Dialog open={submitDialogOpen} title="Submit case" heading={<>Submit case {view.document.document_id}?</>} onClose={() => setSubmitDialogOpen(false)}>
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

        </ul>
        {defaulted.length > 0 && <InlineMessage tone="warning">
          <p>{defaulted.length} annotations have defaulted axis values.</p>
          <Button onClick={reviewDefaulted}>Review defaulted annotations</Button>
        </InlineMessage>}
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
          <Button
            type="button"
            variant="primary"
            disabled={readOnly || !textCheckedConfirmed || (view.key.mode === "review" && openReviewTargets.length > 0)}
            onClick={() => { void confirmSubmit(); }}
          >
            Submit case
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSubmitDialogOpen(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog open={!!logoutProceed} title="Unsaved changes"
        message={<p>Your latest changes are not saved yet.</p>} confirmLabel="Save and log out"
        busy={logoutSaving} onConfirm={() => { void saveAndLogout(); }} onCancel={() => setLogoutProceed(null)} />
      {confirmRequest && <ConfirmDialog open title={confirmRequest.title} message={<p>{confirmRequest.message}</p>}
        confirmLabel={confirmRequest.confirmLabel} onConfirm={() => closeConfirm(true)} onCancel={() => closeConfirm(false)} />}
      {!assignmentNavigation && <ShortcutHelpHost />}
    </div>
    </ProposalMetadataProvider>
  );
};
