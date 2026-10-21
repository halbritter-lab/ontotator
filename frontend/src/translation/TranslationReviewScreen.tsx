import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { api, ApiError, type ReviewWorkspace, type TaskSummary, type TranslationReviewRecord, type SourceObligationView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { nextOpenTask } from "../app/caseOrder";
import { MY_TASKS, routeHref, type Route, type RouteLeaveGuard } from "../app/router";
import { Button, Checkbox, ConfirmDialog, Dialog, EmptyState, IconRetry, InlineMessage, Kbd, StatusBadge, useMediaQuery, type StatusTone } from "../ui";
import { useShortcut } from "../ui/shortcuts";
import { caretInParagraph, paragraphStarts } from "../variants/paragraphs";
import { useCoupledScroll } from "../variants/useCoupledScroll";
import { createDraftSaver, type DraftSaver } from "./draftSaver";
import { DiffView, TextView } from "./DiffView";
import { TranslationEditor } from "./TranslationEditor";
import { SourceObligationReview } from './SourceObligationReview';
import { notifyFinalSelectionChanged } from '../variants/finalSelectionState';
import { ChecksSummary, ReviewSummary, SubmitSummary } from "./ReviewParts";
import { ReviewForm } from "./ReviewForm";
import { autoNoteText, chooseDecision, reactToTextEdit, USER_ORIGIN, type DecisionState } from "./decisionOrigin";
import { categoryLabels, comparisonCountsDiffer, couplingEditingNote, couplingNote, decisionKeyHint, decisionLabels, decisionOutcomes, formatReviewDate, issueMessages, languageName, leadCorrectionKeyHint, leadCorrectionNote, matchingParagraphStatus, nextTaskLabel, paragraphCountChanged, paragraphCountsDiffer, remainingTasksText, reviewIssueMessage, showMatchingLabel, showMatchingShortcut, showMatchingTitle } from "./labels";
import { checkReview, type ClinicalCategory, type ReviewDecisionCode, type ReviewForm as FormValue } from "./reviewRules";

export interface TranslationReviewScreenProps {
  assignmentId: number; username: string; onNavigate: (route: Route) => void;
  routeLeaveRef: MutableRefObject<RouteLeaveGuard | null>;
  leaveGuardRef: MutableRefObject<((proceed: () => void) => void) | null>;
  reportActions?: ReactNode;
  /** The guidelines toolbar button; shown in every mode, also where `reportActions` is hidden (lead correction). */
  guidelineActions?: ReactNode;
  /** The guidelines update notice, shown above the review bar. */
  guidelineNotice?: ReactNode;
  held?: boolean;
  holdReason?: string | null;
  saveBeforeReportRef?: MutableRefObject<(() => Promise<void>) | null>;
}
type RawDraft = { text: string; form: Record<string, unknown> };
/** The reviewer's next open task after submitting (spec A.5). */
type NextTask = { kind: "loading" } | { kind: "ready"; next: TaskSummary | null; remaining: number } | { kind: "error"; error: unknown };
const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const decision = (value: unknown): value is ReviewDecisionCode => typeof value === "string" && has(decisionLabels, value);
const category = (value: unknown): value is ClinicalCategory => typeof value === "string" && has(categoryLabels, value);
const nonblank = (value: string | null) => value !== null && /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(value);
function visualForm(raw: Record<string, unknown>): Partial<FormValue> {
  return { ...(decision(raw.decision) ? { decision: raw.decision } : {}),
    ...(typeof raw.clinical_change === "boolean" ? { clinical_change: raw.clinical_change } : {}),
    ...(Array.isArray(raw.categories) && raw.categories.every(category) ? { categories: raw.categories } : {}),
    ...(typeof raw.rationale === "string" || raw.rationale === null ? { rationale: raw.rationale } : {}) };
}
function typedForm(raw: Record<string, unknown>): FormValue | null {
  if (!decision(raw.decision) || (raw.clinical_change !== undefined && typeof raw.clinical_change !== "boolean")
    || (raw.categories !== undefined && (!Array.isArray(raw.categories) || !raw.categories.every(category)))
    || (raw.rationale !== undefined && raw.rationale !== null && typeof raw.rationale !== "string")) return null;
  return { ...visualForm(raw), decision: raw.decision, clinical_change: raw.clinical_change === true };
}
/** The backend form needs clinical_change; a chosen decision without it gets the unticked default. */
const withClinicalDefault = (form: Record<string, unknown>): Record<string, unknown> =>
  decision(form.decision) && !has(form, "clinical_change") ? { ...form, clinical_change: false } : form;
/** Query and Rejected always imply a clinical change; older drafts may lack it. */
const lacksImpliedClinical = (form: Record<string, unknown>): boolean =>
  (form.decision === "query" || form.decision === "rejected") && form.clinical_change !== true;
const decisionKeys: readonly ReviewDecisionCode[] = ["accepted_unchanged", "accepted_corrected", "query", "rejected"];
/** A lead correction (spec F1, FD4) is submitted only as Accepted with corrections. */
const leadDecisions: readonly ReviewDecisionCode[] = ["accepted_corrected"];
const recordForm = (record: TranslationReviewRecord): Record<string, unknown> => ({ decision: record.decision, clinical_change: record.clinical_change, categories: record.categories, rationale: record.rationale });

const paragraphMarkers = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>("[data-paragraph]")];
const paneTop = (element: HTMLElement) => element.getBoundingClientRect().top + element.clientTop;
/** Index of the last paragraph marker at or above a viewport y; the first paragraph when none is. */
function paragraphAbove(element: HTMLElement, y: number): number {
  let paragraph = 0;
  for (const marker of paragraphMarkers(element)) {
    const index = Number(marker.dataset.paragraph);
    if (Number.isInteger(index) && marker.getBoundingClientRect().top <= y) paragraph = index;
  }
  return paragraph;
}

