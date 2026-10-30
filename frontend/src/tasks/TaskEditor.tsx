import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, ApiError, type AssignmentOpenRequest, type AssignmentView, type AssignmentWorkspace, type CurrentUser, type RoundInputView, type TaskSummary, type WorkRoundView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Dialog, InlineMessage, Select, type ToastMessage } from "../ui";
import { CaseScreen } from "../app/CaseScreen";
import { CaseErrorBoundary } from "../app/ErrorBoundary";
import { MY_TASKS, routeHref, type Route, type RouteLeaveGuard } from "../app/router";
import { isNotAvailable, NotFound, TASK_UNAVAILABLE, TASK_UNAVAILABLE_REASON } from "../app/NotFound";
import { useVersionAccess } from "../variants/useVersionAccess";
import { TranslationReviewScreen } from "../translation/TranslationReviewScreen";
import { WorkRoundsDialog } from "./WorkRoundsDialog";
import { TaskProblemActions } from "./TaskProblemActions";
import { TaskGuidelines } from "./TaskGuidelines";
import { notifyTasksChanged } from "./tasksEvents";
import { ReportAnswerNotice } from "../problems/ReportAnswerNotice";
import { roundBadge as roundBadgeOf, roundIdentity } from "../editor/rounds/roundLabels";
import { ConsolidationScreen } from "../consolidation/ConsolidationScreen";
import { onSpaceActivate } from "../ui/spaceActivates";
import { HelpLink } from "../help/HelpLink";
import { helpHref, type HelpScreen } from "../help/sections";

interface TaskEditorProps {
  assignmentId: number;
  user: CurrentUser;
  onNavigate: (route: Route) => void;
  routeLeaveRef: MutableRefObject<RouteLeaveGuard | null>;
  leaveGuardRef: MutableRefObject<((proceed: () => void) => void) | null>;
  onProjectContext?: (projectKey: string) => void;
  /** `"editor"`: the editor even for an active consolidation round, which otherwise opens the consolidation view. */
  view?: "editor";
  /** The app's toast, which outlives this task (M2 M-6: "EN100068 submitted. View result" after opening the next task). */
  showToast?: (toast: Omit<ToastMessage, "id">) => void;
}

/**
 * M2 M-6, for annotations and translation reviews alike (issue 125): no second modal; a toast names the submission
 * ("View result" reopens it read-only) and the next open task of the project opens, else My tasks.
 */
function afterSubmit({ onNavigate, showToast }: Pick<TaskEditorProps, "onNavigate" | "showToast">) {
  return ({ label, assignmentId, next }: { label: string; assignmentId: number; next?: number }) => {
    showToast?.({ message: `${label} submitted.`, actionLabel: "View result", onAction: () => onNavigate({ name: "task", assignmentId }) });
    // The submitted task no longer counts in "My tasks (n)".
    notifyTasksChanged();
    onNavigate(next !== undefined ? { name: "task", assignmentId: next } : MY_TASKS);
  };
}

export function TaskEditor(props: TaskEditorProps): JSX.Element {
  const identity = JSON.stringify([props.user.username, props.assignmentId]);
  const [state, setState] = useState<{ identity: string; assignment?: AssignmentView; error?: unknown } | null>(null);
  const saveBeforeReportRef = useRef<(() => Promise<void>) | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setState(null);
    api.getAssignmentMetadata(props.assignmentId).then(value => {
      if (active) { setState({ identity, assignment: value }); props.onProjectContext?.(value.project_key); }
    }, error => { if (active) setState({ identity, error }); });
    return () => { active = false; };
  }, [identity, retry]);
  if (!state || state.identity !== identity) return <p className="task-loading" role="status">Opening task…</p>;
  if (state.error) return isNotAvailable(state.error) ? <NotFound title={TASK_UNAVAILABLE} reason={TASK_UNAVAILABLE_REASON} onNavigate={props.onNavigate} />
    : <section className="not-found"><ErrorNotice error={state.error} />
      <div className="toolbar"><Button onClick={() => setRetry(n => n + 1)}>Retry</Button><Button onClick={() => props.onNavigate(MY_TASKS)}>Back to my tasks</Button></div></section>;
  if (state.assignment?.task === "translation_review") {
    const assignment = state.assignment;
    // Lead correction shows no problem reporter, whose focus reload otherwise refreshes the task metadata.
    return <TaskGuidelines assignment={assignment} place="header" readOnly={assignment.status === "submitted" || assignment.held}
      onRefresh={assignment.lead_correction ? value => setState({ identity, assignment: value }) : undefined}>{guidelines => <>
      <TranslationReviewScreen key={identity} assignmentId={props.assignmentId} username={props.user.username}
        held={assignment.held} holdReason={assignment.hold_reason} saveBeforeReportRef={saveBeforeReportRef}
        guidelineActions={<>{guidelines.button}<HelpLink screen="translationReview" /></>} guidelineNotice={guidelines.notice}
        reportActions={<TaskProblemActions assignment={assignment} onSaveBeforeReport={async () => { await saveBeforeReportRef.current?.(); }} onRefresh={value => setState({ identity, assignment: value })} />}
        onNavigate={props.onNavigate} routeLeaveRef={props.routeLeaveRef} leaveGuardRef={props.leaveGuardRef} onSubmitted={afterSubmit(props)} />
      {guidelines.drawer}
    </>}</TaskGuidelines>;
  }
  return <AnnotationTaskEditor key={identity} {...props} />;
}

