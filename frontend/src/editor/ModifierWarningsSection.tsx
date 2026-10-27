import { Button } from "../ui/Button";
import type { OpenItem } from "./openItems";
import { SubmitGroup } from "./SubmitGroup";

/** The Submit dialog's "Modifier warnings" group (R3, R10, R12): acknowledged with "Submit with N warnings", never blocking. */
export function ModifierWarningsSection({ items, onGoTo }: { items: readonly OpenItem[]; onGoTo: (item: OpenItem) => void }) {
  if (items.length === 0) return null;
  return (
    <SubmitGroup heading="Modifier warnings" data-modifier-warnings>
      {items.map(item => (
        <li key={item.key} className="submit-item" data-open-item={item.kind}>
          <span className="submit-item__what"><strong>{item.term}</strong>{item.quote && <> <span className="submit-item__quote">“{item.quote}”</span></>}</span>
          <span className="submit-item__actions">
            <Button type="button" size="sm" aria-label={`Go to ${item.term}`} onClick={() => onGoTo(item)}>Go to</Button>
          </span>
          <span className="submit-item__line">{item.line}</span>
        </li>
      ))}
    </SubmitGroup>
  );
}
