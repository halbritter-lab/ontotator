import { useState, type MouseEvent } from "react";
import { api, type PracticeState, type TaskSummary } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { routeHref, type Route } from "../app/router";
import { Button, ConfirmDialog, DataTable, InlineMessage, StatusBadge, type Column } from "../ui";
import { LanguageText } from "../ui/LanguageTag";
import { taskText } from "../app/identity";
import { assignmentStatusLabels } from "../app/labels";
import { onSpaceActivate } from "../ui/spaceActivates";
import { PRACTICE_TASK_NAMES, tasksDone } from "./practiceSteps";
import { formatDay } from "./usePractice";
import "./practice.css";

export const PRACTICE_CARD_TITLE = "New here? Try it out first";
export const PRACTICE_CARD_TEXT = "A private practice project with short, invented texts in German. Nothing you do there counts, and nobody else sees it.";
export const PRACTICE_GERMAN_HINT = "German is not among the languages in your Profile. You can still try it.";
const PROFILE_ROUTE: Route = { name: "me" };

const follow = (onNavigate: (route: Route) => void, route: Route) => (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); onNavigate(route);
};

/** The "Practice" pill of practice projects and tasks. */
export function PracticePill(): JSX.Element {
  return <span className="practice-pill">Practice</span>;
}

/** "Practice is in your Profile any time." with a link to Profile. */
export function PracticeInProfile({ onNavigate }: { onNavigate: (route: Route) => void }): JSX.Element {
  return <p className="practice-hint">Practice is in your <a href={`${routeHref(PROFILE_ROUTE)}`} onClick={follow(onNavigate, PROFILE_ROUTE)}>Profile</a> any time.</p>;
}

/**
 * My tasks: "New here?" (issue 266). Shown while the user has no practice project and has not hidden the card.
 * "Not now" hides it for good (stored on the server); the line after it says where practice stays.
 */
export function PracticeCard({ state, onChange, onNavigate }: {
  state: PracticeState;
  onChange: (state: PracticeState) => void;
  onNavigate: (route: Route) => void;
}): JSX.Element | null {
  const [busy, setBusy] = useState<"start" | "dismiss" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [why, setWhy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return <PracticeInProfile onNavigate={onNavigate} />;
  if (!state.show_card) return null;
  const start = async () => {
    if (!state.available) { setWhy(true); return; }
    setBusy("start"); setError(null);
    try { onChange(await api.startPractice()); } catch (failure) { setError(failure); } finally { setBusy(null); }
  };
  const notNow = async () => {
    setBusy("dismiss"); setError(null);
    try { onChange(await api.setPracticeCard(false)); setDismissed(true); } catch (failure) { setError(failure); } finally { setBusy(null); }
  };
  return <section className="practice-card" aria-labelledby="practice-card-title">
    <h2 id="practice-card-title">{PRACTICE_CARD_TITLE}</h2>
    <p>{PRACTICE_CARD_TEXT}</p>
    {!state.reads_german && <p className="practice-hint">{PRACTICE_GERMAN_HINT}</p>}
    {why && state.unavailable_message && <InlineMessage tone="info">{state.unavailable_message}</InlineMessage>}
    {error != null && <ErrorNotice error={error} />}
    <div className="toolbar">
      <Button variant="primary" loading={busy === "start"} disabled={busy !== null} onClick={() => { void start(); }}>Try it out</Button>
      <Button loading={busy === "dismiss"} disabled={busy !== null} onClick={() => { void notNow(); }}>Not now</Button>
    </div>
  </section>;
}

/**
 * The practice tasks in their own group (issue 266), never mixed with real tasks. When all are done the group
 * folds to "Practice complete" with Delete.
 */
export function PracticeGroup({ tasks, state, actionLabel, onChange, onNavigate }: {
  tasks: TaskSummary[];
  state: PracticeState | null;
  actionLabel: (task: TaskSummary) => string;
  onChange: (state: PracticeState) => void;
  onNavigate: (route: Route) => void;
}): JSX.Element | null {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (tasks.length === 0) return null;
  const project = state?.project ?? null;
  const done = tasks.filter(task => task.status === "submitted").length;
  const complete = done === tasks.length;
  const kinds = new Map((project?.tasks ?? []).map(task => [task.assignment_id, task.kind]));
  const remove = async () => {
    setBusy(true); setError(null);
    try { onChange(await api.deletePractice()); setConfirm(false); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  const columns: Column<TaskSummary>[] = [
    { id: "text", header: "Text", cell: task => <LanguageText text={taskText(task)} code={task.language} /> },
    { id: "task", header: "Task", cell: task => { const kind = kinds.get(task.assignment_id); return kind ? PRACTICE_TASK_NAMES[kind] : task.task; } },
    { id: "status", header: "Status", cell: task => <StatusBadge status={task.status}>{assignmentStatusLabels[task.status]}</StatusBadge> },
    { id: "open", header: "Action", cell: task => {
      const route: Route = { name: "task", assignmentId: task.assignment_id };
      return <a className="btn btn-secondary" href={routeHref(route)} onKeyDown={onSpaceActivate} onClick={follow(onNavigate, route)}>{actionLabel(task)}</a>;
    } },
  ];
  return <details className="practice-group" open={!complete} data-testid="practice-group">
    <summary>
      <PracticePill /> <span className="practice-group__title">{complete ? "Practice complete" : "Practice"}</span>
      <span className="cell-secondary">{tasksDone(done, tasks.length)}{project ? `, deleted on ${formatDay(project.expires_at)} without activity` : ""}</span>
    </summary>
    {error != null && <ErrorNotice error={error} />}
    {complete && <div className="toolbar"><Button onClick={() => setConfirm(true)}>Delete</Button></div>}
    <DataTable label="Practice tasks" rows={tasks} columns={columns} rowKey={task => String(task.assignment_id)}
      rowProps={task => ({ "data-testid": "practice-task-row", "aria-label": `Practice: ${taskText(task)}` })} />
    <ConfirmDialog open={confirm} title="Delete practice project?" tone="danger" busy={busy} confirmLabel="Delete practice project"
      message={<p>Your practice project and its work are deleted. Nothing else changes. You can start a new one in your Profile.</p>}
      onConfirm={() => { void remove(); }} onCancel={() => setConfirm(false)} />
  </details>;
}