function AnnotationTaskEditor({ assignmentId, user, onNavigate, routeLeaveRef, leaveGuardRef, view, showToast }: TaskEditorProps): JSX.Element {
  const [workspace, setWorkspace] = useState<AssignmentWorkspace | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const versionAccess = useVersionAccess(workspace?.assignment.project_key ?? "", user.username);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [submittedElsewhere, setSubmittedElsewhere] = useState(false);
  const [round, setRound] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const taskGeneration = useRef(0);
  const selectedRound = useRef<AssignmentOpenRequest | undefined>();
  const selectedWorkRound = useRef<string | undefined>();
  const [roundDialogOpen, setRoundDialogOpen] = useState(false);
  const [roundInputs, setRoundInputs] = useState<RoundInputView[]>([]);
  const [roundInfo, setRoundInfo] = useState<WorkRoundView | null>(null);
  const [taskError, setTaskError] = useState<unknown>(null);
  const saveBeforeReportRef = useRef<(() => Promise<void>) | null>(null);
  const loadTasks = async () => {
    const request = ++taskGeneration.current;
    setTaskError(null);
    try {
      const value = await api.listMyTasks();
      if (active.current && request === taskGeneration.current) setTasks(value);
    } catch (failure) {
      if (active.current && request === taskGeneration.current) setTaskError(failure);
    }
  };
  const load = async (selection?: AssignmentOpenRequest, workRoundId?: string) => {
    if (!active.current) return;
    const request = ++generation.current;
    const requestedRound = selection ?? selectedRound.current;
    const requestedWorkRound = workRoundId ?? selectedWorkRound.current;
    setLoading(true); setError(null);
    try {
      const opened: AssignmentWorkspace = requestedWorkRound
        ? await Promise.all([api.openWorkRound(requestedWorkRound), api.getAssignmentMetadata(assignmentId)]).then(([value, assignment]) => ({ ...value, assignment }))
        : requestedRound === undefined ? await api.openAssignment(assignmentId) : await api.openAssignment(assignmentId, requestedRound);
      const roundId = opened.view.key.round_id;
      const [inputs, rounds] = roundId ? await Promise.all([api.listRoundInputs(roundId), api.listWorkRounds(assignmentId)]) : [[], []];
      if (!active.current || request !== generation.current) return;
      selectedRound.current = requestedRound;
      selectedWorkRound.current = requestedWorkRound;
      const info = rounds.find(value => value.round_id === roundId) ?? null;
      const editableState = info ? info.active && info.state === "editable" : opened.assignment.status !== "submitted";
      setRoundInputs(inputs); setRoundInfo(info);
      setWorkspace({ ...opened, read_only: opened.read_only && (!opened.assignment.held || !editableState) }); setRevision(value => value + 1);
    } catch (failure) {
      if (active.current && request === generation.current) setError(failure);
    } finally { if (active.current && request === generation.current) setLoading(false); }
  };
  useEffect(() => {
    active.current = true;
    void load();
    void loadTasks();
    return () => { active.current = false; generation.current++; taskGeneration.current++; };
  }, [assignmentId]);
  const back = () => onNavigate(MY_TASKS);
  const backLink = <a href={routeHref(MY_TASKS)} className="btn btn-secondary" onKeyDown={onSpaceActivate} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); back();
  }}>Back to my tasks</a>;
  if (loading) return <p className="task-loading" role="status">Opening task…</p>;
  if (error) {
    const rounds: string[] = error instanceof ApiError && error.code === "AMBIGUOUS_REVIEW_ROUND"
      && typeof error.details === "object" && Array.isArray(error.details?.rounds) ? error.details.rounds.filter((value): value is string => typeof value === "string") : [];
    if (rounds.length > 0) return <Dialog open title="Select review round" onClose={back}>
      <p>Select the review round to resume.</p>
      <Select id="review-round" label="Review round" value={round} onChange={event => setRound(event.target.value)}>
        <option value="">Select a round</option>
        {rounds.map(value => <option key={value} value={value}>{value}</option>)}
      </Select>
      <Button disabled={!rounds.includes(round)} onClick={() => { if (rounds.includes(round)) void load({ review_round_target_set_id: round }); }}>Resume round</Button>
      <Button onClick={back}>Back to my tasks</Button>
    </Dialog>;
    if (error instanceof ApiError && error.code === "TRANSLATION_NOT_ACCEPTED" && typeof error.details === "object" && error.details?.waiting_for_lead === true) return <NotFound title="Waiting for the project lead"
      reason="The text of this task was corrected. The project lead decides how the task continues." onNavigate={onNavigate} />;
    if (error instanceof ApiError && error.code === "TASK_WAITING_FOR_TRANSLATION_REVIEW") return <NotFound title="Waiting for translation review"
      reason="This task opens by itself once the translation review of the text is accepted. Until then it waits in My tasks." onNavigate={onNavigate} />;
    if (isNotAvailable(error)) return <NotFound title={TASK_UNAVAILABLE} reason={TASK_UNAVAILABLE_REASON} onNavigate={onNavigate} />;
    return <section className="not-found"><ErrorNotice error={error} />
      <div className="toolbar"><Button onClick={() => { void load(); }}>Retry</Button>{backLink}</div></section>;
  }
  if (!workspace) return <NotFound title={TASK_UNAVAILABLE} reason={TASK_UNAVAILABLE_REASON} onNavigate={onNavigate} />;
  const assignment = workspace.assignment;
  // An active consolidation round opens the consolidation view (acceptance fixes WP-E); "Edit in editor…" adds view=editor.
  if (roundInfo?.kind === "consolidation" && roundInfo.active && view !== "editor") {
    // The task's guidelines and "Report a text problem" stay at hand: the consolidator decides guideline questions.
    return <TaskGuidelines assignment={assignment} place="header" readOnly={workspace.read_only || assignment.held}>{guidelines => <>
      <ConsolidationScreen projectKey={assignment.project_key} roundId={roundInfo.round_id} assignmentId={assignmentId}
        onNavigate={onNavigate} workspaceView={workspace.read_only ? null : workspace.view} notice={guidelines.notice}
        headerActions={<>{guidelines.button}<HelpLink screen="consolidation" />
          {/* Group commands save at once: nothing to save before a report. */}
          <TaskProblemActions assignment={assignment} readOnly={workspace.read_only} onSaveBeforeReport={async () => undefined} onRefresh={value => {
            setWorkspace(current => current ? { ...current, assignment: value } : current); void loadTasks();
          }} /></>} />
      {guidelines.drawer}
    </>}</TaskGuidelines>;
  }
  const openRound = async (roundId: string) => {
    if (routeLeaveRef.current && !await routeLeaveRef.current()) return;
    selectedWorkRound.current = roundId; setRoundDialogOpen(false);
    await load(undefined, roundId);
  };
  const current: TaskSummary = tasks.find(task => task.assignment_id === assignment.id) ?? {
    assignment_id: assignment.id, project_key: assignment.project_key, project_name: assignment.project_key,
    document_id: assignment.document_id, task: assignment.task, status: assignment.status,
    language: workspace.view.document.language, updated_at: assignment.updated_at,
    workflow_revision: assignment.workflow_revision, held: assignment.held, hold_reason: assignment.hold_reason, report_answered: false, waiting_for_translation_review: false, waiting_for_lead: false,
  };
  // Toolbar identity (spec section 7): short badge, full identity line as its title.
  const roundBadge = roundBadgeOf(roundInfo);
  const helpScreen: HelpScreen = roundInfo?.kind === "text_change" ? "editorTextChange"
    : roundInfo?.kind === "carry_forward" || roundInfo?.kind === "handover" ? "editorCarried"
    : workspace.view.key.mode === "review" ? "consolidationEditor"
    : workspace.view.key.mode === "proposal_check" ? "editorProposals" : "editorScratch";
  const roundTitle = roundInfo ? roundIdentity(roundInfo) : undefined;
  return <TaskGuidelines assignment={assignment} place="more" readOnly={workspace.read_only || assignment.held}>{guidelines => <>{submittedElsewhere && <InlineMessage tone="info">Another session submitted this task. Your editor has been reloaded read-only.</InlineMessage>}
    {!!taskError && <><ErrorNotice error={taskError} /><Button onClick={() => { void loadTasks(); }}>Retry task list</Button></>}
    {/* "Report a text problem" sits in the header's "More" menu; its dialogs stay mounted here. */}
    <TaskProblemActions assignment={assignment} readOnly={workspace.read_only} onSaveBeforeReport={async () => { await saveBeforeReportRef.current?.(); }} onRefresh={value => {
      setWorkspace(current => current ? { ...current, assignment: value } : current); void loadTasks();
    }} renderEntry={problemItem => <>
    <CaseErrorBoundary key={`${workspace.workspace_id}:${revision}`} onBackToDashboard={back} backLabel="Back to my tasks" onReload={() => { void load(); }}>
    <CaseScreen view={workspace.view} workspaceId={workspace.workspace_id} annotatorName={user.display_name} userPseudonym={user.pseudonym}
      menuItems={[{ id: "rounds", label: "Work rounds", onSelect: () => {
        // Save pending edits first: the dialog tells an untouched round from one with saved work.
        void (saveBeforeReportRef.current?.() ?? Promise.resolve()).catch(() => undefined).then(() => { if (active.current) setRoundDialogOpen(true); });
      } }, problemItem, ...(guidelines.item ? [guidelines.item] : []),
        { id: "help", label: "Help for this screen", onSelect: () => window.open(helpHref(helpScreen), "_blank", "noopener,noreferrer") }]}
      roundInputs={roundInputs} roundKind={roundInfo?.kind} roundActive={roundInfo?.active} roundBadge={roundBadge} roundTitle={roundTitle}
      roundOrdinal={roundInfo?.round_ordinal} documentVersion={roundInfo?.document_version}
      held={assignment.held} holdReason={assignment.hold_reason} saveBeforeReportRef={saveBeforeReportRef}
      guidelineNotice={<>{/* Reloads when a lead acts on the task (revision) or a new answer arrives (My tasks list). */}
        <ReportAnswerNotice key={`${assignment.workflow_revision}:${current.answered_report_id ?? ""}`} projectKey={assignment.project_key}
          assignmentId={assignment.id} held={assignment.held} onNavigate={onNavigate} />{guidelines.notice}</>}
      versionContext={{ username: user.username, assignmentId, onNavigate, canBrowseVersions: versionAccess.allowed }}
      readOnly={workspace.read_only} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef}
      assignmentNavigation={{ tasks, current, onNavigate: id => onNavigate({ name: "task", assignmentId: id }),
        // M2 M-6: no second modal; the next task opens (same order as My tasks), else My tasks.
        onSubmitted: afterSubmit({ onNavigate, showToast }) }}
      onClose={back} onReload={() => load()} onReadonlyRequired={() => { if (active.current) { setSubmittedElsewhere(true); void load(); } }} onSubmitted={() => {
        setWorkspace(value => value ? { ...value, read_only: true } : value);
        void loadTasks(); notifyTasksChanged();
      }} />
  </CaseErrorBoundary>
    </>} />
  {roundDialogOpen && <WorkRoundsDialog assignment={assignment} currentRoundId={workspace.view.key.round_id ?? undefined}
    documentLabel={{ textId: assignment.document_id, language: roundInfo?.document_language ?? workspace.view.document.language }} onClose={() => setRoundDialogOpen(false)} onOpen={openRound}
    onReload={() => { setRoundDialogOpen(false); void load(); }} onCreate={async request => {
      if (routeLeaveRef.current && !await routeLeaveRef.current()) return;
      const created = await api.startWorkRound(assignmentId, request);
      selectedWorkRound.current = created.round_id; setRoundDialogOpen(false);
      await load(undefined, created.round_id);
    }} />}
  {guidelines.drawer}
  </>}</TaskGuidelines>;
}
