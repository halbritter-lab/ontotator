import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { IconCheck, IconClose, IconUndo } from "./icons";
import { useShortcut } from "./shortcuts";

export interface ToastMessage {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The action reverts the reported change: it shows the undo icon and runs on Ctrl+Z / Meta+Z. */
  undo?: boolean;
  note?: string;
  /** Stays until dismissed or replaced (an offer the user may need after the next action, e.g. skipped cases). */
  persist?: boolean;
}

/** Controls that sit at the viewport bottom and must stay visible: the floating selection bar and dialog footers. */
const BOTTOM_OBSTACLES = ".selection-bar, .ui-dialog > .modal-actions";
/** An obstacle counts when its bottom edge is this close to the viewport bottom. */
const BOTTOM_ZONE = 48;

/** Height the toast must clear above the viewport bottom (0 without an obstacle there). */
function bottomOffset(): number {
  const height = window.innerHeight;
  let offset = 0;
  for (const element of document.querySelectorAll<HTMLElement>(BOTTOM_OBSTACLES)) {
    const box = element.getBoundingClientRect();
    if (box.height <= 0 || box.top >= height || box.bottom < height - BOTTOM_ZONE) continue;
    offset = Math.max(offset, Math.ceil(height - box.top));
  }
  return offset;
}

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
 * messages; the toast never takes focus, closes after `durationMs` (paused while hovered or focused; never with `persist`) and its
 * Undo action also runs on Ctrl+Z / Meta+Z outside text fields. It sits above the floating selection bar or a
 * dialog footer at the viewport bottom (`--toast-offset`).
 */
export function Toast({ toast, onDismiss, durationMs = 10_000, undoDescription = "Undo the last plan change", undoGroup = "Selection" }: {
  toast: ToastMessage | null; onDismiss: () => void; durationMs?: number;
  /** The Ctrl+Z line of the shortcut help ("Undo the last decision" in the consolidation view). */
  undoDescription?: string; undoGroup?: string;
}): JSX.Element {
  const [paused, setPaused] = useState({ hover: false, focus: false });
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const holding = paused.hover || paused.focus;
  const region = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    if (!toast) { element.style.setProperty("--toast-offset", "0px"); return; }
    let frame = 0;
    const measure = () => { element.style.setProperty("--toast-offset", `${bottomOffset()}px`); };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    // A dialog or the selection bar can appear while the toast is visible.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    // The selection bar slides in (8 px): measured mid-animation, the toast would cover its top edge.
    document.addEventListener("animationend", schedule, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("animationend", schedule, true);
    };
  }, [toast]);

  useEffect(() => { setPaused({ hover: false, focus: false }); }, [toast?.id]);
  useEffect(() => {
    if (!toast || holding || toast.persist) return;
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
  useShortcut(["Ctrl+z", "Meta+z"], runAction, { scope: "screen", description: undoDescription, group: undoGroup, enabled: !!toast?.onAction && !!toast.undo });

  return (
    <div ref={region} role="status" aria-live="polite" className="ui-toast-region">
      {toast && (
        <div
          key={toast.id}
          className="ui-toast"
          onMouseEnter={() => setPaused((p) => ({ ...p, hover: true }))}
          onMouseLeave={() => setPaused((p) => ({ ...p, hover: false }))}
          onFocus={() => setPaused((p) => ({ ...p, focus: true }))}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused((p) => ({ ...p, focus: false })); }}
        >
          <span className="ui-toast-message" title={toast.message}>{toast.message}</span>
          {toast.note && <span className="ui-toast-note">{toast.note}</span>}
          {toast.onAction && <Button size="sm" className="ui-toast-action" icon={toast.undo ? <IconUndo className="ui-toast-undo-icon" /> : <IconCheck />} onClick={runAction}>{toast.actionLabel ?? "Undo"}</Button>}
          <IconButton size="sm" variant="quiet" className="ui-toast-close" label="Dismiss" icon={<IconClose />} onClick={onDismiss} />
        </div>
      )}
    </div>
  );
}
