import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useShortcutHint } from "../ui/shortcuts";
import { clampSidebarWidth, type SidebarCommitSource, type SidebarLimits } from "./sidebarWidth";

const STEP = 16;
const LARGE_STEP = 64;

export interface SidebarResizerProps {
  width: number;
  limits: SidebarLimits;
  /** id of the sidebar element this separator resizes. */
  controls: string;
  onChange: (width: number) => void;
  onReset: () => void;
  onCommit: (source: SidebarCommitSource) => void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  latest: number;
}

/** Vertical separator between the findings column and the text pane (spec section 10). */
export function SidebarResizer({ width, limits, controls, onChange, onReset, onCommit }: SidebarResizerProps) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);

  useShortcutHint(
    ["← / →", "Shift + ← / →", "Home / End", "Enter"],
    "Resize the findings column (focus the divider)",
    { group: "Layout" },
  );

  const cancelFrame = () => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };
  useEffect(() => cancelFrame, []);

  const endDrag = (element: HTMLElement) => {
    const current = drag.current;
    drag.current = null;
    cancelFrame();
    if (current && element.hasPointerCapture?.(current.pointerId)) element.releasePointerCapture(current.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      const current = drag.current;
      if (!current) return;
      event.preventDefault();
      endDrag(event.currentTarget);
      onChange(current.startWidth);
      onCommit("drag-cancel");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // End an active drag first so later movement or pointer-up cannot reapply its width.
      if (drag.current) endDrag(event.currentTarget);
      onReset();
      return;
    }
    let next: number | null = null;
    const step = event.shiftKey ? LARGE_STEP : STEP;
    if (event.key === "ArrowLeft") next = width - step;
    else if (event.key === "ArrowRight") next = width + step;
    else if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = limits.max;
    if (next == null) return;
    event.preventDefault();
    onChange(clampSidebarWidth(next, limits));
    onCommit("key");
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, latest: width };
    onCommit("drag-start");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || !Number.isFinite(event.clientX)) return;
    current.latest = clampSidebarWidth(current.startWidth + (event.clientX - current.startX), limits);
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (drag.current) onChange(drag.current.latest);
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    endDrag(event.currentTarget);
    onChange(current.latest);
    onCommit("drag");
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    endDrag(event.currentTarget);
    onChange(current.startWidth);
    onCommit("drag-cancel");
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-label="Resize findings column"
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={`${width} pixels (default ${limits.fallback})`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onReset}
    >
      <span className="sidebar-resizer-grip" aria-hidden="true" />
    </div>
  );
}
