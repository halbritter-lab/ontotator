import { useState, type ReactNode } from "react";
import type { PracticeTask } from "../api/client";
import { MY_TASKS, routeHref, type Route } from "../app/router";
import { Button, IconCheck } from "../ui";
import { PracticePill } from "./PracticeOnMyTasks";
import { practiceProgress } from "./practiceSteps";
import { usePractice } from "./usePractice";
import "./practice.css";

export const PRACTICE_BANNER = "Nothing here counts. Invented texts only.";
// The steps tick themselves after the editor saved: the state is read again this often while visible.
const POLL_MS = 4000;

/**
 * "Your practice": the steps of one practice task, ticked from its real state. It starts folded to one line
 * ("Your practice · 1 of 5 · Next: …"), so the editor keeps its height; the steps open on click.
 */
export function PracticePanel({ task }: { task: PracticeTask }): JSX.Element {
  const { steps, next } = practiceProgress(task);
  const done = steps.filter(item => item.done).length;
  return <details className="practice-panel" aria-label="Your practice">
    <summary>
      <span className="practice-panel__title">Your practice</span>
      <span className="practice-panel__count">{` · ${done} of ${steps.length}`}</span>
      <span className="practice-next" role="status">{" · "}{next ? <><strong>Next:</strong> {next.hint}</> : "All steps done. Well done."}</span>
    </summary>
    <ol className="practice-steps">
      {steps.map(({ step, done: ticked }) => <li key={step.id} className={ticked ? "practice-step practice-step--done" : "practice-step"} data-done={ticked}>
        {/* A status marker, not a control: steps tick themselves. */}
        <span className="practice-step__mark" aria-hidden="true">{ticked ? <IconCheck /> : null}</span>
        <span>{step.label}<span className="visually-hidden">{ticked ? ", done" : ", not done"}</span></span>
        <a className="practice-step__help" href={routeHref({ name: "help", ...step.help })} target="_blank" rel="noopener noreferrer">Help</a>
      </li>)}
    </ol>
  </details>;
}

/**
 * Wraps the task page (issue 266): a practice task gets the banner with "Leave practice" and the panel
 * "Your practice"; any other task is shown unchanged.
 */
export function PracticeFrame({ assignmentId, onNavigate, children }: {
  assignmentId: number;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}): JSX.Element {
  // Only a practice task polls; any other task reads the practice state once.
  const [polling, setPolling] = useState(false);
  const { load } = usePractice(polling ? POLL_MS : undefined);
  const task = load.kind === "ready" ? load.state.project?.tasks.find(item => item.assignment_id === assignmentId) : undefined;
  if (!!task !== polling) setPolling(!!task);
  // One stable tree for every task: the task below never remounts when the practice state arrives (a remount
  // would open the task twice). A practice task adds the banner and the folded panel on their own rows.
  return <div className="practice-frame">
    {task && <div className="practice-banner" role="note" data-testid="practice-banner">
      <PracticePill /> <span>{PRACTICE_BANNER}</span>
      <Button size="sm" onClick={() => onNavigate(MY_TASKS)}>Leave practice</Button>
    </div>}
    {task && <PracticePanel task={task} />}
    <div className="practice-frame__task">{children}</div>
  </div>;
}
