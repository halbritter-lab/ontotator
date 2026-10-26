import { ReanchorPanel, currentReanchorResolution, reanchorKey, reanchorRef, useReanchorContext } from "../variants/ReanchorPanel";
import { useCarriedReview } from "../editor/carried/useCarriedReview";
import { carriedChosenAxisIds, carriedListOrder as orderCarriedFirst, deriveCarriedStates, nextUncheckedKey, rowKeyOf, type CarriedState, type SnapshotLike } from "../editor/carried/checkState";
import { carriedOriginLine, TEXT_CHANGE_ORIGIN, instructionLine, missingReason, roundName, textSpanLine, valuesLines, whatToCheckContext, type WhatToCheckContext } from "../editor/carried/instructions";
import { CarriedSection, type CarriedReadOnly } from "../editor/carried/CarriedSection";
import { ExceptionPanel } from "../editor/carried/ExceptionPanel";
import { CarriedRowExtras } from "../editor/carried/CarriedRowExtras";
import { PlaceholderRow } from "../editor/carried/PlaceholderRow";
import { CarriedProgress } from "../editor/carried/CarriedProgress";
import { SidebarResizer } from "../editor/SidebarResizer";
import { useSidebarWidth } from "../editor/sidebarWidth";
import { RoundInputEvidenceDialog } from "../tasks/RoundInputEvidenceDialog";
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
import { routeHref, type Route } from "./router";
import { InlineMessage } from "../ui/InlineMessage";
import { Textarea } from "../ui/Textarea";
import { Button } from "../ui/Button";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
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
import { collectOpenItems, nextOpenItem, type OpenItem } from "../editor/openItems";
import { isModifierWarningKey, modifierWarningPairs, modifierWarnings, pairKey, rowPairs, sameSet, unconfirmedRows, type UnconfirmedRow } from "../editor/unconfirmedValues";
import { HistoricalSubmissionDialog } from "../editor/HistoricalSubmissionDialog";
import { fromSubmission } from "../editor/historicalSubmission";
import { MySubmissions } from "../editor/MySubmissions";
import { formatTime } from "./submissionLabels";
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
import { prefillHint, prefillQuery } from "../editor/termSearch";
import { focusTextAt } from "../editor/textFocus";
import { useMediaQuery } from "../ui/useMediaQuery";
import { SearchManager } from "../editor/searchState";
import { TermName } from "../editor/TermName";
import { TextPane } from "../editor/TextPane";
import { PendingMarkBar } from "../editor/PendingMarkBar";
import { Kbd } from "../ui/Kbd";
import { TreeBrowser } from "../editor/TreeBrowser";
import { useTermLabels } from "../editor/useTermLabels";
import { ModifiersSection } from "../editor/ModifiersSection";
import { AttachModePanel, attachCopy } from "../editor/AttachModePanel";
import { ModifierAsFindingNotice } from "../editor/ModifierAsFindingNotice";
import { useModifierCommands } from "../editor/useModifierCommands";
import { attachCandidates, findingDescription, modifierDisplayId, modifierMarks, parseModifierDisplayId, quoteOf, type AttachFinding, type Seg } from "../editor/modifiers";
import { Toast } from "../ui/Toast";
import { type MentionDisplay, type SelectionPayload } from "../spans/adapter";
import { markColourSlot } from "../editor/markColours";
import { IconCheck, IconClose, IconKeyboard, IconPencil, IconQuestion, IconRetry } from "../ui/icons";
import { isNegated } from "../editor/negation";
import { Dialog } from "../ui/Dialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { IconButton } from "../ui/IconButton";
import { openShortcutHelp, ShortcutHelpHost } from "../ui/ShortcutHelp";
import { isTextEntryTarget, isTypingTarget, useShortcut, useShortcutHint } from "../ui/shortcuts";
import { CaseNavigation } from "./CaseNavigation";
import { adjacentCase, orderTasks } from "./caseOrder";
import type { RouteLeaveGuard } from "./router";
import { isReviewLike, modeBadge } from "../editor/modes";
import { LanguageTag } from "../ui/LanguageTag";
import { onSpaceActivate } from "../ui/spaceActivates";

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
/** Status after the acknowledged pairs changed: only modifier warning pairs → "The warnings changed." (`pairKey("", "")` is the separator.) */
function changedStatus(changed: readonly string[]): string {
  return changed.length && changed.every(pair => isModifierWarningKey(pair.slice(pair.indexOf(pairKey("", "")) + 1)))
    ? "The warnings changed. Check the list again." : "The unconfirmed values changed. Check the list again.";
}
function submissionAxisWarning(error: unknown): AxisWarning | null {
  if (!(error instanceof ApiError) || error.code !== "AXIS_CONFIRMATION_WARNING" || typeof error.details !== "object" || !error.details) return null;
  const acknowledgement = error.details.acknowledgement as AxisWarning["acknowledgement"] | undefined;
  if (!acknowledgement || !Number.isSafeInteger(acknowledgement.draft_revision) || acknowledgement.draft_revision < 0
    || !Number.isSafeInteger(acknowledgement.policy_revision) || acknowledgement.policy_revision < 0
    || typeof acknowledgement.warning_digest !== "string" || !acknowledgement.warning_digest) return null;
  const warnings = Array.isArray(error.details.warnings) ? error.details.warnings.flatMap((warning: unknown) => {
    if (!warning || typeof warning !== "object") return [];
    const item = warning as { annotation_id?: unknown; rule?: unknown; detail?: { axis?: unknown; term_id?: unknown; class?: unknown } };
    // Modifier warnings keep their own key next to the axis ids: "cohort:<term id>", "exclusive:<class>".
    const axis = item.rule === "cohort_modifier" ? typeof item.detail?.term_id === "string" ? `cohort:${item.detail.term_id}` : null
      : item.rule === "exclusive_modifier_class" ? typeof item.detail?.class === "string" ? `exclusive:${item.detail.class}` : null
      : typeof item.detail?.axis === "string" ? item.detail.axis : null;
    return typeof item.annotation_id === "string" && axis ? [{ annotationId: item.annotation_id, axis }] : [];
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
  /** The guidelines update notice (tasks/TaskGuidelines), shown below the toolbar. */
  guidelineNotice?: React.ReactNode;
  held?: boolean;
  holdReason?: string | null;
  saveBeforeReportRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  roundInputs?: readonly import("../api/client").RoundInputView[];
  roundKind?: import("../api/client").WorkRoundView["kind"];
  /** Whether the task's round is still active; an inactive consolidation round offers no "Back to consolidation". */
  roundActive?: boolean;
  /** Toolbar badge of a carry-forward round, e.g. "Round 3, continued from Round 2". */
  roundBadge?: string;
  /** Full round identity, shown as the badge's title. */
  roundTitle?: string;
  /** Version of the open text (`WorkRoundView.document_version`), for the carried "What to check" lines. */
  documentVersion?: number | null;
  /** `WorkRoundView.round_ordinal` of the open round; My submissions names it while it has no submission. */
  roundOrdinal?: number | null;
}

const NO_ROUND_INPUTS: readonly import("../api/client").RoundInputView[] = [];
/** Names of the pending mark's edge handles (spec F1). */
const PENDING_HANDLE_LABELS = { start: "Start of marked text", end: "End of marked text" };
/** Round kinds whose inputs are carried findings to check (a text change and a lead's handover included). */
const isCarryKind = (kind: CaseScreenProps["roundKind"]): boolean => kind === "carry_forward" || kind === "text_change" || kind === "handover";

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
  readOnly: serverReadOnly = false, routeLeaveRef, assignmentNavigation, onReadonlyRequired, versionContext, taskActions, guidelineNotice, held = false, holdReason, saveBeforeReportRef, roundInputs = NO_ROUND_INPUTS, roundKind, roundActive = true, roundBadge, roundTitle, documentVersion, roundOrdinal,
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
  // Segments of the pending mark moved by its handles, readable before the state update lands.
  const pendingSegments = useRef<{ evidenceId: string; segments: SelectionPayload["segments"] } | null>(null);
  const pendingRef = useRef(pendingAnnotation);
  pendingRef.current = pendingAnnotation;
  // Reports a keyboard move of a handle that still waits for its pause (set by TextPane).
  const flushTextResize = useRef<(() => void) | null>(null);
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
  // Attach mode of a modifier hit chosen for the pending mark (E-a), or "Turn into modifier…" of a standalone
  // modifier finding `sourceId` (convert, E-c; `mark` = the source's first mention segments, there is no pending mark).
  const [attachModifier, setAttachModifier] = useState<{ termId: string; termLabel: string; mode: "attach" }
    | { termId: string; termLabel: string; mode: "convert"; sourceId: string; mark: Seg[] } | null>(null);
  const convertSourceId = attachModifier?.mode === "convert" ? attachModifier.sourceId : null;
  /** The focused target row of the attach mode. */
  const [attachFocusId, setAttachFocusId] = useState<string | null>(null);
  /** A target chosen by click or Enter that already has the term with another span: the inspector offers "Replace text span". */
  const [attachReplaceId, setAttachReplaceId] = useState<string | null>(null);
  /** The finding under the pointer or with focus (row or mark): its marks and modifier segments are framed. */
  const [hoverFrameId, setHoverFrameId] = useState<string | null>(null);
  const [textResyncToken, setTextResyncToken] = useState(0);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const creatingPending = useRef(false);
  const [draft, setDraft] = useState<Draft>(view.draft);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const pendingReanchorItems = isReviewLike(view.key.mode) ? view.pending_reanchor_items ?? [] : [];
  const unresolvedReanchorCount = pendingReanchorItems.filter(item =>
    !currentReanchorResolution(item, draft.reanchor_resolutions ?? [], draft.annotations ?? [])).length;
  const carriedInputs = isCarryKind(roundKind) || (view.key.mode === "independent" && roundInputs.length) ? roundInputs : NO_ROUND_INPUTS;
  const [originalRoundInput, setOriginalRoundInput] = useState<import("../api/client").RoundInputView | null>(null);

  const [layerSelection, setLayerSelection] = useState<LayerSelection>(() =>
    initLayerSelection(view.layers ?? [], view.scope)
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const selectedAnnotationIdRef = useRef(selectedAnnotationId);
  selectedAnnotationIdRef.current = selectedAnnotationId;
  // Flush of the Values block's coalesced axis change still waiting (set by AnnotationPanel).
  const pendingAxesFlush = useRef<(() => void) | null>(null);
  /** Queues a waiting axis change, so guards that look at the save queue see it. */
  const flushPendingAxes = () => { pendingAxesFlush.current?.(); };
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const lastTargetIdRef = useRef<string | null>(null);
  if (selectedTargetId) lastTargetIdRef.current = selectedTargetId;
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
  /** The (finding, axis) pairs listed when "Submit with {n} unconfirmed values" was ticked. */
  const [ackSeen, setAckSeen] = useState<ReadonlySet<string> | null>(null);
  /** Polite status of the submit dialog, e.g. after the server listed other values. */
  const [submitStatus, setSubmitStatusState] = useState<{ text: string; count: number } | null>(null);
  /** A new `count` per announcement, so the same text after a resend is read again. */
  const setSubmitStatus = (text: string | null) =>
    setSubmitStatusState(previous => text === null ? null : { text, count: (previous?.count ?? 0) + 1 });
  const submittingWorkspace = useRef(false);
  // A warning's acknowledgement is bound to the draft revision; the ticked checkbox stays while the
  // list only shrinks (new pairs untick it, see the effect on `pairsKey`).
  useEffect(() => { setAxisWarning(null); }, [draft.revision, view.annotation_policy_revision]);
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
  const sidebarWidth = useSidebarWidth(versionContext?.username);
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
  ].flatMap((snapshot) => [snapshot.annotation.term_id, ...((snapshot.annotation as { modifiers?: { term_id: string }[] }).modifiers ?? []).map(m => m.term_id)]
    .map(term_id => ({ layer_id: snapshot.annotation.layer_id, term_id }))).concat(pendingReanchorItems.map(item=>({layer_id:item.layer_id,term_id:item.term_id}))), [draft.annotations, display?.value, view.available_inputs, submissions, view.pending_reanchor_items, roundInputs]);
  const termLabel = useTermLabels(view.key.project_key, displayedTerms);

  const searchManager = useMemo(() => new SearchManager(api), []);
  // "+ Add modifier…" searches on its own, so an open "Change term" search keeps its hits.
  const modifierSearchManager = useMemo(() => new SearchManager(api), []);
  const modifierLayerIds = new Set(view.modifier_layer_ids ?? []);
  const infoFor = (layerId: string) => (termId: string) => termLabel.info(layerId, termId);
  useEffect(() => {
    if (!readOnly || held) return;
    setPendingAnnotation(null);
    setActiveReanchor(null);
    setActiveCarried(null);
    setIsAttachingMention(false);
    setAttachModifier(null);
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
  // At ≤700 px the editor shows one pane at a time; marking text does not switch panes on its own.
  const panesLayout = useMediaQuery("(max-width: 700px)");
  // Back to the text after a cancelled new finding: runs after the text pane re-rendered its runs,
  // so the caret lands in the current text nodes (offset null: focus only).
  const [textFocusRequest, setTextFocusRequest] = useState<{ offset: number | null } | null>(null);
  useEffect(() => {
    if (!textFocusRequest) return;
    setTextFocusRequest(null);
    if (textFocusRequest.offset === null) rootRef.current?.querySelector<HTMLElement>(".text-container")?.focus({ preventScroll: true });
    else focusTextAt(rootRef.current, view.document.text, textFocusRequest.offset);
  }, [textFocusRequest, view.document.text]);
  // A finding without a text span whose reason is required starts in the reason field.
  useEffect(() => {
    if (!pendingAnnotation?.isSpanless || !spanlessNotesRequired || panesLayout) return;
    rootRef.current?.querySelector<HTMLTextAreaElement>("#spanless-reason")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAnnotation?.annotationId]);
  // Narrow screens: the header and toolbar scroll away above the viewport-high workspace. Choosing
  // a pane or opening the tree brings the workspace to the top, so the whole pane is in view.
  // Above 700 px the wrapper has no box (display: contents) and nothing scrolls.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const revealWorkspace = () => {
    const workspace = workspaceRef.current;
    if (workspace && getComputedStyle(workspace).display !== "contents") workspace.scrollIntoView?.({ block: "start" });
  };
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

  const visibleAnnotationById = useMemo(
    () => new Map(visibleAnnotations.map(snapshot => [snapshot.annotation.annotation_id, snapshot])), [visibleAnnotations]);

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

  // Consolidation mode (U8): the consolidator sees the author of every submitted finding by name.
  const consolidationRoundId = roundKind === "consolidation" ? view.key.round_id ?? null : null;
  const [entryAuthors, setEntryAuthors] = useState<{ roundId: string; labels: ReadonlyMap<string, string> } | null>(null);
  useEffect(() => {
    if (!consolidationRoundId) return;
    let live = true;
    api.getConsolidation(consolidationRoundId).then(value => {
      if (!live) return;
      const people = new Map(value.people.map(person => [person.person_id, person.label]));
      const labels = new Map<string, string>();
      for (const group of value.groups) for (const member of group.members) {
        const label = people.get(member.person_id);
        if (label) labels.set(member.annotation_id, label);
      }
      setEntryAuthors({ roundId: consolidationRoundId, labels });
    }, () => undefined); // Without the read the entries stay usable, only without names.
    return () => { live = false; };
  }, [consolidationRoundId]);
  const entryAuthorOf = (annotationId: string): string | undefined =>
    entryAuthors && entryAuthors.roundId === consolidationRoundId ? entryAuthors.labels.get(annotationId) : undefined;
  // Only an active round opens the consolidation view; otherwise the task route opens this editor again.
  const consolidationAssignmentId = roundKind === "consolidation" && roundActive ? assignmentNavigation?.current.assignment_id ?? versionContext?.assignmentId : undefined;

  // Review mode targets
  const reviewTargets: TargetProposal[] = useMemo(() => {
    if (!isReviewLike(view.key.mode) || !view.targets) return [];
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
    if (!isReviewLike(view.key.mode)) return [];
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
  // The selection as of the last render, for async actions that must not move a selection the user changed.
  const selectedListKeyRef = useRef(selectedListKey);
  selectedListKeyRef.current = selectedListKey;
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
      flushPendingAxes();
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
    flushPendingAxes();
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

  const hasInvalidReviewNote = !readOnly && isReviewLike(view.key.mode) && (draft.decisions ?? []).some(d => {
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
    if (!isReviewLike(view.key.mode)) return;
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
  const modifierCommands = useModifierCommands({
    mutate: (annotationId, payload) => mutateAnnotationAndSyncDecision(annotationId, () => enqueueMutation({ ...payload })),
    segmentsOf: (annotationId, termId) => latestDraft.current.annotations?.find(a => a.annotation.annotation_id === annotationId)
      ?.annotation.modifiers?.find(m => m.term_id === termId)?.segments,
    announce: message => announceCarried(message),
    reportError: error => reportError(error),
  });
  // A read-only case has no link-a-span mode (the mode may have started before the case became read-only).
  const linkSpan = readOnly ? null : modifierCommands.linkSpan;
  /** The chip of a modifier (its actions button when it has one). */
  const chipIn = (root: ParentNode, termId: string) =>
    root.querySelector<HTMLElement>(`[data-modifier-chip="${termId}"] button`) ?? root.querySelector<HTMLElement>(`[data-modifier-chip="${termId}"]`);
  const findingNameOf = (snapshot: { annotation: { layer_id: string; term_id: string } }) =>
    termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id;
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
  /**
   * Row order of the findings list (spec section 1): carried findings and placeholder rows first, in
   * round-input order, then every other finding in draft order, including findings on hidden layers
   * (going there makes their layer visible). The rendered list uses the same order.
   */
  const carriedListOrder = useMemo(() => orderCarriedFirst(carried.states,
    (draft.annotations ?? []).map(snapshot => snapshot.annotation.annotation_id)), [carried.states, draft.annotations]);
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
    return <CarriedRowExtras state={shown} sourceOrdinal={(own ?? shown).input.source_round_ordinal ?? null} origin={carriedOriginLine((own ?? shown).input)}
      instruction={carriedInstruction(shown, shown.home === "placeholder" ? "linked" : undefined)} linked={linked} />;
  };

  /** Makes a finding's layer visible and active, so the row it goes to is shown. */
  const revealLayerOf = (ann: { layer_id: string; type_id: string }) =>
    setLayerSelection(previous => ({ ...previous, activeLayerId: ann.layer_id, activeTypeId: ann.type_id,
      visibleLayerIds: [...new Set([...previous.visibleLayerIds, ann.layer_id])] }));
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
    if (key.startsWith("annotation:")) {
      const snapshot = draft.annotations?.find(s => s.annotation.annotation_id === key.slice("annotation:".length));
      if (snapshot) revealLayerOf(snapshot.annotation);
    }
    selectListKey(key);
    return true;
  };

  // Focus a control of the inspector once it shows `key` (after a check action re-rendered it).
  const [focusRequest, setFocusRequest] = useState<{ key: string; find: (root: HTMLElement) => HTMLElement | null } | null>(null);
  useEffect(() => {
    if (!focusRequest || !inspectorRef.current) return;
    if (inspectorKey !== focusRequest.key) { if (inspectorKey !== null) setFocusRequest(null); return; }
    // One matching render: focus the target if it exists; a request for a missing target is dropped.
    focusRequest.find(inspectorRef.current)?.focus();
    setFocusRequest(null);
  });
  const carriedPrimary = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-carried-primary]");
  /** Check state of an input in the latest draft (after a write resolved, before the re-render). */
  const carriedStateNow = (inputId: string) =>
    deriveCarriedStates(carriedInputs, latestDraft.current.round_input_resolutions ?? [], latestDraft.current.annotations ?? [])
      .find(state => state.input.input_id === inputId);
  const carriedReadOnly: CarriedReadOnly = !readOnly ? false : display !== null ? "older" : held ? "paused" : "submitted";
  const showCarriedOriginal = (state: CarriedState) =>
    setOriginalRoundInput(carriedInputs.find(input => input.input_id === state.input.input_id) ?? null);

  /** Carried writes resolve true only when applied; an unexpected error is reported and reads as not applied. */
  const notApplied = (error: unknown) => { reportError(error); return false; };
  const markCarriedChecked = (state: CarriedState) => carried.markChecked(state).catch(notApplied);
  const linkCarried = (state: CarriedState, annotationId: string) => carried.link(state, annotationId).catch(notApplied);
  const dismissCarried = async (state: CarriedState, reason: string): Promise<boolean> => {
    const inputId = state.input.input_id;
    const selectionBefore = selectedListKeyRef.current;
    if (!await carried.dismiss(state, reason).catch(notApplied)) return false;
    // The user moved on while the write was pending: leave their selection and focus alone.
    if (selectedListKeyRef.current !== selectionBefore) return true;
    const after = carriedStateNow(inputId);
    if (after?.variant !== "dismissed") return true;
    // An atomic dismissal removed the carried finding: its row is now the placeholder.
    const key = rowKeyOf(after);
    if (key !== selectionBefore) selectListKey(key);
    setFocusRequest({ key, find: root => root.querySelector<HTMLElement>("[data-carried-undo]") });
    return true;
  };
  const undoCarriedDismissal = async (state: CarriedState) => {
    const inputId = state.input.input_id;
    const selectionBefore = selectedListKeyRef.current;
    if (!await carried.undoDismissal(state).catch(notApplied)) return;
    if (selectedListKeyRef.current !== selectionBefore) return;
    if (latestDraft.current.round_input_resolutions?.some(resolution => resolution.input_id === inputId)) return;
    const after = carriedStateNow(inputId);
    // The server restored the removed carried finding: select it and offer "Mark as checked".
    const key = after?.carriedId ? `annotation:${after.carriedId}` : `input:${inputId}`;
    if (key !== selectionBefore) selectListKey(key);
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
          label: quote ? `${term}, “${quote}”` : `${term}, no text span`,
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
      origin={carriedOriginLine(input)} recordedAt={input.source_draft_snapshot_id != null ? null : input.source_recorded_at}
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
    ? "Delete this finding and all its mentions? This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason."
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
      flushPendingAxes();
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
    // "Link a text span": the selection becomes the modifier's segment.
    if (linkSpan) {
      modifierCommands.setLinkSpan(null);
      setMobilePane("details");
      try { await modifierCommands.setSegments(linkSpan.annotationId, linkSpan.termId, payload.segments); } catch { return; }
      announceCarried(`Linked “${quoteSegments(view.document.text, payload.segments, 40)}” to ${linkSpan.term}.`);
      setFocusRequest({ key: `annotation:${linkSpan.annotationId}`, find: root => chipIn(root, linkSpan.termId) });
      return;
    }
    // At <=700 px a new mark stays in the text pane: the "New finding" bar offers Choose term (spec B.5).
    const newMark = !activeCarried && !activeReanchor && !pendingEvidenceAdoption
      && !(payload.intent === "extend_mention" && selectedEvidenceId) && !(isAttachingMention && selectedAnnotationId);
    if (!(newMark && panesLayout)) setMobilePane("details");

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

  // A newly marked span (not re-anchor, not carried): prefilled, focused term search.
  const pendingIsMarkedSpan = !!pendingAnnotation && !pendingAnnotation.isSpanless && !pendingAnnotation.reanchorItem && !pendingAnnotation.carriedInput;
  const pendingSearchProps = (pending: NonNullable<typeof pendingAnnotation>) => {
    if (pending.reanchorItem || pending.carriedInput) return {};
    const reasonFirst = !!pending.isSpanless && spanlessNotesRequired;
    const base = {
      autoFocus: !panesLayout && !reasonFirst,
      onEscape: () => {
        if (!pending.isSpanless) { discardPending(); return; }
        cancelPending();
        setTextFocusRequest({ offset: null });
      },
    };
    if (pending.isSpanless) return base;
    // Always prefilled; a language that is not searched keeps the English-only hint under the field.
    return {
      ...base,
      initialQuery: prefillQuery(view.document.text, pending.segments),
      languageHint: prefillHint(view.document.language, searchLanguagesFor(pending.layerId)?.active) ?? undefined,
    };
  };

  const cancelPending = () => {
    pendingSegments.current = null;
    setAttachModifier(null); setAttachFocusId(null); setAttachReplaceId(null);
    const item=activeReanchor ?? pendingAnnotation?.reanchorItem;
    setPendingAnnotation(null); setActiveReanchor(null); setActiveCarried(null); searchManager.clear();
    if(item) [...(sidebarScrollRef.current?.querySelectorAll<HTMLElement>('[data-reanchor-item]') ?? [])]
      .find(row=>row.dataset.reanchorItem===reanchorKey(item))?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };

  // Discards a newly marked span (Esc, "Discard"): focus goes back to the text at its end.
  const discardPending = () => {
    const adjusted = pendingSegments.current;
    const segments = adjusted && adjusted.evidenceId === pendingAnnotation?.evidenceId
      ? adjusted.segments : pendingAnnotation?.segments ?? [];
    const end = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
    cancelPending();
    setTextFocusRequest({ offset: end });
    announceCarried("Marked text discarded.");
  };

  const createPendingAnnotation = async (termId: string, searchId?: string, termText?: string) => {
    if (readOnlyRef.current) return;
    if (!pendingAnnotation || creatingPending.current) return;
    // A handle moved by keyboard reports after a pause: take that move along.
    flushTextResize.current?.();
    if (pendingAnnotation.isSpanless && spanlessNotesRequired && !spanlessReason.trim()) {
      setPendingAnnotation({ ...pendingAnnotation, selectedTerm: { termId, searchId } });
      setSpanlessReasonError(true);
      inspectorRef.current?.querySelector<HTMLTextAreaElement>("#spanless-reason")?.focus();
      return;
    }
    creatingPending.current = true;
    setActionError(null);
    const adjusted = pendingSegments.current;
    const pending = adjusted && adjusted.evidenceId === pendingAnnotation.evidenceId
      ? { ...pendingAnnotation, segments: adjusted.segments } : pendingAnnotation;
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
        // A re-created carried finding keeps the original's chosen (not defaulted) axis values as chosen.
        ...(!pending.reanchorItem ? { chosen_axis_ids: pending.carriedInput
          ? carriedChosenAxisIds(pending.carriedInput.source_snapshot.annotation, (type?.axes ?? []).map(axis => axis.id))
          : [] } : {}),
      });
      // create_annotation carries no modifiers: a re-created carried finding gets the source's modifiers one by
      // one, without text spans (the carried text may have changed).
      // One failed copy must not stop the others nor the link to the carried input.
      const notCopied: string[] = [];
      for (const modifier of pending.carriedInput?.source_snapshot.annotation.modifiers ?? []) {
        try { await enqueueMutation({ command: "add_modifier", annotation_id: pending.annotationId, term_id: modifier.term_id }); }
        catch { notCopied.push(termLabel(pending.layerId, modifier.term_id) ?? modifier.term_id); }
      }
      if (notCopied.length) announceCarried(`Could not copy modifier ${notCopied.join(", ")}.`);
      if (pending.reanchorItem) setResolutionItem(pending.reanchorItem);
      // Linked client-side as the input's result; the input stays "Check needed" (no auto-complete).
      if (pending.carriedInput) {
        carried.rememberRecreated(pending.carriedInput.input_id, pending.annotationId);
        setFocusRequest({ key: `annotation:${pending.annotationId}`, find: carriedPrimary });
      }
      setPendingAnnotation(null);
      pendingSegments.current = null;
      setSpanlessReason(""); setSpanlessReasonError(false);
      setSelectedTargetId(null);
      setSelectedSourceId(null);
      setSelectedAnnotationId(pending.annotationId);
      setSelectedEvidenceId(pending.evidenceId ?? null);
      searchManager.clear();
      // A newly marked span continues the loop: values next, then back to the text (spec B.2).
      if (!pending.isSpanless && !pending.reanchorItem && !pending.carriedInput) {
        setLoopFocus({ annotationId: pending.annotationId, termText: termText ?? null });
        setLoopAnnotationId(pending.annotationId);
      }
      if(pending.reanchorItem) requestAnimationFrame(() => {
        const next = inspectorRef.current?.querySelector<HTMLElement>('[data-confirm-defaults]') ?? inspectorRef.current?.querySelector<HTMLElement>('button, input, textarea, select');
        next?.focus({ preventScroll: true });
      });
    } catch (error) { reportError(error); }
    finally { creatingPending.current = false; }
  };

  const handlePickMention = (evidenceId: string) => {
    if (evidenceId === pendingAnnotation?.evidenceId) return;
    const pickedModifier = parseModifierDisplayId(evidenceId);
    if (attachActive) {
      // A finding's mark is a target of the attach mode: a click attaches instead of selecting.
      const owner = pickedModifier?.annotationId ?? ownerOfEvidence(evidenceId)?.annotation.annotation_id;
      if (owner && attachTargets.some(target => target.annotationId === owner)) void attachTo(owner);
      return;
    }
    if (pickedModifier) {
      // A modifier segment selects its finding and focuses the chip.
      selectListKey(`annotation:${pickedModifier.annotationId}`);
      setFocusRequest({ key: `annotation:${pickedModifier.annotationId}`, find: root => chipIn(root, pickedModifier.termId) });
      return;
    }

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
    !selectedSource && !pendingAnnotation && !(isReviewLike(view.key.mode) && selectedTarget)
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
    revealWorkspace();
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

  /** One set_axes for `annotationId` (default: the selected finding); false when nothing was sent. */
  const handleUpdateAxes = async (axesValues: Partial<AxesValues>, confirmedAxisIds?: string[], annotationId = selectedAnnotationId): Promise<boolean> => {
    if (readOnlyRef.current || !annotationId) return false;
    const snapshot = annotationId === selectedAnnotationId && selectedAnnotation ? selectedAnnotation
      : latestDraft.current.annotations?.find(candidate => candidate.annotation.annotation_id === annotationId);
    if (!snapshot) return false;
    await mutateAnnotationAndSyncDecision(annotationId, () =>
      enqueueMutation({
        command: "set_axes",
        annotation_id: annotationId,
        axes_values: axesValues as Record<string, string | null>,
        chosen_axis_ids: confirmedAxisIds ?? Object.keys(axesValues).filter(
          (axis) => axesValues[axis] != null && axesValues[axis] !== "" && axesValues[axis] !== snapshot.annotation.axes_values?.[axis]
        ),
      })
    );
    return true;
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
    // The pending mark changes only locally: nothing is saved before a term is chosen.
    if (pendingIsMarkedSpan && pendingAnnotation?.evidenceId === evidenceId) {
      pendingSegments.current = { evidenceId, segments };
      setPendingAnnotation(current => current?.evidenceId === evidenceId ? { ...current, segments } : current);
      announceCarried(`Marked text: “${quoteSegments(view.document.text, segments, 40)}”`);
      return;
    }
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
  // A newly marked span (not re-anchor, not carried) can be adjusted before a term is chosen.
  const pendingEvidenceId = pendingIsMarkedSpan ? pendingAnnotation?.evidenceId : undefined;
  const resizableEvidenceIds = readOnly || isAttachingMention ? []
    : pendingEvidenceId ? [pendingEvidenceId]
      : selectedAnnotation && !pendingAnnotation && editableLayerIds.includes(selectedAnnotation.annotation.layer_id)
        ? (selectedAnnotation.annotation.evidence_refs ?? []).map((r) => r.evidence_id)
        : [];
  const resizableLabels = pendingEvidenceId ? { [pendingEvidenceId]: PENDING_HANDLE_LABELS } : undefined;

  // --- Modifiers: attach mode (E-a), framing, link a text span -------------------------------------
  const ownerOfEvidence = (evidenceId: string) => visibleAnnotations.find(snapshot =>
    (snapshot.annotation.evidence_refs ?? []).some(ref => ref.evidence_id === evidenceId));
  const draftAnnotationById = new Map((draft.annotations ?? []).map(snapshot => [snapshot.annotation.annotation_id, snapshot]));
  /** Own findings in editable `hpo-phenotype` layers, in list order (spanless ones included). */
  const attachTargets: AttachFinding[] = carriedListOrder.flatMap(key => {
    // From the draft, not the visible layers: a hidden layer's finding is still a target.
    const snapshot = key.startsWith("annotation:") ? draftAnnotationById.get(key.slice("annotation:".length)) : undefined;
    if (!snapshot || !modifierLayerIds.has(snapshot.annotation.layer_id) || !editableLayerIds.includes(snapshot.annotation.layer_id)) return [];
    // Convert mode: the source is no target, nor is a finding of another layer (convert_to_modifier refuses LAYER_MISMATCH).
    if (attachModifier?.mode === "convert" && (snapshot.annotation.annotation_id === attachModifier.sourceId
      || snapshot.annotation.layer_id !== draftAnnotationById.get(attachModifier.sourceId)?.annotation.layer_id)) return [];
    const mentions = (snapshot.annotation.evidence_refs ?? []).map(ref => allEvidenceMap[ref.evidence_id]).filter(Boolean);
    return [{
      annotationId: snapshot.annotation.annotation_id, term: findingNameOf(snapshot), termId: snapshot.annotation.term_id,
      segments: mentions.flatMap(evidence => evidence.mention.segments),
      quote: mentions[0] ? quoteSegments(view.document.text, mentions[0].mention.segments, 40) : "",
    }];
  });
  const attachActive = !!attachModifier && (attachModifier.mode === "convert" || pendingIsMarkedSpan) && !readOnly && attachTargets.length > 0;
  const attachSegments = attachModifier?.mode === "convert" ? attachModifier.mark : pendingAnnotation?.segments ?? [];
  const attachMark = attachSegments.length
    ? { start: Math.min(...attachSegments.map(s => s.start)), end: Math.max(...attachSegments.map(s => s.end)) } : null;
  const attachNearest = attachActive && attachMark ? attachCandidates(view.document.text, attachMark, attachTargets)[0] ?? null : null;
  /** Hidden layers of the targets become visible: their rows render and take keyboard focus. */
  const showLayersOf = (targets: readonly AttachFinding[]) => setLayerSelection(previous => ({ ...previous, visibleLayerIds: [...new Set([
    ...previous.visibleLayerIds, ...targets.flatMap(target => draftAnnotationById.get(target.annotationId)?.annotation.layer_id ?? [])])] }));
  const startAttach = (candidate: { term_id: string; label?: string | null }) => {
    showLayersOf(attachTargets);
    setAttachModifier({ termId: candidate.term_id, termLabel: candidate.label ?? candidate.term_id, mode: "attach" });
    setAttachFocusId(null); setAttachReplaceId(null);
    // At <=700 px the list pane holds the targets (the "Create the finding first" state stays in the details pane).
    if (panesLayout && attachTargets.length) setMobilePane("list");
    // No target: the panel's "Create the finding first" state is announced (its "OK" takes focus).
    if (!attachTargets.length) announceCarried(attachCopy.noFindings(candidate.label ?? candidate.term_id));
  };
  /** "Turn into modifier…" of a modifier used as a finding (R3, E-c): the attach mode in convert mode. */
  const startConvert = (snapshot: AnnotationSnapshot) => {
    const first = snapshot.annotation.evidence_refs?.[0];
    setAttachModifier({ termId: snapshot.annotation.term_id, termLabel: findingNameOf(snapshot), mode: "convert", sourceId: snapshot.annotation.annotation_id,
      mark: first ? allEvidenceMap[first.evidence_id]?.mention.segments ?? [] : [] });
    setAttachFocusId(null); setAttachReplaceId(null);
    // attachTargets is not filtered for convert mode yet: the source's layer is the only target layer.
    const targets = attachTargets.filter(target => target.annotationId !== snapshot.annotation.annotation_id
      && draftAnnotationById.get(target.annotationId)?.annotation.layer_id === snapshot.annotation.layer_id);
    showLayersOf(targets);
    if (panesLayout && targets.length) setMobilePane("list");
    // No target: the panel's "Create the finding first" state is announced (its "OK" takes focus).
    if (!targets.length) announceCarried(attachCopy.noFindings(findingNameOf(snapshot)));
  };
  /** Convert mode: Esc and Cancel only end the mode (the finding stays) and focus "Turn into modifier…" again. */
  const cancelAttachModifier = () => {
    if (attachModifier?.mode !== "convert") { setAttachModifier(null); discardPending(); return; }
    const sourceId = attachModifier.sourceId;
    setAttachModifier(null); setAttachFocusId(null); setAttachReplaceId(null);
    if (panesLayout) setMobilePane("details");
    setFocusRequest({ key: `annotation:${sourceId}`, find: root => root.querySelector<HTMLElement>("[data-turn-into-modifier]") });
  };
  /** Convert mode: one convert_to_modifier (the source's first mention goes along); `replace` keeps none of the target's old span. */
  const convertTo = async (annotationId: string, replace: boolean) => {
    if (attachModifier?.mode !== "convert" || readOnlyRef.current || creatingPending.current) return;
    const target = latestDraft.current.annotations?.find(snapshot => snapshot.annotation.annotation_id === annotationId);
    if (!target) return;
    const { termId, termLabel: term, sourceId, mark } = attachModifier;
    const existing = target.annotation.modifiers?.find(modifier => modifier.term_id === termId);
    const conflict = !!existing?.segments?.length && mark.length > 0 && JSON.stringify(existing.segments) !== JSON.stringify(mark);
    if (conflict && !replace) { setAttachReplaceId(annotationId); setAttachFocusId(annotationId); return; }
    creatingPending.current = true;
    try {
      // convert_to_modifier refuses another span (DUPLICATE_MODIFIER): set the source's span first (the same span passes),
      // so a failure leaves the source finding in place.
      if (conflict) await modifierCommands.setSegments(annotationId, termId, mark);
      await modifierCommands.convert(sourceId, annotationId, true);
    } catch { return; } finally { creatingPending.current = false; }
    setAttachModifier(null); setAttachFocusId(null); setAttachReplaceId(null);
    setSelectedTargetId(null); setSelectedSourceId(null); setSelectedInputId(null);
    setSelectedAnnotationId(annotationId);
    setSelectedEvidenceId(target.annotation.evidence_refs?.[0]?.evidence_id ?? null);
    if (panesLayout) setMobilePane("details");
    announceCarried(attachCopy.converted(term, findingNameOf(target)));
    const end = mark.length ? Math.max(...mark.map(segment => segment.end)) : null;
    setFocusRequest({ key: `annotation:${annotationId}`, find: root => {
      const chip = chipIn(root, termId);
      if (!chip) setTextFocusRequest({ offset: end });
      return chip;
    } });
  };
  /** Attach the pending mark (as adjusted by its handles) to a finding; `replace` sends set_modifier_segments. */
  const attachTo = async (annotationId: string, replace = false) => {
    if (attachModifier?.mode === "convert") { await convertTo(annotationId, replace); return; }
    if (!attachModifier || !pendingAnnotation || readOnlyRef.current || creatingPending.current) return;
    const target = latestDraft.current.annotations?.find(snapshot => snapshot.annotation.annotation_id === annotationId);
    if (!target) return;
    flushTextResize.current?.();
    const adjusted = pendingSegments.current;
    const segments = adjusted && adjusted.evidenceId === pendingAnnotation.evidenceId ? adjusted.segments : pendingAnnotation.segments;
    const { termId, termLabel: term } = attachModifier;
    const existing = target.annotation.modifiers?.find(modifier => modifier.term_id === termId);
    if (existing?.segments?.length && !replace) {
      // add_modifier would refuse DUPLICATE_MODIFIER: only focus the target; the inspector offers "Replace text span".
      setAttachReplaceId(annotationId); setAttachFocusId(annotationId);
      return;
    }
    creatingPending.current = true;
    try {
      if (existing?.segments?.length) await modifierCommands.setSegments(annotationId, termId, segments);
      else await modifierCommands.add(annotationId, termId, segments);
    } catch { return; } finally { creatingPending.current = false; }
    const finding = findingNameOf(target);
    const end = Math.max(...segments.map(segment => segment.end));
    // Another mark made while the command ran stays pending.
    if (pendingRef.current?.evidenceId !== pendingAnnotation.evidenceId) { announceCarried(attachCopy.attached(term, finding)); return; }
    cancelPending();
    setSelectedTargetId(null); setSelectedSourceId(null); setSelectedInputId(null);
    setSelectedAnnotationId(annotationId);
    setSelectedEvidenceId(target.annotation.evidence_refs?.[0]?.evidence_id ?? null);
    if (panesLayout) setMobilePane("details");
    announceCarried(existing && !replace ? attachCopy.linked(quoteSegments(view.document.text, segments, 40), term, finding) : attachCopy.attached(term, finding));
    setFocusRequest({ key: `annotation:${annotationId}`, find: root => {
      const chip = chipIn(root, termId);
      if (!chip) setTextFocusRequest({ offset: end });
      return chip;
    } });
  };
  const moveAttachFocus = (step: 1 | -1) => {
    const index = attachTargets.findIndex(target => target.annotationId === attachFocusId);
    const next = attachTargets[Math.min(attachTargets.length - 1, Math.max(0, index + step))];
    if (next) { setAttachFocusId(next.annotationId); setAttachReplaceId(null); }
  };
  // Focus on start: the nearest target's row, else the first; then the row the arrow keys moved to.
  useEffect(() => {
    if (!attachActive) return;
    if (!attachFocusId || !attachTargets.some(target => target.annotationId === attachFocusId)) {
      setAttachFocusId(attachNearest?.annotationId ?? attachTargets[0].annotationId);
      return;
    }
    rootRef.current?.querySelector<HTMLElement>(`[data-list-key="annotation:${attachFocusId}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachActive, attachFocusId]);

  const startLinkSpan = (annotationId: string, termId: string) => {
    const snapshot = latestDraft.current.annotations?.find(a => a.annotation.annotation_id === annotationId);
    if (!snapshot || readOnlyRef.current) return;
    modifierCommands.setLinkSpan({ annotationId, termId, term: termLabel.info(snapshot.annotation.layer_id, termId)?.label ?? termId, finding: findingNameOf(snapshot) });
    setMobilePane("text");
    setTextFocusRequest({ offset: null });
  };
  const cancelLinkSpan = () => {
    const mode = linkSpan;
    modifierCommands.setLinkSpan(null);
    if (!mode) return;
    if (panesLayout) flushSync(() => setMobilePane("details"));
    if (inspectorRef.current) chipIn(inspectorRef.current, mode.termId)?.focus({ preventScroll: true });
  };
  // Another selection ends "Link a text span".
  useEffect(() => {
    if (linkSpan && linkSpan.annotationId !== selectedAnnotationId) modifierCommands.setLinkSpan(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAnnotationId]);

  /** Mention ids (`mentions`) and modifier display ids of a finding, for `run--framed`. */
  const framingIds = (annotationId: string, mentions: boolean): string[] => {
    const snapshot = visibleAnnotationById.get(annotationId);
    if (!snapshot) return [];
    return [...(mentions ? (snapshot.annotation.evidence_refs ?? []).map(ref => ref.evidence_id) : []),
      ...(snapshot.annotation.modifiers ?? []).map(modifier => modifierDisplayId(annotationId, modifier.term_id))];
  };
  const attachFramed = attachFocusId ?? attachNearest?.annotationId ?? null;
  const framedIds = attachActive ? (attachFramed ? framingIds(attachFramed, true) : [])
    : hoverFrameId ? framingIds(hoverFrameId, true)
      : selectedAnnotationId ? framingIds(selectedAnnotationId, false) : [];
  const handleHoverMentions = (ids: string[]) => {
    const owner = ids.map(id => parseModifierDisplayId(id)?.annotationId ?? ownerOfEvidence(id)?.annotation.annotation_id).find(Boolean);
    setHoverFrameId(owner ?? null);
  };

  // One line above the text, only while a marking mode waits for text (spec C.6).
  const intentTerm = selectedAnnotation
    ? termLabel(selectedAnnotation.annotation.layer_id, selectedAnnotation.annotation.term_id) || selectedAnnotation.annotation.term_id
    : null;
  const extendedMention = selectedAnnotation && selectedEvidenceId
    ? (selectedAnnotation.annotation.evidence_refs ?? []).findIndex(ref => ref.evidence_id === selectedEvidenceId) + 1 : 0;
  const intentMessage = readOnly || !intentTerm ? null
    : isAttachingMention ? `Adding a mention to ${intentTerm}. Mark the text. Esc cancels.`
    : selectionIntent === "extend_mention" && extendedMention > 0
      ? `Adding a segment to mention ${extendedMention} of ${intentTerm}. Mark the text. Esc cancels.` : null;

  const openReviewTargets = reviewTargets.filter(
    (t) => !(draft.decisions ?? []).some((d) => refKey(d.target) === refKey(t)),
  );
  // Confirmed proposals are submitted as they are, next to the draft's own annotations.
  const confirmedCount = (draft.decisions ?? []).filter((d) => d.outcome === "confirmed").length;

  const completionResults = resultSnapshots(draft, view.available_inputs ?? []);
  /** A finding whose term is a modifier or cohort term (R3, old or imported data). */
  const isModifierTerm = (snapshot: SnapshotLike) => {
    const role = termLabel.info(snapshot.annotation.layer_id, snapshot.annotation.term_id)?.role;
    return role === "modifier" || role === "cohort";
  };
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
      : needsSpan ? "Use Add mention to select supporting text, or delete this finding." : "Enter the reason in the note.";
    return reason ? [{ snapshot, reason, remedy, focus: target ? '[data-repair="edit-proposal"]' : needsSpan ? '[data-repair="add-mention"]' : '[data-repair="annotation-note"]' }] : [];
  });
  const defaulted = defaultedResults(completionResults);
  const defaultedKeys = new Set(defaulted.map(s => refKey({ annotation_id: s.annotation.annotation_id, version: s.version })));
  /** Axis definitions (id, label) of a snapshot's layer and type. */
  const axisDefinitions = (snapshot: SnapshotLike) => view.layers?.find(layer => layer.layer_id === snapshot.annotation.layer_id)?.annotation_types
    .find(type => type.type_id === snapshot.annotation.type_id)?.axes ?? view.axes_config ?? [];
  const reviewTargetOf = (snapshot: AnnotationSnapshot) =>
    reviewTargets.find(t => refKey(t) === refKey({ annotation_id: snapshot.annotation.annotation_id, version: snapshot.version }));
  /** Evidence id of the snapshot's first mark in the text (proposal marks use their own ids). */
  const firstEvidenceId = (snapshot: AnnotationSnapshot): string | undefined => {
    const target = reviewTargetOf(snapshot);
    if (!target) return snapshot.annotation.evidence_refs?.[0]?.evidence_id;
    const evidence = snapshot.evidence?.[0];
    return evidence ? `target:${target.annotation_id}:${target.version}:${evidence.mention.evidence_id}:${evidence.version}` : undefined;
  };
  const snapshotTerm = (snapshot: SnapshotLike) => termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id;
  const findingRef = (snapshot: AnnotationSnapshot) => {
    const target = reviewTargetOf(snapshot);
    return { annotationId: snapshot.annotation.annotation_id, term: snapshotTerm(snapshot),
      ...(target ? { targetKey: refKey(target) } : {}), evidenceId: firstEvidenceId(snapshot) };
  };
  /** Segments of the snapshot's first mark: the draft's evidence for own findings, the snapshot's for proposals. */
  const firstSegments = (snapshot: AnnotationSnapshot) => {
    const own = reviewTargetOf(snapshot) ? undefined : allEvidenceMap[snapshot.annotation.evidence_refs?.[0]?.evidence_id ?? ""];
    return (own ?? snapshot.evidence?.[0])?.mention.segments ?? [];
  };
  const currentServerPairs = axisWarning && axisWarning.acknowledgement.draft_revision === draft.revision ? axisWarning.warnings : [];
  // F2: the Submit dialog's "Unconfirmed values" rows, computed locally; a current server warning adds its pairs.
  const unconfirmed = unconfirmedRows({
    snapshots: completionResults,
    axes: axisDefinitions,
    targetKeyOf: snapshot => { const target = reviewTargetOf(snapshot); return target ? refKey(target) : undefined; },
    editableLayerIds,
    term: snapshotTerm,
    quote: snapshot => { const segments = firstSegments(snapshot); return segments.length ? quoteSegments(view.document.text, segments, 40) : ""; },
    evidenceId: firstEvidenceId,
    serverPairs: currentServerPairs.filter(pair => !isModifierWarningKey(pair.axis)),
  });
  // R10, R12: acknowledged with the values (one list and digest on the server).
  const modifierWarningList = modifierWarnings(completionResults,
    (snapshot, termId) => termLabel.info(snapshot.annotation.layer_id, termId), currentServerPairs);
  /** Every acknowledged pair: unconfirmed values (as the server lists them) and modifier warnings. */
  const unconfirmedPairs = new Set([...(view.require_chosen_axes ? [] : rowPairs(unconfirmed)), ...modifierWarningPairs(modifierWarningList)]);
  const pairsKey = [...unconfirmedPairs].sort().join(",");
  const setAcknowledged = (checked: boolean) => {
    setAxisWarningAcknowledged(checked);
    setAckSeen(checked ? unconfirmedPairs : null);
    setSubmitStatus(null);
  };
  // A value the user did not see when ticking the acknowledgement unticks it.
  useEffect(() => {
    if (!axisWarningAcknowledged || !ackSeen) return;
    if ([...unconfirmedPairs].some(pair => !ackSeen.has(pair))) {
      setAxisWarningAcknowledged(false);
      setAckSeen(null);
      setSubmitStatus(changedStatus([...unconfirmedPairs].filter(pair => !ackSeen.has(pair))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsKey]);
  /** "Confirm" of a row: one set_axes with the finding's current values; false when nothing was confirmed. */
  const confirmUnconfirmedRow = async (row: UnconfirmedRow): Promise<boolean> => {
    const snapshot = (latestDraft.current.annotations ?? []).find(candidate => candidate.annotation.annotation_id === row.annotationId);
    if (!snapshot || row.confirmableAxisIds.length === 0) return false;
    try {
      return await handleUpdateAxes({ ...snapshot.annotation.axes_values }, row.confirmableAxisIds, row.annotationId);
    } catch (error) {
      if (!(error instanceof DiscardedChangesError)) reportError(error);
      return false;
    }
  };
  const confirmUnavailableReason = queueState === "conflict" || queueState === "error" || isOffline ? statusText : null;
  // Server axis warnings that still apply: the value is empty or still a default (as the server checks).
  const unconfirmedEntries = axisWarning ? completionResults.flatMap(snapshot => {
    const warned = new Set(axisWarning.warnings.filter(warning => warning.annotationId === snapshot.annotation.annotation_id && !isModifierWarningKey(warning.axis))
      .map(warning => warning.axis));
    const axes = axisDefinitions(snapshot);
    const position = (id: string) => { const index = axes.findIndex(axis => axis.id === id); return index < 0 ? axes.length : index; };
    const open = [...warned].filter(axis => {
      const value = snapshot.annotation.axes_values?.[axis];
      return value === null || value === undefined || value === "" || (snapshot.annotation.axes_defaulted ?? []).includes(axis);
    }).sort((a, b) => position(a) - position(b));
    if (!open.length) return [];
    const label = (id: string) => axes.find(axis => axis.id === id)?.label ?? id;
    return [{ ...findingRef(snapshot), axisId: open[0], axisLabel: label(open[0]),
      values: open.map(axis => `${label(axis)} = ${axisOptionLabel(snapshot.annotation.axes_values?.[axis])}`).join(", ") }];
  }) : [];
  const openItems = collectOpenItems({
    carried: carried.states.filter(state => state.unchecked).map(state => {
      const home = state.homeId ? draft.annotations?.find(snapshot => snapshot.annotation.annotation_id === state.homeId) : undefined;
      return { state, term: carriedTermText(home ?? state.input.source_snapshot), instruction: carriedInstruction(state) ?? "Check needed.",
        evidenceId: home?.annotation.evidence_refs?.[0]?.evidence_id };
    }),
    evidence: submissionIssues.map(({ snapshot, reason, remedy, focus }) => ({ ...findingRef(snapshot), reason, remedy, focus })),
    reanchor: pendingReanchorItems.filter(item => !currentReanchorResolution(item, draft.reanchor_resolutions ?? [], draft.annotations ?? []))
      .map(item => ({ key: reanchorKey(item), term: termLabel(item.layer_id, item.term_id) ?? item.term_id })),
    unconfirmed: unconfirmedEntries,
    openTargets: isReviewLike(view.key.mode) ? openReviewTargets.map(target => {
      const snapshot = (view.available_inputs ?? []).find(s => s.annotation.annotation_id === target.annotation_id && s.version === target.version);
      return { key: refKey(target), term: snapshot ? snapshotTerm(snapshot) : target.annotation_id, evidenceId: snapshot ? firstEvidenceId(snapshot) : undefined };
    }) : [],
    // R3: old data with a modifier term standing alone (the server blocks it as `modifier_as_finding`).
    modifierAsFinding: completionResults.filter(snapshot => isModifierTerm(snapshot)).map(snapshot => ({ ...findingRef(snapshot) })),
    modifierWarnings: modifierWarningList.map(warning => {
      const snapshot = completionResults.find(candidate => candidate.annotation.annotation_id === warning.annotationId);
      return { ...warning, ...(snapshot ? findingRef(snapshot) : { term: warning.annotationId }) };
    }),
    defaulted: defaulted.map(snapshot => {
      const axes = axisDefinitions(snapshot), defaultedAxes = snapshot.annotation.axes_defaulted ?? [];
      return { ...findingRef(snapshot), axisId: axes.find(axis => defaultedAxes.includes(axis.id))?.id ?? defaultedAxes[0] };
    }),
  });

  /** Control of an open item in the inspector: an axis item focuses its axis field, else the item's selector. */
  const openItemControl = (item: OpenItem) => (root: HTMLElement): HTMLElement | null => {
    // Proposals have no modifier buttons nor "Turn into modifier…": their decision buttons resolve them.
    if (!item.axisId) return root.querySelector<HTMLElement>(item.focus) ?? root.querySelector<HTMLElement>(".decision-btn");
    const field = Array.from(root.querySelectorAll<HTMLElement>("[data-axis-field]")).find(element => element.dataset.axisField === item.axisId);
    const control = field?.querySelector<HTMLElement>('input[type="radio"]:checked:not(:disabled)')
      ?? field?.querySelector<HTMLElement>('input[type="radio"]:not(:disabled)')
      ?? field?.querySelector<HTMLElement>("select:not(:disabled)");
    if (control) return control;
    // Proposals show their values read-only: focus the values section instead (rendered with tabIndex -1).
    return root.querySelector<HTMLElement>('[data-testid="axes-section"], .review-actions__proposal');
  };
  const [textScrollRequest, setTextScrollRequest] = useState<{ evidenceId: string; nonce: number } | null>(null);
  const lastOpenItem = useRef<string | null>(null);
  /** "Go to {term}": close the dialog, select the row, scroll the text to its mark and focus the resolving control. */
  const goToOpenItem = (item: OpenItem) => {
    setSubmitDialogOpen(false);
    lastOpenItem.current = item.key;
    if (item.kind === "reanchor") { reviewPendingReanchor(item.key.slice("reanchor:".length)); return; }
    const listKey = item.listKey;
    if (!listKey) return;
    const kind = listKey.slice(0, listKey.indexOf(":")), id = listKey.slice(listKey.indexOf(":") + 1);
    const snapshot = kind === "target" ? (view.available_inputs ?? []).find(s => refKey({ annotation_id: s.annotation.annotation_id, version: s.version }) === id)
      : kind === "annotation" ? draft.annotations?.find(s => s.annotation.annotation_id === id) : undefined;
    if (snapshot) revealLayerOf(snapshot.annotation);
    selectListKey(listKey);
    const evidenceId = item.evidenceId;
    if (evidenceId) {
      setSelectedEvidenceId(evidenceId);
      setTextScrollRequest(previous => ({ evidenceId, nonce: (previous?.nonce ?? 0) + 1 }));
    }
    setFocusRequest({ key: listKey, find: openItemControl(item) });
  };
  /** "Go to" of an unconfirmed row: the finding's first open axis. */
  const goToRow = (row: UnconfirmedRow) =>
    goToOpenItem({
      key: `unconfirmed:${row.targetKey ?? row.annotationId}`,
      kind: "unconfirmed-values",
      blocking: false,
      term: row.term,
      line: "",
      listKey: row.listKey,
      focus: "[data-axis-field]",
      axisId: row.values[0]?.axisId,
      evidenceId: row.evidenceId,
    });
  const goToNextOpenItem = () => {
    const item = nextOpenItem(openItems, selectedListKey, lastOpenItem.current);
    if (item) goToOpenItem(item);
  };

  const reviewPendingReanchor = (key?: string) => {
    const item = pendingReanchorItems.find(item => (key === undefined || reanchorKey(item) === key)
      && !currentReanchorResolution(item, draft.reanchor_resolutions ?? [], draft.annotations ?? []));
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
    if (readOnlyRef.current || !isReviewLike(view.key.mode)) return false;
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
    flushPendingAxes();
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
    setAckSeen(null); setSubmitStatus(null);
    setSubmitDialogOpen(true);
  };

  // Step 2: submit after the explicit "entire text checked" confirmation.
  const confirmSubmit = async () => {
    const rowsRemain = unconfirmed.length > 0;
    if (readOnlyRef.current || submittingWorkspace.current || (rowsRemain && view.require_chosen_axes)) return;
    if (unconfirmedPairs.size > 0 && !axisWarningAcknowledged) return;
    if (!textCheckedConfirmed || blockInvalidUnresolvedNotes() || submissionIssues.length || unresolvedReanchorCount || pendingCarriedCount) return;
    if (isReviewLike(view.key.mode)) {
      const missingTargets = reviewTargets.filter((t) => !(latestDraft.current.decisions ?? []).some(d => refKey(d.target) === refKey(t)));
      if (missingTargets.length > 0) {
        setSubmitError(
          `There are still ${missingTargets.length} undecided review proposals. Please make a decision for each proposal before submitting.`
        );
        return;
      }
    }
    submittingWorkspace.current = true;
    // The values the user saw when submitting; a warning listing exactly these is acknowledged at once (D1).
    const expected = unconfirmedPairs;
    const acknowledged = unconfirmedPairs.size > 0 && axisWarningAcknowledged;
    const held = acknowledged ? axisWarning?.acknowledgement : undefined;
    try {
      const submitEnvelope = (expectedRevision: number, acknowledgement?: AxisWarning["acknowledgement"]) => ({
        mutation_id: crypto.randomUUID(),
        expected_revision: expectedRevision,
        payload: {
          command: "submit_workspace" as const,
          // Explicitly confirmed by the user in the submit dialog.
          document_checked: true,
          ...(acknowledgement ? { warning_acknowledgement: acknowledgement } : {}),
        },
      });
      let first: ReturnType<typeof submitEnvelope> | undefined;
      let resend: ReturnType<typeof submitEnvelope> | undefined;
      const submission = await queueRef.current.enqueue(async (expectedRevision) => {
        assertWritable();
        first ??= submitEnvelope(expectedRevision, held);
        try { return await api.submitWorkspace(workspaceId, first).catch(assignmentFailure); }
        catch (error) {
          const warning = submissionAxisWarning(error);
          // An advisory response applies no mutation and must not count as a
          // rejected edit, which would incorrectly prevent later navigation.
          if (!warning) throw error;
          const answered = new Set(warning.warnings.map(item => pairKey(item.annotationId, item.axis)));
          // D1: the user ticked exactly these values; resend once with the fresh acknowledgement.
          if (acknowledged && sameSet(answered, expected)) {
            resend ??= submitEnvelope(expectedRevision, warning.acknowledgement);
            try { return await api.submitWorkspace(workspaceId, resend).catch(assignmentFailure); }
            catch (again) {
              const next = submissionAxisWarning(again);
              if (next) return { revision: expectedRevision, axisWarning: next };
              throw again;
            }
          }
          return { revision: expectedRevision, axisWarning: warning };
        }
      });
      if ("axisWarning" in submission) {
        setAxisWarning(submission.axisWarning);
        setAxisWarningAcknowledged(false);
        setAckSeen(null);
        const answered = new Set(submission.axisWarning.warnings.map(item => pairKey(item.annotationId, item.axis)));
        setSubmitStatus(changedStatus([...answered].filter(pair => !expected.has(pair)).concat([...expected].filter(pair => !answered.has(pair)))));
        setSubmitDialogOpen(true);
        return;
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
    if (!selectedAnnotation || !isReviewLike(view.key.mode)) return null;
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

  // --- Annotation term loop (spec B.2): values after a new term, keys / V D -------------------
  const [loopFocus, setLoopFocus] = useState<{ annotationId: string; termText: string | null } | null>(null);
  // The finding last created from a marked span; at <=700 px it offers "Back to text".
  const [loopAnnotationId, setLoopAnnotationId] = useState<string | null>(null);
  const [valuesError, setValuesError] = useState<{ annotationId: string; message: string } | null>(null);
  const [changeTermRequest, setChangeTermRequest] = useState(0);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  /** End of the mark: largest segment end of the selected mention, else of the finding's first mention. */
  const markEndOf = (snapshot: AnnotationSnapshot, evidenceId: string | null): number | null => {
    const refs = snapshot.annotation.evidence_refs ?? [];
    const id = evidenceId && refs.some(ref => ref.evidence_id === evidenceId) ? evidenceId : refs[0]?.evidence_id;
    const segments = id ? allEvidenceMap[id]?.mention.segments ?? [] : [];
    return segments.length ? Math.max(...segments.map(segment => segment.end)) : null;
  };
  const focusInspector = (element: HTMLElement | null | undefined) => {
    if (!element) return false;
    element.focus({ preventScroll: true });
    return true;
  };
  useEffect(() => {
    if (!loopFocus) return;
    // Another selection before the new finding arrived ends the loop.
    if (selectedAnnotationId !== loopFocus.annotationId) { setLoopFocus(null); return; }
    if (!selectedAnnotation || selectedAnnotation.annotation.annotation_id !== loopFocus.annotationId) return;
    setLoopFocus(null);
    const snapshot = selectedAnnotation, values = snapshot.annotation.axes_values ?? {};
    const isSet = (value: unknown) => value !== null && value !== undefined && value !== "";
    const defaults = currentAxesConfig.filter(axis => (snapshot.annotation.axes_defaulted ?? []).includes(axis.id) && isSet(values[axis.id]));
    const term = loopFocus.termText ?? termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id;
    announceCarried(defaults.length
      ? `${term} added. Values from defaults: ${defaults.map(axis => axisOptionLabel(values[axis.id])).join(", ")}. Confirm defaults or change a value.`
      : `${term} added.`);
    const inspector = inspectorRef.current;
    const requiredEmpty = currentAxesConfig.find(axis => !axis.allow_empty && !isSet(values[axis.id]));
    const field = requiredEmpty ? Array.from(inspector?.querySelectorAll<HTMLElement>("[data-axis-field]") ?? [])
      .find(element => element.dataset.axisField === requiredEmpty.id) : undefined;
    if (focusInspector(field?.querySelector<HTMLElement>('input[type="radio"]:not(:disabled), select:not(:disabled)'))) return;
    if (focusInspector(inspector?.querySelector<HTMLElement>("[data-confirm-defaults]"))) return;
    if (panesLayout) focusInspector(inspector?.querySelector<HTMLElement>("[data-back-to-text]"));
    else setTextFocusRequest({ offset: markEndOf(snapshot, selectedEvidenceId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopFocus, selectedAnnotation, selectedAnnotationId]);
  useEffect(() => {
    if (!searchFocusRequest) return;
    const input = inspectorRef.current?.querySelector<HTMLInputElement>("#search-input");
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [searchFocusRequest]);
  useEffect(() => {
    setValuesError(null);
    // Selecting another finding ends the loop of the new one.
    setLoopAnnotationId(current => current === selectedAnnotationId ? current : null);
  }, [selectedAnnotationId]);

  /** "Confirm defaults (n)": one set_axes with the shown values; then back to the text after the mark. */
  const handleConfirmDefaults = async (axisIds: string[], values?: AxesValues, options?: { moveFocus?: boolean }) => {
    if (readOnlyRef.current || !selectedAnnotation) return;
    const snapshot = selectedAnnotation, annotationId = snapshot.annotation.annotation_id;
    const current: AxesValues = values ?? snapshot.annotation.axes_values ?? {};
    const ids = axisIds.filter(id => current[id] !== null && current[id] !== undefined && current[id] !== "");
    if (ids.length === 0) return;
    setValuesError(null);
    try {
      if (!await handleUpdateAxes(current, ids, annotationId)) return;
    } catch (error) {
      if (!(error instanceof DiscardedChangesError)) setValuesError({ annotationId, message: "The values could not be confirmed. Try again." });
      return;
    }
    const axisLabel = (id: string) => currentAxesConfig.find(axis => axis.id === id)?.label ?? id;
    announceCarried(`Confirmed: ${ids.map(id => `${axisLabel(id)} ${axisOptionLabel(current[id])}`).join(", ")}.`);
    // A click on the highlighted default confirms in place (D5): focus stays on that value.
    if (options?.moveFocus === false) return;
    // Move focus only while the same finding is selected and the user has not gone elsewhere meanwhile.
    const active = document.activeElement as HTMLElement | null;
    const focusUntouched = !active || active === document.body || active.hasAttribute("data-confirm-defaults")
      || !!active.closest("[data-values-section]");
    if (selectedAnnotationIdRef.current !== annotationId || !focusUntouched) return;
    if (panesLayout && mobilePane === "details") {
      focusInspector(inspectorRef.current?.querySelector<HTMLElement>("[data-back-to-text]"));
      return;
    }
    setTextFocusRequest({ offset: markEndOf(snapshot, selectedEvidenceId) });
  };
  const backToText = () => {
    setLoopAnnotationId(null);
    setMobilePane("text");
    setTextFocusRequest({ offset: selectedAnnotation ? markEndOf(selectedAnnotation, selectedEvidenceId) : null });
  };
  /** Choose term at <=700 px: the details pane with the prefilled, focused search. */
  const chooseTerm = () => {
    setMobilePane("details");
    setSearchFocusRequest(count => count + 1);
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
  useShortcut("Escape", (event) => {
    // Registered with allowInInputs so a select or other non-text control can discard (spec F1.5);
    // text fields keep their Escape, and only the pending discard runs from a non-text control.
    if (isTextEntryTarget(event.target)) return false;
    if (pendingIsMarkedSpan && !readOnly) {
      // A drawer or dialog owns its Escape (same rule as TextPane's attach mode).
      if (event.target instanceof Element && event.target.closest(".ui-drawer, [role='dialog']")) return false;
      discardPending();
      return;
    }
    if (isTypingTarget(event.target)) return false;
    if (isAttachingMention) { setIsAttachingMention(false); return; }
    if (selectionIntent === "extend_mention" && !readOnly) { setSelectionIntent("new_mention"); return; }
    if (!selectedAnnotationId && !selectedTargetId && !selectedSourceId && !selectedInputId) return false;
    handleDeselectAll();
  }, { ...shortcutOptions, allowRepeat: true, allowInInputs: true, group: "General", description: "Discard the marked text / clear selection / cancel adding a mention or segment" });
  useShortcut(["j", "k"], (event) => {
    // Resume from the last proposal (Edit & Replace clears the selection) and prefer open ones.
    const n = reviewTargets.length;
    const current = reviewTargets.findIndex((target) => refKey(target) === (selectedTargetId ?? lastTargetIdRef.current));
    const step = event.key.toLowerCase() === "j" ? 1 : -1;
    const start = current < 0 ? (step > 0 ? -1 : n) : current;
    const at = (i: number) => (((start + step * i) % n) + n) % n;
    let index = at(1);
    for (let i = 1; i <= n; i++) if (!decisionsMap[refKey(reviewTargets[at(i)])]) { index = at(i); break; }
    setSelectedTargetId(refKey(reviewTargets[index]));
    setSelectedAnnotationId(null);
    setSelectedSourceId(null);
  }, { ...shortcutOptions, enabled: isReviewLike(view.key.mode) && reviewTargets.length > 0,
    group: "Decisions", description: "Next / previous review proposal" });
  const reviewShortcutOptions = { ...shortcutOptions, enabled: !readOnly && isReviewLike(view.key.mode) && !!selectedTarget, group: "Decisions" };
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
  useShortcut("c", event => {
    // Plain "c" only: Shift+C is not this shortcut.
    if (event.shiftKey || !checkableCarried || readOnlyRef.current) return false;
    void markCarriedChecked(checkableCarried);
  }, { ...shortcutOptions, enabled: carriedActive && !readOnly && !!selectedCarriedState?.unchecked, group: "Carried findings", description: "Mark carried finding as checked" });
  useShortcutHint(["Shift + arrows, then release Shift"], "Select text with the keyboard to create a mention");
  // Finding keys (spec B.7): own editable findings and the new finding only, never proposals or read-only views.
  const ownFindingActive = !readOnly && !display && !!selectedAnnotation && !pendingAnnotation && !selectedSource
    && !selectedInputState && !(isReviewLike(view.key.mode) && selectedTarget);
  const pendingSearchable = !readOnly && !display && !!pendingAnnotation && !pendingAnnotation.carriedInput && !savedPendingReanchor;
  useShortcut("/", () => {
    if (pendingSearchable) {
      if (panesLayout) chooseTerm();
      else setSearchFocusRequest(count => count + 1);
      return;
    }
    if (!ownFindingActive) return false;
    if (panesLayout) setMobilePane("details");
    const open = inspectorRef.current?.querySelector<HTMLInputElement>("#search-input");
    if (open) { open.focus({ preventScroll: true }); return; }
    setChangeTermRequest(count => count + 1);
  }, { ...shortcutOptions, enabled: pendingSearchable || ownFindingActive, group: "Finding", description: "Focus the term search" });
  useShortcut("v", event => {
    // Plain "v" only: Shift+V is not this shortcut.
    if (event.shiftKey) return false;
    const fields = Array.from(inspectorRef.current?.querySelectorAll<HTMLElement>("[data-values-section] [data-axis-field]") ?? []);
    const defaulted = new Set(selectedAnnotation?.annotation.axes_defaulted ?? []);
    const field = fields.find(element => defaulted.has(element.dataset.axisField ?? "")) ?? fields[0];
    const control = field?.querySelector<HTMLElement>('input[type="radio"]:checked:not(:disabled)')
      ?? field?.querySelector<HTMLElement>('input[type="radio"]:not(:disabled)') ?? field?.querySelector<HTMLElement>("select:not(:disabled)");
    if (!control) return false;
    // At <=700 px the details pane must be shown before its control can take focus.
    if (panesLayout && mobilePane !== "details") flushSync(() => setMobilePane("details"));
    control.focus({ preventScroll: true });
  }, { ...shortcutOptions, enabled: ownFindingActive && currentAxesConfig.length > 0, group: "Finding", description: "Focus the values" });
  useShortcut("d", event => {
    // Plain "d" only: Shift+D is not this shortcut.
    if (event.shiftKey || readOnlyRef.current) return false;
    const button = inspectorRef.current?.querySelector<HTMLButtonElement>("[data-confirm-defaults]");
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
    button.click();
  }, { ...shortcutOptions, enabled: ownFindingActive && (selectedAnnotation?.annotation.axes_defaulted?.length ?? 0) > 0,
    group: "Finding", description: "Confirm all default values" });
  useShortcutHint(["←", "→", "Ctrl + ← / →"], "Move the focused mention edge (Tab to an edge handle of the selected annotation or the marked text)");

  // Finding marks are described with their modifiers (in the attach mode: "Attach Severe to Seizure"); modifier
  // segments are drawn in their finding's slot. TextPane compares a signature, so no memo is needed here.
  const attachTargetIds = new Set(attachActive ? attachTargets.map(target => target.annotationId) : []);
  const textMentions: MentionDisplay[] = [
    ...mentionsDisplay.map(mention => {
      const owner = ownerOfEvidence(mention.evidence_id);
      if (!owner) return mention;
      const name = findingNameOf(owner);
      const label = attachActive && attachModifier && attachTargetIds.has(owner.annotation.annotation_id)
        ? attachCopy.targetName(attachModifier.termLabel, name)
        : findingDescription(name, owner.annotation.modifiers ?? [], view.document.text, infoFor(owner.annotation.layer_id));
      return label ? { ...mention, label } : mention;
    }),
    ...visibleAnnotations.flatMap(snapshot => {
      const ann = snapshot.annotation;
      if (!ann.modifiers?.length) return [];
      return modifierMarks([{ annotationId: ann.annotation_id, term: findingNameOf(snapshot), termId: ann.term_id,
        colorIndex: markColourSlot({ termId: ann.term_id, layerId: ann.layer_id, kind: "own" }), modifiers: ann.modifiers }],
      view.document.text, infoFor(ann.layer_id));
    }),
    ...targetMentions,
    ...sourceMentions,
    ...(pendingAnnotation && !pendingAnnotation.isSpanless && pendingAnnotation.evidenceId
      ? [{ evidence_id: pendingAnnotation.evidenceId, segments: pendingAnnotation.segments }]
      : []),
  ];

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

  const badge = modeBadge(view.key.mode);
  return (
    <ProposalMetadataProvider scope={`${workspaceId}:${JSON.stringify(view.key)}`} projectKey={view.key.project_key} proposals={view.available_inputs ?? []} metadata={view.proposal_sets ?? []} allowPublicFetch={false}>
    <div ref={rootRef} className={compareOpen ? "case-screen case-comparing" : "case-screen"}>
      <div className="visually-hidden" aria-live="polite" data-carried-announcer>{carriedAnnouncement}</div>
      {/* The Undo toast of a removed modifier; its live region exists only where modifiers can be edited. */}
      {modifierLayerIds.size > 0 && <Toast toast={modifierCommands.toast} onDismiss={modifierCommands.dismissToast} undoDescription="Undo removing the modifier" undoGroup="Finding" />}
      {/* Header */}
      <Toolbar className="case-toolbar" label="Case">
        <div className="app-title">
          {/* Assignment routes go back through the shell breadcrumb; only the legacy path keeps its own way back. */}
          {!assignmentNavigation && (
            <Button type="button" size="sm" onClick={() => { void leaveCase(onClose); }} title="Back to dashboard">
              ← Dashboard
            </Button>
          )}
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
          ) : null}
          <h1 className="case-title" title={view.document.document_id}>{assignmentNavigation?.current.external_id || view.document.document_id}</h1>
          <LanguageTag code={view.document.language} />
          <span
            title={roundTitle ?? (roundKind !== "consolidation" && !isCarryKind(roundKind) ? badge.title : undefined)}
            className={`badge ${badge.className}`}
          >
            {roundKind === "consolidation" ? modeBadge("review").label : roundKind === "text_change" ? TEXT_CHANGE_ORIGIN : isCarryKind(roundKind) ? roundBadge ?? "Review carried findings" : badge.label}
          </span>
          {consolidationAssignmentId ? <a className="btn btn-secondary btn-sm" href={routeHref({ name: "task", assignmentId: consolidationAssignmentId })} onKeyDown={onSpaceActivate}>Back to consolidation</a> : null}
          {/* The display name has a bounded width (full text in the title), so the header
              does not need another line; the pseudonym is never shortened. */}
          <span
            className="badge identity-badge"
            data-testid="annotator-identity"
            title={`${annotatorName ? `${annotatorName} (${view.key.annotator_id})` : view.key.annotator_id}: your annotations and decisions are saved under this pseudonym`}
          >
            as{" "}
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
            openCount={readOnly ? null : openItems.length}
            onNextOpen={goToNextOpenItem}
          />
        </div>
      </Toolbar>

      {!!versionError && <><ErrorNotice error={versionError} /><Button onClick={retryVersions}>Retry version list</Button></>}
      {display && <InlineMessage tone="info"><span>Viewing {display.label} (read-only)</span>
        <Button disabled={versionBusy} onClick={() => { void chooseAnnotationVersion("draft"); }}>Back to my draft</Button>
      </InlineMessage>}
      {serverReadOnly && <InlineMessage tone="info">Submitted. The project lead can reopen it for changes.</InlineMessage>}
      {guidelineNotice}
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
      {/* Pane tabs and panes; on narrow screens one viewport-high block below the scrolling toolbar. */}
      <div ref={workspaceRef} className="case-workspace">
      <nav className="mobile-pane-tabs" aria-label="Select view">
        {([ ["list", carried.openKeys.size > 0 ? `Findings, ${carried.openKeys.size} to check` : "Findings"], ["text", "Document"], ["details", "Details"] ] as const).map(([pane, label]) => (
          <button key={pane} type="button" aria-pressed={mobilePane === pane}
            onClick={() => { setMobilePane(pane); revealWorkspace(); }}>{label}</button>
        ))}
      </nav>
      {/* Main Workspace Layout */}
      <div className={`app-layout mobile-pane-${mobilePane}${treeWalk && !treeCollapsed ? " tree-open" : ""}`}
        style={{ "--sidebar-width": `${sidebarWidth.width}px` } as CSSProperties}>
        {/* Left: Sidebar (Annotations & Review Targets) */}
        <aside className="sidebar density-compact" id="findings-column">
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
            {isReviewLike(view.key.mode) && (
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
                          {defaultedKeys.has(refKey(t)) && <StatusBadge tone="warning">Defaults to confirm</StatusBadge>}
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
                                    size="sm"
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
                        {entryAuthorOf(t.annotation_id) && <div className="doc-meta">{entryAuthorOf(t.annotation_id)}</div>}
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
                  {view.layers?.find(l => l.layer_id === s.annotation.layer_id)?.label}, Read-only{" "}
                  <AiBadge provenance={s.annotation.provenance} source={s} />
                </span>
              </button>)}
            </section>}

            <div className="sidebar-section">
              <div className="sidebar-header sidebar-header--actions">
                <span>Findings ({visibleAnnotations.length})</span>
                <Button
                  type="button"
                  size="sm"
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
                {carriedListOrder.map(listKey => {
                  if (listKey.startsWith("input:")) {
                    const state = carried.placeholders.find(value => `input:${value.input.input_id}` === listKey);
                    if (!state) return null;
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
                  }
                  const annSnap = visibleAnnotationById.get(listKey.slice("annotation:".length));
                  if (!annSnap) return null;
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
                      documentText={view.document.text}
                      convertSource={attachActive && convertSourceId === annSnap.annotation.annotation_id}
                      attachTarget={attachActive && attachModifier && attachTargetIds.has(annSnap.annotation.annotation_id) ? {
                        term: attachModifier.termLabel, active: attachFocusId === annSnap.annotation.annotation_id, onMove: moveAttachFocus,
                      } : undefined}
                      onFrame={on => {
                        const id = annSnap.annotation.annotation_id;
                        setHoverFrameId(current => on ? id : current === id ? null : current);
                      }}
                      onActivate={() => {
                        if (attachActive && attachTargetIds.has(annSnap.annotation.annotation_id)) {
                          void attachTo(annSnap.annotation.annotation_id);
                          return;
                        }
                        if (attachActive && convertSourceId === annSnap.annotation.annotation_id) return;
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

          {versionContext?.assignmentId !== undefined ? <MySubmissions assignmentId={versionContext.assignmentId} projectKey={view.key.project_key}
            currentRound={view.key.round_id && roundOrdinal ? { roundId: view.key.round_id, ordinal: roundOrdinal } : undefined}
            documentId={view.document.document_id} documentText={view.document.text} termLabel={termLabel}
            reloadKey={submissions.at(-1)?.submission_id} />
          : <section className="detail-section submission-history" aria-label="Submission history">
            <h3>Submission history</h3>
            {submissions.length === 0 && <p>No previous submissions yet.</p>}
            {submissions.map((submission, index) => <Button type="button" variant="secondary" size="sm"
              key={submission.submission_id} onClick={() => setHistorySubmission(submission)}>
              {submissionHistoryLabel(submission.created_at, index + 1)}
            </Button>)}
          </section>}

        </aside>
        <SidebarResizer width={sidebarWidth.width} limits={sidebarWidth.limits} controls="findings-column"
          onChange={sidebarWidth.setWidth} onReset={sidebarWidth.reset} onCommit={sidebarWidth.commit} />

        {/* Center: Text View */}
        <TextPane
          header={versionControls}
          onTextElement={setLeftTextElement}
          contextSegments={reanchorContext.contextSegments}
          text={view.document.text}
          mentions={textMentions}
          isAttachingMention={attachActive || !!linkSpan || isAttachingMention || !!activeReanchor || !!activeCarried || (!!pendingEvidenceAdoption && !confirmRequest)}
          attachMessage={attachActive && attachModifier ? attachCopy.banner(attachModifier.termLabel)
            : linkSpan ? `Select the text for ${linkSpan.term}, then press Enter. Esc cancels.`
            : activeCarried ? `Select supporting text to re-create ${carriedTermText(activeCarried.source_snapshot)}.` : activeReanchor ? `Select supporting text to re-create ${activeReanchor.term_id}. Save the finding, review its values, then complete the text-change review.` : pendingEvidenceAdoption ? "Select supporting text to create an editable copy of this proposal. The current decision is kept until you confirm the replacement." : undefined}
          intentMessage={intentMessage}
          // TextPane owns Esc while a banner is shown (window capture): each mode cancels through its own handler.
          onCancelAttach={attachActive ? cancelAttachModifier : linkSpan ? cancelLinkSpan : cancelAttach}
          framedIds={framedIds}
          onHoverMentions={handleHoverMentions}
          selectedEvidenceId={selectedEvidenceId}
          selectionIntent={selectionIntent}
          onSelection={handleSelection}
          onPick={handlePickMention}
          onChangeIntent={intent => { if (!readOnlyRef.current) setSelectionIntent(intent); }}
          readOnly={readOnly}
          resizableEvidenceIds={resizableEvidenceIds}
          resizableLabels={resizableLabels}
          flushResizeRef={flushTextResize}
          onResizeMention={(evidenceId, segments) => { void handleResizeMention(evidenceId, segments); }}
          resyncToken={textResyncToken}
          scrollRequest={textScrollRequest}
        />
        {/* Attach mode: the banner owns the instruction and Cancel; Esc still cancels and discards. */}
        {!panesLayout && !attachActive && pendingIsMarkedSpan && !readOnly && pendingAnnotation?.evidenceId && (
          <PendingMarkBar textElement={leftTextElement} evidenceId={pendingAnnotation.evidenceId}
            segmentsKey={JSON.stringify(pendingAnnotation.segments)} onDiscard={discardPending} />
        )}
        {panesLayout && !attachActive && pendingIsMarkedSpan && !readOnly && mobilePane === "text" && (
          <div className="pending-bar" role="group" aria-label="New finding">
            <span className="pending-bar__text">New finding “{quoteSegments(view.document.text, pendingAnnotation!.segments, 40)}”</span>
            <Button type="button" variant="primary" size="sm" onClick={chooseTerm}>Choose term</Button>
            <Button type="button" variant="secondary" size="sm" onClick={discardPending}>Discard</Button>
          </div>
        )}

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
                <p>{view.layers?.find(l => l.layer_id === selectedSource.annotation.layer_id)?.label}, Read-only</p>
                <p>
                  <AiBadge provenance={selectedSource.annotation.provenance} source={selectedSource} />{" "}
                  {selectedSource.annotation.provenance.actor.actor_id}, {selectedSource.annotation.provenance.method}
                </p>
                {Object.entries(selectedSource.annotation.axes_values ?? {}).map(([axis, value]) => <p key={axis}>{axis}: {value ?? "Not specified"}</p>)}
                <h3>Mentions ({selectedSource.evidence.length})</h3>
                {selectedSource.evidence.map(ev => <p key={ev.version}>
                  {ev.mention.segments.map(seg => Array.from(view.document.text).slice(seg.start, seg.end).join("")).join(" … ")}
                </p>)}
              </div>
            </section>
          ) : attachModifier && (attachModifier.mode === "convert" ? !readOnly : pendingAnnotation) ? (
            <AttachModePanel termLabel={attachModifier.termLabel} termId={attachModifier.termId}
              markQuote={attachSegments.length ? quoteSegments(view.document.text, attachSegments, 40) : null}
              note={attachModifier.mode === "convert"
                ? <p>{attachCopy.convertNote(attachModifier.termLabel, attachSegments.length ? quoteSegments(view.document.text, attachSegments, 40) : null)}</p>
                : undefined}
              nearest={attachNearest} focused={attachTargets.find(target => target.annotationId === attachReplaceId) ?? null}
              existing={annotationId => {
                const modifier = draft.annotations?.find(a => a.annotation.annotation_id === annotationId)?.annotation.modifiers
                  ?.find(m => m.term_id === attachModifier.termId);
                return modifier ? { segmentsQuote: modifier.segments?.length ? quoteOf(view.document.text, modifier.segments) : null } : undefined;
              }}
              noFindings={attachTargets.length === 0}
              showCancel={panesLayout}
              onAttach={annotationId => { void attachTo(annotationId); }}
              onReplace={annotationId => { void attachTo(annotationId, true); }}
              onCancel={attachActive || attachModifier.mode === "convert" ? cancelAttachModifier : discardPending} />
          ) : pendingAnnotation ? (
            <section className="detail-pane" aria-label="New finding">
              <div className="detail-section">
                <div className="term-heading-row">
                  <h2>
                    {pendingAnnotation.carriedInput ? "Re-create carried finding" : pendingAnnotation.reanchorItem ? "Re-create finding on corrected text" : pendingAnnotation.isSpanless
                      ? "New finding without a text span"
                      : "New finding"}
                  </h2>
                  {pendingIsMarkedSpan && <Button type="button" size="sm" aria-keyshortcuts="Escape" onClick={discardPending}>
                    Discard<span aria-hidden="true"> <Kbd>Esc</Kbd></span>
                  </Button>}
                </div>
                {pendingIsMarkedSpan
                  ? <>
                    <p className="pending-quote">“{quoteSegments(view.document.text, pendingAnnotation.segments)}”</p>
                    <p className="form-hint">Adjust the marked text with its edge handles, or mark new text to replace it.</p>
                  </>
                  : <p>
                    {pendingAnnotation.carriedInput ? "Save this finding with the original term and values. Then check it and mark it as checked." : pendingAnnotation.reanchorItem ? "Save this finding, check its evidence and values, then complete the text-change review." : "Select a term from the ontology for the new finding."}
                  </p>}
                {pendingAnnotation.reanchorItem && <>
                  <p><TermName termId={savedPendingReanchor?.annotation.term_id ?? pendingAnnotation.reanchorItem.term_id} label={termLabel(pendingAnnotation.layerId,savedPendingReanchor?.annotation.term_id ?? pendingAnnotation.reanchorItem.term_id)} />, {pendingAnnotation.layerId}</p>
                  <p>Finding type: {view.layers?.find(layer=>layer.layer_id===pendingAnnotation.layerId)?.annotation_types.find(type=>type.type_id===pendingAnnotation.typeId)?.label ?? pendingAnnotation.typeId}</p>
                  {!savedPendingReanchor && pendingAnnotation.reanchorItem.axes_values && <p>Original clinical context: {Object.entries(pendingAnnotation.reanchorItem.axes_values).map(([axis, value]) => `${axis}: ${value ?? "Not specified"}${pendingAnnotation.reanchorItem!.axes_defaulted?.includes(axis) ? " (defaulted)" : ""}`).join(", ")}. These values will be carried over; you can edit them after saving.</p>}
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
                  {...pendingSearchProps(pendingAnnotation)}
                  onPickModifier={pendingIsMarkedSpan && modifierLayerIds.has(pendingAnnotation.layerId) ? startAttach : undefined}
                  onSelectCandidate={(candidate, searchId) => {
                    if (pendingAnnotation.selectedTerm) setPendingAnnotation({ ...pendingAnnotation, selectedTerm: { termId: candidate.term_id, searchId } });
                    else void createPendingAnnotation(candidate.term_id, searchId, candidate.label ?? undefined);
                  }} />}
                {!pendingIsMarkedSpan && <Button type="button" variant="secondary" disabled={queueState === "saving"} onClick={cancelPending}>Cancel</Button>}
              </div>
            </section>
          ) : selectedInputState ? (() => {
            const state = selectedInputState, source = state.input.source_snapshot;
            const sourceNote = source.annotation.note?.trim();
            return <div className="detail-pane">
              <ExceptionPanel key={state.input.input_id} state={state}
                origin={carriedOriginLine(state.input)} recordedAt={state.input.source_draft_snapshot_id != null ? null : state.input.source_recorded_at}
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
                onRetry={() => carried.retry(state.input.input_id)}
                onSaveNote={async () => {
                  await flushAnnotationNotes();
                  if (!unsavedAnnotationNotes().length) carried.clearError(state.input.input_id);
                }} />
            </div>;
          })() : isReviewLike(view.key.mode) && selectedTarget ? (
            <ReviewActions
              source={targetSnapshot}
              readOnly={readOnly}
              key={refKey(selectedTarget)}
              target={selectedTarget}
              termLabel={termLabel(selectedTarget.layer_id, selectedTarget.term_id ?? selectedTarget.annotation_id)}
              resolveTermLabel={termLabel}
              termInfo={termId => selectedTarget.layer_id ? termLabel.info(selectedTarget.layer_id, termId) : undefined}
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
            {panesLayout && !readOnly && selectedAnnotation && selectedAnnotationId === loopAnnotationId && (
              <Button type="button" variant="secondary" size="sm" className="back-to-text" data-back-to-text onClick={backToText}>
                Back to text
              </Button>
            )}
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
              modifierNotice={selectedAnnotation && isModifierTerm(selectedAnnotation) ? <ModifierAsFindingNotice
                term={findingNameOf(selectedAnnotation)} readOnly={readOnly || !editableLayerIds.includes(selectedAnnotation.annotation.layer_id)}
                onTurn={() => startConvert(selectedAnnotation)} /> : undefined}
              modifiersSection={selectedAnnotation && modifierLayerIds.has(selectedAnnotation.annotation.layer_id) ? (() => {
                const ann = selectedAnnotation.annotation, id = ann.annotation_id, finding = findingNameOf(selectedAnnotation);
                const label = (termId: string) => termLabel.info(ann.layer_id, termId)?.label ?? termId;
                return <ModifiersSection finding={finding} modifiers={ann.modifiers ?? []} text={view.document.text}
                  termInfo={infoFor(ann.layer_id)} readOnly={readOnly || !editableLayerIds.includes(ann.layer_id)}
                  onAdd={termId => modifierCommands.add(id, termId)}
                  onLinkSpan={termId => startLinkSpan(id, termId)}
                  onRemoveSpan={termId => { void modifierCommands.removeSpan(id, termId, label(termId)).catch(() => undefined); }}
                  onRemove={termId => {
                    void modifierCommands.remove(id, termId, label(termId), finding).then(
                      // The chip is gone: focus stays in the section.
                      () => inspectorRef.current?.querySelector<HTMLElement>("[data-modifiers-section] .mod-add")?.focus({ preventScroll: true }),
                      () => undefined);
                  }}
                  searchProps={{ searchManager: modifierSearchManager, annotationId: id, workspaceKey: view.key, layerId: ann.layer_id,
                    languages: searchLanguagesFor(ann.layer_id) }} />;
              })() : undefined}
              termLabel={selectedAnnotation ? termLabel(selectedAnnotation.annotation.layer_id, selectedAnnotation.annotation.term_id) : null}
              axesConfig={currentAxesConfig}
              noteValue={selectedAnnotation ? annotationNoteDrafts[selectedAnnotation.annotation.annotation_id] ?? selectedAnnotation.annotation.note ?? "" : ""}
              noteRequired={spanlessNotesRequired && !!selectedAnnotation && !selectedAnnotation.annotation.evidence_refs?.length}
              noteHint={!selectedAnnotation?.annotation.evidence_refs?.length ? legacySubmissionHint : undefined}
              onChangeNote={note => { if (selectedAnnotationId) { annotationNoteDraftsRef.current = { ...annotationNoteDraftsRef.current, [selectedAnnotationId]: note }; setAnnotationNoteDrafts(annotationNoteDraftsRef.current); } }}
              onSaveNote={() => { if (selectedAnnotationId) void saveAnnotationNote(selectedAnnotationId).catch(reportError); }}
              detachLastBlockedReason={selectedAnnotation && view.enforce_spanless_rules ? (!view.allow_spanless_findings ? "This project requires a text span for findings." :
                view.layers?.find(l => l.layer_id === selectedAnnotation.annotation.layer_id)?.annotation_types.find(t => t.type_id === selectedAnnotation.annotation.type_id)?.evidence_policy === "required_on_complete" ? "This annotation type requires a text span." :
                spanlessNotesRequired && !(selectedAnnotation.annotation.note ?? "").trim() ? "Enter a reason in the note before removing the last mention." : undefined) : undefined}
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
              onUpdateAxes={(axesValues) => handleUpdateAxes(axesValues, undefined, selectedAnnotationId)
                .catch(error => { reportError(error); throw error; })}
              axesFlushRef={pendingAxesFlush}
              onConfirmDefaults={(axisIds, values, options) => handleConfirmDefaults(axisIds, values, options)}
              valuesError={valuesError && valuesError.annotationId === selectedAnnotationId ? valuesError.message : null}
              searchRequest={changeTermRequest}
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
      </div>

      </>}
      {comparison}
      </div>
      {originalRoundInput && <RoundInputEvidenceDialog projectKey={view.key.project_key} input={originalRoundInput} onClose={() => setOriginalRoundInput(null)} labelFor={termLabel}
        sourceName={originalRoundInput.source_round_ordinal ? roundName(originalRoundInput.source_round_ordinal) : undefined} />}
      {historySubmission && <HistoricalSubmissionDialog view={fromSubmission(historySubmission,
        // Assignment editors name the submission by its round, as My submissions does.
        versionContext?.assignmentId !== undefined && roundOrdinal ? `Round ${roundOrdinal}, ${formatTime(historySubmission.created_at)}`
          : submissionHistoryLabel(historySubmission.created_at, submissions.findIndex(s => s.submission_id === historySubmission.submission_id) + 1))}
        documentText={view.document.text} currentDocumentId={view.document.document_id} projectKey={view.key.project_key}
        termLabel={termLabel} onClose={() => setHistorySubmission(null)} />}

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
        reviewMode={isReviewLike(view.key.mode)}
        resultCount={completionResults.length}
        confirmedCount={confirmedCount}
        unresolvedDecisionCount={(draft.decisions ?? []).filter(d => d.outcome === "uncertain").length}
        savedFindingsCount={(draft.annotations ?? []).length}
        reviewTargetCount={reviewTargets.length}
        openReviewTargetCount={openReviewTargets.length}
        pendingReanchorCount={pendingReanchorItems.length}
        unresolvedReanchorCount={unresolvedReanchorCount}
        items={openItems}
        unconfirmed={unconfirmed}
        requireChosenAxes={view.require_chosen_axes === true}
        confirmUnavailableReason={confirmUnavailableReason}
        onConfirmValues={confirmUnconfirmedRow}
        acknowledged={axisWarningAcknowledged}
        setAcknowledged={setAcknowledged}
        submitStatus={submitStatus}
        textChecked={textCheckedConfirmed}
        saving={queueState === "saving"}
        readOnly={readOnly}
        setTextChecked={setTextCheckedConfirmed}
        onGoTo={goToOpenItem}
        onGoToRow={goToRow}
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
