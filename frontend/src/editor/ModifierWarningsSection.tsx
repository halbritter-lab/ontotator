import { useId } from "react";
import { Button } from "../ui/Button";
import type { OpenItem } from "./openItems";
import "./submitDialog.css";

/** The Submit dialog's "Modifier warnings · {m}" list (R10, R12): acknowledgeable, never blocking. */
export function ModifierWarningsSection({ items, onGoTo }: { items: readonly OpenItem[]; onGoTo: (item: OpenItem) => void }) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className="unconfirmed-values" aria-labelledby={headingId} data-modifier-warnings>
      <h3 id={headingId} className="modifier-warnings__heading">Modifier warnings · {items.length}</h3>
      <ul className="unconfirmed-values__list">
        {items.map(item => (
          <li key={item.key} className="unconfirmed-values__row modifier-warnings__row" data-open-item={item.kind}>
            <span>{item.term}: {item.line}</span>
            <Button type="button" size="sm" onClick={() => onGoTo(item)}>Go to {item.term}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
