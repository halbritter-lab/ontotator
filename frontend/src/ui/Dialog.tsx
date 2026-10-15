import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { useShortcut } from "./shortcuts";

export interface DialogProps {
  open: boolean;
  title: string;
  heading?: ReactNode;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  initialFocus?: RefObject<HTMLElement>;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
  children: ReactNode;
}

const activeDialogs: HTMLElement[] = [];
let originalOverflow = "";
const isActive = (element: HTMLElement) => !element.closest("[inert]") && activeDialogs.filter((dialog) => !dialog.closest("[inert]")).at(-1) === element;
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

export function Dialog({ open, title, heading, onClose, closeOnBackdrop = false, initialFocus, size = "md", footer, children }: DialogProps): JSX.Element | null {
  const content = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef(initialFocus);
  requestedFocus.current = initialFocus;
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
    const focusInside = () => {
      if (!isActive(element)) return;
      const requested = requestedFocus.current?.current;
      (requested && element.contains(requested) ? requested : focusableElements(element)[0] ?? element).focus();
    };
    focusInside();
    const containFocus = (event: FocusEvent) => {
      if (isActive(element) && !element.contains(event.target as Node)) focusInside();
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      const wasTop = activeDialogs.at(-1) === element;
      activeDialogs.splice(activeDialogs.indexOf(element), 1);
      if (!activeDialogs.length) document.body.style.overflow = originalOverflow;
      if (wasTop && previous?.isConnected && !previous.closest("[inert]")) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(event) => {
      if (event.target === event.currentTarget && closeOnBackdrop && content.current && isActive(content.current)) onClose?.();
    }}>
      <div ref={content} className={`modal-content ui-dialog ui-dialog--${size}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || !isActive(event.currentTarget)) return;
          const elements = focusableElements(event.currentTarget);
          const first = elements[0]; const last = elements.at(-1);
          if (!first) { event.preventDefault(); event.currentTarget.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last!.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
        }}>
        <h2 className="ui-dialog-heading">{heading ?? title}</h2>
        <div className="ui-dialog-body">{children}</div>
        {footer != null && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}
