import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { paragraphStarts } from "../variants/paragraphs";
import { Button } from "../ui";
import { checkedSummary, isChecked, type MarkState, type Sentence } from "./sentences";
import "./translation.css";

export interface SentenceViewProps {
  text: string;
  sentences: readonly Sentence[];
  states: readonly MarkState[];
  label: string;
  lang?: string;
  disabled?: boolean;
  /** Toggles one sentence. */
  onToggle: (index: number) => void;
  /** Sets the sentences from `from` to `to` to checked or unchecked. */
  onRange: (from: number, to: number, checked: boolean) => void;
}

type Drag = { pointerId: number; start: number; current: number; value: boolean };

const sentenceOf = (target: EventTarget | null): number | null => {
  const element = target instanceof Element ? target.closest<HTMLElement>("[data-sentence]") : null;
  const index = Number(element?.dataset.sentence);
  return element && Number.isInteger(index) ? index : null;
};

/** Text nodes with the hidden paragraph markers coupled scrolling reads, and one button per sentence. */
function sentenceNodes(text: string, sentences: readonly Sentence[], render: (sentence: Sentence) => ReactNode): ReactNode[] {
  // Paragraph starts are code-point offsets; sentences use UTF-16 offsets.
  const units: number[] = [];
  let unit = 0;
  for (const char of text) { units.push(unit); unit += char.length; }
  units.push(unit);
  const points = paragraphStarts(text), starts = points.map(point => units[Math.min(point, units.length - 1)]);
  const nodes: ReactNode[] = [];
  let paragraph = 0, position = 0;
  /** Text up to `end`; a marker at `end` comes before the sentence that starts there. */
  const gap = (end: number) => {
    for (; paragraph < starts.length && starts[paragraph] <= end; paragraph++) {
      if (starts[paragraph] > position) { nodes.push(text.slice(position, starts[paragraph])); position = starts[paragraph]; }
      nodes.push(<span key={`p${paragraph}`} aria-hidden="true" data-paragraph={paragraph} data-paragraph-offset={points[paragraph]} />);
    }
    if (end > position) { nodes.push(text.slice(position, end)); position = end; }
  };
  for (const sentence of sentences) {
    gap(sentence.start);
    nodes.push(render(sentence));
    position = sentence.end;
  }
  gap(text.length);
  return nodes;
}

/**
 * A review text in marking mode: every sentence is a toggle button. Click toggles it,
 * Shift+click marks the range from the last clicked sentence, and a drag sets every
 * sentence passed to the opposite of the sentence it started on.
 */
export const SentenceView = forwardRef<HTMLDivElement, SentenceViewProps>(function SentenceView(
  { text, sentences, states, label, lang, disabled = false, onToggle, onRange }, ref,
) {
  const anchor = useRef<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const [range, setRange] = useState<Drag | null>(null);
  const latest = useRef({ onToggle, onRange }); latest.current = { onToggle, onRange };
  const finish = useCallback((apply: boolean) => {
    const current = drag.current;
    drag.current = null; setRange(null);
    if (!current || !apply) return;
    if (current.current === current.start) latest.current.onToggle(current.start);
    else latest.current.onRange(current.start, current.current, current.value);
    anchor.current = current.current;
  }, []);
  // A drag may end outside the text.
  const dragging = range !== null;
  useEffect(() => {
    if (!dragging) return;
    const up = (event: globalThis.PointerEvent) => { if (event.pointerId === drag.current?.pointerId) finish(true); };
    const cancel = (event: globalThis.PointerEvent) => { if (event.pointerId === drag.current?.pointerId) finish(false); };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
  }, [dragging, finish]);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button > 0) return;
    const index = sentenceOf(event.target);
    if (index === null) return;
    event.preventDefault();
    (event.target as HTMLElement).closest<HTMLElement>("[data-sentence]")?.focus({ preventScroll: true });
    if (event.shiftKey && anchor.current !== null) { onRange(anchor.current, index, true); anchor.current = index; return; }
    // Touch captures the pointer on the start sentence; released, moves report the sentence below.
    try { const target = event.target as Element; if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId); } catch { /* Nothing to release. */ }
    const next = { pointerId: event.pointerId, start: index, current: index, value: !isChecked(states[index]) };
    drag.current = next; setRange(next);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    let index = sentenceOf(event.target);
    if (index === null && typeof document.elementFromPoint === "function") index = sentenceOf(document.elementFromPoint(event.clientX, event.clientY));
    if (index === null || index === current.current) return;
    const next = { ...current, current: index };
    drag.current = next; setRange(next);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = sentenceOf(event.target);
    if (disabled || index === null || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (event.shiftKey && anchor.current !== null) onRange(anchor.current, index, true);
    else onToggle(index);
    anchor.current = index;
  };
  /** A click without a pointer press (assistive technology) toggles the sentence. */
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const index = sentenceOf(event.target);
    if (event.detail !== 0 || disabled || index === null) return;
    onToggle(index); anchor.current = index;
  };
  const rangeValue = range?.value;
  const low = range ? Math.min(range.start, range.current) : -1, high = range ? Math.max(range.start, range.current) : -2;
  const content = useMemo(() => sentenceNodes(text, sentences, sentence => {
    const state = states[sentence.index];
    const inRange = sentence.index >= low && sentence.index <= high;
    const className = ["review-sentence", isChecked(state) && "is-checked", state?.kind === "stale" && "is-stale",
      inRange && (rangeValue ? "is-range-mark" : "is-range-unmark")].filter(Boolean).join(" ");
    return <span key={`s${sentence.index}`} className={className} role="button" tabIndex={0} data-sentence={sentence.index}
      aria-pressed={isChecked(state)} aria-disabled={disabled || undefined}
      title={state?.kind === "stale" ? "Changed since checked" : undefined}>
      {sentence.text}{state?.kind === "stale" && <span className="review-sr-only"> (changed since checked)</span>}</span>;
  }), [text, sentences, states, low, high, rangeValue, disabled]);
  return <div ref={ref} className="translation-text translation-sentences" role="region" aria-label={label} lang={lang}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onKeyDown={keyDown} onClick={click}>{content}</div>;
});

/** Counts of one side. */
export interface SideCount { checked: number; total: number; stale: number }

/** The bar above the texts in marking mode: counts, two meters and Next unchecked. */
export function CheckedSentencesBar({ source, translation, onNext, saveError, onRetry }: {
  source: SideCount; translation: SideCount; onNext: () => void; saveError: boolean; onRetry: () => void;
}): JSX.Element {
  const meter = (name: string, count: SideCount) => <meter className="checked-sentences-meter" min={0} max={Math.max(1, count.total)} value={count.checked}
    aria-label={`${name} sentences checked`} />;
  return <div className="checked-sentences-bar" role="group" aria-label="Checked sentences">
    <p className="checked-sentences-count" role="status">{checkedSummary(source, translation)}
      {translation.stale > 0 && <span className="checked-sentences-stale">{` · ${translation.stale} changed since checked`}</span>}</p>
    {meter("Source", source)}{meter("Translation", translation)}
    <Button size="sm" onClick={onNext} disabled={translation.checked >= translation.total}>Next unchecked</Button>
    {saveError && <p className="checked-sentences-error" role="alert">Checked sentences are not saved. <Button size="sm" variant="quiet" onClick={onRetry}>Retry</Button></p>}
  </div>;
}
