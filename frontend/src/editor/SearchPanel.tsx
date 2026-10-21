import { IconButton } from "../ui/IconButton";
import { IconCheck, IconClose } from "../ui/icons";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { Kbd } from "../ui/Kbd";
import { useShortcutHint } from "../ui/shortcuts";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SearchCandidate } from "../api/client";
import { SearchLanguageButton } from "./SearchLanguageButton";
import type { SearchLanguageControl } from "./searchLanguages";
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";
import { firstUsableIndex, matchLine } from "./termSearch";

export interface SearchPanelProps {
  canAssign?: boolean;
  searchManager: SearchManager;
  annotationId: string;
  workspaceKey: WorkspaceKey;
  layerId?: string;
  currentTermId?: string | null;
  onSelectCandidate: (candidate: SearchCandidate, searchId?: string) => void;
  /** Delay before a typed query is sent; avoids one request (and one logged search event) per keystroke. */
  debounceMs?: number;
  /** Present when the layer's ontology has translations loaded; then the language button is shown. */
  languages?: SearchLanguageControl;
  /** Prefilled query: shown selected and searched at once on mount (no debounce). */
  initialQuery?: string;
  /** Focus the field on mount (preventScroll; scrollIntoView({ block: "nearest" }) only if it is outside the viewport). */
  autoFocus?: boolean;
  /** Esc in the field. */
  onEscape?: () => void;
  /** Language hint ("Names are searched in English…"): replaces the empty-field help line, stays under
   * the field while a query is shown and starts the no-hits message. */
  languageHint?: string;
}

