import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { IconClose, IconUndo } from "./icons";
import { useShortcut } from "./shortcuts";

export interface ToastMessage { id: number; message: string; actionLabel?: string; onAction?: () => void; note?: string }

let nextId = 1;

/** One toast at a time: `show` replaces the current one. */
export function useToast(): { toast: ToastMessage | null; show: (t: Omit<ToastMessage, "id">) => void; dismiss: () => void } {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((t: Omit<ToastMessage, "id">) => setToast({ ...t, id: nextId++ }), []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}

/**
 * Polite toast for reversible saved changes. The region is always rendered so screen readers pick up new
 * messages; the toast never takes focus, closes after `durationMs` (paused while hovered or focused) and its
 * action also runs on Ctrl+Z / Meta+Z outside text fields.
 */
export function Toast({ toast, onDismiss, durationMs = 10_000 }: { toast: ToastMessage | null; onDismiss: () => void; durationMs?: number }): JSX.Element {
  const [paused, setPaused] = useState({ hover: false, focus: false });
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const holding = paused.hover || paused.focus;

  useEffect(() => { setPaused({ hover: false, focus: false }); }, [toast?.id]);
  useEffect(() => {
    if (!toast || holding) return;
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, holding, durationMs]);

  const runAction = () => {
    if (!toast?.onAction) return;
    const action = toast.onAction;
    onDismiss();
    action();
  };
  // Checkboxes and radios are not typing targets, so this also works from a focused case checkbox.
  useShortcut(["Ctrl+z", "Meta+z"], runAction, { scope: "screen", description: "Undo the last plan change", group: "Selection", enabled: !!toast?.onAction });

  return (
    <div role="status" aria-live="polite" className="ui-toast-region">
      {toast && (
        <div
          key={toast.id}
          className="ui-toast"
          onMouseEnter={() => setPaused((p) => ({ ...p, hover: true }))}
          onMouseLeave={() => setPaused((p) => ({ ...p, hover: false }))}
          onFocus={() => setPaused((p) => ({ ...p, focus: true }))}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused((p) => ({ ...p, focus: false })); }}
        >
          <span className="ui-toast-message">{toast.message}</span>
          {toast.note && <span className="ui-toast-note">{toast.note}</span>}
          {toast.onAction && <Button size="sm" variant="quiet" className="ui-toast-action" icon={<IconUndo />} onClick={runAction}>{toast.actionLabel ?? "Undo"}</Button>}
          <IconButton size="sm" variant="quiet" className="ui-toast-close" label="Dismiss" icon={<IconClose />} onClick={onDismiss} />
        </div>
      )}
    </div>
  );
}
