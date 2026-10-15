import type { ReactNode } from "react";
import { IconCheck, IconClose, IconWarning } from "./icons";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "in_progress": return "info";
    case "completed": case "submitted": case "succeeded": return "success";
    case "reopened": case "queued": case "running": return "warning";
    case "failed": case "invalid": case "revoked": return "danger";
    default: return "neutral";
  }
}

export function StatusBadge({ status, tone, children, title }: {
  status?: string; tone?: StatusTone; children: ReactNode; title?: string;
}): JSX.Element {
  const resolvedTone = tone ?? statusTone(status ?? "");
  const shapes = {
    neutral: <span className="status-pill-dot" />,
    info: <span className="status-pill-ring" />,
    success: <IconCheck />,
    warning: <IconWarning />,
    danger: <IconClose />,
  };
  return <span className={`status-pill status-pill--${resolvedTone}`} title={title}><span className="status-pill-shape" aria-hidden="true">{shapes[resolvedTone]}</span>{children}</span>;
}
