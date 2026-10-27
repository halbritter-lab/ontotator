import { useId, type ReactNode } from "react";

/**
 * One settings topic as a card (settings redesign, variant A): a short title, the controls, one hint line;
 * the longer rule text sits behind "Why?". With `id`, the title and hint get `{id}-title` and `{id}-hint`
 * so controls can point at them (e.g. a radio group named by the title).
 */
export function SettingsCard({ id, title, hint, why, children, className }: {
  id?: string; title: ReactNode; hint?: ReactNode; why?: ReactNode; children?: ReactNode; className?: string;
}): JSX.Element {
  const fallback = useId().replace(/:/g, "");
  const base = id ?? fallback;
  return <section className={["settings-card", className].filter(Boolean).join(" ")}>
    <h2 id={`${base}-title`} className="settings-card-title">{title}</h2>
    {children}
    <SettingsHint id={`${base}-hint`} why={why}>{hint}</SettingsHint>
  </section>;
}

/** The one hint line of a card; the explanation opens in place under "Why?". */
export function SettingsHint({ id, why, children }: { id?: string; why?: ReactNode; children?: ReactNode }): JSX.Element | null {
  if (!children && !why) return null;
  return <div className="settings-card-hint">
    {children && <span id={id}>{children}</span>}{children && why ? " " : null}
    {why && <details className="settings-why"><summary>Why?</summary><div className="settings-why-text">{why}</div></details>}
  </div>;
}
