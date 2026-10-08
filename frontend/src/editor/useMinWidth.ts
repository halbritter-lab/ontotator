import { useEffect, useState } from "react";

const matches = (query: string): boolean =>
  // No matchMedia (jsdom): treat the screen as wide.
  typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(query).matches;

/** Whether the viewport is at least `pixels` wide; follows window resizes. */
export function useMinWidth(pixels: number): boolean {
  const query = `(min-width: ${pixels}px)`;
  const [wide, setWide] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setWide(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return wide;
}
