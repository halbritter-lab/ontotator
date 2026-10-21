import { useId, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { IconClose } from "./icons";
import { useShortcut } from "./shortcuts";
import { useMediaQuery } from "./useMediaQuery";
import "./drawer.css";

export interface DrawerProps {
  open: boolean;
  /** Heading text and accessible name. */
  title: string;
  /** ID of the heading (generated when omitted). */
  headingId?: string;
  onClose: () => void;
  /** Receives focus when the drawer closes (the control that opened it). */
  returnFocusRef: RefObject<HTMLElement>;
  footer?: ReactNode;
  children: ReactNode;
}

const USER_SCROLL = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * A reading panel next to the work. From 1100 px a non-modal `<aside>` on the right; the shell's main area narrows
 * beside it, so the page stays visible and operable; between 700 and 1099 px a modal `lg` Dialog; below 700 px a full-height sheet. Focus moves to the
 * heading on open and back to `returnFocusRef` on close; Escape closes. Inside the non-modal drawer, keys
 * do not reach the page's shortcuts (only Escape passes, and closes it). The scroll position is kept
 * across close and reopen for the lifetime of the component.
 */
export function Drawer({ open, title, headingId, onClose, returnFocusRef, footer, children }: DrawerProps): JSX.Element | null {
  const wide = useMediaQuery("(min-width: 1100px)");
  const sheet = useMediaQuery("(max-width: 699px)");
  const generated = useId();
  const labelId = headingId ?? `${generated}-heading`;
  const aside = useRef<HTMLElement>(null);
  const heading = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollMemory = useRef(0);
  const wasOpen = useRef(open);

  // Non-modal: Escape closes only while focus is inside; outside, the page's own Escape handling runs.
  useShortcut("Escape", event => {
    if (!aside.current || !(event.target instanceof Node) || !aside.current.contains(event.target)) return false;
    onClose();
  }, { scope: "dialog", allowInInputs: true, enabled: open && wide, root: aside });

  // The modal variants focus the heading through Dialog's initialFocus.
  useLayoutEffect(() => { if (open && wide) heading.current?.focus(); }, [open, wide]);

  // The aside starts below the AppShell header, so the account and navigation controls stay reachable.
  // It does not cover the page: the root carries its width (`--ui-drawer-inset`) and the shell's main area
  // narrows by that much (drawer.css), so the text being worked on stays readable beside it.
  useLayoutEffect(() => {
    const element = aside.current;
    if (!open || !wide || !element) return;
    const root = document.documentElement;
    const place = () => {
      const header = document.querySelector(".shell-header");
      element.style.setProperty("--ui-drawer-top", `${Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0))}px`);
      root.style.setProperty("--ui-drawer-inset", `${Math.ceil(element.getBoundingClientRect().width)}px`);
    };
    root.setAttribute("data-ui-drawer-open", "");
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      root.removeAttribute("data-ui-drawer-open");
      root.style.removeProperty("--ui-drawer-inset");
    };
  }, [open, wide]);

  useLayoutEffect(() => {
    if (wasOpen.current && !open) {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Restore the remembered position, also while late content (a lazy renderer) grows, until the user scrolls.
  useLayoutEffect(() => {
    const element = content.current;
    const scroller = element?.closest<HTMLElement>(".ui-drawer-body, .ui-dialog-body");
    if (!open || !element || !scroller) return;
    const target = scrollMemory.current;
    let restoring = target > 0;
    const restore = () => {
      if (!restoring) return;
      scroller.scrollTop = target;
      if (Math.abs(scroller.scrollTop - target) < 1) restoring = false;
    };
    const remember = () => { if (!restoring) scrollMemory.current = scroller.scrollTop; };
    const userScroll = () => { restoring = false; };
    restore();
    scroller.addEventListener("scroll", remember);
    for (const name of USER_SCROLL) scroller.addEventListener(name, userScroll, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(restore) : null;
    observer?.observe(element);
    return () => {
      scroller.removeEventListener("scroll", remember);
      for (const name of USER_SCROLL) scroller.removeEventListener(name, userScroll);
      observer?.disconnect();
    };
  }, [open, wide, sheet]);

  if (!open) return null;
  const body = <div ref={content} className="ui-drawer-content">{children}</div>;
  if (!wide) {
    return <div className={sheet ? "ui-drawer-sheet" : "ui-drawer-dialog"}>
      <Dialog open title={title} size="lg" onClose={onClose} initialFocus={heading} footer={footer}
        heading={<span ref={heading} id={labelId} tabIndex={-1} className="ui-drawer-heading-target">{title}</span>}>
        {body}
      </Dialog>
    </div>;
  }
  // React delegates at the root, so stopping here keeps the key from the window shortcut listener.
  const keepKeysInside = (event: ReactKeyboardEvent) => { if (event.key !== "Escape") event.stopPropagation(); };
  return <aside ref={aside} className="ui-drawer" aria-labelledby={labelId} onKeyDown={keepKeysInside}>
    <div className="ui-dialog-header">
      <h2 ref={heading as RefObject<HTMLHeadingElement>} id={labelId} tabIndex={-1} className="ui-dialog-heading ui-drawer-heading-target">{title}</h2>
      <IconButton className="ui-dialog-close" label="Close" icon={<IconClose />} variant="quiet" size="sm" onClick={onClose} />
    </div>
    <div className="ui-drawer-body">{body}</div>
    {footer != null && <div className="ui-drawer-footer">{footer}</div>}
  </aside>;
}
