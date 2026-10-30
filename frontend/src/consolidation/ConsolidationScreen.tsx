/**
 * Consolidation view of one round (acceptance fixes spec "WP-E Frontend", U2, U9, U11–U14, X1, X3, X6–X8, X12–X14,
 * X16, X18, X21): the read-only clinical text with one underline lane per person, and the finding groups with one
 * decision per open group. Opened from the task (the assignee, live) and read-only from the row panel (the lead,
 * after submission); a withdrawn input or a lost assignment makes it read-only with the reason.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { api, ApiError, type ConsolidationAnnotatePayload, type ConsolidationGroupView, type ConsolidationResolvePayload, type SearchCandidate, type TaskSummary } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import type { WorkspaceView } from "../app/CaseScreen";
import { nextOpenTask } from "../app/caseOrder";
import { consolidationReasonText } from "../app/labels";
import { MY_TASKS, routeHref, type Route } from "../app/router";
import { prefillQuery } from "../editor/termSearch";
import { randomId } from "../editor/ids";
import { nextTaskLabel, remainingTasksText } from "../translation/labels";
import { Button, ConfirmDialog, EmptyState, InlineMessage, MenuButton, Popover, Select, TextInput, Toast, useMediaQuery, useToast } from "../ui";
import { useShortcut } from "../ui/shortcuts";
import { StagePath } from "../ui/StagePath";
import { AddedFindings } from "./AddedFindings";
import { addedHeading, duplicatesText, finalizationState, headerTitle, readOnlyText, submittedText, summaryText } from "./consolidationText";
import { duplicateTerms, groupName, termLabel } from "./groupModel";
import { GroupList, textOrder } from "./GroupList";
import { SubmitBar } from "./SubmitBar";
import { SummaryDialog } from "./SummaryDialog";
import { newFindingTarget, TermPicker } from "./TermPicker";
import { TextPane, type AddedFinding, type TextRange } from "./TextPane";
import { useConsolidation, type AxisWarning } from "./useConsolidation";
import "./consolidation.css";
import { LanguageText } from "../ui/LanguageTag";
import { onSpaceActivate } from "../ui/spaceActivates";

export interface ConsolidationScreenProps {
  projectKey: string;
  roundId: string;
  /** Finding group to show first (the flags banner's "Open"). */
  group?: string;
  /** The lead's read of a submitted consolidation (U9); the server decides as well. */
  readOnly?: boolean;
  /** The consolidator's task: enables "Open in full editor" and "Next task" after submitting. */
  assignmentId?: number;
  onNavigate?: (route: Route) => void;
  /** The editor view of the round when the task already opened it (layers, axes, creation defaults). */
  workspaceView?: WorkspaceView | null;
  /** Task actions next to the title (the task's guidelines and "Report a text problem"). */
  headerActions?: ReactNode;
  /** The task's one-time guidelines notice, shown under the header (inside the screen's padding, as in CaseScreen). */
  notice?: ReactNode;
  /** "Back to documents" target of the lead's read-only view (the Documents page with its row panel). */
  back?: Route;
  /** The consolidator leads the project: after submitting, they accept the result themselves. Unknown: asked after submit. */
  lead?: boolean;
}

type NextTask = { kind: "loading" } | { kind: "ready"; next: TaskSummary | null; remaining: number } | { kind: "error"; error: unknown };

/** Codepoint ranges of every exact occurrence of `query` (trimmed) in `text`. */
export function passagesOf(text: string, query: string): TextRange[] {
  const needle = query.trim();
  if (!needle) return [];
  const found: TextRange[] = [];
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
    const start = Array.from(text.slice(0, index)).length;
    found.push({ start, end: start + Array.from(needle).length });
  }
  return found;
}

