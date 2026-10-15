import type { ReactNode } from "react";
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
}
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = "Cancel", tone = "primary", busy = false, onConfirm, onCancel }: ConfirmDialogProps): JSX.Element {
  return <Dialog open={open} title={title} size="sm" onClose={busy ? undefined : onCancel} footer={<>
    <Button disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
    <Button variant={tone} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
  </>}>{message}</Dialog>;
}
