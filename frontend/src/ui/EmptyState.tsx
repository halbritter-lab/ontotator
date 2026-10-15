import type { ReactNode } from "react";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }): JSX.Element {
  return <div className="empty-state"><h2 className="empty-state-title">{title}</h2>{children != null && children !== false && <div className="empty-state-body">{children}</div>}{action != null && action !== false && <div className="empty-state-action">{action}</div>}</div>;
}
