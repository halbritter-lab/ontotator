import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Dialog } from "./Dialog";
import { useMediaQuery } from "./useMediaQuery";

export interface PopoverProps {
  open: boolean;
  /** The button that opens the popover; it gets focus back on Escape. Give it `aria-expanded` and `aria-controls`. */
  anchorRef: RefObject<HTMLElement>;
  /** Accessible name of the dialog, e.g. "Filter". */
  label: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]';
const GAP = 4;
const EDGE = 8;
function focusables(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest("[hidden],[inert]"));
}

/**
 * Anchored, non-modal `role="dialog"` below its button. Focus moves to the first control inside; Tab cycles inside;
 * Escape closes and returns focus to the anchor; a pointer down outside closes without moving focus.
 * Below 700 px it is a full-height sheet: a modal `Dialog` with class `ui-popover-sheet`.
 */
export function Popover({ open, anchorRef, label, onClose, width = 360, children, footer }: PopoverProps): JSX.Element | null {
  const narrow = useMediaQuery("(max-width: 699px)");
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
    setPosition({ top: rect.bottom + GAP, left: Math.min(Math.max(EDGE, rect.left), maxLeft) });
  }, [anchorRef, width]);

  useLayoutEffect(() => {
    if (!open || narrow) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, narrow, place]);

  useLayoutEffect(() => {
    if (!open || narrow || !panel.current) return;
    (focusables(panel.current)[0] ?? panel.current).focus();
  }, [open, narrow]);

  useEffect(() => {
    if (!open || narrow) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchorRef.current?.contains(target)) closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, narrow, anchorRef]);

  if (!open) return null;
  if (narrow) return <Dialog open title={label} onClose={onClose} className="ui-popover-sheet" footer={footer}>{children}</Dialog>;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // Consumed here so page-level Escape shortcuts do not also run.
      event.preventDefault(); event.stopPropagation();
      onClose();
      anchorRef.current?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusables(event.currentTarget);
    const first = elements[0]; const last = elements.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last!.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div ref={panel} role="dialog" aria-label={label} tabIndex={-1} className="ui-popover" onKeyDown={onKeyDown}
    style={{ position: "fixed", top: `${position?.top ?? 0}px`, left: `${position?.left ?? 0}px`, width: `${width}px` }}>
    <div className="ui-popover-body">{children}</div>
    {footer != null && <div className="ui-popover-footer">{footer}</div>}
  </div>;
}
