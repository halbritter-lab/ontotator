import { useLayoutEffect, type RefObject } from "react";

/** The scroll container the floating bar lines up with (the AppShell main column). */
const CONTAINER = ".shell-main";
/** Root custom property with the space the floating bar takes at the viewport bottom (padding, scroll padding). */
export const BAR_SPACE_PROPERTY = "--selection-bar-space";
/** Gap between the bar and the viewport bottom and above the bar for the last row (`--space-3`). */
const GAP = 12;

/**
 * Keeps a `position: fixed` bar at the viewport bottom aligned with the main column and reserves its space:
 * while the bar is shown, the root gets `--selection-bar-space` (bar height plus gaps), which the page uses as
 * bottom padding and the scroll containers as `scroll-padding-bottom`, so the last rows and focused controls are
 * never hidden behind it. The bar itself gets `--selection-bar-left` / `--selection-bar-right`.
 */
export function useFloatingBar(ref: RefObject<HTMLElement>, shown: boolean): void {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!shown || !bar) return;
    const root = document.documentElement;
    const container = bar.closest<HTMLElement>(CONTAINER);
    const measure = () => {
      if (container) {
        const box = container.getBoundingClientRect();
        bar.style.setProperty("--selection-bar-left", `${Math.max(0, Math.round(box.left))}px`);
        bar.style.setProperty("--selection-bar-right", `${Math.max(0, Math.round(window.innerWidth - box.left - container.clientWidth))}px`);
      }
      root.style.setProperty(BAR_SPACE_PROPERTY, `${Math.ceil(bar.getBoundingClientRect().height) + 2 * GAP}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    if (container) observer?.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty(BAR_SPACE_PROPERTY);
    };
  }, [ref, shown]);
}
