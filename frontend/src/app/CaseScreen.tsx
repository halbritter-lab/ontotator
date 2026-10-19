import { ReanchorPanel, currentReanchorResolution, reanchorKey, reanchorRef, useReanchorContext } from "../variants/ReanchorPanel";
import { useCarriedReview } from "../editor/carried/useCarriedReview";
import { deriveCarriedStates, nextUncheckedKey, rowKeyOf, type CarriedState, type SnapshotLike } from "../editor/carried/checkState";
import { carriedFromLine, instructionLine, missingReason, roundName, textSpanLine, valuesLines, whatToCheckContext, type WhatToCheckContext } from "../editor/carried/instructions";
import { CarriedSection, type CarriedReadOnly } from "../editor/carried/CarriedSection";
import { ExceptionPanel } from "../editor/carried/ExceptionPanel";
import { CarriedRowExtras } from "../editor/carried/CarriedRowExtras";
import { PlaceholderRow } from "../editor/carried/PlaceholderRow";
import { CarriedProgress } from "../editor/carried/CarriedProgress";
import { RoundInputEvidenceDialog } from "../tasks/RoundInputEvidenceDialog";
import { MergeInputs } from "../tasks/MergeInputs";
import { ComparePane } from "../variants/ComparePane";
import { Toolbar } from "../ui/Toolbar";
import { VariantSelectors } from "../variants/VariantSelectors";
import { ReadOnlyAnnotationView } from "../variants/ReadOnlyAnnotationView";
import { useCaseVersions } from "../variants/useCaseVersions";
import { VariantDetails, variantDescription } from "../variants/CaseViewer";
import { annotationOptions, pickVariant, refForKey } from "../variants/versionState";
import { ErrorNotice } from "../admin/ErrorNotice";
import { errorMessage } from "../admin/errors";
import type { AnnotationVersion } from "../api/client";
import type { Route } from "./router";
import { InlineMessage } from "../ui/InlineMessage";
import { Textarea } from "../ui/Textarea";
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
  type ReanchorItem,
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
import { submissionHistoryLabel } from "../editor/submissionHistoryLabel";
import { FindingRow } from "../editor/FindingRow";
import { SubmitCaseDialog } from "../editor/SubmitCaseDialog";
import { SubmitControl } from "../editor/SubmitControl";
import { HistoricalSubmissionDialog } from "../editor/HistoricalSubmissionDialog";
import { axisOptionLabel, findingAxes } from "../editor/axisLabels";
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
 * Unspecified baseline for new findings. Configured project presets are applied
 * separately and never imply deliberate clinical confirmation.
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

type AxisWarning = {
  acknowledgement: { draft_revision: number; policy_revision: number; warning_digest: string };
  warnings: { annotationId: string; axis: string }[];
};
function submissionAxisWarning(error: unknown): AxisWarning | null {
  if (!(error instanceof ApiError) || error.code !== "AXIS_CONFIRMATION_WARNING" || typeof error.details !== "object" || !error.details) return null;
  const acknowledgement = error.details.acknowledgement as AxisWarning["acknowledgement"] | undefined;
  if (!acknowledgement || !Number.isSafeInteger(acknowledgement.draft_revision) || acknowledgement.draft_revision < 0
    || !Number.isSafeInteger(acknowledgement.policy_revision) || acknowledgement.policy_revision < 0
    || typeof acknowledgement.warning_digest !== "string" || !acknowledgement.warning_digest) return null;
  const warnings = Array.isArray(error.details.warnings) ? error.details.warnings.flatMap((warning: unknown) => {
    if (!warning || typeof warning !== "object") return [];
    const item = warning as { annotation_id?: unknown; detail?: { axis?: unknown } };
    return typeof item.annotation_id === "string" && typeof item.detail?.axis === "string" ? [{ annotationId: item.annotation_id, axis: item.detail.axis }] : [];
  }) : [];
  return { acknowledgement, warnings };
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
  taskActions?: React.ReactNode;
  held?: boolean;
  holdReason?: string | null;
  saveBeforeReportRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  roundInputs?: readonly import("../api/client").RoundInputView[];
  roundKind?: import("../api/client").WorkRoundView["kind"];
  /** Toolbar badge of a carry-forward round, e.g. "Round 3 · continued from Round 2". */
  roundBadge?: string;
  /** Full round identity, shown as the badge's title. */
  roundTitle?: string;
  /** Version of the open text (`WorkRoundView.document_version`), for the carried "What to check" lines. */
  documentVersion?: number | null;
}

