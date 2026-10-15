import type { ReactNode } from "react";

export function Toolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }): JSX.Element {
  return <div role="group" aria-label={label} className={["toolbar", className].filter(Boolean).join(" ")}>{children}</div>;
}
