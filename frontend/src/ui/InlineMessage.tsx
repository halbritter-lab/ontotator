import type { ReactNode } from "react";
import { IconButton } from "./IconButton";
import { IconClose } from "./icons";

export function InlineMessage({ tone, title, children, onDismiss, "aria-label": ariaLabel, live = true }: {
  tone: "info" | "success" | "warning" | "error";
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  "aria-label"?: string;
  /** False inside a live region the caller owns: the message gets no status/alert role of its own. */
  live?: boolean;
}): JSX.Element {
  return (
    <div className={`notice notice-${tone}`} role={!live ? undefined : tone === "error" ? "alert" : "status"} aria-label={ariaLabel}>
      <div className="notice-content">{title && <strong className="notice-title">{title}</strong>}{children}</div>
      {onDismiss && <IconButton variant="quiet" size="sm" label="Dismiss message" icon={<IconClose />} onClick={onDismiss} />}
    </div>
  );
}
