import { EmptyState } from "../ui/EmptyState";
import { routeHref, type Route } from "./router";

export interface NotFoundProps {
  noAccess?: boolean;
  onNavigate: (route: Route) => void;
}

export function NotFound({ noAccess = false, onNavigate }: NotFoundProps): JSX.Element {
  return <EmptyState title={noAccess ? "You do not have access to this page." : "This page does not exist."}
    action={<a href={routeHref({ name: "tasks" })} className="btn btn-secondary" onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate({ name: "tasks" });
    }}>My tasks</a>} />;
}
