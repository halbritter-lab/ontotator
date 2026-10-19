import { useId, type ReactNode } from "react";
import { CarriedStateBadge } from "./CarriedRowExtras";
import "./carried-inspector.css";

export interface CarriedCheckItem {
  term: ReactNode;
  state: "checked" | "dismissed" | "needed";
  reason?: string;
  /** "Carried from Round 2". */
  origin: string;
}

/** Read-only check states of a submitted carry-forward round (Resolved 5): historical dialog and case viewer. */
export function CarriedChecksReadOnly({ items }: { items: readonly CarriedCheckItem[] }): JSX.Element {
  const headingId = `${useId()}-carried-checks`;
  return (
    <section aria-labelledby={headingId} className="carried-checks">
      <h3 id={headingId} className="carried-section__title">Carried findings</h3>
      <ul className="carried-checks__list">
        {items.map((item, index) => (
          <li key={index} className="carried-checks__item">
            <span className="carried-checks__term">{item.term}</span>
            <CarriedStateBadge variant={item.state} />
            <span className="carried-checks__origin">{item.origin}</span>
            {item.state === "dismissed" && item.reason && (
              <span className="carried-checks__reason">Dismissal reason: {item.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
