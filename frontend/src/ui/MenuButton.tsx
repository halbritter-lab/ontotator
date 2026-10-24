import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./Button";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** One line under the label on what the item does (the item's accessible description). */
  description?: string;
}
export interface MenuButtonProps {
  /** Accessible name of the button and the menu, e.g. "2 more actions for case-107 de". */
  label: string;
  items: MenuItem[];
  /** Visible button text, e.g. "More". */
  buttonLabel: string;
  /** Icon before the text, e.g. `<IconMore />` for a "More" menu. */
  icon?: ReactNode;
  /** Visible button content instead of `buttonLabel` (e.g. a person chip). */
  content?: ReactNode;
  className?: string;
}

/**
 * Menu button pattern: Enter, Space, click or ArrowDown open the menu at the first item, ArrowUp at the last;
 * arrows (wrapping), Home and End move; Enter, Space or click choose; Escape closes; focus returns to the button.
 * Tab and a pointer down outside close the menu without moving focus.
 */
export function MenuButton({ label, items, buttonLabel, icon, content, className }: MenuButtonProps): JSX.Element {
  const [open, setOpen] = useState<null | "first" | "last">(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const menuItems = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];

  useLayoutEffect(() => {
    if (!open) return;
    // Fixed position: the menu is not clipped by a scrolling table wrapper.
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(0, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const elements = menuItems();
    (open === "first" ? elements[0] : elements.at(-1))?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => { setOpen(null); button.current?.focus(); };
  const choose = (item: MenuItem) => { close(); item.onSelect(); };
  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(event.key === "ArrowDown" ? "first" : "last");
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = menuItems();
    const index = elements.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      // Consumed here so page-level Escape shortcuts do not also run.
      event.preventDefault(); event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") { setOpen(null); return; }
    const target = event.key === "ArrowDown" ? (index + 1) % elements.length
      : event.key === "ArrowUp" ? (index - 1 + elements.length) % elements.length
        : event.key === "Home" ? 0 : event.key === "End" ? elements.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    elements[target]?.focus();
  };

  return <span className="ui-menu-button">
    <Button ref={button} size="sm" className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open !== null} aria-controls={open ? menuId : undefined}
      onClick={() => open ? setOpen(null) : setOpen("first")} onKeyDown={onButtonKeyDown}>{content ?? (icon ? <>{icon}<span>{buttonLabel}</span></> : buttonLabel)}</Button>
    {open && <div ref={menu} id={menuId} role="menu" aria-label={label} className="ui-menu" onKeyDown={onMenuKeyDown}
      style={{ position: "fixed", top: `${position.top}px`, right: `${position.right}px` }}>
      {items.map((item) => <button key={item.id} type="button" role="menuitem" tabIndex={-1} className="ui-menu-item" onClick={() => choose(item)}
        aria-label={item.description ? item.label : undefined} aria-describedby={item.description ? `${menuId}-${item.id}` : undefined}>
        {item.label}{item.description && <span id={`${menuId}-${item.id}`} className="ui-menu-item-description">{item.description}</span>}
      </button>)}
    </div>}
  </span>;
}
