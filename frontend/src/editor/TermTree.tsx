import { viewLabel } from "./termLinks";
import React, { useEffect, useRef } from "react";
import { keyAction, type TreeRow } from "./treeState";

export interface TermTreeProps {
  rows: TreeRow[];
  /** The row in the Tab order; the arrow keys start from it. */
  focusedKey: string | null;
  selectedKey: string | null;
  /** The term the annotation carries right now. */
  currentTermId: string | null;
  /** Rows whose data is being loaded. */
  loadingKeys: ReadonlySet<string>;
  /** Scroll this row into view (and focus it, if asked) whenever this object changes. */
  reveal: { key: string; focus: boolean } | null;
  label: string;
  onFocusKey: (key: string) => void;
  onExpand: (key: string) => void;
  onCollapse: (key: string) => void;
  onSelect: (key: string) => void;
  onClose: () => void;
  /** Terms that cannot be assigned here (modifier terms in "Change term"): the row reads aria-disabled. */
  isUnavailable?: (termId: string) => boolean;
}

/** An ARIA tree as a flat list of rows with roving focus. */
export const TermTree: React.FC<TermTreeProps> = ({
  rows,
  focusedKey,
  selectedKey,
  currentTermId,
  loadingKeys,
  reveal,
  label,
  onFocusKey,
  onExpand,
  onCollapse,
  onSelect,
  onClose,
  isUnavailable,
}) => {
  const items = useRef(new Map<string, HTMLLIElement>());
  // Exactly one row is in the Tab order: the focused one, or the first while there is none.
  const tabKey = rows.some((row) => row.key === focusedKey) ? focusedKey : rows[0]?.key ?? null;

  useEffect(() => {
    if (!reveal) return;
    const element = items.current.get(reveal.key);
    if (!element) return;
    // Only as far as needed: a tree that fits is shown from its top. (jsdom has no scrollIntoView.)
    element.scrollIntoView?.({ block: "nearest" });
    if (reveal.focus) element.focus({ preventScroll: true });
  }, [reveal]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = keyAction(rows, tabKey, event.key);
    if (!action) return;
    // The tree handled it: the case screen's own shortcuts (Escape clears the selection) stay out.
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "focus") {
      items.current.get(action.key)?.focus();
      onFocusKey(action.key);
    } else if (action.type === "expand") {
      onExpand(action.key);
    } else if (action.type === "collapse") {
      onCollapse(action.key);
    } else if (action.type === "select") {
      onSelect(action.key);
    } else {
      onClose();
    }
  };

  const toggle = (event: React.MouseEvent, row: TreeRow) => {
    event.stopPropagation(); // opening a branch is not selecting it
    if (row.expanded) onCollapse(row.key);
    else onExpand(row.key);
  };

  return (
    <ul className="term-tree" role="tree" aria-label={label} onKeyDown={handleKeyDown}>
      {rows.map((row) => {
        const isCurrent = row.termId === currentTermId;
        return (
          <li
            key={row.key}
            ref={(element) => {
              if (element) items.current.set(row.key, element);
              else items.current.delete(row.key);
            }}
            role="treeitem"
            aria-labelledby={`tree-label-${row.key}`}
            className={isCurrent ? "tree-item tree-item--current" : "tree-item"}
            style={{ paddingLeft: 8 + (row.depth - 1) * 14 }}
            data-key={row.key}
            data-term-id={row.termId}
            aria-level={row.depth}
            aria-posinset={row.posInSet}
            aria-setsize={row.setSize}
            aria-expanded={row.childCount > 0 ? row.expanded : undefined}
            aria-selected={row.key === selectedKey}
            aria-current={isCurrent ? "true" : undefined}
            aria-disabled={isUnavailable?.(row.termId) ? true : undefined}
            aria-busy={loadingKeys.has(row.key) ? true : undefined}
            tabIndex={row.key === tabKey ? 0 : -1}
            onFocus={() => onFocusKey(row.key)}
            onClick={() => onSelect(row.key)}
          >
            {row.childCount > 0 ? (
              <span className="tree-toggle" aria-hidden="true" onClick={(event) => toggle(event, row)}>
                {row.expanded ? "▾" : "▸"}
              </span>
            ) : (
              <span className="tree-toggle" aria-hidden="true" />
            )}
            <span className="tree-label" id={`tree-label-${row.key}`}>
              {row.label}
            </span>
            <span className="tree-id">{row.termId}</span>
            {row.externalUrl && (
              <a
                className="tree-external"
                href={row.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={-1}
                title={viewLabel(row.termId, row.externalUrl)}
                aria-label={viewLabel(row.termId, row.externalUrl)}
                onClick={(event) => event.stopPropagation()} // looking a term up is not selecting it
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.stopPropagation();
                }}
              >
                ↗
              </a>
            )}
            {row.childCount > 0 && (
              <span className="tree-count" aria-label={`${row.childCount} children`}>
                {row.childCount}
              </span>
            )}
            {isCurrent && <span className="tree-current">current</span>}
          </li>
        );
      })}
    </ul>
  );
};
