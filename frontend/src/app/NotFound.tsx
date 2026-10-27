import { MY_TASKS, routeHref, type Route } from "./router";
import { onSpaceActivate } from "../ui/spaceActivates";

export interface NotFoundProps {
  noAccess?: boolean;
  /** What is unavailable ("Task not found or not yours"); defaults to the page wording. */
  title?: string;
  /** One line on why, without telling apart "missing" and "not yours". */
  reason?: string;
  onNavigate: (route: Route) => void;
}

/** The one not-found / no-access page (X-4): an h1, a reason, one way back to My tasks, never a Retry. */
export function NotFound({ noAccess = false, title, reason, onNavigate }: NotFoundProps): JSX.Element {
  return <section className="empty-state not-found">
    <h1 className="empty-state-title">{title ?? (noAccess ? "You do not have access to this page." : "This page does not exist.")}</h1>
    {reason && <p className="empty-state-body">{reason}</p>}
    <div className="empty-state-action"><a href={routeHref(MY_TASKS)} className="btn btn-secondary" onKeyDown={onSpaceActivate} onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(MY_TASKS);
    }}>My tasks</a></div>
  </section>;
}

/** A refusal the user cannot fix by retrying: the thing is missing or not theirs (HTTP 403 or 404). */
export const isNotAvailable = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && (error.status === 403 || error.status === 404)
  && !("code" in error && error.code === "CSRF_FAILED");

export const TASK_UNAVAILABLE = "Task not found or not yours";
export const TASK_UNAVAILABLE_REASON = "It does not exist, is not assigned to you, or was withdrawn.";