/** "Add finding" without a mouse selection: type the passage, choose its occurrence. */
function PassageForm({ text, anchorRef, onPick, onClose }: { text: string; anchorRef: RefObject<HTMLElement>; onPick: (range: TextRange) => void; onClose: () => void }): JSX.Element {
  const [value, setValue] = useState("");
  const [index, setIndex] = useState(0);
  const id = useId();
  const matches = useMemo(() => passagesOf(text, value), [text, value]);
  const chars = useMemo(() => Array.from(text), [text]);
  const context = ({ start, end }: TextRange) =>
    `${start > 20 ? "…" : ""}${chars.slice(Math.max(0, start - 20), end + 20).join("")}${end + 20 < chars.length ? "…" : ""}`;
  const pick = () => { const match = matches[Math.min(index, matches.length - 1)]; if (match) onPick(match); };
  return <Popover open anchorRef={anchorRef} label="Add finding" onClose={onClose} width={420}>
    <form className="cons-passage-form" onSubmit={event => { event.preventDefault(); pick(); }}>
      <TextInput id={`${id}-passage`} label="Passage from the text" value={value} autoComplete="off"
        hint={value.trim() && !matches.length ? "Not found in the text. Type it exactly as written." : "Or select the passage in the text."}
        onChange={event => { setValue(event.target.value); setIndex(0); }} />
      {matches.length > 1 && <Select id={`${id}-occurrence`} label="Occurrence" value={String(index)} onChange={event => setIndex(Number(event.target.value))}>
        {matches.map((match, position) => <option key={match.start} value={position}>{`${position + 1}: ${context(match)}`}</option>)}
      </Select>}
      <div className="cons-actions">
        <Button type="submit" variant="primary" aria-disabled={!matches.length || undefined}>Continue</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  </Popover>;
}

const nextOpenAfter = (groups: readonly ConsolidationGroupView[], groupId: string | null): string | null => {
  const index = groups.findIndex(group => group.group_id === groupId);
  for (let step = 1; step <= groups.length; step++) {
    const candidate = groups[(Math.max(index, -1) + step + groups.length) % groups.length];
    if (candidate && candidate.state === "open" && candidate.group_id !== groupId) return candidate.group_id;
  }
  return null;
};

