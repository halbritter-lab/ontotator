import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Layout of the Values block (editor axes spec 1.4): one segmented row per axis, label above, or one box per axis. */
export type ValuesLayout = "row" | "stacked" | "boxes";
/** Return to a better layout only when the free space exceeds the required width by this much (spec 1.4). */
export const VALUES_HYSTERESIS_PX = 8;

/** Label column (`calc(2 * var(--space-7))`) plus the column gap (`var(--space-2)`) of layout B. */
const LABEL_COLUMN_PX = 96;
const COLUMN_GAP_PX = 8;

/**
 * required: max-content width of every segmented control (axes with a Select are left out);
 * widths.row: control-cell width in layout B (section content width − 96 px label column − 8 px gap);
 * widths.stacked: full section content width; current: the layout shown now (null on mount).
 */
export function chooseValuesLayout(
  required: readonly number[],
  widths: { row: number; stacked: number },
  current: ValuesLayout | null,
): ValuesLayout {
  const order: ValuesLayout[] = ["row", "stacked", "boxes"];
  for (const layout of order) {
    if (layout === "boxes") return layout;
    const better =
      current !== null && order.indexOf(layout) < order.indexOf(current);
    const margin = better ? VALUES_HYSTERESIS_PX : 0;
    if (required.every((width) => width + margin <= widths[layout]))
      return layout;
  }
  return "boxes";
}

const px = (value: string) => parseFloat(value) || 0;

/**
 * Intrinsic width of one segmented control: each segment's inner text width (`scrollWidth`) plus its
 * horizontal padding, plus (n + 1) px for the outline and separators. The segment's own
 * `scrollWidth` is never used: segments stretch (`flex: 1 1 auto`), so it would report the stretched width.
 */
function controlWidth(control: HTMLElement): number {
  const segments = Array.from(control.querySelectorAll<HTMLElement>(":scope > .axis-option"));
  return segments.reduce((sum, segment) => {
    const text = segment.querySelector<HTMLElement>(":scope > span:not(.visually-hidden)");
    const style = getComputedStyle(segment);
    // scrollWidth is rounded; the fractional box width is rounded up so a control never overflows by a pixel.
    const textWidth = text ? Math.max(text.scrollWidth, Math.ceil(text.getBoundingClientRect().width)) : 0;
    return sum + textWidth + px(style.paddingLeft) + px(style.paddingRight);
  }, segments.length + 1);
}

/** Observes the section, re-evaluates on resize, on `deps` change and after document.fonts.ready; returns the layout. */
export function useValuesLayout(
  section: RefObject<HTMLElement>,
  deps: readonly unknown[],
): ValuesLayout {
  const [layout, setLayout] = useState<ValuesLayout>("row");
  const current = useRef<ValuesLayout | null>(null);
  const observed = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const evaluate = useRef(() => {
    const element = section.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const content = element.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    // A section without layout (hidden, not yet laid out) keeps the layout it has.
    if (content <= 0) return;
    const required = Array.from(element.querySelectorAll<HTMLElement>(".axis-options")).map(controlWidth);
    const next = chooseValuesLayout(required, { row: content - LABEL_COLUMN_PX - COLUMN_GAP_PX, stacked: content }, current.current);
    current.current = next;
    setLayout(next);
  }).current;

  // The section can mount after the hook (no finding selected first): observe whichever element is current.
  useLayoutEffect(() => {
    const element = section.current;
    if (element === observed.current) return;
    observer.current?.disconnect();
    observer.current = null;
    observed.current = element;
    current.current = null;
    if (!element) return;
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(() => evaluate());
      observer.current.observe(element);
    }
    evaluate();
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { evaluate(); }, deps);

  useEffect(() => {
    let active = true;
    document.fonts?.ready.then(() => { if (active) evaluate(); });
    return () => {
      active = false;
      observer.current?.disconnect();
      observer.current = null;
      observed.current = null;
    };
  }, [evaluate]);

  return layout;
}