export function TranslationReviewScreen(props: TranslationReviewScreenProps): JSX.Element {
  const [loaded, setLoaded] = useState<{ workspace: ReviewWorkspace; generation: number } | null>(null);
  const [error, setError] = useState<unknown>(null), [retry, setRetry] = useState(0);
  const identity = JSON.stringify([props.username, props.assignmentId, retry]);
  const [readyIdentity, setReadyIdentity] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setError(null); setReadyIdentity(null);
    api.openTranslationReview(props.assignmentId).then(workspace => {
      if (active) { setLoaded({ workspace, generation: retry }); setReadyIdentity(identity); }
    }, failure => { if (active) { setError(failure); setReadyIdentity(identity); } });
    return () => { active = false; };
  }, [identity]);
  if (readyIdentity !== identity) return <InlineMessage tone="info">Opening translation review...</InlineMessage>;
  if (error || !loaded) return <section><h1>Translation review</h1>
    {error instanceof ApiError && error.code === "ASSIGNMENT_NOT_FOUND" ? <EmptyState title="This task is no longer assigned to you." /> : <ErrorNotice error={error} />}
    <Button onClick={() => setRetry(n => n + 1)}>Retry</Button><Button onClick={() => props.onNavigate(MY_TASKS)}>Back to my tasks</Button></section>;
  return <ReviewEditor key={identity} {...props} workspace={loaded.workspace} onReload={() => setRetry(n => n + 1)} />;
}

