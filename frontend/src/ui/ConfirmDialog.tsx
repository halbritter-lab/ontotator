import { useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Start focus on the confirm button (for keyboard flows such as Ctrl+Enter, Enter). */
  focusConfirm?: boolean;
}
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = "Cancel", tone = "primary", busy = false, onConfirm, onCancel, focusConfirm = false }: ConfirmDialogProps): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return <Dialog open={open} title={title} size="sm" onClose={busy ? undefined : onCancel} initialFocus={focusConfirm ? confirmRef : undefined} footer={<>
    <Button disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
    <Button ref={confirmRef} variant={tone} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
  </>}>{message}</Dialog>;
}
