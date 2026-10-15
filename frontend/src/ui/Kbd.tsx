import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="kbd">{children}</kbd>;
}

export function formatKey(key: string): string {
  switch (key) {
    case "ArrowLeft": return "←";
    case "ArrowRight": return "→";
    case "ArrowUp": return "↑";
    case "ArrowDown": return "↓";
    case "Escape": return "Esc";
    default: return key;
  }
}
