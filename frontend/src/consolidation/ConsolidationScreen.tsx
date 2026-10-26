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
import { MY_TASKS, routeHref, type Route } from "../app/router";
import { prefillQuery } from "../editor/termSearch";
import { nextTaskLabel, remainingTasksText } from "../translation/labels";
import { Button, EmptyState, InlineMessage, Popover, Select, TextInput, Toast, useMediaQuery, useToast } from "../ui";
import { useShortcut } from "../ui/shortcuts";
import { StagePath } from "../ui/StagePath";
import { addedHeading, finalizationState, headerTitle, READ_ONLY_REASONS, submittedText, summaryText } from "./consolidationText";
import { groupName, termLabel } from "./groupModel";
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
  /** The consolidator's task: enables "Edit in editor…" and "Next task" after submitting. */
  assignmentId?: number;
  onNavigate?: (route: Route) => void;
  /** The editor view of the round when the task already opened it (layers, axes, creation defaults). */
  workspaceView?: WorkspaceView | null;
  /** Task actions next to the title (the task's guidelines and "Report problem"). */
  headerActions?: ReactNode;
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
  const [textHidden, setTextHidden] = useState(false);
  const [range, setRange] = useState<TextRange | null>(null);
  const [adding, setAdding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [isLead, setIsLead] = useState<boolean | undefined>(props.lead);
  const [dialog, setDialog] = useState<{ open: boolean; busy: boolean; warning: AxisWarning | null; error: unknown }>({ open: false, busy: false, warning: null, error: null });
  const [submitted, setSubmitted] = useState(false);
  const [nextTask, setNextTask] = useState<NextTask | null>(null);
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
    const first = routed ?? textOrder(view.groups).find(group => group.state === "open");
    setSelected(first?.group_id ?? null);
  }, [view, props.group]);

  useEffect(() => {
    if (!focusRequest) return;
    toggles.current.get(focusRequest.groupId)?.focus();
  }, [focusRequest]);

  const readOnly = !view || view.read_only || !!props.readOnly || submitted;
  const groups = useMemo(() => textOrder(view?.groups ?? []), [view?.groups]);
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

  const reopen = async (group: ConsolidationGroupView): Promise<boolean> => {
    const ok = await data.reopen(group.group_id, { input_ids: group.members.map(member => member.input_id) });
    if (ok) {
      setSummaries(current => { const next = new Map(current); next.delete(group.group_id); return next; });
      select(group.group_id, true);
    }
    return ok;
  };
  const resolve = async (group: ConsolidationGroupView, payload: ConsolidationResolvePayload, summary: string): Promise<boolean> => {
    const ok = await data.resolve(group.group_id, payload);
    if (!ok) return false;
    setSummaries(current => new Map(current).set(group.group_id, summary));
    const next = nextOpenAfter(textOrder(viewRef.current?.groups ?? []), group.group_id);
    setSelected(next);
    if (next) setFocusRequest({ groupId: next });
    else submitRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    show({ message: `${groupName(group, viewRef.current?.text ?? "")}: ${summary}.`, actionLabel: "Undo", undo: true, onAction: () => { void reopen(group); } });
    return true;
  };
  const annotate = (group: ConsolidationGroupView, payload: ConsolidationAnnotatePayload) => data.annotate(group.group_id, payload);

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
    setAdding(false);
    const ok = await data.addFinding({ ...addTarget, termId: candidate.term_id, searchId, segments: [range], axes: addTarget.axes });
    if (ok) { setRange(null); show({ message: `Finding added: ${candidate.label} (${candidate.term_id}).` }); }
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
  const submit = async (acknowledged: boolean) => {
    setDialog(current => ({ ...current, busy: true, error: null }));
    try {
      const result = await data.submit(acknowledged && dialog.warning ? dialog.warning.acknowledgement : undefined);
      if (result.kind === "warning") { setDialog(current => ({ ...current, busy: false, warning: result.warning })); return; }
      setDialog({ open: false, busy: false, warning: null, error: null });
      // A submitted round has nothing left to undo.
      dismiss();
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

  const reason = view.read_only ? READ_ONLY_REASONS[view.read_only_reason ?? ""] ?? "This consolidation is read-only." : null;
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
          { id: "finalization", title: "Finalization", state: finalizationState(open, groups.length), tone: "now" },
        ]} />
        <h1 id="cons-title" className="cons-title"><LanguageText text={headerTitle(view, readOnly && !submitted)} code={view.language} /></h1>
      </div>
      {props.headerActions && <div className="cons-header-actions" role="group" aria-label="Task">{props.headerActions}</div>}
      {!readOnly && <div ref={submitRef}><SubmitBar open={open} onSubmit={() => setDialog({ open: true, busy: false, warning: null, error: null })}
        onNextOpen={() => { const next = nextOpenAfter(groups, selected); if (next) select(next, true); }} /></div>}
    </header>
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
          onSelect={groupId => select(groupId)} onSelectGroup={groupId => select(groupId, true)} onResolve={resolve} onAnnotate={annotate} onReopen={reopen}
          onDismissOutcome={data.dismissOutcome} onEditInEditor={editInEditor}
          toggleRef={groupId => element => { if (element) toggles.current.set(groupId, element); else toggles.current.delete(groupId); }} />
        {added.length > 0 && <section className="cons-added-list" aria-label="Added findings">
          <h2 className="cons-subheading">{addedHeading(props.assignmentId !== undefined, view.added_by)}</h2>
          <ul>{added.map(finding => <li key={finding.annotationId}>{finding.label}, {finding.spans.map(([start, end]) => `“${Array.from(view.text).slice(start, end).join("")}”`).join(" … ")}</li>)}</ul>
        </section>}
      </div>
    </div>
    {typing && <PassageForm text={view.text} anchorRef={addRef} onPick={pickPassage} onClose={() => setTyping(false)} />}
    {data.workspace && addTarget && <TermPicker open={adding} anchorRef={addRef} label="Add finding" workspace={data.workspace} layerId={addTarget.layerId}
      initialQuery={range ? prefillQuery(view.text, [range]) : undefined} onClose={() => setAdding(false)} onPick={(candidate, searchId) => { void addFinding(candidate, searchId); }} />}
    <SummaryDialog open={dialog.open} summary={summaryText(groups, added.length)} busy={dialog.busy} warning={dialog.warning} error={dialog.error}
      onSubmit={acknowledged => { void submit(acknowledged); }} onClose={() => setDialog({ open: false, busy: false, warning: null, error: null })} />
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    <Toast toast={toast} onDismiss={dismiss} undoDescription="Undo the last decision" undoGroup="Consolidation" />
  </section>;
}