export function ConsolidationScreen(props: ConsolidationScreenProps): JSX.Element {
  const data = useConsolidation(props.roundId, { workspaceView: props.workspaceView });
  const view = data.view;
  const wide = useMediaQuery("(min-width: 1100px)");
  const medium = useMediaQuery("(min-width: 700px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const narrow = !wide && !medium;
  const [selected, setSelected] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, string>>(new Map());
  const [restoring, setRestoring] = useState<string | null>(null);
  /** M-7g: the last decision, undone inline in its row or with Ctrl/Cmd+Z until the next action. */
  const [lastDecision, setLastDecision] = useState<ConsolidationGroupView | null>(null);
  const [textHidden, setTextHidden] = useState(false);
  const [range, setRange] = useState<TextRange | null>(null);
  const [adding, setAdding] = useState(false);
  // Made before the search: its search event must name the annotation it creates (as in the editor).
  const [newAnnotationId, setNewAnnotationId] = useState(() => `ann-${randomId()}`);
  const [typing, setTyping] = useState(false);
  /** The finding "Add finding" just saved: its values open for editing. */
  const [editAdded, setEditAdded] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isLead, setIsLead] = useState<boolean | undefined>(props.lead);
  const [dialog, setDialog] = useState<{ open: boolean; busy: boolean; warning: AxisWarning | null; error: unknown }>({ open: false, busy: false, warning: null, error: null });
  const [submitted, setSubmitted] = useState(false);
  const [nextTask, setNextTask] = useState<NextTask | null>(null);
  const [reopeningAll, setReopeningAll] = useState({ open: false, busy: false });
  const [focusRequest, setFocusRequest] = useState<{ groupId: string } | null>(null);
  const { toast, show, dismiss } = useToast();
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  const submitRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const initialized = useRef(false);

  // First read: the route's group, else the first open group in text order.
  useEffect(() => {
    if (!view || initialized.current) return;
    initialized.current = true;
    const routed = view.groups.find(group => group.group_id === props.group);
    const first = routed ?? textOrder(view.groups, view.text).find(group => group.state === "open");
    setSelected(first?.group_id ?? null);
  }, [view, props.group]);

  // Issue 143: the submit dialog already tells a lead consolidator that they accept the result themselves.
  useEffect(() => {
    if (props.assignmentId === undefined || props.lead !== undefined) return;
    let live = true;
    api.listProjects().then(projects => {
      if (live) setIsLead(current => current ?? !!projects.find(project => project.project_key === props.projectKey)?.can_manage);
    }, () => undefined);
    return () => { live = false; };
  }, [props.assignmentId, props.lead, props.projectKey]);

  useEffect(() => {
    if (!focusRequest) return;
    toggles.current.get(focusRequest.groupId)?.focus();
  }, [focusRequest]);

  const readOnly = !view || view.read_only || !!props.readOnly || submitted;
  const groups = useMemo(() => textOrder(view?.groups ?? [], view?.text ?? ""), [view?.groups, view?.text]);
  const open = groups.filter(group => group.state === "open").length;

  const select = (groupId: string, focus = false) => {
    setSelected(groupId);
    if (focus) setFocusRequest({ groupId });
  };
  const announceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);
  const announce = (text: string) => {
    window.clearTimeout(announceTimer.current);
    setAnnouncement("");
    announceTimer.current = window.setTimeout(() => setAnnouncement(text), 0);
  };
  // J/K walk the open groups in text order; the ends are announced, as in the row panel.
  const step = (delta: number) => {
    const index = groups.findIndex(group => group.group_id === selected);
    let next = index < 0 ? (delta > 0 ? 0 : groups.length - 1) : index + delta;
    while (next >= 0 && next < groups.length && groups[next].state !== "open") next += delta;
    if (next < 0 || next >= groups.length) { announce(delta > 0 ? "Last open group" : "First open group"); return; }
    select(groups[next].group_id, true);
  };
  useShortcut("j", () => step(1), { description: "Next open group", group: "Consolidation", enabled: !!view });
  useShortcut("k", () => step(-1), { description: "Previous open group", group: "Consolidation", enabled: !!view });

  const reopen = async (group: ConsolidationGroupView, undone = false): Promise<boolean> => {
    const previous = lastDecision;
    setLastDecision(null);
    const ok = await data.reopen(group.group_id, { input_ids: group.members.map(member => member.input_id) });
    // A failed reopen keeps Undo available.
    if (!ok) setLastDecision(previous);
    if (ok) {
      setSummaries(current => { const next = new Map(current); next.delete(group.group_id); return next; });
      select(group.group_id, true);
      // issue 198: the status region no longer reads the decision that was just taken back.
      announce(`${groupName(group, viewRef.current?.text ?? "")}: ${undone ? "decision undone" : "reopened"}.`);
    }
    return ok;
  };
  const resolve = async (group: ConsolidationGroupView, payload: ConsolidationResolvePayload, summary: string): Promise<boolean> => {
    setLastDecision(null);
    const ok = await data.resolve(group.group_id, payload);
    if (!ok) return false;
    setSummaries(current => new Map(current).set(group.group_id, summary));
    const next = nextOpenAfter(textOrder(viewRef.current?.groups ?? [], viewRef.current?.text ?? ""), group.group_id);
    setSelected(next);
    if (next) setFocusRequest({ groupId: next });
    // After the card re-rendered as ready: its one button is Submit.
    else requestAnimationFrame(() => submitRef.current?.querySelector<HTMLButtonElement>(".btn-primary")?.focus());
    announce(`${groupName(group, viewRef.current?.text ?? "")}: ${summary}.`);
    setLastDecision(group);
    return true;
  };
  const undoLast = () => {
    if (!lastDecision) return false;
    const group = lastDecision;
    setRestoring(group.group_id);
    void reopen(group, true);
  };
  // Not in text fields (the shortcut scope "screen" leaves typing targets alone). Listed in "?" while the view is
  // editable (R-25); without a decision to undo the key passes through.
  useShortcut(["Ctrl+z", "Meta+z"], undoLast, { scope: "screen", description: "Undo the last decision", group: "Consolidation", enabled: !readOnly });
  const annotate = (group: ConsolidationGroupView, payload: ConsolidationAnnotatePayload) => { setLastDecision(null); return data.annotate(group.group_id, payload); };
  // R-10 "re-merge": every decided group open again without preselection, matches taken over again; one Undo.
  const decidedCount = groups.filter(group => group.state !== "open" && group.state !== "auto").length;
  const reopenAll = async () => {
    setReopeningAll(current => ({ ...current, busy: true }));
    setLastDecision(null); setRestoring(null);
    const ok = await data.reopenAll();
    setReopeningAll({ open: false, busy: false });
    if (!ok) { show({ message: "Could not reopen the decisions. Nothing changed." }); return; }
    setSummaries(new Map());
    const first = textOrder(viewRef.current?.groups ?? [], viewRef.current?.text ?? "").find(group => group.state === "open");
    if (first) select(first.group_id, true);
    show({ message: `Reopened ${decidedCount} decided ${decidedCount === 1 ? "group" : "groups"}.`, undo: true, onAction: () => {
      void data.undoReopenAll().then(restored => show({ message: restored ? "Decisions restored." : "Could not restore the decisions." }));
    } });
  };

  // Findings added outside the groups, as the server lists them (live and after submission).
  const added: AddedFinding[] = useMemo(() => (view?.added ?? []).map(finding => ({
    annotationId: finding.annotation_id,
    label: termLabel(finding),
    spans: finding.spans,
  })), [view?.added]);

  const addTarget = data.workspace ? newFindingTarget(data.workspace, groups[0]?.members[0]?.layer_id) : null;
  const pickPassage = (picked: TextRange) => { setRange(picked); setTyping(false); setAdding(true); };
  const addFinding = async (candidate: SearchCandidate, searchId?: string) => {
    if (!range || !addTarget) return;
    setAdding(false); setLastDecision(null);
    const ok = await data.addFinding({ ...addTarget, annotationId: newAnnotationId, termId: candidate.term_id, searchId, segments: [range], axes: addTarget.axes });
    // The new finding has the creation defaults; its values open for a check right away.
    if (ok) { setRange(null); setEditAdded(newAnnotationId); setNewAnnotationId(`ann-${randomId()}`); show({ message: `Finding added: ${candidate.label} (${candidate.term_id}). Check its values.` }); }
    else show({ message: "Could not add the finding. Nothing changed." });
  };

  const navigate = (route: Route) => { if (props.onNavigate) props.onNavigate(route); else window.location.hash = routeHref(route); };
  const editInEditor = props.assignmentId !== undefined && !readOnly
    ? () => navigate({ name: "task", assignmentId: props.assignmentId!, view: "editor" }) : undefined;

  const loadNextTask = () => {
    if (props.assignmentId === undefined) return;
    setNextTask({ kind: "loading" });
    api.listMyTasks().then(tasks => setNextTask({ kind: "ready", ...nextOpenTask(tasks, props.assignmentId!, props.projectKey) }),
      error => setNextTask({ kind: "error", error }));
  };
  // One dialog: Submit sends without acknowledgement; warnings from the server are listed in it, and only
  // "Submit with N warnings" acknowledges exactly those (a changed warning set is shown again).
  const submit = async (acknowledged: boolean) => {
    setDialog(current => ({ ...current, busy: true, error: null }));
    try {
      const result = await data.submit(acknowledged && dialog.warning ? dialog.warning.acknowledgement : undefined);
      if (result.kind === "warning") { setDialog(current => ({ ...current, busy: false, warning: result.warning })); return; }
      setDialog({ open: false, busy: false, warning: null, error: null });
      // A submitted round has nothing left to undo.
      dismiss(); setLastDecision(null);
      setSubmitted(true);
      loadNextTask();
      if (isLead === undefined) api.listProjects().then(projects => {
        setIsLead(!!projects.find(project => project.project_key === props.projectKey)?.can_manage);
      }, () => undefined);
    } catch (error) { setDialog(current => ({ ...current, busy: false, error })); }
  };

  if (data.error) {
    const missing = data.error instanceof ApiError && (data.error.code === "ROUND_NOT_FOUND" || data.error.status === 404);
    return <section className="cons-screen">
      {missing ? <EmptyState title="This consolidation is not available.">It is not submitted yet, or it is not yours to open.</EmptyState> : <ErrorNotice error={data.error} />}
      {!missing && <Button onClick={data.reload}>Retry</Button>}
    </section>;
  }
  if (!view) return <section className="cons-screen" aria-busy="true">
    <InlineMessage tone="info">Loading consolidation…</InlineMessage>
    <ul className="cons-group-list" aria-hidden="true">{[0, 1, 2].map(index => <li key={index} className="cons-placeholder" />)}</ul>
  </section>;

  const lead = props.assignmentId === undefined || !!isLead;
  const reason = view.read_only ? readOnlyText(view, lead) : null;
  const showText = !narrow && (wide || !textHidden);
  const textToolbar = <>
    {!readOnly && addTarget && <Button ref={addRef} size="sm" aria-expanded={adding || typing}
      aria-describedby={!range ? "cons-add-hint" : undefined}
      onClick={() => { if (range) setAdding(true); else setTyping(true); }}>Add finding</Button>}
    {!readOnly && addTarget && !range && <span id="cons-add-hint" className="cons-muted">Select text, or type the passage, to add a finding everyone missed.</span>}
    {!wide && <Button size="sm" onClick={() => setTextHidden(true)}>Hide text</Button>}
  </>;

  return <section className="cons-screen" aria-labelledby="cons-title">
    <header className="cons-header">
      <div className="cons-heading">
        {readOnly && props.back && <a className="cons-back btn btn-secondary btn-sm" href={routeHref(props.back)} onKeyDown={onSpaceActivate} onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); navigate(props.back!);
        }}>Back to documents</a>}
        <StagePath segments={[
          { id: "translation", title: "Translation", state: "done", tone: "done" },
          { id: "annotation", title: "Annotation", state: `${view.people.length} submitted`, tone: "done" },
          { id: "finalization", title: "Finalization", ...finalizationState(open, groups.length, submitted || view.read_only_reason === "submitted",
            view.accepted_at, lead) },
        ]} />
        <h1 id="cons-title" className="case-title"><LanguageText text={headerTitle(view, readOnly && !submitted)} code={view.language} /></h1>
        {/* B5-6: the tools as a quiet row under the title (mockup 02 B). M-7a: one way into the full editor, same tab. */}
        {(props.headerActions || editInEditor || (!readOnly && decidedCount > 0)) && <div className="cons-header-actions" role="group" aria-label="Task">
          {editInEditor && <Button size="sm" variant="quiet" title="For span changes and findings the comparison cannot express" onClick={editInEditor}>Open in full editor</Button>}
          {props.headerActions}
          {!readOnly && decidedCount > 0 && <MenuButton label="More task actions" buttonLabel="More…" size="sm" items={[
            { id: "reopen-all", label: "Reopen all decisions…", onSelect: () => setReopeningAll({ open: true, busy: false }) },
          ]} />}
        </div>}
      </div>
      {!readOnly && <div ref={submitRef} className="cons-header-progress"><SubmitBar open={open} total={groups.length} onSubmit={() => setDialog({ open: true, busy: false, warning: null, error: null })}
        onNextOpen={() => { const next = nextOpenAfter(groups, selected); if (next) select(next, true); }} /></div>}
    </header>
    {props.notice}
    {view.consolidation_reason && <InlineMessage tone="info" live={false}><p className="cons-lead-reason">{consolidationReasonText(view.consolidation_reason)}</p></InlineMessage>}
    {reason && !submitted && <InlineMessage tone="info">{reason}</InlineMessage>}
    {submitted && <div className="cons-submitted" role="status">
      <p>{submittedText(!!isLead)}</p>
      <div className="cons-actions">
        {nextTask?.kind === "loading" && <Button variant="primary" loading>Next task</Button>}
        {nextTask?.kind === "ready" && nextTask.next && <Button variant="primary" onClick={() => navigate({ name: "task", assignmentId: nextTask.next!.assignment_id })}>{nextTaskLabel(nextTask.next)}</Button>}
        <Button variant={nextTask?.kind === "ready" && nextTask.next ? "secondary" : "primary"} onClick={() => navigate(MY_TASKS)}>Back to my tasks</Button>
      </div>
      {nextTask?.kind === "ready" && <p className="cons-muted">{remainingTasksText(nextTask.remaining)}</p>}
      {nextTask?.kind === "error" && <><ErrorNotice error={nextTask.error} /><Button onClick={loadNextTask}>Retry</Button></>}
    </div>}
    {!!data.refreshError && <div className="cons-failure"><ErrorNotice error={data.refreshError} /><Button onClick={data.reload}>Reload</Button></div>}
    <div className={`cons-layout cons-layout-${wide ? "wide" : medium ? "medium" : "narrow"}`}>
      {showText && <TextPane text={view.text} groups={groups} people={view.people} selectedGroupId={selected} reducedMotion={reducedMotion}
        onSelectGroup={groupId => select(groupId, true)} added={added} toolbar={textToolbar}
        onTextSelection={!readOnly && addTarget ? setRange : undefined} />}
      {!narrow && !wide && textHidden && <div><Button size="sm" onClick={() => setTextHidden(false)}>Show text</Button></div>}
      <div className="cons-side">
        <GroupList groups={groups} people={view.people} text={view.text} selected={selected} readOnly={readOnly} busy={data.busy}
          outcomes={data.outcomes} narrow={narrow} workspace={data.workspace} summaries={summaries}
          onSelect={groupId => select(groupId)} onSelectGroup={groupId => select(groupId, true)} onResolve={resolve} onAnnotate={annotate} restoring={restoring}
          onReopen={group => { setRestoring(group.group_id); return reopen(group); }} draft={data.draft}
          onDismissOutcome={data.dismissOutcome} undo={lastDecision && !readOnly ? { groupId: lastDecision.group_id, run: undoLast } : null}
          toggleRef={groupId => element => { if (element) toggles.current.set(groupId, element); else toggles.current.delete(groupId); }} />
        {added.length > 0 && <AddedFindings heading={addedHeading(props.assignmentId !== undefined, view.added_by)} added={view.added ?? []} text={view.text}
          workspace={data.workspace} readOnly={readOnly} busy={data.busy === "add-finding"} editRequest={editAdded}
          onSetValues={async (annotationId, axes) => {
            setLastDecision(null); setEditAdded(null);
            const ok = await data.setAddedValues(annotationId, axes);
            if (!ok) show({ message: "Could not save the values. Nothing changed." });
            return ok;
          }} />}
      </div>
    </div>
    {typing && <PassageForm text={view.text} anchorRef={addRef} onPick={pickPassage} onClose={() => setTyping(false)} />}
    {data.workspace && addTarget && <TermPicker open={adding} anchorRef={addRef} label="Add finding" workspace={data.workspace} layerId={addTarget.layerId} annotationId={newAnnotationId}
      initialQuery={range ? prefillQuery(view.text, [range]) : undefined} onClose={() => setAdding(false)} onPick={(candidate, searchId) => { void addFinding(candidate, searchId); }} />}
    <SummaryDialog open={dialog.open} lead={!!isLead} summary={summaryText(groups, added.length)} duplicates={duplicatesText(duplicateTerms(groups))} busy={dialog.busy} warning={dialog.warning} error={dialog.error}
      onSubmit={acknowledged => { void submit(acknowledged); }} onClose={() => setDialog({ open: false, busy: false, warning: null, error: null })} />
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    <ConfirmDialog open={reopeningAll.open} busy={reopeningAll.busy} title={`Reopen ${decidedCount} decided ${decidedCount === 1 ? "group" : "groups"}?`}
      message="Back to the start: groups where everyone agreed are taken over again, every other group opens without a preselection. The submissions and this consolidation stay. You can undo this right after."
      confirmLabel="Reopen all" onConfirm={() => { void reopenAll(); }} onCancel={() => setReopeningAll({ open: false, busy: false })} />
    <Toast toast={toast} onDismiss={dismiss} />
  </section>;
}
