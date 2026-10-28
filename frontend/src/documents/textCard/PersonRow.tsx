import { forwardRef, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { StatusBadge, type StatusTone } from "../../ui/StatusBadge";

/** "Anna Roth’s": the possessive used in the person rows' accessible names. */
export const possessive = (name: string): string => `${name}’s`;

/**
 * The people of one step as a list (person rows, mockup variant A): one row per person, so screen readers announce
 * "Annotators, list, 3 items". The wrapper is the container the rows' narrow layout queries (below 520 px the
 * buttons wrap under the name).
 */
export function PersonList({ label, children, className }: { label: string; children: ReactNode; className?: string }): JSX.Element {
  return <div className={["person-rows-box", className].filter(Boolean).join(" ")}>
    <ul className="person-rows" aria-label={label}>{children}</ul>
  </div>;
}

export interface PersonRowProps {
  name: string;
  /** Shown muted after the name when it differs from it. */
  pseudonym?: string | null;
  /** The details line under the name (dates, findings, mode). */
  details?: ReactNode;
  /** The status pill: shape and words, not colour alone. */
  status: { tone: StatusTone; label: string };
  /** A removed person (kept for their submission in the history): muted name. */
  removed?: boolean;
  /** This person's own actions, right-aligned on the row (below 520 px on a line of their own). */
  children?: ReactNode;
}

/** One person on a step: name and details, the status in an aligned column, then that person's own actions. */
export const PersonRow = forwardRef<HTMLLIElement, PersonRowProps>(function PersonRow({ name, pseudonym, details, status, removed = false, children }, ref) {
  return <li ref={ref} className={removed ? "person-row person-row--removed" : "person-row"}>
    <div className="person-row-who">
      <span><span className="person-row-name">{name}</span>{pseudonym && pseudonym !== name && <> <span className="person-row-pseudonym">{pseudonym}</span></>}</span>
      {details && <span className="person-row-details">{details}</span>}
    </div>
    <span className="person-row-status"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></span>
    <div className="person-row-actions">{children}</div>
  </li>;
});

/** The first button or link of the row after `row`: where focus goes once `row`'s person is removed. */
export function nextRowTarget(row: HTMLElement | null): HTMLElement | null {
  return row?.nextElementSibling?.querySelector<HTMLElement>("button, a[href]") ?? null;
}

/**
 * Focus after a removal: the next person's first button, else `fallback` (e.g. "Assign annotators…"). It runs
 * once the confirm dialog has returned focus to its trigger (effects run after the dialog's cleanup).
 */
export function useFocusAfterRemoval(fallback?: RefObject<HTMLElement>): (next: HTMLElement | null) => void {
  const [request, setRequest] = useState<{ next: HTMLElement | null } | null>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useEffect(() => {
    if (!request) return;
    const target = request.next?.isConnected ? request.next : fallbackRef.current?.current;
    target?.focus();
  }, [request]);
  return next => setRequest({ next });
}
