import { useState, type ReactNode } from "react";
import type { PracticeTask } from "../api/client";
import { MY_TASKS, routeHref, type Route } from "../app/router";
import { Button, IconCheck } from "../ui";
import { PracticePill } from "./PracticeOnMyTasks";
import { practiceProgress } from "./practiceSteps";
import { usePractice } from "./usePractice";
import "./practice.css";

export const PRACTICE_BANNER = "Practice: nothing here counts. Invented texts only.";
// The steps tick themselves after the editor saved: the state is read again this often while visible.
const POLL_MS = 4000;

/** "Your practice": the steps of one practice task, ticked from its real state, and the next one's hint. */
export function PracticePanel({ task }: { task: PracticeTask }): JSX.Element {
  const { steps, next } = practiceProgress(task);
  return <details className="practice-panel" open aria-label="Your practice">
    <summary>Your practice</summary>
    <ol className="practice-steps">
      {steps.map(({ step, done }) => <li key={step.id} className={done ? "practice-step practice-step--done" : "practice-step"} data-done={done}>
        <span className="practice-step__mark" aria-hidden="true">{done ? <IconCheck /> : null}</span>
        <span>{step.label}<span className="visually-hidden">{done ? ", done" : ", open"}</span></span>
        <a className="practice-step__help" href={routeHref({ name: "help", ...step.help })} target="_blank" rel="noopener noreferrer">Help</a>
      </li>)}
    </ol>
    <p className="practice-next" role="status">{next ? <><strong>Next:</strong> {next.hint}</> : "All steps done. Well done."}</p>
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
  if (!task) return <>{children}</>;
  return <>
    <div className="practice-banner" role="note" data-testid="practice-banner">
      <PracticePill /> <span>{PRACTICE_BANNER}</span>
      <Button size="sm" onClick={() => onNavigate(MY_TASKS)}>Leave practice</Button>
    </div>
    <PracticePanel task={task} />
    {children}
  </>;
}