const NO_ROUND_INPUTS: readonly import("../api/client").RoundInputView[] = [];

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
  readOnly: serverReadOnly = false, routeLeaveRef, assignmentNavigation, onReadonlyRequired, versionContext, taskActions, held = false, holdReason, saveBeforeReportRef, roundInputs = NO_ROUND_INPUTS, roundKind, roundBadge, roundTitle, documentVersion,
}) => {
  const versionIdentity = JSON.stringify([versionContext?.username, versionContext?.assignmentId, versionContext?.canBrowseVersions, workspaceId, view.key]);
  const [acceptedSubmission, setAcceptedSubmission] = useState<{ identity: string; value: Submission } | null>(null);
  const submissions = useMemo(() => {
    const stored = view.submissions ?? [];
    if (acceptedSubmission?.identity !== versionIdentity || stored.some(value => value.submission_id === acceptedSubmission.value.submission_id)) return stored;
    return [...stored, acceptedSubmission.value];
  }, [view.submissions, acceptedSubmission, versionIdentity]);
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
  const readOnly = serverReadOnly || display !== null || held || acceptedSubmission?.identity === versionIdentity;
  const spanlessNotesRequired = view.enforce_spanless_rules && view.allow_spanless_findings !== false && view.require_spanless_note !== false;
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
    reanchorItem?: ReanchorItem;
    /** "Mark in text" of a carried input without a carried finding: re-create it with the original term. */
    carriedInput?: import("../api/client").RoundInputView;
    selectedTerm?: { termId: string; searchId?: string };
  } | null>(null);
  const [activeReanchor, setActiveReanchor] = useState<ReanchorItem | null>(null);
  // "Mark in text" waits for a text selection for this carried input.
  const [activeCarried, setActiveCarried] = useState<import("../api/client").RoundInputView | null>(null);
  const [resolutionItem, setResolutionItem] = useState<ReanchorItem | null>(null);
  const [spanlessReason, setSpanlessReason] = useState("");
  const [pendingEvidenceAdoption, setPendingEvidenceAdoption] = useState<TargetProposal | null>(null);
  const [pendingAdoption, setPendingAdoption] = useState<TargetProposal | null>(null);
  const [adoptionReasons, setAdoptionReasons] = useState<Record<string, string>>({});
  const [spanlessReasonError, setSpanlessReasonError] = useState(false);
  const [annotationNoteDrafts, setAnnotationNoteDrafts] = useState<Record<string, string>>({});
  const annotationNoteSaves = useRef(new Map<string, Promise<void>>());
  const annotationNoteDraftsRef = useRef(annotationNoteDrafts);
  annotationNoteDraftsRef.current = annotationNoteDrafts;
  const unsavedAnnotationNotes = () => Object.entries(annotationNoteDraftsRef.current).filter(([id, note]) => {
    const ann = latestDraft.current.annotations?.find(a => a.annotation.annotation_id === id)?.annotation;
    return ann && note !== (ann.note ?? "");
  });
  const invalidAnnotationNotes = () => unsavedAnnotationNotes().filter(([id, note]) => {
    const ann = latestDraft.current.annotations?.find(a => a.annotation.annotation_id === id)?.annotation;
    return spanlessNotesRequired && ann && !ann.evidence_refs?.length && !note.trim();
  });
  const [isAttachingMention, setIsAttachingMention] = useState(false);
  const [textResyncToken, setTextResyncToken] = useState(0);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const creatingPending = useRef(false);
  const [draft, setDraft] = useState<Draft>(view.draft);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const pendingReanchorItems = view.key.mode === "review" ? view.pending_reanchor_items ?? [] : [];
  const unresolvedReanchorCount = pendingReanchorItems.filter(item =>
    !currentReanchorResolution(item, draft.reanchor_resolutions ?? [], draft.annotations ?? [])).length;
  const carriedInputs = roundKind === "carry_forward" || (view.key.mode === "independent" && roundInputs.length) ? roundInputs : NO_ROUND_INPUTS;
  const [originalRoundInput, setOriginalRoundInput] = useState<import("../api/client").RoundInputView | null>(null);

  const [layerSelection, setLayerSelection] = useState<LayerSelection>(() =>
    initLayerSelection(view.layers ?? [], view.scope)
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  // A carried input without a finding on this text (placeholder row); exclusive with the others.
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedAnnotationId || selectedTargetId || selectedSourceId) setSelectedInputId(null);
  }, [selectedAnnotationId, selectedTargetId, selectedSourceId]);
  useEffect(() => {
    if (readOnly || (pendingEvidenceAdoption && selectedTargetId !== refKey(pendingEvidenceAdoption))) setPendingEvidenceAdoption(null);
  }, [readOnly, selectedTargetId, pendingEvidenceAdoption]);
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
  const [axisWarning, setAxisWarning] = useState<AxisWarning | null>(null);
  const [axisWarningAcknowledged, setAxisWarningAcknowledged] = useState(false);
  const submittingWorkspace = useRef(false);
  useEffect(() => { setAxisWarning(null); setAxisWarningAcknowledged(false); }, [draft.revision, view.annotation_policy_revision]);
  const [isReloading, setIsReloading] = useState(false);
  // Reviewer notes typed in the UI, keyed by target; kept even when a decision is reset.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const invalidReviewNoteGuard = useRef<() => boolean>(() => false);
  const hasInvalidReviewNoteRef = useRef(false);
  const [requiredNoteKey, setRequiredNoteKey] = useState<string | null>(null);
  const [decisionIntentKeys, setDecisionIntentKeys] = useState<string[]>([]);
  const decisionIntentTokens = useRef<Record<string, number>>({});
  const nextDecisionIntentToken = useRef(0);
  const noteDraftsRef = useRef(noteDrafts);
  noteDraftsRef.current = noteDrafts;

  // Modals
  const [completedSubmission, setCompletedSubmission] = useState<Submission | null>(null);
  const completedNextAssignment = useRef<number | undefined>(undefined);
  const [historySubmission, setHistorySubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reloadSubmissionRules, setReloadSubmissionRules] = useState(false);
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
    ...submissions.flatMap((submission) => submission.snapshots),
    ...roundInputs.flatMap(input => [input.source_snapshot, ...(input.target_snapshot ? [input.target_snapshot] : [])]),
  ].map((snapshot) => ({
    layer_id: snapshot.annotation.layer_id,
    term_id: snapshot.annotation.term_id,
  })).concat(pendingReanchorItems.map(item=>({layer_id:item.layer_id,term_id:item.term_id}))), [draft.annotations, display?.value, view.available_inputs, submissions, view.pending_reanchor_items, roundInputs]);
  const termLabel = useTermLabels(view.key.project_key, displayedTerms);

  const searchManager = useMemo(() => new SearchManager(api), []);
  useEffect(() => {
    if (!readOnly || held) return;
    setPendingAnnotation(null);
    setActiveReanchor(null);
    setActiveCarried(null);
    setIsAttachingMention(false);
    setSelectionIntent("new_mention");
    setSubmitDialogOpen(false);
    searchManager.clear();
  }, [readOnly, held, searchManager]);

  useEffect(() => {
    searchManager.setLayer(layerSelection.activeLayerId);
  }, [layerSelection.activeLayerId, searchManager]);

  // Search languages: stored per annotator, offered per ontology of the layer.
  const languagesForOntology = useSearchLanguages(api, view.key.annotator_id, view.key.project_key, view.document.language, view.document.document_id);
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
  const matchingReanchorItems = selectedAnnotation ? pendingReanchorItems.filter(item =>
    item.layer_id === selectedAnnotation.annotation.layer_id && item.type_id === selectedAnnotation.annotation.type_id &&
    selectedAnnotation.annotation.provenance.source_refs?.includes(`${item.source_ref.annotation_id}:${item.source_ref.version}`) &&
    !currentReanchorResolution(item, draft.reanchor_resolutions ?? [], draft.annotations ?? [])) : [];
  const selectedReanchorItem = matchingReanchorItems.find(item=>resolutionItem && reanchorKey(item)===reanchorKey(resolutionItem)) ??
    (matchingReanchorItems.length===1 ? matchingReanchorItems[0] : undefined);
  const savedPendingReanchor = pendingAnnotation?.reanchorItem ? draft.annotations?.find(snapshot=>snapshot.annotation.annotation_id===pendingAnnotation.annotationId) : undefined;

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
        axes_defaulted: snap?.annotation.axes_defaulted ?? [],
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
    : selectedInputId ? `input:${selectedInputId}`
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
  useEffect(() => {
    if (requiredNoteKey !== null && selectedTargetId !== requiredNoteKey) setRequiredNoteKey(null);
    else if (requiredNoteKey !== null) inspectorRef.current?.querySelector<HTMLTextAreaElement>('[aria-label="Reviewer note"]')?.focus();
  }, [selectedTargetId, requiredNoteKey]);
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

  const pausedLocalInput = useRef<() => boolean>(() => false);
  pausedLocalInput.current = () => held && (!!pendingAnnotation || !!activeReanchor || decisionIntentKeys.length > 0 || unsavedAnnotationNotes().length > 0);
  useEffect(() => {
    if (!leaveGuardRef) return;
    leaveGuardRef.current = (proceed) => {
      if (pausedLocalInput.current()) {
        void askConfirm("Paused task has local input", "Logging out discards the local input kept in this paused editor. Saved work is kept.", "Discard local input and log out").then(discard => { if (discard) proceed(); }); return;
      }
      if (unsavedAnnotationNotes().length > 0) {
        logoutRejectedBaseline.current = queueRef.current.rejectedCount();
        setLogoutProceed(() => proceed); return;
      }
      if (invalidReviewNoteGuard.current()) return;
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
    if (invalidAnnotationNotes().length > 0) { setActionError("A reason is required for findings without a text span."); setLogoutProceed(null); return; }
    if (invalidReviewNoteGuard.current()) { setLogoutProceed(null); return; }
    setLogoutSaving(true);
    try {
      await flushAnnotationNotes();
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
      if (held && (pendingAnnotation || activeReanchor || decisionIntentKeys.length || unsavedAnnotationNotes().length)) {
        const discard = await askConfirm("Paused task has local input", "Your task is paused and local input cannot be saved. Stay in this editor to resume and save, or explicitly discard the local input and leave. Saved work is kept.", "Discard local input and leave");
        if (!discard) return false;
      }
      if (!readOnlyRef.current && decisionIntentKeys.length) {
        const discard = await askConfirm("Decision not saved", "An unresolved decision is still a draft. Return to Save decision, or discard this decision draft and leave. The saved decision is kept.", "Discard decision draft and leave");
        if (!discard) return false;
        const kept = { ...noteDraftsRef.current };
        for (const key of decisionIntentKeys) delete kept[key];
        noteDraftsRef.current = kept; setNoteDrafts(kept); setDecisionIntentKeys([]);
      }
      const invalidLocalAnnotationNotes = !readOnlyRef.current ? invalidAnnotationNotes() : [];
      if (invalidLocalAnnotationNotes.length > 0) {
        const discard = await askConfirm("Changes not saved", "Annotation notes have unsaved edits. A reason is required when no text span is linked. Leaving discards these local edits.", "Discard edits and leave");
        if (!discard) return false;
        const kept = { ...annotationNoteDraftsRef.current };
        for (const [id] of invalidLocalAnnotationNotes) delete kept[id];
        annotationNoteDraftsRef.current = kept; setAnnotationNoteDrafts(kept);
      }
      const invalidLocalNotes = !readOnlyRef.current ? (latestDraft.current.decisions ?? []).filter(d => {
        const local = noteDraftsRef.current[refKey(d.target)];
        return d.outcome === "uncertain" && local !== undefined && !local.trim() && local !== (d.note ?? "");
      }) : [];
      if (invalidLocalNotes.length > 0) {
        const discard = await askConfirm("Changes not saved",
          "An unresolved reviewer note is empty and cannot be saved. Leaving discards the local note edit; the saved review decision is kept.",
          "Discard edits and leave");
        if (!discard) { invalidReviewNoteGuard.current(); return false; }
        const kept = { ...noteDraftsRef.current };
        for (const decision of invalidLocalNotes) delete kept[refKey(decision.target)];
        noteDraftsRef.current = kept; setNoteDrafts(kept);
      }
      const rejectedBefore = queueRef.current.rejectedCount();
      if (rejectedBefore > 0) {
        setActionError("A change could not be saved. Reload the case before leaving.");
        return false;
      }
      try {
        await flushAnnotationNotes();
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
        annotationNoteDraftsRef.current = {}; setAnnotationNoteDrafts({});
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
      setReloadSubmissionRules(false); setSubmitError(null);
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

  const hasInvalidReviewNote = !readOnly && view.key.mode === "review" && (draft.decisions ?? []).some(d => {
    const local = noteDrafts[refKey(d.target)];
    return d.outcome === "uncertain" && local !== undefined && !local.trim() && local !== (d.note ?? "");
  });
  hasInvalidReviewNoteRef.current = hasInvalidReviewNote || unsavedAnnotationNotes().length > 0 || decisionIntentKeys.length > 0;
  const statusText =
    queueState === "conflict" ? "Changed elsewhere – reload required"
    : queueState === "error" ? (
      isSessionProblem(queueError) ? "Session ended – changes kept"
      : isNetworkError(queueError) || isOffline ? "Offline – changes not saved"
      : "Save error – changes not saved"
    )
    : unsavedAnnotationNotes().length > 0 ? "Annotation note changes not saved"
    : decisionIntentKeys.length > 0 ? "Draft review decision not saved"
    : hasInvalidReviewNote ? "Reviewer note required – changes not saved"
    : queueState === "saving" ? "Saving..."
    : queueState === "dirty" ? "Unsaved changes"
    : isOffline ? "Offline"
    : "Saved";
  const statusIsError = queueState === "conflict" || queueState === "error" || isOffline || hasInvalidReviewNote;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasInvalidReviewNoteRef.current || ["saving", "dirty", "error"].includes(queueRef.current.getState())) {
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

  const resolveReanchor = (item: ReanchorItem, outcome: "recreated" | "dismissed", value: string): Promise<Draft> => {
    assertWritable();
    setActionError(null);
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.resolveReanchor>[1] | undefined;
    return queueRef.current.enqueue(async expectedRevision => {
      assertWritable();
      if (!envelope) {
        const saved = outcome === "recreated" ? latestDraft.current.annotations?.find(snapshot => snapshot.annotation.annotation_id === value) : undefined;
        if (outcome === "recreated" && !saved) throw new ValidationError("Save the replacement finding before resolving this item.");
        envelope = {mutation_id:mutationId,expected_revision:expectedRevision,payload:{item:reanchorRef(item),outcome,
          ...(saved ? {replacement:{annotation_id:saved.annotation.annotation_id,version:saved.version}} : {reason:value})}};
      }
      const updated = await api.resolveReanchor(workspaceId,envelope).catch(assignmentFailure);
      latestDraft.current=updated;setDraft(updated);return updated;
    });
  };

  const beginReanchor = async (item: ReanchorItem) => {
    try {
      assertWritable();
      await flushAnnotationNotes();
      if (unsavedAnnotationNotes().length) {
        setActionError("Save the annotation note before re-creating another finding.");return;
      }
      assertWritable();
      const layer=view.layers?.find(value=>value.layer_id===item.layer_id);
      if (!item.type_id || !layer?.annotation_types.some(type=>type.type_id===item.type_id)) {
        setActionError("The original finding type is unavailable for re-creation. You can still dismiss this finding with a reason.");return;
      }
      handleDeselectAll();
      const copies=latestDraft.current.annotations?.filter(snapshot=>snapshot.annotation.layer_id===item.layer_id && snapshot.annotation.type_id===item.type_id &&
        snapshot.annotation.provenance.source_refs?.includes(`${item.source_ref.annotation_id}:${item.source_ref.version}`)) ?? [];
      const saved=copies.find(snapshot=>snapshot.annotation.annotation_id===selectedAnnotationId) ?? (copies.length===1 ? copies[0] : undefined);
      if(saved) {
        setResolutionItem(item);
        setSelectedAnnotationId(saved.annotation.annotation_id);setSelectedEvidenceId(saved.annotation.evidence_refs?.[0]?.evidence_id ?? null);
        setMobilePane("details");return;
      }
      if(copies.length>1) {
        setResolutionItem(item);setMobilePane("list");
        setActionError("Select the replacement finding in the findings list, then choose Complete text-change review.");return;
      }
      setLayerSelection(previous => setActiveLayer(previous,view.layers ?? [],view.scope,item.layer_id));
      setActiveReanchor(item);setSelectionIntent("new_mention");setMobilePane("text");
      reanchorContext.reveal(item.new_context);
      leftTextElement?.focus();
    } catch(error) {reportError(error);}
  };

  const mergeInputs = async (inputIds: string[], outputId: string, note?: string) => {
    await flushAnnotationNotes();
    if (unsavedAnnotationNotes().length) throw new ValidationError("Save the annotation note before merging inputs.");
    assertWritable();
    const mutationId = crypto.randomUUID();
    let envelope: Parameters<typeof api.mergeRoundInputs>[1] | undefined;
    await queueRef.current.enqueue(async expectedRevision => {
      assertWritable();
      if (!envelope) {
        const saved = latestDraft.current.annotations?.find(value => value.annotation.annotation_id === outputId);
        if (!saved) throw new ValidationError("Select a current saved finding before merging inputs.");
        envelope = { mutation_id: mutationId, expected_revision: expectedRevision, payload: { input_ids: inputIds, replacement: { annotation_id: saved.annotation.annotation_id, version: saved.version }, ...(note ? { note } : {}) } };
      }
      const updated = await api.mergeRoundInputs(workspaceId, envelope).catch(assignmentFailure);
      latestDraft.current = updated; setDraft(updated); return updated;
    });
  };

  const handleDeselectAll = () => {
    setSelectedInputId(null);
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
  /** Whether an adopted copy differs from its source proposal (term, type, axes, note or mentions). */
  const copyDiffersFromTarget = (copy: AnnotationSnapshot, target: { annotation_id: string; version: string }) => {
    const source = targetSnapshotOf(target);
    if (!source) return true;
    if ((copy.annotation.note ?? "") !== (source.annotation.note ?? "")) return true;
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
    const type = view.layers?.find(layer => layer.layer_id === ann.annotation.layer_id)?.annotation_types.find(item => item.type_id === ann.annotation.type_id);
    // Intermediate copies stay editable; approval waits for the profile's evidence.
    if (type?.evidence_policy === "required_on_complete" && !ann.annotation.evidence_refs?.length) return;
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

  const saveAnnotationNote = async (id: string): Promise<void> => {
    const running = annotationNoteSaves.current.get(id);
    if (running) { await running; return saveAnnotationNote(id); }
    if (readOnlyRef.current) return;
    const note = annotationNoteDraftsRef.current[id];
    const ann = latestDraft.current.annotations?.find(a => a.annotation.annotation_id === id)?.annotation;
    if (!ann || note === undefined || note === (ann.note ?? "")) return;
    if (spanlessNotesRequired && !ann.evidence_refs?.length && !note.trim()) return;
    const save = (async () => {
      await mutateAnnotationAndSyncDecision(id, () => enqueueMutation({ command: "set_annotation_note", annotation_id: id, note: note.trim() || null }));
      if (annotationNoteDraftsRef.current[id] === note) {
        const next = { ...annotationNoteDraftsRef.current }; delete next[id];
        annotationNoteDraftsRef.current = next; setAnnotationNoteDrafts(next);
      }
    })();
    annotationNoteSaves.current.set(id, save);
    try { await save; } finally { annotationNoteSaves.current.delete(id); }
  };

  /** Drain saved-note continuations through the queue's error-aware flush path.
   * Transport/session failures deliberately keep enqueue promises pending for retry.
   */
  const flushAnnotationNotes = async () => {
    const requested = new Set<string>();
    const rejectedBefore = queueRef.current.rejectedCount();
    while (true) {
      if (readOnlyRef.current) { await queueRef.current.flush(); return; }
      const invalid = new Set(invalidAnnotationNotes().map(([id]) => id));
      for (const [id] of unsavedAnnotationNotes()) {
        if (!invalid.has(id) && (!requested.has(id) || !annotationNoteSaves.current.has(id))) {
          requested.add(id); void saveAnnotationNote(id).catch(reportError);
        }
      }
      await queueRef.current.flush();
      // A domain rejection is reported by its save continuation; do not retry it.
      if (queueRef.current.rejectedCount() !== rejectedBefore) return;
      // A save can enqueue a newer note or replacement after an earlier drain.
      const saveableNotes = unsavedAnnotationNotes().some(([id]) => !invalid.has(id));
      if (annotationNoteSaves.current.size === 0 && !saveableNotes) return;
    }
  };

  // Carried review (carry-forward rounds): check states, writes and announcements.
  const [carriedAnnouncement, setCarriedAnnouncement] = useState("");
  const announcementRef = useRef("");
  const announceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);
  /** Polite announcement; an identical message is cleared first so screen readers read it again. */
  const announceCarried = (message: string) => {
    window.clearTimeout(announceTimer.current);
    if (message !== announcementRef.current) { announcementRef.current = message; setCarriedAnnouncement(message); return; }
    announcementRef.current = ""; setCarriedAnnouncement("");
    announceTimer.current = window.setTimeout(() => { announcementRef.current = message; setCarriedAnnouncement(message); }, 50);
  };
  const carriedTermText = (snapshot: SnapshotLike) =>
    termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id;
  const carried = useCarriedReview({
    inputs: carriedInputs, draft, workspaceId, readOnly,
    // The hook writes through this queue; keep the editor's read-only guard and the
    // "assignment submitted elsewhere" handling of every other draft write.
    queue: {
      enqueue: operation => queueRef.current.enqueue(async expectedRevision => {
        assertWritable();
        const updated = await operation(expectedRevision).catch(assignmentFailure);
        if (updated && "annotations" in (updated as object)) { latestDraft.current = updated as Draft; setDraft(updated as Draft); }
        return updated;
      }),
      retry: () => queueRef.current.retry(),
      getLastError: () => queueRef.current.getLastError(),
    },
    queueState,
    flushNotes: flushAnnotationNotes,
    hasUnsavedNotes: () => unsavedAnnotationNotes().length > 0,
    onDraft: updated => {
      if (updated.revision < latestDraft.current.revision) return;
      latestDraft.current = updated; setDraft(updated);
    },
    announce: announceCarried,
    termText: carriedTermText,
  });
  const carriedActive = carried.states.length > 0;
  const pendingCarriedCount = carried.states.filter(state => state.unchecked).length;
  /** Row order of the findings list: placeholder rows (input order), then the visible findings. */
  const carriedListOrder = useMemo(() => [
    ...carried.placeholders.map(state => `input:${state.input.input_id}`),
    ...visibleAnnotations.map(snapshot => `annotation:${snapshot.annotation.annotation_id}`),
  ], [carried.placeholders, visibleAnnotations]);
  // Version of the open text: from the round (prop), the case versions or the document list. A text
  // with the source's hash is the source's text, so its version is the source version.
  const currentTextVersion = documentVersion
    ?? versions?.detail.variants.find(row => row.document_id === view.document.document_id)?.version
    ?? documentList?.find(row => row.document_id === view.document.document_id)?.version
    ?? null;
  const carriedContext = (input: CarriedState["input"]): { context: WhatToCheckContext; versionKnown: boolean } => {
    const base = whatToCheckContext(input, { ...view.document, version: currentTextVersion ?? 0 });
    const version = currentTextVersion ?? (base.sameText ? input.source_version ?? null : null);
    if (version === null) return { context: { ...base, sourceVersion: null }, versionKnown: false };
    return { context: { ...base, currentVersion: version }, versionKnown: true };
  };
  /** "What to check" → "Text span"; without a known text version the version suffix is left out. */
  const carriedTextSpan = (input: CarriedState["input"]): string => {
    const { context, versionKnown } = carriedContext(input);
    if (!versionKnown && context.hasEvidence && context.sameText) return `Same text as in ${roundName(context.sourceOrdinal)}.`;
    return textSpanLine(context);
  };
  const carriedInstruction = (state: CarriedState, whereOverride?: "linked"): string | null => {
    const where = whereOverride ?? (state.home !== "placeholder" ? state.home
      : state.missing === "deleted" ? "placeholder:deleted" as const : "placeholder:mapping_failed" as const);
    return instructionLine(carriedContext(state.input).context, state.variant, where);
  };
  /** The finding re-created via "Mark in text" for a placeholder input, while it exists (client-side link). */
  const recreatedFinding = (state: CarriedState) => {
    const id = state.homeId ? undefined : carried.recreatedFor[state.input.input_id];
    return id ? draft.annotations?.find(snapshot => snapshot.annotation.annotation_id === id) : undefined;
  };
  /** Carried inputs a finding shows: its own homes plus placeholder inputs re-created as this finding. */
  const carriedStatesFor = (annotationId: string): CarriedState[] => [
    ...(carried.byHome.get(annotationId) ?? []),
    ...carried.placeholders.filter(state => recreatedFinding(state)?.annotation.annotation_id === annotationId),
  ];
  const carriedShownState = (states: CarriedState[]) =>
    states.find(state => state.unchecked) ?? states.find(state => state.home === "carried") ?? states[0];

  /** Carried check state, meta and instruction lines of a finding row that shows carried inputs. */
  const carriedExtras = (annotationId: string) => {
    const states = carriedStatesFor(annotationId);
    if (!states.length) return null;
    const own = states.find(state => state.home === "carried");
    const shown = carriedShownState(states);
    const linked = own ? undefined : states.map(state => ({ term: carriedTermText(state.input.source_snapshot), sourceOrdinal: state.input.source_round_ordinal ?? null }));
    return <CarriedRowExtras state={shown} sourceOrdinal={(own ?? shown).input.source_round_ordinal ?? null}
      instruction={carriedInstruction(shown, shown.home === "placeholder" ? "linked" : undefined)} linked={linked} />;
  };

  /** The one selection entry point of the findings list: selects a row and clears every other selection. */
  const selectListKey = (key: string | null) => {
    cancelPending();
    setSelectedTargetId(null); setSelectedSourceId(null); setSelectedAnnotationId(null); setSelectedInputId(null); setSelectedEvidenceId(null);
    if (!key) return;
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator), id = key.slice(separator + 1);
    if (kind === "annotation") {
      setSelectedAnnotationId(id);
      setSelectedEvidenceId(latestDraft.current.annotations?.find(snapshot => snapshot.annotation.annotation_id === id)?.annotation.evidence_refs?.[0]?.evidence_id ?? null);
    } else if (kind === "input") setSelectedInputId(id);
    else if (kind === "target") setSelectedTargetId(id);
    else if (kind === "source") setSelectedSourceId(id);
    setMobilePane("details");
  };
  /** Selects the next (1) or previous (-1) unchecked carried row, wrapping; false when none is open. */
  const selectedInputState = selectedInputId ? carried.states.find(state => state.input.input_id === selectedInputId) : undefined;
  const goToUnchecked = (direction: 1 | -1): boolean => {
    const key = nextUncheckedKey(carriedListOrder, carried.openKeys, selectedListKey, direction);
    if (!key) return false;
    selectListKey(key);
    return true;
  };

  // Focus a control of the inspector once it shows `key` (after a check action re-rendered it).
  const [focusRequest, setFocusRequest] = useState<{ key: string; find: (root: HTMLElement) => HTMLElement | null } | null>(null);
  useEffect(() => {
    if (!focusRequest || !inspectorRef.current) return;
    if (inspectorKey !== focusRequest.key) { if (inspectorKey !== null) setFocusRequest(null); return; }
    const target = focusRequest.find(inspectorRef.current);
    if (target) { target.focus(); setFocusRequest(null); }
  });
  const byButtonText = (text: string) => (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>("button")).find(button => button.textContent?.trim() === text) ?? null;
  const carriedPrimary = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-carried-primary]");
  /** Check state of an input in the latest draft (after a write resolved, before the re-render). */
  const carriedStateNow = (inputId: string) =>
    deriveCarriedStates(carriedInputs, latestDraft.current.round_input_resolutions ?? [], latestDraft.current.annotations ?? [])
      .find(state => state.input.input_id === inputId);
  const carriedReadOnly: CarriedReadOnly = !readOnly ? false : display !== null ? "older" : held ? "paused" : "submitted";
  const showCarriedOriginal = (state: CarriedState) =>
    setOriginalRoundInput(carriedInputs.find(input => input.input_id === state.input.input_id) ?? null);

  const markCarriedChecked = (state: CarriedState) => carried.markChecked(state).catch(reportError);
  const linkCarried = (state: CarriedState, annotationId: string) => carried.link(state, annotationId).catch(reportError);
  const dismissCarried = async (state: CarriedState, reason: string) => {
    const inputId = state.input.input_id;
    try { await carried.dismiss(state, reason); } catch (error) { reportError(error); return; }
    const after = carriedStateNow(inputId);
    if (after?.variant !== "dismissed") return;
    // An atomic dismissal removed the carried finding: its row is now the placeholder.
    const key = rowKeyOf(after);
    if (key !== selectedListKey) selectListKey(key);
    setFocusRequest({ key, find: byButtonText("Undo dismissal") });
  };
  const undoCarriedDismissal = async (state: CarriedState) => {
    const inputId = state.input.input_id;
    try { await carried.undoDismissal(state); } catch (error) { reportError(error); return; }
    if (latestDraft.current.round_input_resolutions?.some(resolution => resolution.input_id === inputId)) return;
    const after = carriedStateNow(inputId);
    // The server restored the removed carried finding: select it and offer "Mark as checked".
    const key = after?.carriedId ? `annotation:${after.carriedId}` : `input:${inputId}`;
    if (key !== selectedListKey) selectListKey(key);
    setFocusRequest({ key, find: carriedPrimary });
  };
  /** "Mark in text": attach mode with the original term; the new finding is linked client-side only. */
  const markCarriedInText = (state: CarriedState) => {
    const input = carriedInputs.find(value => value.input_id === state.input.input_id);
    if (!input || readOnlyRef.current) return;
    const source = input.source_snapshot.annotation;
    const layer = view.layers?.find(value => value.layer_id === source.layer_id);
    if (!layer?.annotation_types.some(type => type.type_id === source.type_id) || !view.scope.editable_layer_ids.includes(source.layer_id)) {
      setActionError("This finding's layer is no longer editable."); return;
    }
    setActionError(null);
    setLayerSelection(previous => setActiveLayer(previous, view.layers ?? [], view.scope, source.layer_id));
    setActiveCarried(input); setSelectionIntent("new_mention"); setMobilePane("text");
    leftTextElement?.focus();
  };
  /** Findings of the carried input's layer and type that it can be linked to. */
  const carriedLinkCandidates = (state: CarriedState) => {
    const source = state.input.source_snapshot.annotation;
    return (draft.annotations ?? [])
      .filter(snapshot => snapshot.annotation.layer_id === source.layer_id && snapshot.annotation.type_id === source.type_id)
      .map(snapshot => {
        const term = carriedTermText(snapshot);
        const evidence = (snapshot.annotation.evidence_refs ?? []).map(ref => allEvidenceMap[ref.evidence_id]).find(Boolean);
        const quote = evidence ? quoteSegments(view.document.text, evidence.mention.segments, 40) : "";
        return {
          annotationId: snapshot.annotation.annotation_id, version: snapshot.version, technicalId: snapshot.annotation.annotation_id,
          label: quote ? `${term} · “${quote}”` : `${term} · no text span`,
        };
      });
  };
  /** Display labels and values of the axes of a snapshot. */
  const carriedAxes = (snapshot: SnapshotLike) => {
    const config = view.layers?.find(layer => layer.layer_id === snapshot.annotation.layer_id)?.annotation_types
      .find(type => type.type_id === snapshot.annotation.type_id)?.axes ?? view.axes_config;
    return findingAxes((snapshot.annotation.axes_values ?? {}) as Record<string, unknown>, config);
  };
  // Original quote of a placeholder input: the open text when it is the source text, else the source text.
  const [carriedSourceText, setCarriedSourceText] = useState<{ hash: string; text: string } | null>(null);
  const roundInputOf = (state: CarriedState) => carriedInputs.find(input => input.input_id === state.input.input_id);
  const selectedSourceSnapshot = selectedInputState ? roundInputOf(selectedInputState)?.source_snapshot : undefined;
  useEffect(() => {
    const snapshot = selectedSourceSnapshot;
    if (!snapshot?.text_sha256 || snapshot.text_sha256 === view.document.text_sha256 || carriedSourceText?.hash === snapshot.text_sha256) return;
    if (!(snapshot.annotation.evidence_refs ?? []).length) return;
    let active = true;
    api.getVariantText(view.key.project_key, snapshot.document_id).then(value => {
      if (active && value.text_sha256 === snapshot.text_sha256) setCarriedSourceText({ hash: value.text_sha256, text: value.text });
    }, () => { /* the quote stays "…"; "Show original evidence" reports the failure */ });
    return () => { active = false; };
  }, [selectedSourceSnapshot, view.document.text_sha256, view.key.project_key]);
  const carriedSourceQuote = (state: CarriedState): string | null => {
    const snapshot = roundInputOf(state)?.source_snapshot;
    if (!snapshot) return null;
    const refs = snapshot.annotation.evidence_refs ?? [];
    const evidence = refs.flatMap(ref => snapshot.evidence.filter(value => value.mention.evidence_id === ref.evidence_id && value.version === ref.version));
    if (!evidence.length) return null;
    const text = snapshot.text_sha256 === view.document.text_sha256 ? view.document.text
      : carriedSourceText && carriedSourceText.hash === snapshot.text_sha256 ? carriedSourceText.text : null;
    if (text === null) return "…";
    return evidence.map(value => quoteSegments(text, value.mention.segments)).filter(Boolean).join(" … ") || "…";
  };
  const selectedCarriedStates = selectedAnnotationId && !pendingAnnotation ? carriedStatesFor(selectedAnnotationId) : [];
  const selectedCarriedState = selectedCarriedStates.length ? carriedShownState(selectedCarriedStates) : undefined;
  const carriedSection = selectedCarriedState && selectedAnnotation ? (() => {
    const state = selectedCarriedState, input = state.input;
    const sourceNote = input.source_snapshot.annotation.note?.trim() ?? "";
    const defaulted = new Set(selectedAnnotation.annotation.axes_defaulted ?? []);
    return <CarriedSection key={input.input_id} state={state}
      origin={carriedFromLine(input.source_round_ordinal ?? null)} recordedAt={input.source_recorded_at}
      whatToCheck={{
        textSpan: carriedTextSpan(input),
        values: valuesLines(carriedAxes(selectedAnnotation).filter(axis => defaulted.has(axis.id)).map(axis => axis.label)),
        noteFirstLine: sourceNote ? sourceNote.split("\n")[0] : undefined,
        noteFull: sourceNote || undefined,
      }}
      readOnly={carriedReadOnly}
      onMarkChecked={() => markCarriedChecked(state)}
      onShowOriginal={() => showCarriedOriginal(state)}
      onNextUnchecked={carried.openKeys.size > 0 ? () => { goToUnchecked(1); } : undefined}
      onDismiss={reason => dismissCarried(state, reason)}
      error={carried.errorFor(input.input_id)}
      onRetry={() => carried.retry(input.input_id)}
      onSaveNoteAndCheck={async () => { await flushAnnotationNotes(); await markCarriedChecked(state); }} />;
  })() : null;
  const carriedDeleteMessage = selectedAnnotationId && carried.byHome.has(selectedAnnotationId)
    ? "Delete this annotation and all its mentions? This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason."
    : undefined;
  /** Delete; a deleted carried finding becomes its placeholder row, selected with "Dismiss with reason…" focused. */
  const deleteAnnotation = async (annotationId: string) => {
    const homes = carried.byHome.get(annotationId) ?? [];
    await handleDeleteAnnotation(annotationId);
    const after = homes.length ? carriedStateNow(homes[0].input.input_id) : undefined;
    if (!after || after.homeId) return;
    const key = `input:${after.input.input_id}`;
    selectListKey(key);
    setFocusRequest({ key, find: root => root.querySelector<HTMLElement>("[data-carried-dismiss]") });
  };

  useEffect(() => {
    if (!saveBeforeReportRef) return;
    const flush = async () => {
      await flushAnnotationNotes();
      await queueRef.current.flush();
      if (unsavedAnnotationNotes().length || invalidAnnotationNotes().length) throw new Error("Some annotation notes are not saved. Your input is kept in this editor.");
    };
    saveBeforeReportRef.current = flush;
    return () => { if (saveBeforeReportRef.current === flush) saveBeforeReportRef.current = null; };
  });

  // Text selection handler
  const handleSelection = async (payload: SelectionPayload) => {
    if (readOnlyRef.current) return;
    if (!payload.segments || payload.segments.length === 0) return;
    setMobilePane("details");

    setActionError(null);
    if (activeCarried) {
      const input = activeCarried, source = input.source_snapshot.annotation;
      handleDeselectAll();
      setPendingAnnotation({ annotationId: `ann-${crypto.randomUUID()}`, evidenceId: newEvidenceId(), layerId: source.layer_id,
        typeId: source.type_id, segments: payload.segments, carriedInput: input });
      return;
    }
    if (activeReanchor) {
      const item=activeReanchor;
      const layer=view.layers?.find(value=>value.layer_id===item.layer_id);
      const typeId=item.type_id;
      if (!typeId || !layer?.annotation_types.some(type=>type.type_id===typeId) || !view.scope.editable_layer_ids.includes(item.layer_id)) {
        setActionError("This finding's layer is no longer editable.");return;
      }
      handleDeselectAll();
      setPendingAnnotation({annotationId:`ann-${crypto.randomUUID()}`,evidenceId:newEvidenceId(),layerId:item.layer_id,
        typeId,segments:payload.segments,reanchorItem:item});
      return;
    }
    if (pendingEvidenceAdoption) {
      if (selectedTargetId !== refKey(pendingEvidenceAdoption) || creatingPending.current) return;
      creatingPending.current = true;
      try { await handleAdoptAndEditTarget(pendingEvidenceAdoption, undefined, payload.segments); }
      catch (error) { reportError(error); }
      finally { creatingPending.current = false; }
      return;
    }
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

  const cancelPending = () => {
    const item=activeReanchor ?? pendingAnnotation?.reanchorItem;
    setPendingAnnotation(null); setActiveReanchor(null); setActiveCarried(null); searchManager.clear();
    if(item) [...(sidebarScrollRef.current?.querySelectorAll<HTMLElement>('[data-reanchor-item]') ?? [])]
      .find(row=>row.dataset.reanchorItem===reanchorKey(item))?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const createPendingAnnotation = async (termId: string, searchId?: string) => {
    if (readOnlyRef.current) return;
    if (!pendingAnnotation || creatingPending.current) return;
    if (pendingAnnotation.isSpanless && spanlessNotesRequired && !spanlessReason.trim()) {
      setPendingAnnotation({ ...pendingAnnotation, selectedTerm: { termId, searchId } });
      setSpanlessReasonError(true);
      inspectorRef.current?.querySelector<HTMLTextAreaElement>("#spanless-reason")?.focus();
      return;
    }
    creatingPending.current = true;
    setActionError(null);
    const pending = pendingAnnotation;
    try {
      const type = view.layers?.find(l => l.layer_id === pending.layerId)?.annotation_types.find(t => t.type_id === pending.typeId);
      if (!pending.reanchorItem || !latestDraft.current.annotations?.some(snapshot=>snapshot.annotation.annotation_id===pending.annotationId)) await enqueueMutation({
        command: pending.reanchorItem ? "recreate_reanchor" : "create_annotation",
        ...(pending.reanchorItem ? {item:reanchorRef(pending.reanchorItem)} : {}),
        annotation_id: pending.annotationId,
        evidence_id: pending.evidenceId,
        layer_id: pending.layerId,
        type_id: pending.typeId,
        term_id: termId,
        ...(!pending.reanchorItem ? {search_event_id:searchId} : {}),
        ...(pending.isSpanless && spanlessReason.trim() ? { note: spanlessReason.trim() } : {}),
        segments: pending.segments,
        axes_values: pending.reanchorItem?.axes_values ?? (pending.carriedInput ? { ...pending.carriedInput.source_snapshot.annotation.axes_values }
          : { ...initialAxisValues(type?.axes ?? [], termId), ...view.creation_defaults?.[pending.layerId]?.[pending.typeId] }),
        ...(!pending.reanchorItem ? { chosen_axis_ids: [] } : {}),
      });
      if (pending.reanchorItem) setResolutionItem(pending.reanchorItem);
      // Linked client-side as the input's result; the input stays "Check needed" (no auto-complete).
      if (pending.carriedInput) {
        carried.rememberRecreated(pending.carriedInput.input_id, pending.annotationId);
        setFocusRequest({ key: `annotation:${pending.annotationId}`, find: carriedPrimary });
      }
      setPendingAnnotation(null);
      setSpanlessReason(""); setSpanlessReasonError(false);
      setSelectedTargetId(null);
      setSelectedSourceId(null);
      setSelectedAnnotationId(pending.annotationId);
      setSelectedEvidenceId(pending.evidenceId ?? null);
      searchManager.clear();
      if(pending.reanchorItem) requestAnimationFrame(() => {
        const next = inspectorRef.current?.querySelector<HTMLElement>('.axis-field .btn') ?? inspectorRef.current?.querySelector<HTMLElement>('button, input, textarea, select');
        next?.focus();
      });
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

  const legacySubmissionHint = !view.enforce_spanless_rules
    ? !view.allow_spanless_findings ? "Before submission, add a text span or remove this finding. This older draft still permits intermediate edits."
      : view.require_spanless_note !== false ? "Before submission, add a reason for every finding without a text span. This older draft still permits intermediate edits." : undefined
    : undefined;
  const activeSpanlessType = view.layers?.find(l => l.layer_id === layerSelection.activeLayerId)?.annotation_types.find(t => t.type_id === layerSelection.activeTypeId)
    ?? view.layers?.find(l => l.layer_id === layerSelection.activeLayerId)?.annotation_types[0];
  const spanlessBlockedReason = activeSpanlessType?.evidence_policy === "required_on_complete"
    ? "This annotation type requires a text span."
    : view.enforce_spanless_rules && !view.allow_spanless_findings ? "This project requires a text span for findings." : undefined;

  const handleStartSpanless = () => {
    if (readOnlyRef.current || spanlessBlockedReason) return;
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

  const requestReviewerNote = (target: TargetProposal, draftOutcome = false) => {
    const key = targetKeyOf(target);
    if (draftOutcome) {
      decisionIntentTokens.current[key] = ++nextDecisionIntentToken.current;
      setDecisionIntentKeys(keys => keys.includes(key) ? keys : [...keys, key]);
    }
    setRequiredNoteKey(key); setSelectedTargetId(key);
    setSelectedAnnotationId(null); setSelectedSourceId(null); setSelectedEvidenceId(null);
    cancelPending(); setMobilePane("details");
    if (selectedTargetId === key) inspectorRef.current?.querySelector<HTMLTextAreaElement>('[aria-label="Reviewer note"]')?.focus();
  };

  // Review Decision Handler: always carries the current reviewer note.
  const handleReviewDecision = async (payload: DecisionPayload, forTarget?: TargetProposal | null) => {
    if (readOnlyRef.current) return;
    const target = forTarget ?? selectedTarget;
    if (!target) return;
    setActionError(null);
    const key = targetKeyOf(target);
    const submittedIntentToken = decisionIntentTokens.current[key];
    if (payload.outcome === "uncertain" && !(payload.note !== undefined ? payload.note.trim() : currentNoteFor(key))) {
      requestReviewerNote(target);
      return;
    }
    setRequiredNoteKey(null); setSubmitError(null);
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
      // A previous decision may finish after the reviewer starts another intent.
      // Only the intent that this request actually submitted can be cleared.
      if (decisionIntentTokens.current[key] === submittedIntentToken) setDecisionIntentKeys(keys => keys.filter(value => value !== key));
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
  const handleAdoptAndEditTarget = async (target: TargetProposal, reason?: string, supportingSegments?: SelectionPayload["segments"]) => {
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

    const sourceSnapshot = targetSnapshotOf(target);
    if (!existingCopy && view.enforce_spanless_rules && !sourceSnapshot?.annotation.evidence_refs?.length && !supportingSegments?.length) {
      if (!view.allow_spanless_findings) { setPendingEvidenceAdoption(target); setMobilePane("text"); return; }
      if (spanlessNotesRequired && !(reason ?? sourceSnapshot?.annotation.note ?? "").trim()) { setPendingAdoption(target); return; }
    }

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
    const firstSegments = supportingSegments ?? firstEvidence?.mention.segments ?? [];
    const firstEvidenceId = firstSegments.length > 0 ? newEvidenceId() : undefined;
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
        chosen_axis_ids: [],
        segments: firstSegments,
        ...(reason?.trim() || snap?.annotation.note ? { note: reason?.trim() || snap?.annotation.note } : {}),
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
    if (reason?.trim() || supportingSegments?.length) {
      try { await syncReplacementDecision(newAnnId); } catch (error) { reportError(error); }
    }
    setPendingEvidenceAdoption(null);
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
  // Submission always uses current project rules, including legacy open drafts.
  const submissionIssues = completionResults.flatMap(snapshot => {
    const ann = snapshot.annotation;
    const target = reviewTargets.some(t => t.annotation_id === ann.annotation_id && t.version === snapshot.version);
    const status = view.term_statuses?.[`${ann.layer_id}:${ann.term_id}`] ?? view.term_statuses?.[ann.term_id];
    if (status === "unknown" || status === "obsolete") return [{ snapshot, reason: `This term is ${status}.`,
      remedy: target ? "Reject this proposal or use Edit & Replace to choose a valid term." : "Change the term or delete this finding.",
      focus: target ? '[data-repair="edit-proposal"]' : '[data-repair="change-term"]' }];
    if (ann.evidence_refs?.length) return [];
    const type = view.layers?.find(layer => layer.layer_id === ann.layer_id)?.annotation_types?.find(type => type.type_id === ann.type_id);
    const needsSpan = type?.evidence_policy === "required_on_complete" || view.allow_spanless_findings === false;
    const reason = type?.evidence_policy === "required_on_complete" ? "This annotation type requires a text span."
      : view.allow_spanless_findings === false ? "This project requires a text span for findings."
      : view.require_spanless_note !== false && !(ann.note ?? "").trim() ? "A reason is required for this finding without a text span." : null;
    const remedy = target ? needsSpan ? "Use Edit & Replace to add supporting text, or reject this proposal."
      : "Use Edit & Replace to add an annotation reason. The reviewer note does not supply the annotation reason."
      : needsSpan ? "Use Add Mention to select supporting text, or delete this finding." : "Enter the reason in the annotation note.";
    return reason ? [{ snapshot, reason, remedy, focus: target ? '[data-repair="edit-proposal"]' : needsSpan ? '[data-repair="add-mention"]' : '[data-repair="annotation-note"]' }] : [];
  });
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

  const [repairFocus, setRepairFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!repairFocus || submitDialogOpen) return;
    const control = inspectorRef.current?.querySelector<HTMLElement>(repairFocus);
    if (control) { control.focus(); control.scrollIntoView?.({ block: "nearest" }); setRepairFocus(null); }
  }, [repairFocus, submitDialogOpen, selectedAnnotationId, selectedTargetId]);
  const reviewEvidenceIssue = (snapshot: AnnotationSnapshot, focus: string) => {
    const ann = snapshot.annotation;
    setLayerSelection(previous => ({ ...previous, activeLayerId: ann.layer_id, activeTypeId: ann.type_id,
      visibleLayerIds: [...new Set([...previous.visibleLayerIds, ann.layer_id])] }));
    const target = reviewTargets.find(t => refKey(t) === refKey({ annotation_id: ann.annotation_id, version: snapshot.version }));
    setSelectedTargetId(target ? refKey(target) : null); setSelectedAnnotationId(target ? null : ann.annotation_id);
    setSelectedSourceId(null); setSelectedEvidenceId(null); cancelPending();
    setMobilePane("details"); setSubmitDialogOpen(false);
    setRepairFocus(focus);
  };
  const reviewPendingReanchor = () => {
    const item = pendingReanchorItems.find(item => !currentReanchorResolution(item, draft.reanchor_resolutions ?? [], draft.annotations ?? []));
    if (!item) return;
    setSubmitDialogOpen(false); setMobilePane("list");
    requestAnimationFrame(() => {
      const row = [...(sidebarScrollRef.current?.querySelectorAll<HTMLElement>('[data-reanchor-item]') ?? [])]
        .find(row => row.dataset.reanchorItem === reanchorKey(item));
      const disclosure = row?.closest("details");
      if (disclosure) disclosure.open = true;
      row?.scrollIntoView?.({ block: "nearest" }); row?.querySelector<HTMLButtonElement>('button')?.focus();
    });
  };

  const blockInvalidUnresolvedNotes = (action: "submitting" | "leaving" = "submitting") => {
    const intent = reviewTargets.find(target => decisionIntentKeys.includes(refKey(target)));
    if (intent) {
      requestReviewerNote(intent);
      setSubmitError(`Save the draft review decision before ${action}.`);
      return true;
    }
    if (readOnlyRef.current || view.key.mode !== "review") return false;
    const invalid = (latestDraft.current.decisions ?? []).filter(d => {
      const local = noteDraftsRef.current[refKey(d.target)];
      // Submission revalidates legacy decisions; leaving only protects changed local drafts.
      return d.outcome === "uncertain" && !currentNoteFor(refKey(d.target)) &&
        (action === "submitting" || (local !== undefined && local !== (d.note ?? "")));
    });
    if (invalid.length === 0) return false;
    setSubmitError(`${invalid.length} unresolved proposals require a reviewer note before ${action}.`);
    const target = reviewTargets.find(t => refKey(t) === refKey(invalid[0].target));
    if (target) requestReviewerNote(target);
    setSubmitDialogOpen(false);
    return true;
  };

  invalidReviewNoteGuard.current = () => blockInvalidUnresolvedNotes("leaving");

  // Step 1: save pending edits, validate the saved draft and open the confirmation dialog.
  const handleSubmitWorkspace = async () => {
    if (readOnlyRef.current) return;
    setSubmitError(null);
    if (invalidAnnotationNotes().length > 0) { setActionError(null); setSubmitError("A reason is required for findings without a text span."); return; }
    if (blockInvalidUnresolvedNotes()) return;

    // Validate only after pending saves have finished;
    // the draft from before them would give a stale validation result.
    const rejectedBefore = queueRef.current.rejectedCount();
    setSubmitPending(true);
    try {
      await flushAnnotationNotes();
    } catch (error) { reportError(error); return; } finally { setSubmitPending(false); }
    // A save the server refused shows its own error, but a later edit clears that one;
    // keep the reason why the case was not submitted.
    if (queueRef.current.rejectedCount() !== rejectedBefore) {
      setSubmitError("A change could not be saved; the case was not submitted.");
      return;
    }

    if (blockInvalidUnresolvedNotes()) return;
    setTextCheckedConfirmed(false); setAxisWarning(null); setAxisWarningAcknowledged(false);
    setSubmitDialogOpen(true);
  };

  // Step 2: submit after the explicit "entire text checked" confirmation.
  const confirmSubmit = async () => {
    if (readOnlyRef.current || submittingWorkspace.current || (axisWarning && !axisWarningAcknowledged)) return;
    if (!textCheckedConfirmed || blockInvalidUnresolvedNotes() || submissionIssues.length || unresolvedReanchorCount || pendingCarriedCount) return;
    if (view.key.mode === "review") {
      const missingTargets = reviewTargets.filter((t) => !(latestDraft.current.decisions ?? []).some(d => refKey(d.target) === refKey(t)));
      if (missingTargets.length > 0) {
        setSubmitError(
          `There are still ${missingTargets.length} undecided review proposals. Please make a decision for each proposal before submitting.`
        );
        return;
      }
    }
    submittingWorkspace.current = true;
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
            ...(axisWarning && axisWarningAcknowledged ? { warning_acknowledgement: axisWarning.acknowledgement } : {}),
          },
        };
        try { return await api.submitWorkspace(workspaceId, envelope).catch(assignmentFailure); }
        catch (error) {
          const warning = submissionAxisWarning(error);
          // An advisory response applies no mutation and must not count as a
          // rejected edit, which would incorrectly prevent later navigation.
          if (warning) return { revision: expectedRevision, axisWarning: warning };
          throw error;
        }
      });
      if ("axisWarning" in submission) {
        setAxisWarning(submission.axisWarning); setAxisWarningAcknowledged(false); setSubmitDialogOpen(true); return;
      }
      setSubmitDialogOpen(false);
      setAcceptedSubmission({ identity: versionIdentity, value: structuredClone(submission) });
      readOnlyRef.current = true;
      retryVersions();
      completedNextAssignment.current = adjacentTask.next;
      setCompletedSubmission(submission);
      try {
        await onSubmitted?.();
      } catch {
        // list refresh is best effort
      }
    } catch (err: unknown) {
      setSubmitDialogOpen(false);
      if (err instanceof DiscardedChangesError) return;
      const msg = errorMessage(err);
      setActionError(null);
      const refresh = err instanceof ApiError && ["PROJECT_RULE_VIOLATION", "UNKNOWN_TERM", "OBSOLETE_TERM"].includes(err.code ?? "");
      setReloadSubmissionRules(refresh);
      setSubmitError(`Submission failed: ${msg}${refresh ? " Reload the case to load the current rules and term status, then review the submission checklist." : ""}`);
    } finally { submittingWorkspace.current = false; }
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
    if (!selectedAnnotationId && !selectedTargetId && !selectedSourceId && !selectedInputId) return false;
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
    requestReviewerNote(selectedTarget, true);
  }, { ...reviewShortcutOptions, description: "Mark selected proposal as unresolved (note required)" });
  useShortcut("0", () => { void handleReviewDecision({ outcome: null }); }, { ...reviewShortcutOptions, description: "Reset selected review decision to open" });
  // Single-character bindings ignore Shift, so Shift+N reaches this handler too.
  useShortcut("n", event => goToUnchecked(event.shiftKey ? -1 : 1) ? undefined : false,
    { ...shortcutOptions, enabled: carriedActive && !display, group: "Carried findings", description: "Next unchecked carried finding" });
  useShortcutHint(["Shift + N"], "Previous unchecked carried finding", { group: "Carried findings", enabled: carriedActive && !display });
  const checkableCarried = selectedCarriedState?.unchecked && !carried.busy(selectedCarriedState.input.input_id) ? selectedCarriedState : undefined;
  useShortcut("c", () => {
    if (!checkableCarried || readOnlyRef.current) return false;
    void markCarriedChecked(checkableCarried);
  }, { ...shortcutOptions, enabled: carriedActive && !readOnly && !!selectedCarriedState?.unchecked, group: "Carried findings", description: "Mark carried finding as checked" });
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

  const cancelAttach = () => { setIsAttachingMention(false); setPendingEvidenceAdoption(null); cancelPending(); };

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
      <div className="visually-hidden" aria-live="polite" data-carried-announcer>{carriedAnnouncement}</div>
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
            title={roundKind === "carry_forward" ? roundTitle : undefined}
            className={`badge ${
              view.key.mode === "review"
                ? "badge-review"
                : view.key.mode === "assisted"
                ? "badge-assisted"
                : "badge-independent"
            }`}
          >
            {roundKind === "consolidation" ? "Consolidation review" : roundKind === "carry_forward" ? roundBadge ?? "Review carried findings" : view.key.mode === "review"
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
          {taskActions}
          {held && <InlineMessage tone="warning">Task paused: {holdReason ?? "A project problem needs attention."} Saved work remains readable. Your local input is kept.</InlineMessage>}

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

          <SubmitControl
            onSubmit={() => { void handleSubmitWorkspace(); }}
            disabled={readOnly || submitPending}
            pending={submitPending}
          />
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
          {(queueRef.current.rejectedCount() > 0 || reloadSubmissionRules) && onReload && <Button type="button" variant="secondary" size="sm"
            disabled={isReloading} onClick={() => { void reloadCase(); }}>{reloadSubmissionRules ? "Reload current rules" : "Reload case"}</Button>}
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
            {!readOnly && roundKind === "consolidation" && <MergeInputs inputs={roundInputs} annotations={draft.annotations ?? []} labelFor={termLabel} onMerge={mergeInputs} />}
            <ReanchorPanel key={versionIdentity} items={pendingReanchorItems} labelFor={termLabel} onContext={reanchorContext.reveal}
              onOpenFinding={id => { setSelectedTargetId(null); setSelectedSourceId(null); cancelPending(); setSelectedAnnotationId(id); setMobilePane("details"); }}
              resolutions={draft.reanchor_resolutions} annotations={draft.annotations} busy={queueState === "saving"}
              recreateUnavailableReason={item=>!view.scope.editable_layer_ids.includes(item.layer_id) || !view.layers?.find(layer=>layer.layer_id===item.layer_id)?.annotation_types.some(type=>type.type_id===item.type_id)
                ? "The original finding type is unavailable for re-creation. You can still dismiss this finding with a reason." : undefined}
              onRecreate={readOnly ? undefined : item=>{void beginReanchor(item);}}
              onDismiss={readOnly ? undefined : async(item,reason)=>{
                await resolveReanchor(item,"dismissed",reason);
                if ([activeReanchor,pendingAnnotation?.reanchorItem].some(value=>value && reanchorKey(value)===reanchorKey(item))) cancelPending();
              }} />
            {view.key.mode === "review" && (
              <div className="sidebar-section">
                <div className="sidebar-header">
                  {roundKind === "consolidation" ? "Selected submitted findings" : "Review Proposals"} ({reviewTargets.length})
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
                               : <><IconQuestion />Unresolved</>}
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
                <span>Findings ({visibleAnnotations.length})</span>
                <Button
                  type="button"
                  variant="quiet" size="sm"
                  disabled={readOnly || !!spanlessBlockedReason} onClick={handleStartSpanless}
                  title="Create new annotation via ontology search"
                >
                  Add finding without a text span
                </Button>
              </div>
              {spanlessBlockedReason && <p className="field-hint">{spanlessBlockedReason}</p>}
              {legacySubmissionHint && <p className="field-hint">{legacySubmissionHint}</p>}
              {carriedActive && <CarriedProgress text={carried.progress} showNext={carried.openKeys.size > 0} onNext={() => { goToUnchecked(1); }} />}
              <ul className="doc-list">
                {carried.placeholders.map(state => {
                  const source = state.input.target_snapshot ?? state.input.source_snapshot;
                  const recreated = recreatedFinding(state);
                  const linked = state.home === "linked" ? draft.annotations?.find(snapshot => snapshot.annotation.annotation_id === state.homeId) : recreated;
                  const key = `input:${state.input.input_id}`;
                  return <PlaceholderRow key={key} state={state}
                    termLabel={<TermName termId={source.annotation.term_id} label={termLabel(source.annotation.layer_id, source.annotation.term_id)} />}
                    termText={carriedTermText(source)} instruction={recreated ? null : carriedInstruction(state)}
                    selected={selectedInputId === state.input.input_id}
                    linkedTo={linked ? carriedTermText(linked) : undefined}
                    onActivate={() => { if (selectedInputId === state.input.input_id) handleDeselectAll(); else selectListKey(key); }} />;
                })}
                {visibleAnnotations.map((annSnap) => {
                  const isSelected =
                    annSnap.annotation.annotation_id === selectedAnnotationId;
                  const axesValues = annSnap.annotation.axes_values ?? (annSnap.annotation as any).axes?.values ?? {};
                  const findingLayer = view.layers?.find((l) => l.layer_id === annSnap.annotation.layer_id);
                  const axes = findingAxes(axesValues, findingLayer?.annotation_types.find(type => type.type_id === annSnap.annotation.type_id)?.axes ?? view.axes_config);
                  const layerName = findingLayer?.label;

                  return (
                    <FindingRow
                      key={annSnap.annotation.annotation_id}
                      snapshot={annSnap}
                      selected={isSelected}
                      termLabel={termLabel}
                      layerName={layerName}
                      showLayer={(view.layers ?? []).length > 1}
                      axes={axes}
                      defaulted={defaultedKeys.has(refKey({ annotation_id: annSnap.annotation.annotation_id, version: annSnap.version }))}
                      proposal={proposalFor(annSnap, view.available_inputs ?? [])}
                      onActivate={() => {
                        if (selectedAnnotationId === annSnap.annotation.annotation_id) {
                          handleDeselectAll();
                          return;
                        }
                        selectListKey(`annotation:${annSnap.annotation.annotation_id}`);
                      }}
                    >
                      {carriedExtras(annSnap.annotation.annotation_id)}
                    </FindingRow>
                  );
                })}
              </ul>
            </div>
          </div>

          <section className="detail-section submission-history" aria-label="Submission history">
            <h3>Submission history</h3>
            {submissions.length === 0 && <p>No previous submissions yet.</p>}
            {submissions.map((submission, index) => <Button type="button" variant="secondary" size="sm"
              key={submission.submission_id} onClick={() => setHistorySubmission(submission)}>
              {submissionHistoryLabel(submission.created_at, index + 1)}
            </Button>)}
          </section>

        </aside>

        {/* Center: Text View */}
        <TextPane
          header={versionControls}
          onTextElement={setLeftTextElement}
          contextSegments={reanchorContext.contextSegments}
          text={view.document.text}
          mentions={textMentions}
          isAttachingMention={isAttachingMention || !!activeReanchor || !!activeCarried || (!!pendingEvidenceAdoption && !confirmRequest)}
          attachMessage={activeCarried ? `Select supporting text to re-create ${carriedTermText(activeCarried.source_snapshot)}.` : activeReanchor ? `Select supporting text to re-create ${activeReanchor.term_id}. Save the finding, review its values, then complete the text-change review.` : pendingEvidenceAdoption ? "Select supporting text to create an editable copy of this proposal. The current decision is kept until you confirm the replacement." : undefined}
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
          {!readOnly && !pendingAnnotation && selectedReanchorItem && selectedAnnotation && <InlineMessage tone="warning">
            <p>This finding is saved. Its current version still needs text-change review. Check the evidence and clinical values, then complete this review. Later changes require completion again.</p>
            <Button disabled={queueState === "saving"} onClick={()=>{void (async()=>{
              await flushAnnotationNotes();
              if(unsavedAnnotationNotes().length) return;
              await resolveReanchor(selectedReanchorItem,"recreated",selectedAnnotation.annotation.annotation_id);
            })().catch(reportError);}}>Complete text-change review</Button>
          </InlineMessage>}
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
                  {pendingAnnotation.carriedInput ? "Re-create carried finding" : pendingAnnotation.reanchorItem ? "Re-create finding on corrected text" : pendingAnnotation.isSpanless
                    ? "Select term for new annotation"
                    : "Select term for highlighted text"}
                </h2>
                <p>
                  {pendingAnnotation.carriedInput ? "Save this finding with the original term and values. Then check it and mark it as checked." : pendingAnnotation.reanchorItem ? "Save this finding, check its evidence and values, then complete the text-change review." : pendingAnnotation.isSpanless
                    ? "Select a term from the ontology for the new annotation."
                    : "The annotation will be saved upon selecting a term."}
                </p>
                {pendingAnnotation.reanchorItem && <>
                  <p><TermName termId={savedPendingReanchor?.annotation.term_id ?? pendingAnnotation.reanchorItem.term_id} label={termLabel(pendingAnnotation.layerId,savedPendingReanchor?.annotation.term_id ?? pendingAnnotation.reanchorItem.term_id)} /> · {pendingAnnotation.layerId}</p>
                  <p>Finding type: {view.layers?.find(layer=>layer.layer_id===pendingAnnotation.layerId)?.annotation_types.find(type=>type.type_id===pendingAnnotation.typeId)?.label ?? pendingAnnotation.typeId}</p>
                  {!savedPendingReanchor && pendingAnnotation.reanchorItem.axes_values && <p>Original clinical context: {Object.entries(pendingAnnotation.reanchorItem.axes_values).map(([axis, value]) => `${axis}: ${value ?? "Not specified"}${pendingAnnotation.reanchorItem!.axes_defaulted?.includes(axis) ? " (defaulted)" : ""}`).join(" · ")}. These values will be carried over; you can edit them after saving.</p>}
                  {savedPendingReanchor && <p>The replacement is saved. Link its saved version to finish reviewing this item.</p>}
                  <Button variant="secondary" disabled={readOnly || queueState === "saving"} onClick={()=>{void createPendingAnnotation(pendingAnnotation.reanchorItem!.term_id);}}>Save re-created finding</Button>
                  {!savedPendingReanchor && <p>Or select a different term below.</p>}
                </>}
                {pendingAnnotation.carriedInput && <>
                  <p><TermName termId={pendingAnnotation.carriedInput.source_snapshot.annotation.term_id} label={termLabel(pendingAnnotation.layerId, pendingAnnotation.carriedInput.source_snapshot.annotation.term_id)} /></p>
                  <Button variant="primary" disabled={readOnly || queueState === "saving"} onClick={() => { void createPendingAnnotation(pendingAnnotation.carriedInput!.source_snapshot.annotation.term_id); }}>Save re-created finding</Button>
                </>}
                {pendingAnnotation.isSpanless && <Textarea id="spanless-reason" label="Reason for no text span"
                  readOnly={readOnly} required={spanlessNotesRequired} hint={legacySubmissionHint ?? (!spanlessNotesRequired ? "Optional context for this finding." : undefined)} value={spanlessReason}
                  error={spanlessReasonError && !spanlessReason.trim() ? "A reason is required before adding this annotation." : undefined}
                  onChange={event => { setSpanlessReason(event.target.value); setSpanlessReasonError(false); }} />}
                {pendingAnnotation.selectedTerm && <div className="pending-term-continuation">
                  <p>Selected term: <TermName termId={pendingAnnotation.selectedTerm.termId} label={termLabel(pendingAnnotation.layerId, pendingAnnotation.selectedTerm.termId)} /></p>
                  <Button disabled={readOnly || queueState === "saving" || (spanlessNotesRequired && !spanlessReason.trim())}
                    onClick={() => { void createPendingAnnotation(pendingAnnotation.selectedTerm!.termId, pendingAnnotation.selectedTerm!.searchId); }}>Add annotation</Button>
                </div>}
                {!readOnly && !savedPendingReanchor && !pendingAnnotation.carriedInput && <SearchPanel key={pendingAnnotation.annotationId} searchManager={searchManager}
                  annotationId={pendingAnnotation.annotationId} workspaceKey={view.key} layerId={pendingAnnotation.layerId}
                  languages={searchLanguagesFor(pendingAnnotation.layerId)}
                  onSelectCandidate={(candidate, searchId) => {
                    if (pendingAnnotation.selectedTerm) setPendingAnnotation({ ...pendingAnnotation, selectedTerm: { termId: candidate.term_id, searchId } });
                    else void createPendingAnnotation(candidate.term_id, searchId);
                  }} />}
                <Button type="button" variant="secondary" disabled={queueState === "saving"} onClick={cancelPending}>Cancel</Button>
              </div>
            </section>
          ) : selectedInputState ? (() => {
            const state = selectedInputState, source = state.input.source_snapshot;
            const sourceNote = source.annotation.note?.trim();
            return <div className="detail-pane">
              <ExceptionPanel key={state.input.input_id} state={state}
                origin={carriedFromLine(state.input.source_round_ordinal ?? null)} recordedAt={state.input.source_recorded_at}
                reason={missingReason(state.missing ?? "mapping_failed", state.input.review_reason)}
                original={{
                  term: <TermName termId={source.annotation.term_id} label={termLabel(source.annotation.layer_id, source.annotation.term_id)} />,
                  values: carriedAxes(source).map(axis => ({ label: axis.label, value: axisOptionLabel(axis.value) })),
                  note: sourceNote || undefined,
                  quote: carriedSourceQuote(state),
                }}
                candidates={carriedLinkCandidates(state)}
                readOnly={carriedReadOnly}
                onMarkInText={() => markCarriedInText(state)}
                onLink={annotationId => linkCarried(state, annotationId)}
                onDismiss={reason => dismissCarried(state, reason)}
                onUndoDismissal={() => undoCarriedDismissal(state)}
                onShowOriginal={() => showCarriedOriginal(state)}
                error={carried.errorFor(state.input.input_id)}
                onRetry={() => carried.retry(state.input.input_id)} />
            </div>;
          })() : view.key.mode === "review" && selectedTarget ? (
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
              requireNote={requiredNoteKey === refKey(selectedTarget)}
              draftUnresolved={decisionIntentKeys.includes(refKey(selectedTarget))}
              onDraftUnresolved={() => requestReviewerNote(selectedTarget, true)}
              busy={queueState === "saving"}
              requireChosenAxes={view.require_chosen_axes}
              axesConfig={view.layers?.find(layer => layer.layer_id === selectedTarget.layer_id)?.annotation_types.find(type => type.type_id === selectedTarget.type_id)?.axes ?? view.axes_config}
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
          ) : (<>
            {carriedSection}
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
              noteValue={selectedAnnotation ? annotationNoteDrafts[selectedAnnotation.annotation.annotation_id] ?? selectedAnnotation.annotation.note ?? "" : ""}
              noteRequired={spanlessNotesRequired && !!selectedAnnotation && !selectedAnnotation.annotation.evidence_refs?.length}
              noteHint={!selectedAnnotation?.annotation.evidence_refs?.length ? legacySubmissionHint : undefined}
              onChangeNote={note => { if (selectedAnnotationId) { annotationNoteDraftsRef.current = { ...annotationNoteDraftsRef.current, [selectedAnnotationId]: note }; setAnnotationNoteDrafts(annotationNoteDraftsRef.current); } }}
              onSaveNote={() => { if (selectedAnnotationId) void saveAnnotationNote(selectedAnnotationId).catch(reportError); }}
              detachLastBlockedReason={selectedAnnotation && view.enforce_spanless_rules ? (!view.allow_spanless_findings ? "This project requires a text span for findings." :
                view.layers?.find(l => l.layer_id === selectedAnnotation.annotation.layer_id)?.annotation_types.find(t => t.type_id === selectedAnnotation.annotation.type_id)?.evidence_policy === "required_on_complete" ? "This annotation type requires a text span." :
                spanlessNotesRequired && !(selectedAnnotation.annotation.note ?? "").trim() ? "Enter a reason in the annotation note before removing the last mention." : undefined) : undefined}
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
              onDeleteAnnotation={(id) => { void deleteAnnotation(id).catch(reportError); }}
              deleteConfirmMessage={carriedDeleteMessage}
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
          </>)}
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
      {originalRoundInput && <RoundInputEvidenceDialog projectKey={view.key.project_key} input={originalRoundInput} onClose={() => setOriginalRoundInput(null)} labelFor={termLabel} />}
      {historySubmission && <HistoricalSubmissionDialog submission={historySubmission}
        heading={submissionHistoryLabel(historySubmission.created_at, submissions.findIndex(s => s.submission_id === historySubmission.submission_id) + 1)}
        documentText={view.document.text} termLabel={termLabel} onClose={() => setHistorySubmission(null)} />}

      {completedSubmission && <Dialog open title="Case submitted" heading="✓ Case successfully submitted!">
        <p>Submission ID: <code>{completedSubmission.submission_id}</code></p>
        <p>Timestamp: {completedSubmission.created_at}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <Button type="button" onClick={() => { setHistorySubmission(completedSubmission); setCompletedSubmission(null); }}>View submitted result</Button>
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

      <SubmitCaseDialog
        open={submitDialogOpen}
        documentId={view.document.document_id}
        reviewMode={view.key.mode === "review"}
        completionResults={completionResults}
        confirmedCount={confirmedCount}
        unresolvedDecisionCount={(draft.decisions ?? []).filter(d => d.outcome === "uncertain").length}
        savedFindingsCount={(draft.annotations ?? []).length}
        reviewTargetCount={reviewTargets.length}
        openReviewTargetCount={openReviewTargets.length}
        pendingReanchorCount={pendingReanchorItems.length}
        unresolvedReanchorCount={unresolvedReanchorCount}
        pendingCarriedCount={pendingCarriedCount}
        defaultedCount={defaulted.length}
        submissionIssues={submissionIssues}
        axisWarning={axisWarning}
        axisWarningAcknowledged={axisWarningAcknowledged}
        textChecked={textCheckedConfirmed}
        saving={queueState === "saving"}
        readOnly={readOnly}
        layers={view.layers}
        termLabel={termLabel}
        setTextChecked={setTextCheckedConfirmed}
        setAxisWarningAcknowledged={setAxisWarningAcknowledged}
        onReviewEvidenceIssue={reviewEvidenceIssue}
        onReviewPendingReanchor={reviewPendingReanchor}
        onReviewCarried={() => {
          setSubmitDialogOpen(false);
          const key = nextUncheckedKey(carriedListOrder, carried.openKeys, null, 1);
          if (!key) return;
          selectListKey(key);
          requestAnimationFrame(() => {
            Array.from(sidebarScrollRef.current?.querySelectorAll<HTMLElement>("[data-list-key]") ?? [])
              .find(element => element.dataset.listKey === key)?.focus();
          });
        }}
        onReviewDefaulted={reviewDefaulted}
        onConfirm={() => { void confirmSubmit(); }}
        onCancel={() => setSubmitDialogOpen(false)}
      />

      {pendingAdoption && <Dialog open title="Reason for no text span" onClose={() => setPendingAdoption(null)}>
        <p>The editable copy needs a reason because this proposal has no text span.</p>
        <Textarea id="adoption-spanless-reason" label="Reason for no text span" required
          value={adoptionReasons[refKey(pendingAdoption)] ?? ""}
          onChange={event => setAdoptionReasons(prev => ({ ...prev, [refKey(pendingAdoption)]: event.target.value }))} />
        <Button variant="primary" disabled={!(adoptionReasons[refKey(pendingAdoption)] ?? "").trim()} onClick={() => {
          const target = pendingAdoption; const reason = adoptionReasons[refKey(target)]; setPendingAdoption(null);
          void handleAdoptAndEditTarget(target, reason).catch(reportError);
        }}>Create editable copy</Button>
        <Button onClick={() => setPendingAdoption(null)}>Cancel</Button>
      </Dialog>}

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
