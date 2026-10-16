import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, ApiError, type AssignmentOpenRequest, type AssignmentWorkspace, type CurrentUser, type TaskSummary } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Dialog, EmptyState, InlineMessage, Select } from "../ui";
import { CaseScreen } from "../app/CaseScreen";
import { CaseErrorBoundary } from "../app/ErrorBoundary";
import { routeHref, type Route, type RouteLeaveGuard } from "../app/router";
import { NotFound } from "../app/NotFound";

interface TaskEditorProps {
  assignmentId: number;
  user: CurrentUser;
  onNavigate: (route: Route) => void;
  routeLeaveRef: MutableRefObject<RouteLeaveGuard | null>;
  leaveGuardRef: MutableRefObject<((proceed: () => void) => void) | null>;
}

export function TaskEditor({ assignmentId, user, onNavigate, routeLeaveRef, leaveGuardRef }: TaskEditorProps): JSX.Element {
  const [workspace, setWorkspace] = useState<AssignmentWorkspace | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [submittedElsewhere, setSubmittedElsewhere] = useState(false);
  const [round, setRound] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const taskGeneration = useRef(0);
  const selectedRound = useRef<AssignmentOpenRequest | undefined>();
  const [taskError, setTaskError] = useState<unknown>(null);
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
  const load = async (selection?: AssignmentOpenRequest) => {
    if (!active.current) return;
    const request = ++generation.current;
    const requestedRound = selection ?? selectedRound.current;
    setLoading(true); setError(null);
    try {
      const opened = requestedRound === undefined ? await api.openAssignment(assignmentId) : await api.openAssignment(assignmentId, requestedRound);
      if (!active.current || request !== generation.current) return;
      selectedRound.current = requestedRound;
      setWorkspace(opened); setRevision(value => value + 1);
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
  const back = () => onNavigate({ name: "tasks" });
  const backLink = <a href={routeHref({ name: "tasks" })} className="btn btn-secondary" onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); back();
  }}>Back to my tasks</a>;
  if (loading) return <InlineMessage tone="info">Opening task...</InlineMessage>;
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
    const unavailable = error instanceof ApiError && ["ASSIGNMENT_REQUIRED", "ASSIGNMENT_NOT_FOUND", "DOCUMENT_NOT_FOUND"].includes(error.code ?? "");
    if (!unavailable && error instanceof ApiError && error.status === 403 && error.code !== "CSRF_FAILED") return <NotFound noAccess onNavigate={onNavigate} />;
    if (!unavailable && error instanceof ApiError && error.status === 404) return <NotFound onNavigate={onNavigate} />;
    return <>{unavailable ? <EmptyState title="This task is no longer assigned to you." /> : <ErrorNotice error={error} />}
      {!unavailable && <Button onClick={() => { void load(); }}>Retry</Button>}{backLink}</>;
  }
  if (!workspace) return <EmptyState title="This task is no longer assigned to you." action={backLink} />;
  const assignment = workspace.assignment;
  const current: TaskSummary = tasks.find(task => task.assignment_id === assignment.id) ?? {
    assignment_id: assignment.id, project_key: assignment.project_key, project_name: assignment.project_key,
    document_id: assignment.document_id, task: assignment.task, status: assignment.status,
    language: workspace.view.document.language, updated_at: assignment.updated_at,
  };
  return <>{submittedElsewhere && <InlineMessage tone="info">Another session submitted this task. Your editor has been reloaded read-only.</InlineMessage>}
    {!!taskError && <><ErrorNotice error={taskError} /><Button onClick={() => { void loadTasks(); }}>Retry task list</Button></>}
    <CaseErrorBoundary key={`${workspace.workspace_id}:${revision}`} onBackToDashboard={back} backLabel="Back to my tasks" onReload={() => { void load(); }}>
    <CaseScreen view={workspace.view} workspaceId={workspace.workspace_id} annotatorName={user.display_name}
      readOnly={workspace.read_only} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef}
      assignmentNavigation={{ tasks, current, onNavigate: id => onNavigate({ name: "task", assignmentId: id }) }}
      onClose={back} onReload={() => load()} onReadonlyRequired={() => { if (active.current) { setSubmittedElsewhere(true); void load(); } }} onSubmitted={() => {
        setWorkspace(value => value ? { ...value, read_only: true } : value);
        // CaseScreen owns the successful-submission dialog; retain its mounted state.
        void loadTasks();
      }} />
  </CaseErrorBoundary></>;
}