export const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_EMPTY_HINT = "Name or code, for example HP:0001250";

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchManager,
  canAssign = true,
  annotationId,
  workspaceKey,
  layerId,
  currentTermId,
  onSelectCandidate,
  debounceMs = SEARCH_DEBOUNCE_MS,
  languages,
  initialQuery,
  autoFocus = false,
  onEscape,
  languageHint,
}) => {
  const languageControl = languages && languages.options.length > 0 ? languages : undefined;
  // Sent with every request when translations are loaded; English is implied.
  const requestLanguages = languageControl?.active;
  const listboxId = useId();
  const hintId = `${listboxId}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // A typed query waits for the debounce; while it waits, the shown hits belong to an older query.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncing, setDebouncing] = useState(false);
  const cancelDebounce = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
    setDebouncing(false);
  };
  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);
  const runSearch = (val: string, immediate = false) => {
    cancelDebounce();
    if (immediate || debounceMs <= 0 || !val.trim()) {
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId, requestLanguages);
      return;
    }
    setDebouncing(true);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      setDebouncing(false);
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId, requestLanguages);
    }, debounceMs);
  };
  const [state, setState] = useState<SearchState>(searchManager.getState());
  const [queryInput, setQueryInput] = useState<string>(initialQuery ?? "");

  useEffect(() => {
    return searchManager.subscribe((nextState) => {
      setState(nextState);
    });
  }, [searchManager]);

  // A new finding starts a new search; the first one may be prefilled and runs at once.
  // Compared by identity, so a replayed mount effect (StrictMode) keeps the prefill.
  const mountIdentity = useRef([annotationId, workspaceKey, layerId, searchManager] as const);
  useEffect(() => {
    cancelDebounce();
    searchManager.clear();
    const identity = [annotationId, workspaceKey, layerId, searchManager] as const;
    const isMount = identity.every((value, index) => Object.is(value, mountIdentity.current[index]));
    const query = isMount ? initialQuery ?? "" : "";
    setQueryInput(query);
    if (query.trim()) runSearch(query, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationId, workspaceKey, layerId, searchManager]);

  // The prefill follows the marked text (late search languages, an adjusted mark) until the user types or clears:
  // the first one runs at once and is shown selected; later ones wait for the normal debounce.
  const prefillSettled = useRef(!!initialQuery?.trim());
  const lastPrefill = useRef(initialQuery ?? "");
  const userTyped = useRef(false);
  const selectPrefill = useRef(false);
  useEffect(() => {
    if (userTyped.current || !initialQuery?.trim()) return;
    if (prefillSettled.current && initialQuery === lastPrefill.current) return;
    const identity = [annotationId, workspaceKey, layerId, searchManager] as const;
    if (!identity.every((value, index) => Object.is(value, mountIdentity.current[index]))) return;
    const first = !prefillSettled.current;
    prefillSettled.current = true;
    lastPrefill.current = initialQuery;
    selectPrefill.current = true;
    setQueryInput(initialQuery);
    runSearch(initialQuery, first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  useLayoutEffect(() => {
    if (!selectPrefill.current) return;
    selectPrefill.current = false;
    const input = inputRef.current;
    if (input && document.activeElement === input) input.select();
  }, [queryInput]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
    // Below the text (701–1024 px) the field may be out of view: bring only the inspector in, never the text pane.
    const rect = input.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) input.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A changed language selection is a new question: ask the pending query again.
  const languagesKey = requestLanguages ? requestLanguages.join(",") : null;
  const lastLanguagesKey = useRef(languagesKey);
  useEffect(() => {
    if (lastLanguagesKey.current === languagesKey) return;
    lastLanguagesKey.current = languagesKey;
    if (queryInput.trim()) runSearch(queryInput, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languagesKey]);

  useShortcutHint(["↓ / ↑", "Enter"], "Move through term hits; add the active hit", { group: "Finding" });

  const isUsable = (c: SearchCandidate): boolean => canAssign && c.obsolete !== true;
  const hasQuery = queryInput.trim() !== "";
  const searching = hasQuery && (debouncing || (state.isLoading && state.query === queryInput));
  const failed = hasQuery && !searching && !!state.error && state.query === queryInput;
  // Hits are shown (and can be added) only when they answer the query in the field.
  const resultsCurrent = hasQuery && state.query === queryInput && !state.isLoading && !debouncing && !state.error;
  const candidates = resultsCurrent ? state.candidates : [];
  const expanded = candidates.length > 0;
  const noHits = resultsCurrent && candidates.length === 0;

  // The active hit resets to the first usable one whenever a new result list arrives.
  const [active, setActive] = useState<{ list: SearchCandidate[]; index: number } | null>(null);
  const activeIndex = active && active.list === state.candidates
    ? active.index
    : firstUsableIndex(state.candidates, canAssign);
  const shownActive = expanded && activeIndex >= 0 && activeIndex < candidates.length ? activeIndex : -1;
  const optionId = (index: number) => `${listboxId}-${index}-${candidates[index].term_id}`;

  const scrollActive = useRef(false);
  useEffect(() => {
    if (!scrollActive.current) return;
    scrollActive.current = false;
    if (shownActive < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-option-index="${shownActive}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [shownActive]);

  const moveActive = (step: 1 | -1) => {
    if (!expanded) return;
    for (let index = shownActive + step; index >= 0 && index < candidates.length; index += step) {
      if (isUsable(candidates[index])) {
        scrollActive.current = true;
        setActive({ list: state.candidates, index });
        return;
      }
    }
  };

  const addCandidate = (candidate: SearchCandidate) => {
    if (isUsable(candidate)) onSelectCandidate(candidate, state.searchId ?? undefined);
  };

  const handleQueryChange = (val: string) => {
    userTyped.current = true;
    setQueryInput(val);
    runSearch(val);
  };

  const handleClear = () => {
    userTyped.current = true;
    cancelDebounce();
    setQueryInput("");
    searchManager.clear();
  };

  const retry = () => runSearch(queryInput, true);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!expanded) return;
        event.preventDefault();
        moveActive(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        event.preventDefault();
        if (resultsCurrent) {
          if (shownActive >= 0) addCandidate(candidates[shownActive]);
          return;
        }
        // A pending or stale search runs now; its hits need a second Enter.
        if (state.isLoading && !debouncing && state.query === queryInput) return;
        retry();
        return;
      case "Escape":
        if (!onEscape) return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      default:
    }
  };

  const usableCount = candidates.filter(isUsable).length;
  const termCount = (count: number) => `${count} ${count === 1 ? "term" : "terms"}`;

  return (
    <div className="search-panel">
      <div className="form-group">
        <label htmlFor="search-input" className="form-label">
          Search term
        </label>
        <div className="search-field-row">
          <input
            ref={inputRef}
            id="search-input"
            type="text"
            role="combobox"
            className="form-control"
            placeholder="Name or code"
            value={queryInput}
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={expanded ? listboxId : undefined}
            aria-activedescendant={shownActive >= 0 ? optionId(shownActive) : undefined}
            aria-describedby={hintId}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          {queryInput && (
            <IconButton label="Clear search" icon={<IconClose />} size="sm" onClick={handleClear} title="Clear search" />
          )}
          {languageControl && <SearchLanguageButton control={languageControl} />}
        </div>
        <div id={hintId} className="search-hint">
          {hasQuery && languageHint && !noHits && <span className="search-hint-language">{languageHint}</span>}
          {!hasQuery ? (
            languageHint ?? DEFAULT_EMPTY_HINT
          ) : searching ? (
            <span role="status">Searching…</span>
          ) : failed ? null : noHits ? (
            `${languageHint ? `${languageHint} ` : ""}No terms match “${queryInput.trim()}”. Change the words, try a code (HP:0001250) or switch search languages.`
          ) : expanded ? (
            canAssign ? (
              <>
                {termCount(usableCount)} · <Kbd>↓</Kbd><Kbd>↑</Kbd> choose · <Kbd>Enter</Kbd> add · <Kbd>Esc</Kbd> cancel
              </>
            ) : (
              termCount(candidates.length)
            )
          ) : null}
        </div>
      </div>

      {failed && (
        <InlineMessage tone="error">
          The term search failed.{" "}
          <Button size="sm" variant="secondary" onClick={retry}>Retry</Button>
        </InlineMessage>
      )}

      {expanded && (
        <ul ref={listRef} id={listboxId} role="listbox" aria-label="Terms" className="candidate-list">
          {candidates.map((cand, index) => {
            const usable = isUsable(cand);
            const isActive = index === shownActive;
            const isSelected = cand.term_id === currentTermId;
            const match = matchLine(cand);
            return (
              <li
                key={`${cand.term_id}-${cand.rank}-${index}`}
                id={optionId(index)}
                data-option-index={index}
                role="option"
                aria-selected={isActive}
                aria-disabled={!usable}
                className={`candidate-card${cand.obsolete ? " candidate-obsolete" : ""}`}
                // Keep the focus in the field: the hits are options of the combobox, not buttons.
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={() => {
                  if (usable && !isActive) setActive({ list: state.candidates, index });
                }}
                onClick={() => addCandidate(cand)}
              >
                <div className="candidate-header">
                  <strong className="candidate-label">{cand.label}</strong>
                  <span className="candidate-id">{cand.term_id}</span>
                  {isActive && canAssign && <Kbd>Enter</Kbd>}
                </div>
                {match && <div className="candidate-match" title={cand.match_kind}>{match}</div>}
                {cand.definition && (
                  <div className={`candidate-def${isActive ? "" : " is-clamped"}`}>{cand.definition}</div>
                )}
                {cand.obsolete && (
                  <span className="warning-badge">
                    Obsolete term (assignment not allowed)
                  </span>
                )}
                {isSelected && (
                  <span className="candidate-selected">
                    <IconCheck /> Currently selected
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
