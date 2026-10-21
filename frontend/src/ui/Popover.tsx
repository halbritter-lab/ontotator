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
  /** Tab past the last focusable (or Shift+Tab before the first) closes the popover and lets focus move on; default cycles inside. */
  closeOnTabOut?: boolean;
}

const FOCUSABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]';
const GAP = 4;
const EDGE = 8;
/** Smallest height cap, even when neither side has that much room. */
const MIN_HEIGHT = 120;
/** Matches the stylesheet's `max-height: 70vh`, which the inline cap replaces. */
const MAX_SHARE = 0.7;
function focusables(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest("[hidden],[inert]"));
}

/**
 * Anchored, non-modal `role="dialog"` below its button; above it when there is more room there. Its height is capped
 * to the room on that side and the body scrolls. Focus moves to the first control inside; Tab cycles inside;
 * Escape closes and returns focus to the anchor; a pointer down outside closes without moving focus.
 * With `closeOnTabOut`, Tab out at either end closes it and focus moves on as usual.
 * Below 700 px it is a full-height sheet: a modal `Dialog` with class `ui-popover-sheet`.
 */
export function Popover({ open, anchorRef, label, onClose, width = 360, children, footer, closeOnTabOut = false }: PopoverProps): JSX.Element | null {
  const narrow = useMediaQuery("(max-width: 699px)");
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Natural height (only the stylesheet's 70vh cap): a capped panel can still flip once its content grows.
    const node = panel.current;
    const cap = node?.style.maxHeight ?? "";
    if (node) node.style.maxHeight = "";
    const height = node?.offsetHeight ?? 0;
    if (node) node.style.maxHeight = cap;
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const flip = height > below && above > below;
    const maxHeight = Math.max(MIN_HEIGHT, Math.min(flip ? above : below, Math.floor(window.innerHeight * MAX_SHARE)));
    const top = flip ? Math.max(EDGE, rect.top - GAP - Math.min(height, maxHeight)) : rect.bottom + GAP;
    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
    const left = Math.min(Math.max(EDGE, rect.left), maxLeft);
    setPosition((current) => (current && current.top === top && current.left === left && current.maxHeight === maxHeight ? current : { top, left, maxHeight }));
  }, [anchorRef, width]);

  useLayoutEffect(() => {
    if (!open || narrow) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // Content can grow after opening (search hits arrive): follow the panel and what its body holds.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    const node = panel.current;
    if (observer && node) {
      observer.observe(node);
      for (const child of Array.from(node.querySelector(".ui-popover-body")?.children ?? [])) observer.observe(child);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
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
    const leavesStart = event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget);
    const leavesEnd = !event.shiftKey && document.activeElement === last;
    if (closeOnTabOut && (leavesStart || leavesEnd || !first)) { onClose(); return; }
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last!.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div ref={panel} role="dialog" aria-label={label} tabIndex={-1} className="ui-popover" onKeyDown={onKeyDown}
    style={{ position: "fixed", top: `${position?.top ?? 0}px`, left: `${position?.left ?? 0}px`, width: `${width}px`,
      maxHeight: position ? `${position.maxHeight}px` : undefined }}>
    <div className="ui-popover-body">{children}</div>
    {footer != null && <div className="ui-popover-footer">{footer}</div>}
  </div>;
}
