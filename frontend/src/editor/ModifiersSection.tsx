import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { MenuButton, type MenuItem } from "../ui/MenuButton";
import { IconMore } from "../ui/icons";
import { SearchPanel, type SearchPanelProps } from "./SearchPanel";
import { COHORT_TAG, chipText as editorChipText, exclusiveWarnings, quoteOf, sortByLabel, type ModifierLike, type TermInfo } from "./modifiers";
import "./modifiers.css";

export interface ModifiersSectionProps {
  /** The finding's term label, e.g. "Seizure". */
  finding: string;
  modifiers: readonly ModifierLike[];
  /** Document text, for the quotes of linked modifiers. */
  text: string;
  termInfo: (termId: string) => TermInfo | undefined;
  readOnly?: boolean;
  /** Chip text; the editor shows "Severe · “schwere”", the consolidation passes its own wording. */
  chipText?: (label: string, quote: string | null, role: TermInfo["role"]) => string;
  /** Adds a modifier without a text span; resolves once saved. `role` is the search candidate's. */
  onAdd?: (termId: string, label: string, role: TermInfo["role"]) => Promise<unknown>;
  onLinkSpan?: (termId: string) => void;
  onRemoveSpan?: (termId: string) => void;
  onRemove?: (termId: string) => void;
  /** The selected modifier (M1 mockup 01 A): its row is marked and a status line names it with its term ID. */
  selectedTermId?: string | null;
  /** A click on a modifier row selects that modifier (its span is marked in the text). */
  onSelectModifier?: (termId: string) => void;
  /** The term search of "+ Add modifier…" (modifier mode is set here); absent: no add button. */
  searchProps?: Omit<SearchPanelProps, "onSelectCandidate" | "mode" | "assignMode" | "onPickModifier" | "autoFocus" | "onEscape">;
}

/**
 * Modifiers of one finding (spec "Modifiers section", B3-4 mockup 01 A): plain rows with an actions menu, the "Two severities" /
 * "Two onsets" warning and "+ Add modifier…". Depends on no editor state, so the consolidation can reuse it.
 */
export function ModifiersSection({ finding, modifiers, text, termInfo, readOnly = false, chipText = editorChipText,
  onAdd, onLinkSpan, onRemoveSpan, onRemove, selectedTermId = null, onSelectModifier, searchProps }: ModifiersSectionProps): JSX.Element {
  const headingId = useId();
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<{ text: string; linkTermId?: string } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const sorted = sortByLabel(modifiers, termInfo);
  const warnings = exclusiveWarnings(modifiers, termInfo);
  const closeSearch = () => {
    setSearching(false);
    // After the search unmounts.
    requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
  };

  return <section className="detail-section mod-section" data-modifiers-section aria-labelledby={headingId}>
    <h3 id={headingId} className="mod-heading">Modifiers</h3>
    {sorted.length > 0 && <ul className="mod-rows" aria-label={`Modifiers of ${finding}`}>
      {sorted.map(modifier => {
        const info = termInfo(modifier.term_id);
        const label = info?.label ?? modifier.term_id;
        const linked = !!modifier.segments?.length;
        const items: MenuItem[] = readOnly ? [] : [
          ...(onLinkSpan ? [{ id: "link", label: linked ? "Change text span…" : "Link a text span…", onSelect: () => onLinkSpan(modifier.term_id) }] : []),
          ...(onRemoveSpan && linked ? [{ id: "unlink", label: "Remove text span", onSelect: () => onRemoveSpan(modifier.term_id) }] : []),
          ...(onRemove ? [{ id: "remove", label: "Remove modifier", onSelect: () => onRemove(modifier.term_id) }] : []),
        ];
        const content = chipText(label, linked ? quoteOf(text, modifier.segments) : null, info?.role ?? "modifier");
        const tail = ` · ${COHORT_TAG}`;
        const cohortTag = info?.role === "cohort" && content.endsWith(tail);
        const words = cohortTag ? content.slice(0, -tail.length) : content;
        // The name in strong text, the rest (quote) muted; the text stays the chip text.
        const name = words.startsWith(label) ? label : "";
        const body = <>{name && <span className="mod-row-label">{name}</span>}<span className="mod-row-quote">{words.slice(name.length)}</span>
          {cohortTag && <> · <span className="mod-cohort">{COHORT_TAG}</span></>}</>;
        const selected = selectedTermId === modifier.term_id;
        return <li key={modifier.term_id} className={["mod-row", selected && "is-sel"].filter(Boolean).join(" ")} data-modifier-chip={modifier.term_id} tabIndex={-1}
          aria-current={selected ? "true" : undefined}>
          {onSelectModifier ? <button type="button" className="mod-row-main" aria-pressed={selected} onClick={() => onSelectModifier(modifier.term_id)}>{body}</button>
            : <span className="mod-row-main">{body}</span>}
          {items.length > 0 && <MenuButton label={`Actions, ${label}`} buttonLabel={`Actions, ${label}`} content={<IconMore />} items={items} />}
        </li>;
      })}
    </ul>}
    {(() => {
      const chosen = selectedTermId ? modifiers.find(modifier => modifier.term_id === selectedTermId) : undefined;
      if (!chosen) return null;
      const quote = chosen.segments?.length ? quoteOf(text, chosen.segments) : null;
      return <p className="mod-selected">{`${termInfo(chosen.term_id)?.label ?? chosen.term_id} · ${chosen.term_id} · ${quote ? `in the text: “${quote}”` : "no text span"}`}</p>;
    })()}
    {warnings.map(warning => <p key={warning} className="mod-warning">{warning}</p>)}
    <div role="status" className="mod-status">{status && <>
      {status.text}
      {status.linkTermId && onLinkSpan && <Button size="sm" onClick={() => { const id = status.linkTermId!; setStatus(null); onLinkSpan(id); }}>Link a text span</Button>}
    </>}</div>
    {!readOnly && onAdd && searchProps && (searching
      ? <div className="mod-search" role="group" aria-label={`Add modifier to ${finding}`}>
        <SearchPanel {...searchProps} mode="modifier" assignMode="modifier" autoFocus onEscape={closeSearch}
          onSelectCandidate={candidate => {
            const label = candidate.label ?? candidate.term_id;
            closeSearch();
            void onAdd(candidate.term_id, label, candidate.role).then(
              () => setStatus(onLinkSpan ? { text: `Added ${label} to ${finding}. Link a text span?`, linkTermId: candidate.term_id }
                : { text: `Added ${label} to ${finding}.` }),
              () => undefined, // the caller reports the failure
            );
          }} />
      </div>
      : <Button ref={addButton} size="sm" className="mod-add" onClick={() => { setStatus(null); setSearching(true); }}>+ Add modifier…</Button>)}
  </section>;
}
