import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { IconButton } from "./IconButton";
import { IconClose } from "./icons";
import { useShortcut } from "./shortcuts";

export interface DialogProps {
  open: boolean;
  title: string;
  heading?: ReactNode;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  initialFocus?: RefObject<HTMLElement>;
  size?: "sm" | "md" | "lg";
  /**
   * `side`: a right panel (480 px, full height, 150 ms slide, a full-screen sheet below 700 px) that ignores `size`,
   * focuses its heading on open (unless `initialFocus`) and makes the rest of the page `inert` while open.
   */
  variant?: "center" | "side";
  /** Extra class on the dialog element (e.g. `ui-popover-sheet`). */
  className?: string;
  footer?: ReactNode;
  /**
   * Focus target when the dialog closes, asked at close time (e.g. the row the panel shows now); null or a
   * missing element falls back to the element focused when the dialog opened, then to the page's main region.
   */
  returnFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
}

const activeDialogs: HTMLElement[] = [];
let originalOverflow = "";
const isActive = (element: HTMLElement) => !element.closest("[inert]") && activeDialogs.filter((dialog) => !dialog.closest("[inert]")).at(-1) === element;
/** True when `element` is the topmost open (non-inert) dialog. */
export const isTopDialog = isActive;
function isRendered(element: HTMLElement): boolean {
  const visibility = getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  // display is not inherited: a visible-looking child can belong to a hidden subtree.
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === "none") return false;
  }
  return true;
}
function focusableElements(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex],[contenteditable="true"]'))
    .filter((item) => item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest('[hidden],[inert],[aria-hidden="true"]') && isRendered(item));
}

type FocusCandidate = () => HTMLElement | null | undefined;
const focusable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  !!element && element !== document.body && element.isConnected && !element.closest("[inert]");
let closing: FocusCandidate[] = [];
/**
 * Second chance once the closing commit is complete (#18): the trigger may have been re-rendered (a renamed row),
 * or a nested dialog closed with its parent. If focus fell to <body>, the first candidate still on the page
 * wins (dialogs in closing order), else the page's main region.
 */
function restoreFocusAfterCommit(candidates: FocusCandidate[]): void {
  if (!closing.length) queueMicrotask(() => {
    const queued = closing;
    closing = [];
    if (activeDialogs.length || (document.activeElement && document.activeElement !== document.body)) return;
    for (const candidate of queued) {
      const element = candidate();
      if (focusable(element)) { element.focus(); return; }
    }
    document.getElementById("main")?.focus();
  });
  closing.push(...candidates);
}

/** Makes every sibling of `element` and of each of its ancestors `inert`; returns the elements it changed. */
function inertOutside(element: HTMLElement): Element[] {
  const changed: Element[] = [];
  for (let node: Element = element; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute("inert") || ["SCRIPT", "STYLE", "TEMPLATE"].includes(sibling.tagName)) continue;
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
  }
  return changed;
}

export function Dialog({ open, title, heading, onClose, closeOnBackdrop = false, initialFocus, size = "md", variant = "center", className, footer, returnFocus, children }: DialogProps): JSX.Element | null {
  const content = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const side = variant === "side";
  const requestedFocus = useRef(initialFocus);
  requestedFocus.current = initialFocus;
  const returnTarget = useRef(returnFocus);
  returnTarget.current = returnFocus;
  useShortcut("Escape", () => {
    if (!content.current || !isActive(content.current)) return false;
    onClose?.();
  }, { scope: "dialog", allowInInputs: true, enabled: open, root: content });

  useLayoutEffect(() => {
    const element = content.current;
    if (!open || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!activeDialogs.length) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeDialogs.push(element);
    const inerted = side && element.parentElement ? inertOutside(element.parentElement) : [];
    const focusInside = () => {
      if (!isActive(element)) return;
      const requested = requestedFocus.current?.current;
      // The header close button is reachable by Tab but never receives initial focus.
      const candidates = focusableElements(element).filter((item) => !item.hasAttribute("data-dialog-close"));
      (requested && element.contains(requested) ? requested : (side ? headingRef.current : candidates[0]) ?? element).focus();
    };
    focusInside();
    const containFocus = (event: FocusEvent) => {
      if (isActive(element) && !element.contains(event.target as Node)) focusInside();
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      for (const item of inerted) item.removeAttribute("inert");
      const wasTop = activeDialogs.at(-1) === element;
      activeDialogs.splice(activeDialogs.indexOf(element), 1);
      if (!activeDialogs.length) document.body.style.overflow = originalOverflow;
      const candidates: FocusCandidate[] = [() => returnTarget.current?.(), () => previous];
      if (wasTop) candidates.map((candidate) => candidate()).find(focusable)?.focus();
      restoreFocusAfterCommit(candidates);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={side ? "modal-overlay modal-overlay--side" : "modal-overlay"} onClick={(event) => {
      if (event.target === event.currentTarget && closeOnBackdrop && content.current && isActive(content.current)) onClose?.();
    }}>
      <div ref={content} className={["modal-content", "ui-dialog", side ? "ui-dialog--side" : `ui-dialog--${size}`, className].filter(Boolean).join(" ")} role="dialog" aria-modal="true"
        {...(heading == null ? { "aria-labelledby": headingId } : { "aria-label": title })} tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || !isActive(event.currentTarget)) return;
          const elements = focusableElements(event.currentTarget);
          const first = elements[0]; const last = elements.at(-1);
          if (!first) { event.preventDefault(); event.currentTarget.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget || (side && document.activeElement === headingRef.current))) { event.preventDefault(); last!.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
        }}>
        <div className="ui-dialog-header">
          <h2 ref={headingRef} id={headingId} className="ui-dialog-heading" tabIndex={side ? -1 : undefined}>{heading ?? title}</h2>
          {onClose && <IconButton className="ui-dialog-close" label="Close" icon={<IconClose />} variant="quiet" size="sm" data-dialog-close onClick={onClose} />}
        </div>
        <div className="ui-dialog-body">{children}</div>
        {footer != null && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}
