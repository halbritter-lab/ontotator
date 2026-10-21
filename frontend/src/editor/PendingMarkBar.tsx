import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";

export interface PendingMarkBarProps {
  /** The text scrollport (`.text-container`); the bar hides while the mark is outside it. */
  textElement: HTMLElement | null;
  evidenceId: string;
  /** Changes when the mark moved; re-places the bar. */
  segmentsKey: string;
  onDiscard: () => void;
}

const GAP = 4;
const EDGE = 8;

/** Bar under the pending mark (> 700 px): absolute over the text, never reflows it, not modal. */
export function PendingMarkBar({ textElement, evidenceId, segmentsKey, onDiscard }: PendingMarkBarProps): JSX.Element {
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const update = useCallback(() => {
    const node = bar.current;
    const parent = node?.offsetParent as HTMLElement | null;
    if (!node || !parent || !textElement) return;
    const rects = Array.from(textElement.querySelectorAll<HTMLElement>(".run[data-mentions]"))
      .filter((run) => (run.dataset.mentions ?? "").split(",").includes(evidenceId))
      .flatMap((run) => Array.from(run.getClientRects()));
    const pane = textElement.getBoundingClientRect();
    if (!rects.length || rects[rects.length - 1].bottom < pane.top || rects[0].top > pane.bottom) {
      setPlace(null);
      return;
    }
    const first = rects[0];
    const last = rects[rects.length - 1];
    const origin = parent.getBoundingClientRect();
    const below = last.bottom + GAP;
    const top = below + node.offsetHeight > pane.bottom - EDGE ? first.top - GAP - node.offsetHeight : below;
    const left = Math.min(Math.max(last.left, pane.left + EDGE), pane.right - node.offsetWidth - EDGE);
    const next = { top: top - origin.top + parent.scrollTop, left: left - origin.left + parent.scrollLeft };
    setPlace((current) => (current && current.top === next.top && current.left === next.left ? current : next));
  }, [textElement, evidenceId]);

  useLayoutEffect(() => {
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // The span editor draws (and redraws) the mark after this effect: follow its runs.
    const observer = typeof MutationObserver === "undefined" || !textElement ? null : new MutationObserver(update);
    observer?.observe(textElement!, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-mentions"] });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [update, segmentsKey, textElement]);

  return (
    <div
      ref={bar}
      role="group"
      aria-label="Marked text"
      className={`pending-mark-bar${place ? "" : " is-hidden"}`}
      style={place ? { top: `${place.top}px`, left: `${place.left}px` } : undefined}
    >
      <span className="pending-mark-bar__hint">Drag the edges to adjust</span>
      <Button type="button" variant="quiet" size="sm" aria-keyshortcuts="Escape" onClick={onDiscard}>
        Discard
        <span aria-hidden="true">
          {" "}
          <Kbd>Esc</Kbd>
        </span>
      </Button>
    </div>
  );
}
