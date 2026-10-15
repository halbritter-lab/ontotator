import type { ReactNode } from "react";
import { IconButton } from "./IconButton";
import { IconClose } from "./icons";

export function InlineMessage({ tone, title, children, onDismiss, "aria-label": ariaLabel }: {
  tone: "info" | "success" | "warning" | "error";
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  "aria-label"?: string;
}): JSX.Element {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"} aria-label={ariaLabel}>
      <div className="notice-content">{title && <strong className="notice-title">{title}</strong>}{children}</div>
      {onDismiss && <IconButton variant="quiet" size="sm" label="Dismiss message" icon={<IconClose />} onClick={onDismiss} />}
    </div>
  );
}
