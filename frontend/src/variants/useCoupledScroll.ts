import { useEffect } from "react";

export interface CoupledScrollOptions {
  leftStarts: readonly number[];
  rightStarts: readonly number[];
  enabled: boolean;
}

/** Couple only the supplied scrollports; paragraph positions come from live DOM markers. */
export function useCoupledScroll(
  left: HTMLElement | null,
  right: HTMLElement | null,
  { leftStarts, rightStarts, enabled }: CoupledScrollOptions,
): void {
  useEffect(() => {
    if (!enabled || !left || !right || left === right) return;
    const wide = window.matchMedia("(min-width: 1100px)");
    let detach = () => {};

    const bind = () => {
      detach();
      if (!wide.matches) return;
      const echoes = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
      const clearEcho = (element: HTMLElement) => {
        const timer = echoes.get(element);
        if (timer !== undefined) clearTimeout(timer);
        echoes.delete(element);
      };
      const sync = (from: HTMLElement, to: HTMLElement, n: number, m: number) => {
        if (echoes.has(from) || n === 0 || m === 0) return;
        const edge = from.getBoundingClientRect().top + from.clientTop;
        let paragraph: number | undefined;
        for (const marker of from.querySelectorAll<HTMLElement>("[data-paragraph]")) {
          const index = Number(marker.dataset.paragraph);
          if (!Number.isInteger(index) || index < 0 || index >= n) continue;
          const top = marker.getBoundingClientRect().top;
          if (!Number.isFinite(top)) continue;
          paragraph ??= index; // First paragraph while its leading padding is visible.
          if (top <= edge) paragraph = index;
        }
        if (paragraph === undefined) return;
        const mapped = n <= 1 || m <= 1 ? 0 : Math.round(paragraph * (m - 1) / (n - 1));
        const marker = to.querySelector<HTMLElement>(`[data-paragraph="${mapped}"]`);
        if (!marker) return;
        const before = to.scrollTop;
        const offset = before + marker.getBoundingClientRect().top
          - (to.getBoundingClientRect().top + to.clientTop);
        if (!Number.isFinite(offset) || offset === before) return;
        const previous = echoes.get(to);
        // Install before writing: a programmatic target event must never echo back.
        const timer = setTimeout(() => echoes.delete(to), 150);
        echoes.set(to, timer);
        to.scrollTop = offset; // The browser retains its native scroll-range clamping.
        if (to.scrollTop === before) {
          clearEcho(to);
          // A clamped no-op must neither cancel nor extend an earlier movement's guard.
          if (previous !== undefined) echoes.set(to, previous);
        } else if (previous !== undefined) clearTimeout(previous);
      };
      const onLeft = () => sync(left, right, leftStarts.length, rightStarts.length);
      const onRight = () => sync(right, left, rightStarts.length, leftStarts.length);
      left.addEventListener("scroll", onLeft, { passive: true });
      right.addEventListener("scroll", onRight, { passive: true });
      detach = () => {
        left.removeEventListener("scroll", onLeft);
        right.removeEventListener("scroll", onRight);
        for (const timer of echoes.values()) clearTimeout(timer);
        echoes.clear();
      };
    };

    bind();
    wide.addEventListener("change", bind);
    return () => { wide.removeEventListener("change", bind); detach(); };
  }, [left, right, leftStarts, rightStarts, enabled]);
}
