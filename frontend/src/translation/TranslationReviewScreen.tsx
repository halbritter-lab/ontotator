import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { api, ApiError, type ReviewWorkspace, type TranslationReviewRecord } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { routeHref, type Route, type RouteLeaveGuard } from "../app/router";
import { Button, Checkbox, Dialog, EmptyState, InlineMessage, Select, Textarea } from "../ui";
import { useShortcut } from "../ui/shortcuts";
import { ReadOnlyAnnotationView } from "../variants/ReadOnlyAnnotationView";
import { paragraphStarts } from "../variants/paragraphs";
import { useCoupledScroll } from "../variants/useCoupledScroll";
import { createDraftSaver, type DraftSaver } from "./draftSaver";
import { DiffView } from "./DiffView";
import { ReviewForm } from "./ReviewForm";
import { categoryLabels, decisionLabels, issueMessages } from "./labels";
import { checkReview, type ClinicalCategory, type IssueCode, type ReviewDecisionCode, type ReviewForm as FormValue } from "./reviewRules";

export interface TranslationReviewScreenProps {
  assignmentId: number; username: string; onNavigate: (route: Route) => void;
  routeLeaveRef: MutableRefObject<RouteLeaveGuard | null>;
  leaveGuardRef: MutableRefObject<((proceed: () => void) => void) | null>;
}
type RawDraft = { text: string; form: Record<string, unknown> };
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
const recordForm = (record: TranslationReviewRecord): Record<string, unknown> => ({ decision: record.decision, clinical_change: record.clinical_change, categories: record.categories, rationale: record.rationale });

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
    <Button onClick={() => setRetry(n => n + 1)}>Retry</Button><Button onClick={() => props.onNavigate({ name: "tasks" })}>Back to my tasks</Button></section>;
  return <ReviewEditor key={identity} {...props} workspace={loaded.workspace} onReload={() => setRetry(n => n + 1)} />;
}