function ReviewEditor({ workspace, onReload, ...props }: TranslationReviewScreenProps & { workspace: ReviewWorkspace; onReload: () => void }): JSX.Element {
  const immutableReadOnly = workspace.read_only && (!workspace.assignment.held || workspace.assignment.status === "submitted" || workspace.submitted_record !== null);
  const held = props.held ?? workspace.assignment.held;
  const leadCorrection = workspace.lead_correction;
  const editable = !immutableReadOnly && !held;
  // A stored Query/Rejected draft without the implied clinical change is normalised once on open (and saved).
  // A lead correction preselects Accepted with corrections; a stored other decision is replaced and saved.
  const [normaliseOnOpen] = useState(() => editable && (leadCorrection
    ? decision(workspace.draft.form.decision) && workspace.draft.form.decision !== "accepted_corrected"
    : lacksImpliedClinical(workspace.draft.form)));
  const [draft, setDraft] = useState<RawDraft>(() => {
    const form = structuredClone(workspace.draft.form);
    if (editable && leadCorrection && form.decision !== "accepted_corrected")
      return { text: workspace.draft.text, form: withClinicalDefault(chooseDecision(form, "accepted_corrected")) };
    return { text: workspace.draft.text, form: normaliseOnOpen && decision(form.decision) ? chooseDecision(form, form.decision) : form };
  });
  /** Client-side origin of the decision (spec A.4); a stored decision counts as the user's. */
  const [decisionState, setDecisionState] = useState<DecisionState>(USER_ORIGIN);
  const decisionStateRef = useRef(decisionState); decisionStateRef.current = decisionState;
  const draftRef = useRef(draft); draftRef.current = draft;
  const saver = useRef<DraftSaver<RawDraft> | null>(null);
  const alive = useRef(false), operation = useRef(false), departing = useRef(false), readOnlyRef = useRef(workspace.read_only);
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [qualification, setQualification] = useState(workspace.qualification);
  const [submitted, setSubmitted] = useState<TranslationReviewRecord | null>(null);
  const [createdVersion, setCreatedVersion] = useState<number | null>(null);
  const [nextTask, setNextTask] = useState<NextTask | null>(null), [nextTaskLoad, setNextTaskLoad] = useState(0);
  const nextTaskButton = useRef<HTMLButtonElement | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [showChanges, setShowChanges] = useState(false), [confirming, setConfirming] = useState(false);
  const decisionHeading = useRef<HTMLHeadingElement | null>(null), submitReason = useRef<HTMLDivElement | null>(null);
  const screenRoot = useRef<HTMLElement | null>(null), submitControl = useRef<HTMLButtonElement | null>(null);
  const detailsRef = useRef<HTMLDetailsElement | null>(null), detailsSummary = useRef<HTMLElement | null>(null);
  /** Submit or its reason when one of them was the last focused element; restored when crossing 1100 px. */
  const focusedControl = useRef<"submit" | "reason" | null>(null);
  const [comparisonId, setComparisonId] = useState(workspace.comparisons[0]?.variant.document_id ?? "");
  const [sourceElement, setSourceElement] = useState<HTMLDivElement | null>(null), [targetElement, setTargetElement] = useState<HTMLDivElement | null>(null), [comparisonElement, setComparisonElement] = useState<HTMLDivElement | null>(null);
  const record = submitted ?? (immutableReadOnly ? workspace.submitted_record : null);
  const readOnly = immutableReadOnly || submitted !== null || held; readOnlyRef.current = readOnly;
  const text = record?.proposed_text ?? draft.text, rawForm = record ? recordForm(record) : draft.form;
  const form = typedForm(rawForm), issues = form ? checkReview(form, workspace.text, text) : [];
  const comparison = workspace.comparisons.find(row => row.variant.document_id === comparisonId);
  /** The editable translation is shown: it is the fixed leader and its pairing waits for a recompute (spec 2.2, 2.3). */
  const editing = !readOnly && !showChanges;
  const sourceStarts = useMemo(() => paragraphStarts(workspace.source.text), [workspace.source.text]);
  const comparisonStarts = useMemo(() => paragraphStarts(comparison?.text ?? ""), [comparison?.text]);
  /** Translation starts lag the text while editing: 300 ms after the last edit, at once on blur, never during composition. */
  const [targetStarts, setTargetStarts] = useState(() => paragraphStarts(text));
  const [startsRevision, setStartsRevision] = useState(0);
  /** Paragraph count of the text loaded with the workspace; a count changed by edits is announced in the notes. */
  const [loadedCount] = useState(() => targetStarts.length);
  // The hook reads starts through getters, so a recompute bumps the revision instead of rebinding the panes.
  const startsRef = useRef({ source: sourceStarts, target: targetStarts, comparison: comparisonStarts });
  startsRef.current.source = sourceStarts; startsRef.current.comparison = comparisonStarts;
  const textRef = useRef(text); textRef.current = text;
  const startsText = useRef(text), startsTimer = useRef<number | undefined>(undefined), composing = useRef(false);
  /** Applies a pending recompute at once; true when the starts changed (a new revision follows). */
  const commitStarts = () => {
    window.clearTimeout(startsTimer.current); startsTimer.current = undefined;
    if (startsText.current === textRef.current) return false;
    startsText.current = textRef.current;
    const next = paragraphStarts(textRef.current);
    startsRef.current.target = next; setTargetStarts(next); setStartsRevision(revision => revision + 1);
    return true;
  };
  const scheduleStarts = () => { window.clearTimeout(startsTimer.current); startsTimer.current = window.setTimeout(commitStarts, 300); };
  // A layout effect, so the starts are current before the hook binds to a newly shown surface.
  useLayoutEffect(() => {
    if (!editing) commitStarts();
    else if (!composing.current && startsText.current !== text) scheduleStarts();
  }, [text, editing]);
  useEffect(() => () => window.clearTimeout(startsTimer.current), []);
  const couplingIdentity = useMemo(() => ({}), [workspace, comparisonId, readOnly]);
  const [requestedCoupling, setRequestedCoupling] = useState<object | null>(null);
  const couplingRequested = requestedCoupling === couplingIdentity;
  const panes = useMemo(() => [
    { id: 'source', element: sourceElement, starts: () => startsRef.current.source },
    { id: 'target', element: targetElement, starts: () => startsRef.current.target },
    { id: 'comparison', element: comparison ? comparisonElement : null, starts: () => startsRef.current.comparison },
  ], [sourceElement, targetElement, comparisonElement, comparison]);
  const pairing = useCoupledScroll(panes, { enabled: couplingRequested, minWidth: 700, startsRevision,
    fixedLeader: editing ? "target" : undefined, frozenPaneId: editing ? "target" : undefined });
  const coupled = couplingRequested && pairing.available;
  /** The pair line follows only once scrolling rests, so it does not chatter; never on a recompute or align (spec 2.7). */
  const [restingPairs, setRestingPairs] = useState(pairing.pairs);
  const restTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (pairing.origin === "refresh" || pairing.origin === "align") return;
    const pairs = pairing.pairs;
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => setRestingPairs(pairs), 150);
  }, [pairing.pairs, pairing.origin]);
  useEffect(() => () => window.clearTimeout(restTimer.current), []);
  /** "Show matching paragraph" (spec 2.4): the anchor sources and the one polite status of its result. */
  const paneElements = useRef<Record<string, HTMLElement | null>>({});
  paneElements.current = { source: sourceElement, target: targetElement, comparison: comparison ? comparisonElement : null };
  const lastPointer = useRef<{ paneId: string; paragraph: number } | null>(null), lastPane = useRef("target");
  const matchButton = useRef<HTMLButtonElement | null>(null), caretFocus = useRef(false);
  const pendingMatch = useRef<{ paneId: string; paragraph: number; fraction?: number } | null>(null);
  const [matchStatus, setMatchStatus] = useState("");
  /** A repeated identical result is cleared first and set again on the next frame, so it is announced again. */
  const matchStatusText = useRef(""), matchStatusFrame = useRef<number | undefined>(undefined);
  const announceMatch = (next: string) => {
    if (matchStatusFrame.current !== undefined) window.cancelAnimationFrame(matchStatusFrame.current);
    matchStatusFrame.current = undefined;
    const repeated = next === matchStatusText.current;
    matchStatusText.current = next;
    if (!repeated) { setMatchStatus(next); return; }
    setMatchStatus("");
    matchStatusFrame.current = window.requestAnimationFrame(() => { matchStatusFrame.current = undefined; setMatchStatus(next); });
  };
  useEffect(() => () => { if (matchStatusFrame.current !== undefined) window.cancelAnimationFrame(matchStatusFrame.current); }, []);
  useEffect(() => {
    const removals: (() => void)[] = [];
    const listen = (element: EventTarget, type: string, listener: (event: Event) => void) => {
      element.addEventListener(type, listener, { passive: true }); removals.push(() => element.removeEventListener(type, listener));
    };
    for (const [paneId, element] of Object.entries(paneElements.current)) {
      if (!element) continue;
      const touched = () => { lastPane.current = paneId; };
      for (const type of ["focusin", "wheel", "touchstart", "keydown"]) listen(element, type, touched);
      listen(element, "pointerdown", event => {
        touched();
        // A press on the scrollport itself (scrollbar, padding) scrolls; only a press into the text is a click on a paragraph.
        const y = (event as MouseEvent).clientY;
        if (event.target !== element && Number.isFinite(y)) lastPointer.current = { paneId, paragraph: paragraphAbove(element, y) };
      });
    }
    // The button keeps the caret anchor when it is reached from the textarea with the keyboard.
    listen(document, "focusin", event => {
      if (event.target !== matchButton.current) caretFocus.current = event.target instanceof HTMLTextAreaElement && event.target.id === "review-translation";
    });
    return () => removals.forEach(remove => remove());
  }, [sourceElement, targetElement, comparisonElement, comparison]);
  const runMatch = (anchor: { paneId: string; paragraph: number; fraction?: number }) => {
    const elements = paneElements.current, anchorElement = elements[anchor.paneId];
    if (!anchorElement) return;
    const order = anchor.paneId === "target" ? ["source", "comparison"] : anchor.paneId === "source" ? ["target", "comparison"] : ["target", "source"];
    const targets = order.filter(id => elements[id]);
    const marker = paragraphMarkers(anchorElement).find(row => Number(row.dataset.paragraph) === anchor.paragraph);
    const anchorOffset = marker ? marker.getBoundingClientRect().top - paneTop(anchorElement) : 0;
    // In a long paragraph whose top is scrolled away, the caret line (else the top line) is matched, not the tops.
    const result = pairing.align({ anchor: { paneId: anchor.paneId, paragraph: anchor.paragraph }, targets, anchorOffset, topInset: 12, anchorFraction: anchor.fraction });
    // Below 700 px the texts stack: the target scrolled internally is also brought into view; focus and caret stay.
    if (!pairing.available && targets[0]) elements[targets[0]]?.scrollIntoView?.({ block: "nearest" });
    const shown = result.pairs.filter(pair => pair.paneId !== anchor.paneId);
    if (shown.length) announceMatch(matchingParagraphStatus(anchor, shown, result.estimate));
  };
  const showMatching = () => {
    const elements = paneElements.current, active = document.activeElement;
    const textarea = elements.target?.querySelector("textarea") ?? null;
    let anchor: { paneId: string; paragraph: number; fraction?: number };
    if (textarea && (active === textarea || (active === matchButton.current && caretFocus.current))) {
      // Rule 1: the caret's paragraph, in code points, with freshly computed starts.
      const offset = Array.from(textarea.value.slice(0, textarea.selectionStart ?? 0)).length;
      anchor = { paneId: "target", ...caretInParagraph(textarea.value, offset) };
    } else if (lastPointer.current && elements[lastPointer.current.paneId]) {
      anchor = lastPointer.current;
    } else {
      const paneId = elements[lastPane.current] ? lastPane.current : "target", element = elements[paneId];
      if (!element) return;
      anchor = { paneId, paragraph: paragraphAbove(element, paneTop(element) + 1) };
    }
    // A pending recompute is applied first; the hook re-reads the geometry with the new revision before aligning.
    if (commitStarts()) pendingMatch.current = anchor;
    else runMatch(anchor);
  };
  useEffect(() => {
    const anchor = pendingMatch.current;
    pendingMatch.current = null;
    if (anchor) runMatch(anchor);
  }, [startsRevision]);
  /** At least 1100 px: decision in a pinned rail; narrower: decision follows the texts and a bar pins Submit. */
  const wide = useMediaQuery("(min-width: 1100px)");
  type Leave = { kind: "leave" | "logout"; resolve?: (allowed: boolean) => void; proceed?: () => void };
  const [leave, setLeave] = useState<Leave | null>(null);
  const pendingLeave = useRef<Leave | null>(null), leavePromise = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    alive.current = true;
    if (!immutableReadOnly) {
      const instance = createDraftSaver<RawDraft>({ initialRevision: workspace.draft.revision,
        save: async (value, expected_revision) => {
          if (!alive.current || readOnlyRef.current) throw new Error("This review is read-only.");
          return (await api.saveTranslationReviewDraft(props.assignmentId, { ...value, expected_revision })).revision;
        }, onStateChange: () => { if (alive.current && saver.current === instance) refresh(n => n + 1); } });
      saver.current = instance;
      if (normaliseOnOpen) instance.update(draftRef.current);
    }
    return () => { alive.current = false; saver.current?.dispose(); saver.current = null; pendingLeave.current?.resolve?.(false); pendingLeave.current = null; };
  }, [workspace, props.assignmentId, props.username]);

  async function flush() {
    const instance = saver.current;
    if (instance) { await instance.flush(); if (instance.hasUnsavedChanges) throw new Error("Changes are not saved."); }
    return alive.current;
  }
  useEffect(() => {
    if (!props.saveBeforeReportRef) return;
    const save = async () => { await flush(); };
    props.saveBeforeReportRef.current = save;
    return () => { if (props.saveBeforeReportRef?.current === save) props.saveBeforeReportRef.current = null; };
  });
  const closeLeave = (allowed: boolean) => {
    const request = pendingLeave.current; pendingLeave.current = null; setLeave(null); leavePromise.current = null;
    if (allowed) { departing.current = true; readOnlyRef.current = true; operation.current = true; setBusy(true); saver.current?.dispose(); saver.current = null; }
    request?.resolve?.(allowed);
    if (allowed && alive.current) request?.proceed?.();
  };
  const guard = (): Promise<boolean> => {
    if (operation.current) return Promise.resolve(false);
    if (leavePromise.current) return leavePromise.current;
    if (!saver.current?.hasUnsavedChanges) return Promise.resolve(true);
    const promise = (async () => {
      try { return await flush(); } catch (failure) {
        if (!alive.current) return false;
        setError(failure);
        return new Promise<boolean>(resolve => {
          const request: Leave = { kind: "leave", resolve }; pendingLeave.current = request; setLeave(request);
        });
      }
    })();
    leavePromise.current = promise;
    void promise.then(() => { if (leavePromise.current === promise) leavePromise.current = null; });
    return promise;
  };
  const latest = useRef({ guard, logout: (_proceed: () => void) => {} });
  latest.current = { guard, logout: proceed => {
    if (operation.current || pendingLeave.current) return;
    if (!saver.current?.hasUnsavedChanges) { proceed(); return; }
    const request: Leave = { kind: "logout", proceed }; pendingLeave.current = request; setLeave(request);
  } };
  useEffect(() => {
    const routeGuard = () => latest.current.guard();
    const logoutGuard = (proceed: () => void) => latest.current.logout(proceed);
    props.routeLeaveRef.current = routeGuard; props.leaveGuardRef.current = logoutGuard;
    return () => {
      if (props.routeLeaveRef.current === routeGuard) props.routeLeaveRef.current = null;
      if (props.leaveGuardRef.current === logoutGuard) props.leaveGuardRef.current = null;
    };
  }, [props.routeLeaveRef, props.leaveGuardRef]);
  useEffect(() => {
    if (immutableReadOnly) return;
    const warn = (event: BeforeUnloadEvent) => { if (saver.current?.hasUnsavedChanges) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [immutableReadOnly]);
  const edit = (next: RawDraft) => {
    if (readOnlyRef.current || operation.current) return;
    draftRef.current = next; setDraft(next); saver.current?.update(next); setServerIssues([]);
  };
  const retrySave = async () => { try { await flush(); if (alive.current) { setError(null); refresh(n => n + 1); } } catch (failure) { if (alive.current) setError(failure); } };
  const reload = async () => { if (await guard() && alive.current) onReload(); };
  const loadCreated = async (value: TranslationReviewRecord) => {
    if (!value.created_variant_id) return;
    try { const variant = await api.getVariantMetadata(workspace.assignment.project_key, value.created_variant_id); if (alive.current) setCreatedVersion(variant.version); }
    catch (failure) { if (alive.current) setError(failure); }
  };
  /** After a successful submit: a fresh My tasks list, so a task assigned meanwhile counts. */
  const projectKey = workspace.assignment.project_key;
  useEffect(() => {
    if (!submitted || leadCorrection) return;
    let active = true;
    setNextTask({ kind: "loading" });
    api.listMyTasks().then(tasks => {
      if (active) setNextTask({ kind: "ready", ...nextOpenTask(tasks, props.assignmentId, projectKey) });
    }, failure => { if (active) setNextTask({ kind: "error", error: failure }); });
    return () => { active = false; };
  }, [submitted, nextTaskLoad, props.assignmentId, projectKey, leadCorrection]);
  const nextTaskId = nextTask?.kind === "ready" ? nextTask.next?.assignment_id : undefined;
  useEffect(() => { if (nextTaskId !== undefined) nextTaskButton.current?.focus({ preventScroll: true }); }, [nextTaskId]);
  const saveState = saver.current?.state ?? "saved";
  const canSubmit = !readOnly && !busy && form !== null && issues.length === 0 && nonblank(qualification)
    && saveState === "saved" && !saver.current?.hasUnsavedChanges;
  const submit = async (cause?: SourceObligationView): Promise<boolean> => {
    const currentForm = typedForm(draftRef.current.form);
    if (operation.current || readOnlyRef.current || !currentForm || checkReview(currentForm, workspace.text, draftRef.current.text).length || !nonblank(qualification)
      || (cause && !['accepted_unchanged', 'accepted_corrected'].includes(currentForm.decision))) return false;
    operation.current = true; setBusy(true); setError(null); setServerIssues([]);
    try {
      if (!await flush()) return false;
      const revision = saver.current?.revision ?? workspace.draft.revision;
      const value = cause ? await api.resolveSourceObligation(props.assignmentId, cause.cause_id, {
        expected_revision: revision, translation_text_sha256: cause.translation_text_sha256,
        old_source_text_sha256: cause.old_source_text_sha256, new_source_text_sha256: cause.new_source_text_sha256,
      }) : await api.submitTranslationReview(props.assignmentId, revision);
      if (!alive.current) return false;
      readOnlyRef.current = true; saver.current?.dispose(); saver.current = null; setSubmitted(value); setConfirming(false);
      await loadCreated(value);
      notifyFinalSelectionChanged(workspace.assignment.project_key);
      return true;
    } catch (failure) {
      if (!alive.current) return false;
      setError(failure);
      if (failure instanceof ApiError && failure.code === "REVIEW_INVALID" && typeof failure.details === "object" && Array.isArray(failure.details.issues)) setServerIssues(failure.details.issues.filter((value): value is string => typeof value === "string"));
      if (failure instanceof ApiError && failure.code === "QUALIFICATION_REQUIRED") {
        setQualification(null);
        try { const profile = await api.getProfile(); if (alive.current) setQualification(profile.qualification ?? null); } catch { /* Keep the refusal and current input visible. */ }
      }
      return false;
    } finally { if (alive.current) { operation.current = false; setBusy(false); setConfirming(false); } }
  };
  /** Submitting is immutable, so it always goes through a confirmation. */
  const requestSubmit = () => {
    if (canSubmit) setConfirming(true);
    else submitReason.current?.focus();
  };
  const chooseOption = (option: ReviewDecisionCode) => {
    if (readOnlyRef.current || operation.current) return;
    const current = draftRef.current;
    edit({ ...current, form: withClinicalDefault(chooseDecision(current.form, option)) });
    decisionStateRef.current = USER_ORIGIN; setDecisionState(USER_ORIGIN);
  };
  const editText = (nextText: string) => {
    if (readOnlyRef.current || operation.current) return;
    const current = draftRef.current;
    const result = reactToTextEdit(decisionStateRef.current, current.form, workspace.text, nextText);
    // The whole returned form, so undoing an automatic selection can remove the decision again.
    edit({ text: nextText, form: result.form === current.form ? result.form : withClinicalDefault(result.form) });
    decisionStateRef.current = result.state; setDecisionState(result.state);
  };
  const keyOptions = { scope: "screen", group: "Translation review", enabled: !readOnly && !leadCorrection } as const;
  useShortcut("1", () => chooseOption(decisionKeys[0]), { ...keyOptions, description: `Choose ${decisionLabels[decisionKeys[0]]}` });
  useShortcut("2", () => chooseOption(decisionKeys[1]), { ...keyOptions, description: `Choose ${decisionLabels[decisionKeys[1]]}` });
  useShortcut("3", () => chooseOption(decisionKeys[2]), { ...keyOptions, description: `Choose ${decisionLabels[decisionKeys[2]]}` });
  useShortcut("4", () => chooseOption(decisionKeys[3]), { ...keyOptions, description: `Choose ${decisionLabels[decisionKeys[3]]}` });
  useShortcut("Ctrl+Enter", requestSubmit, { scope: "screen", group: "Translation review", description: "Submit review (asks for confirmation)", enabled: !readOnly, allowInInputs: true });
  useShortcut("Alt+M", () => showMatching(), { scope: "screen", group: "Translation review", description: showMatchingShortcut, allowInInputs: true });
  useEffect(() => {
    const track = (event: FocusEvent) => {
      const target = event.target;
      focusedControl.current = target === submitControl.current ? "submit"
        : target instanceof Element && target.id === "review-submit-reason" ? "reason" : null;
    };
    // Click outside the translation details popover closes it.
    const outside = (event: Event) => {
      const details = detailsRef.current;
      if (details?.open && !(event.target instanceof Node && details.contains(event.target))) details.open = false;
    };
    document.addEventListener("focusin", track); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("focusin", track); document.removeEventListener("pointerdown", outside); };
  }, []);
  /** Submit and its reason move between rail footer and pinned bar; a focused one keeps the focus. */
  const wideMounted = useRef(false);
  useLayoutEffect(() => {
    if (!wideMounted.current) { wideMounted.current = true; return; }
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (focusedControl.current === "submit") submitControl.current?.focus({ preventScroll: true });
    else if (focusedControl.current === "reason") submitReason.current?.focus({ preventScroll: true });
  }, [wide]);
  /** Heights of the bands above and below the texts and of the pinned bar, for the text height below 1100 px. */
  useEffect(() => {
    const root = screenRoot.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const bar = root.querySelector<HTMLElement>(".translation-pinned-bar");
      root.style.setProperty("--review-bar", `${Math.round(bar?.getBoundingClientRect().height ?? 0)}px`);
      const texts = root.querySelector<HTMLElement>(".translation-texts");
      const box = texts?.querySelector<HTMLElement>(".translation-column > .translation-text, .translation-column > .translation-editor, .translation-column > .translation-diff");
      if (!texts || !box) return;
      // Neither value depends on the text height itself, so setting it cannot loop.
      const rootTop = root.getBoundingClientRect().top, boxRect = box.getBoundingClientRect();
      const above = Math.max(0, rootTop) + boxRect.top - rootTop + root.scrollTop;
      const below = texts.getBoundingClientRect().bottom - boxRect.bottom;
      root.style.setProperty("--review-bands", `${Math.max(0, Math.round(above + below))}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll(".translation-review > .notice, .translation-review-bar, .translation-checks, .translation-pinned-bar, .translation-column-head, .translation-column-note, .translation-column-hint")
      .forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [wide, readOnly, showChanges, comparisonId, coupled]);
  const closeDetails = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.open = false; detailsSummary.current?.focus({ preventScroll: true });
  };
  const focusDecision = () => { decisionHeading.current?.scrollIntoView?.({ block: "nearest" }); decisionHeading.current?.focus(); };
  /** "Change ↓" in the pinned bar: bring the decision legend into view and move focus to it. */
  const focusDecisionLegend = () => {
    const legend = screenRoot.current?.querySelector<HTMLElement>("[data-decision-legend]");
    legend?.scrollIntoView?.({ block: "start" }); legend?.focus({ preventScroll: true });
  };

  const [status, statusTone]: readonly [string, StatusTone] = readOnly ? ["Read-only", "neutral"] : ({
    saved: ["Saved", "neutral"], dirty: ["Changes not saved", "info"], saving: ["Saving…", "info"],
    error: ["Changes not saved", "warning"], conflict: ["Conflict: reload", "danger"],
  } satisfies Record<typeof saveState, readonly [string, StatusTone]>)[saveState];
  const submitBlocker: string | null = readOnly || busy ? null
    : !decision(rawForm.decision) ? "Choose a decision to submit."
    : !form ? "Update the unsupported values above to submit."
    : issues.length > 0 ? null
    : !nonblank(qualification) ? "Your qualification is required to submit."
    : saveState === "conflict" ? "This review was changed elsewhere. Reload from server to continue."
    : saveState === "error" ? "Your changes are not saved. Retry saving to submit."
    : saveState !== "saved" || saver.current?.hasUnsavedChanges ? "Saving your changes…"
    : null;
  const allChecks = Array.isArray(workspace.translation_ancestor.translation?.checks) ? workspace.translation_ancestor.translation.checks as unknown[] : null;
  const run = workspace.translation_ancestor.translation;
  const sourceLanguage = workspace.source.variant.language, targetLanguage = workspace.variant.language;
  const changed = text !== workspace.text;
  const earlier = workspace.previous_reviews.filter(value => value.id !== record?.id);
  const navigateLink = (route: Route, label: ReactNode, className?: string) => <a className={className} href={routeHref(route)} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); props.onNavigate(route); }}>{label}</a>;
  const paneNames: Record<string, string> = { source: "Source", target: "Translation", comparison: "Comparison" };
  const reasonShown = submitBlocker !== null || issues.length > 0;
  /** Reason, key hint and Submit: in the rail footer when wide, in the pinned bar otherwise; one of each in the DOM. */
  const listedIssues = issues.length > 0 && !busy;
  /** Pinned bar: one line (first issue or blocker, "and n more"); the full list then stays in the decision form. */
  const reasonFirst = listedIssues ? issueMessages[issues[0]] : submitBlocker, reasonMore = listedIssues ? issues.length - 1 : 0;
  const submitReasonElement = reasonShown && <div id="review-submit-reason" ref={submitReason} tabIndex={-1} className="translation-submit-reason" aria-live="polite">
    {!wide ? <p className="translation-submit-reason-line" title={`${reasonFirst ?? ""}${reasonMore > 0 ? ` and ${reasonMore} more` : ""}`}>
        <span className="translation-submit-reason-first">{reasonFirst}</span>{reasonMore > 0 && <span className="translation-submit-reason-more">{` and ${reasonMore} more`}</span>}</p>
      : listedIssues
        ? <><p>Before submitting:</p><ol className="review-issues" aria-label="Review issues">{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issueMessages[issue]}</li>)}</ol></>
        : <p>{submitBlocker}</p>}
  </div>;
  const qualificationNote = !nonblank(qualification) && <p className="translation-submit-note">{navigateLink({ name: "me" }, "Add your qualification in your profile")}</p>;
  const submitButton = <Button ref={submitControl} variant="primary" aria-describedby={reasonShown ? "review-submit-reason" : undefined}
    aria-disabled={canSubmit ? undefined : true} loading={busy} onClick={requestSubmit}>Submit review…</Button>;

  return <section className="translation-review" aria-label="Translation review" ref={screenRoot}>
    {held && <InlineMessage tone="warning">Task paused: {props.holdReason ?? workspace.assignment.hold_reason ?? "A project problem needs attention."} Your local translation and review input are kept.</InlineMessage>}
    {/* Gone once the review is submitted here: the notice belongs to editable tasks. */}
    {!readOnly && props.guidelineNotice}
    <Button className="translation-skip" onClick={focusDecision}>Skip to decision</Button>
    <div className="translation-review-bar density-compact">
      <h1>{workspace.variant.external_id}</h1>
      <div className="translation-review-meta">
        <p>{languageName(sourceLanguage)} <span aria-hidden="true">→</span><span className="review-sr-only">{" to "}</span> {languageName(targetLanguage)}</p>
        <details className="translation-details" ref={detailsRef} onKeyDown={closeDetails}>
          <summary ref={detailsSummary}>Translation details</summary>
          <dl>
            {run?.provider != null && <div><dt>Machine translation</dt><dd>{String(run.provider)}</dd></div>}
            {run?.model != null && <div><dt>Model</dt><dd>{String(run.model)}</dd></div>}
            {run?.run_id != null && <div><dt>Run</dt><dd>{String(run.run_id)}</dd></div>}
            <div><dt>Reviewed version</dt><dd>v{workspace.variant.version}</dd></div>
            <div><dt>Source document</dt><dd>{workspace.source.variant.external_id}</dd></div>
          </dl>
        </details>
      </div>
      <div className="translation-review-tools">
        {props.guidelineActions}
        {!leadCorrection && props.reportActions}
        <span role="status" className="translation-save-status"><StatusBadge tone={statusTone}>{status}</StatusBadge></span>
        <Button variant="quiet" size="sm" icon={<IconRetry />} onClick={() => { void reload(); }}
          title="Load the latest saved state of this review. Unsaved edits are saved first; if that fails, you choose whether to discard them.">Reload from server</Button>
      </div>
    </div>
    <ChecksSummary failed={workspace.failed_checks} all={allChecks} />
    <div className="translation-workspace">
      <div className="translation-texts">
        <div className={`translation-columns${comparison ? " translation-columns--comparison" : ""}`}>
          <div className="translation-column">
            <div className="translation-column-head density-compact"><h2 className="translation-column-title">Source ({sourceLanguage})</h2></div>
            <TextView ref={setSourceElement} text={workspace.source.text} label={`Source (${sourceLanguage})`} lang={sourceLanguage} />
          </div>
          <div className="translation-column">
            <div className="translation-column-head density-compact">
              <h2 id="review-translation-label" className="translation-column-title">Translation ({targetLanguage})</h2>
              <div className="translation-column-controls">
              <Checkbox id="review-show-changes" label="Show changes" checked={showChanges} onChange={event => setShowChanges(event.target.checked)} />
              {pairing.available && <Checkbox id="review-couple" label="Couple scrolling" checked={coupled} onChange={event => setRequestedCoupling(event.target.checked ? couplingIdentity : null)} />}
              <Button ref={matchButton} size="sm" title={showMatchingTitle} aria-keyshortcuts="Alt+M" onMouseDown={event => event.preventDefault()} onClick={showMatching}>
                {showMatchingLabel}<span aria-hidden="true"> <Kbd>Alt M</Kbd></span></Button>
              </div>
              <span role="status" className="review-sr-only">{matchStatus}</span>
            </div>
            {showChanges
              ? <DiffView ref={setTargetElement} before={workspace.text} after={text} lang={targetLanguage} />
              : <TranslationEditor ref={setTargetElement} id="review-translation" labelledBy="review-translation-label" describedBy="review-translation-note"
                  machineText={workspace.text} value={text} lang={targetLanguage} readOnly={readOnly} disabled={busy}
                  onChange={event => editText(event.target.value)}
                  onBlur={() => { composing.current = false; commitStarts(); }}
                  onCompositionStart={() => { composing.current = true; window.clearTimeout(startsTimer.current); }}
                  onCompositionEnd={() => { composing.current = false; scheduleStarts(); }} />}
            <p id="review-translation-note" className="translation-column-note">{showChanges
              ? "Showing changes against the machine translation. Turn off Show changes to edit."
              : changed ? "Underlined text differs from the machine translation." : "Same as the machine translation."}</p>
          </div>
          {comparison && <div className="translation-column">
            <div className="translation-column-head density-compact">
              <h2 className="translation-column-title">Comparison</h2>
              {/* The heading names the column; the picker keeps its full name for assistive technology only. */}
              <div className="translation-column-controls">
              <select id="review-comparison" className="form-select" aria-label="Comparison translation" value={comparisonId} onChange={event => setComparisonId(event.target.value)}>
                {workspace.comparisons.map(row => <option key={row.variant.document_id} value={row.variant.document_id}>{row.variant.external_id} · {row.variant.language}</option>)}</select>
              </div>
            </div>
            <TextView key={comparisonId} ref={setComparisonElement} text={comparison.text} label="Comparison" lang={comparison.variant.language} />
          </div>}
          {/* One line below the panes spanning the text columns, so the notes never push one pane below the others. */}
          {coupled && <p className="translation-column-hint">
            <span>{couplingNote}</span>
            {editing && <span>{couplingEditingNote}</span>}
            <span role="status" aria-label="Paragraph pairing">{restingPairs.map(pair => `${paneNames[pair.paneId]} paragraph ${pair.paragraph + 1}`).join(" ↔ ")}</span>
            {sourceStarts.length !== targetStarts.length && <span>{paragraphCountsDiffer(sourceStarts.length, targetStarts.length)}</span>}
            {comparison && comparisonStarts.length !== targetStarts.length && <span>{comparisonCountsDiffer(targetStarts.length, comparisonStarts.length)}</span>}
            <span aria-live="polite">{targetStarts.length !== loadedCount && paragraphCountChanged(loadedCount, targetStarts.length)}</span>
          </p>}
        </div>
      </div>
      <aside className="translation-decision density-compact" aria-labelledby="translation-decision-heading">
        <div className="translation-decision-body">
          <h2 id="translation-decision-heading" className="translation-section-title" ref={decisionHeading} tabIndex={-1}>Your review</h2>
          <SourceObligationReview assignmentId={props.assignmentId} username={props.username} documentId={workspace.variant.document_id}
            translationText={text} canResolve={canSubmit && !!form && ['accepted_unchanged', 'accepted_corrected'].includes(form.decision)}
            busy={busy} readOnly={readOnly} error={error} onResolve={submit} />
          {submitted && <InlineMessage tone="success" title="Review submitted"><p>{decisionOutcomes[submitted.decision]}</p>
            {createdVersion !== null && <p>A corrected version v{createdVersion} was created.</p>}
            {submitted.created_variant_id && createdVersion === null && <Button size="sm" onClick={() => { void loadCreated(submitted); }}>Retry corrected version metadata</Button>}</InlineMessage>}
          {submitted && leadCorrection && <div className="translation-next-task">
            {navigateLink({ name: "projectDocuments", key: projectKey, case: workspace.variant.case_id, language: workspace.variant.language }, "Back to Documents")}
          </div>}
          {submitted && !leadCorrection && nextTask && <div className="translation-next-task">
            {nextTask.kind === "loading" && <Button variant="primary" loading>Next task</Button>}
            {nextTask.kind === "ready" && nextTask.next && <Button ref={nextTaskButton} variant="primary"
              onClick={() => props.onNavigate({ name: "task", assignmentId: nextTask.next!.assignment_id })}>{nextTaskLabel(nextTask.next)}</Button>}
            {nextTask.kind === "ready" && !nextTask.next
              ? <Button variant="primary" onClick={() => props.onNavigate(MY_TASKS)}>Back to my tasks</Button>
              : navigateLink(MY_TASKS, "Back to my tasks")}
            {nextTask.kind === "ready" && <p role="status" className="translation-submit-note">{remainingTasksText(nextTask.remaining)}</p>}
            {nextTask.kind === "error" && <><ErrorNotice error={nextTask.error} /><Button onClick={() => setNextTaskLoad(n => n + 1)}>Retry</Button></>}
          </div>}
          {record ? <ReviewSummary record={record} heading="Submitted review" />
            : held ? <><InlineMessage tone="info">This task is paused. Your review choices are kept.</InlineMessage>
              {leadCorrection && <InlineMessage tone="info">{leadCorrectionNote}</InlineMessage>}
              <ReviewForm value={visualForm(rawForm)} issues={[]} failedCheckCount={workspace.failed_checks.length} readOnly decisions={leadCorrection ? leadDecisions : undefined} onChange={() => {}} /></>
            : readOnly ? <InlineMessage tone="info">This review can no longer be edited.</InlineMessage>
            : <>
              {leadCorrection && <InlineMessage tone="info">{leadCorrectionNote}</InlineMessage>}
              {decision(rawForm.decision) && !form && <InlineMessage tone="error">The review form contains unsupported values. Update the affected fields before submitting.</InlineMessage>}
              <ReviewForm value={visualForm(rawForm)} issues={!wide && !busy ? issues : []} readOnly={busy} decisions={leadCorrection ? leadDecisions : undefined} failedCheckCount={workspace.failed_checks.length}
                autoNote={autoNoteText(decisionState.note)} onChooseDecision={chooseOption} onChange={next => {
                const current = draftRef.current;
                edit({ ...current, form: { ...(!has(current.form, "clinical_change") ? { clinical_change: false } : {}), ...current.form, ...next } });
              }} />
            </>}
          {(error ?? saver.current?.error) != null && <ErrorNotice error={error ?? saver.current?.error} />}
          {serverIssues.length > 0 && <ol className="review-issues" aria-label="Server review issues">{serverIssues.map((code, index) => <li key={index}>{reviewIssueMessage(code)}</li>)}</ol>}
          {!readOnly && saveState === "error" && <Button onClick={() => { void retrySave(); }}>Retry save</Button>}
          {earlier.length > 0 && <section className="review-history" aria-labelledby="review-history-heading">
            <h2 id="review-history-heading" className="translation-section-title">Previous reviews</h2>
            {earlier.map(value => <details key={value.id}><summary>{decisionLabels[value.decision]} · {formatReviewDate(value.created_at)}</summary>
              <ReviewSummary record={value} heading="Review details" />
              <h3 className="review-history-label">Proposed text</h3>
              <p className="review-history-text">{value.proposed_text}</p></details>)}
          </section>}
        </div>
        {!readOnly && wide && <div className="translation-decision-footer">
          {qualificationNote}
          {/* Why Submit is unavailable, right next to it; the review rules' issues are listed here too. */}
          {submitReasonElement}
          <p className="translation-key-hint">{leadCorrection ? leadCorrectionKeyHint : decisionKeyHint}</p>
          {submitButton}
        </div>}
      </aside>
    </div>
    {!readOnly && !wide && <div className="translation-pinned-bar density-compact" role="region" aria-label="Decision and submit">
      <p className="translation-pinned-decision"><strong>Decision:</strong> {decision(rawForm.decision) ? decisionLabels[rawForm.decision] : "Not chosen"}</p>
      <Button variant="quiet" size="sm" onClick={focusDecisionLegend}>Change ↓</Button>
      {qualificationNote}
      {submitReasonElement}
      {submitButton}
    </div>}
    {form && <ConfirmDialog focusConfirm open={confirming} title="Submit this review?" confirmLabel="Submit review" cancelLabel="Keep editing" busy={busy}
      message={<SubmitSummary decision={form.decision} clinical={form.clinical_change} categories={form.categories ?? []} rationale={form.rationale} />}
      onCancel={() => setConfirming(false)} onConfirm={() => { void submit(); }} />}
    {leave && <Dialog open title={leave.kind === "logout" ? "Unsaved changes" : "Changes not saved"} onClose={busy ? undefined : () => closeLeave(false)} footer={<>
      <Button disabled={busy} onClick={() => closeLeave(false)}>Cancel</Button>
      <Button variant="danger" disabled={busy} onClick={() => closeLeave(true)}>{leave.kind === "logout" ? "Discard and log out" : "Discard edits and leave"}</Button>
      {leave.kind === "logout" && <Button loading={busy} onClick={() => { if (operation.current) return; operation.current = true; setBusy(true); void flush().then(allowed => { if (allowed) closeLeave(true); }, failure => { if (alive.current) setError(failure); }).finally(() => { if (alive.current && !departing.current) { operation.current = false; setBusy(false); } }); }}>Save and log out</Button>}
    </>}>
      <p>Your latest changes are not saved yet. Discarding them cannot be undone.</p>
    </Dialog>}
  </section>;
}