function ReviewEditor({ workspace, onReload, ...props }: TranslationReviewScreenProps & { workspace: ReviewWorkspace; onReload: () => void }): JSX.Element {
  const [draft, setDraft] = useState<RawDraft>(() => ({ text: workspace.draft.text, form: structuredClone(workspace.draft.form) }));
  const draftRef = useRef(draft); draftRef.current = draft;
  const saver = useRef<DraftSaver<RawDraft> | null>(null);
  const alive = useRef(false), operation = useRef(false), departing = useRef(false), readOnlyRef = useRef(workspace.read_only);
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [qualification, setQualification] = useState(workspace.qualification);
  const [submitted, setSubmitted] = useState<TranslationReviewRecord | null>(null);
  const [createdVersion, setCreatedVersion] = useState<number | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [showChanges, setShowChanges] = useState(true), [allChecks, setAllChecks] = useState(false), [coupled, setCoupled] = useState(true);
  const [comparisonId, setComparisonId] = useState(workspace.comparisons[0]?.variant.document_id ?? "");
  const [sourceElement, setSourceElement] = useState<HTMLDivElement | null>(null), [targetElement, setTargetElement] = useState<HTMLDivElement | null>(null), [comparisonElement, setComparisonElement] = useState<HTMLDivElement | null>(null);
  const record = submitted ?? (workspace.read_only ? workspace.submitted_record : null);
  const readOnly = workspace.read_only || submitted !== null; readOnlyRef.current = readOnly;
  const text = record?.proposed_text ?? draft.text, rawForm = record ? recordForm(record) : draft.form;
  const form = typedForm(rawForm), issues = form ? checkReview(form, workspace.text, text) : [];
  const comparison = workspace.comparisons.find(row => row.variant.document_id === comparisonId);
  const sourceStarts = useMemo(() => paragraphStarts(workspace.source.text), [workspace.source.text]);
  const targetStarts = useMemo(() => paragraphStarts(text), [text]);
  const comparisonStarts = useMemo(() => paragraphStarts(comparison?.text ?? ""), [comparison?.text]);
  useCoupledScroll(sourceElement, showChanges ? targetElement : null, { leftStarts: sourceStarts, rightStarts: targetStarts, enabled: coupled && showChanges });
  useCoupledScroll(showChanges ? targetElement : null, comparison ? comparisonElement : null, { leftStarts: targetStarts, rightStarts: comparisonStarts, enabled: coupled && showChanges });
  type Leave = { kind: "leave" | "logout"; resolve?: (allowed: boolean) => void; proceed?: () => void };
  const [leave, setLeave] = useState<Leave | null>(null);
  const pendingLeave = useRef<Leave | null>(null), leavePromise = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    alive.current = true;
    if (!workspace.read_only) {
      const instance = createDraftSaver<RawDraft>({ initialRevision: workspace.draft.revision,
        save: async (value, expected_revision) => {
          if (!alive.current || readOnlyRef.current) throw new Error("This review is read-only.");
          return (await api.saveTranslationReviewDraft(props.assignmentId, { ...value, expected_revision })).revision;
        }, onStateChange: () => { if (alive.current && saver.current === instance) refresh(n => n + 1); } });
      saver.current = instance;
    }
    return () => { alive.current = false; saver.current?.dispose(); saver.current = null; pendingLeave.current?.resolve?.(false); pendingLeave.current = null; };
  }, [workspace, props.assignmentId, props.username]);

  async function flush() {
    const instance = saver.current;
    if (instance) { await instance.flush(); if (instance.hasUnsavedChanges) throw new Error("Changes are not saved."); }
    return alive.current;
  }
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
    if (workspace.read_only) return;
    const warn = (event: BeforeUnloadEvent) => { if (saver.current?.hasUnsavedChanges) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [workspace.read_only]);
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
  const canSubmit = !readOnly && !busy && form !== null && issues.length === 0 && nonblank(qualification)
    && (saver.current?.state ?? "saved") === "saved" && !saver.current?.hasUnsavedChanges;
  const submit = async () => {
    const currentForm = typedForm(draftRef.current.form);
    if (operation.current || readOnlyRef.current || !currentForm || checkReview(currentForm, workspace.text, draftRef.current.text).length || !nonblank(qualification)) return;
    operation.current = true; setBusy(true); setError(null); setServerIssues([]);
    try {
      if (!await flush()) return;
      const revision = saver.current?.revision ?? workspace.draft.revision;
      const value = await api.submitTranslationReview(props.assignmentId, revision);
      if (!alive.current) return;
      readOnlyRef.current = true; saver.current?.dispose(); saver.current = null; setSubmitted(value);
      await loadCreated(value);
    } catch (failure) {
      if (!alive.current) return;
      setError(failure);
      if (failure instanceof ApiError && failure.code === "REVIEW_INVALID" && typeof failure.details === "object" && Array.isArray(failure.details.issues)) setServerIssues(failure.details.issues.filter((value): value is string => typeof value === "string"));
      if (failure instanceof ApiError && failure.code === "QUALIFICATION_REQUIRED") {
        setQualification(null);
        try { const profile = await api.getProfile(); if (alive.current) setQualification(profile.qualification ?? null); } catch { /* Keep the refusal and current input visible. */ }
      }
    } finally { if (alive.current) { operation.current = false; setBusy(false); } }
  };
  useShortcut("Ctrl+Enter", () => { void submit(); }, { scope: "screen", group: "Translation review", description: "Submit review", enabled: canSubmit, allowInInputs: true });
  const status = readOnly ? "Read-only" : ({ saved: "Saved", dirty: "Changes not saved", saving: "Saving…", error: "Changes not saved", conflict: "Conflict: reload" }[saver.current?.state ?? "saved"]);
  const checks = allChecks ? (Array.isArray(workspace.translation_ancestor.translation?.checks) ? workspace.translation_ancestor.translation.checks : workspace.failed_checks) : workspace.failed_checks;
  const run = workspace.translation_ancestor.translation;
  const navigateLink = (route: Route, label: string) => <a href={routeHref(route)} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); props.onNavigate(route); }}>{label}</a>;
  return <section className="translation-review" aria-label="Translation review">
    <div className="translation-review-header"><h1>{workspace.variant.external_id}</h1>
      <p>{workspace.source.variant.language} → {workspace.variant.language}{run && ` · ${String(run.provider ?? "")}${run.model ? ` · ${String(run.model)}` : ""}`}</p>
      <span role="status">{status}</span>{navigateLink({ name: "tasks" }, "Back to my tasks")}</div>
    <section className="translation-checks" aria-label="Translation checks"><h2>Inherited translation-run checks</h2>
      <Checkbox id="review-all-checks" label="Show all checks" checked={allChecks} onChange={event => setAllChecks(event.target.checked)} />
      <ul>{checks.map((raw, index) => { const check = raw as Record<string, unknown>; return <li key={index}>{String(check.code ?? "Check")} — {check.passed ? "Passed" : "Failed"}{check.detail ? `: ${String(check.detail)}` : ""}</li>; })}</ul>
    </section>
    <div className="translation-review-controls"><Checkbox id="review-show-changes" label="Show changes" checked={showChanges} onChange={event => setShowChanges(event.target.checked)} />
      <Checkbox id="review-couple" label="Couple scrolling" checked={coupled} disabled={!showChanges} onChange={event => setCoupled(event.target.checked)} />
      {showChanges && sourceStarts.length !== targetStarts.length && <InlineMessage tone="info">Paragraphs differ ({sourceStarts.length} / {targetStarts.length}); scrolling is approximate.</InlineMessage>}</div>
    <div className={`translation-columns${comparison ? " translation-columns--comparison" : ""}`}>
      <section aria-label={`Source (${workspace.source.variant.language})`}><h2>Source ({workspace.source.variant.language})</h2>
        <ReadOnlyAnnotationView text={workspace.source.text} annotations={[]} evidence={[]} labelFor={() => null} onTextElement={setSourceElement} /></section>
      <section><Textarea id="review-translation" label={`Translation (${workspace.variant.language})`} value={text} readOnly={readOnly} disabled={busy} onChange={event => edit({ ...draftRef.current, text: event.target.value })} />
        {showChanges && <DiffView ref={setTargetElement} before={workspace.text} after={text} />}</section>
      {comparison && <section aria-label="Comparison"><h2>Comparison</h2>
        <Select id="review-comparison" label="Comparison translation" value={comparisonId} onChange={event => setComparisonId(event.target.value)}>
          {workspace.comparisons.map(row => <option key={row.variant.document_id} value={row.variant.document_id}>{row.variant.external_id} · {row.variant.language}</option>)}</Select>
        {showChanges && comparisonStarts.length !== targetStarts.length && <InlineMessage tone="info">Paragraphs differ ({targetStarts.length} / {comparisonStarts.length}); scrolling is approximate.</InlineMessage>}
        <ReadOnlyAnnotationView key={comparisonId} text={comparison.text} annotations={[]} evidence={[]} labelFor={() => null} onTextElement={setComparisonElement} /></section>}
    </div>
    <div className="translation-decision density-compact">
      {!readOnly && !decision(rawForm.decision) && <p>Select a decision before submitting.</p>}
      {!readOnly && decision(rawForm.decision) && !form && <InlineMessage tone="error">The review form contains unsupported values. Update the affected fields before submitting.</InlineMessage>}
      <ReviewForm value={visualForm(rawForm)} issues={issues} readOnly={readOnly || busy} onChange={next => edit({ ...draftRef.current, form: { ...draftRef.current.form, ...next } })} />
      {!nonblank(qualification) && !readOnly && <p>{navigateLink({ name: "me" }, "Add your qualification in your profile")}</p>}
      {(error ?? saver.current?.error) != null && <ErrorNotice error={error ?? saver.current?.error} />}
      {serverIssues.length > 0 && <ol aria-label="Server review issues">{serverIssues.map((code, index) => <li key={index}>{has(issueMessages, code) ? issueMessages[code as IssueCode] : `Review issue: ${code}`}</li>)}</ol>}
      {!readOnly && saver.current?.state === "error" && <Button onClick={() => { void retrySave(); }}>Retry save</Button>}
      {!readOnly && <><Button onClick={() => { void reload(); }}>Reload review</Button><Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => { void submit(); }}>Submit review</Button></>}
      {submitted && <InlineMessage tone="success"><strong>Review submitted</strong><p>Resulting status: {submitted.status_after}</p>{createdVersion !== null && <p>A corrected version v{createdVersion} was created.</p>}
        {submitted.created_variant_id && createdVersion === null && <Button onClick={() => { void loadCreated(submitted); }}>Retry corrected version metadata</Button>}</InlineMessage>}
      {workspace.previous_reviews.filter(value => value.id !== record?.id).length > 0 && <section><h2>Previous reviews</h2>{workspace.previous_reviews.filter(value => value.id !== record?.id).map(value => <details key={value.id}><summary>{decisionLabels[value.decision]} · {value.created_at}</summary><p>{value.proposed_text}</p><p>{value.rationale}</p></details>)}</section>}
    </div>
    {leave && <Dialog open title={leave.kind === "logout" ? "Unsaved changes" : "Changes not saved"} onClose={busy ? undefined : () => closeLeave(false)}>
      <p>Your latest changes are not saved yet. Discarding them cannot be undone.</p>
      <Button disabled={busy} onClick={() => closeLeave(false)}>Cancel</Button>
      <Button variant="danger" disabled={busy} onClick={() => closeLeave(true)}>{leave.kind === "logout" ? "Discard and log out" : "Discard edits and leave"}</Button>
      {leave.kind === "logout" && <Button loading={busy} onClick={() => { if (operation.current) return; operation.current = true; setBusy(true); void flush().then(allowed => { if (allowed) closeLeave(true); }, failure => { if (alive.current) setError(failure); }).finally(() => { if (alive.current && !departing.current) { operation.current = false; setBusy(false); } }); }}>Save and log out</Button>}
    </Dialog>}
  </section>;
}
