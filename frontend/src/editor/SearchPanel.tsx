import { IconButton } from "../ui/IconButton";
import { IconCheck, IconClose } from "../ui/icons";
import { Button } from "../ui/Button";
import { FilterChip } from "../ui/FilterChip";
import { InlineMessage } from "../ui/InlineMessage";
import { Kbd } from "../ui/Kbd";
import { useShortcutHint } from "../ui/shortcuts";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SearchCandidate } from "../api/client";
import { SearchLanguageButton } from "./SearchLanguageButton";
import type { SearchLanguageControl } from "./searchLanguages";
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";
import { matchLine } from "./termSearch";
import { COHORT_TAG, MODIFIER_ROOTS } from "./modifiers";
import "./modifiers.css";

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
  /** "modifier": the "+ Add modifier…" search (label "Search modifier", hits only under MODIFIER_ROOTS). */
  mode?: "finding" | "modifier";
  /** "change": a modifier hit cannot become the finding's term (spec "Attach mode" 10). */
  assignMode?: "new" | "change" | "modifier";
  /** New mark: a modifier hit is reported here instead of being assigned (attach mode, E-a). */
  onPickModifier?: (candidate: SearchCandidate, searchId?: string) => void;
  /** The layer's profile classifies modifiers (HPO phenotype): offer the "Modifiers only" chip and the `mod:` prefix (M2 M-3). */
  modifierFilter?: boolean;
}

/** Reason line of a modifier hit in "Change term". */
export const MODIFIER_IN_CHANGE = "Modifier — add it under Modifiers instead.";
const isModifierHit = (c: SearchCandidate) => c.role === "modifier" || c.role === "cohort";

export const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_EMPTY_HINT = "Name or code, for example HP:0001250";
/** Typed at the start of the query, switches "Modifiers only" on and is removed from the query (M2 M-3). */
export const MODIFIER_PREFIX = "mod:";
export const MODIFIER_PREFIX_HINT = "mod: searches modifiers only.";

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
  mode = "finding",
  assignMode = "new",
  onPickModifier,
  modifierFilter = false,
}) => {
  const [modifiersOnly, setModifiersOnly] = useState(false);
  // "Modifiers only" switched on by the `mod:` prefix: an emptied field switches it off again.
  const modifiersFromPrefix = useRef(false);
  const offerModifierFilter = modifierFilter && mode === "finding";
  const within = mode === "modifier" || (offerModifierFilter && modifiersOnly) ? MODIFIER_ROOTS : undefined;
  // "/" focuses #search-input (the term search); the modifier search has its own id.
  const inputId = mode === "modifier" ? "modifier-search-input" : "search-input";
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
  /** `roots`: null searches every term; omitted, the current filter. */
  const runSearch = (val: string, immediate = false, roots: readonly string[] | null = within ?? null) => {
    cancelDebounce();
    if (immediate || debounceMs <= 0 || !val.trim()) {
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId, requestLanguages, roots ?? undefined);
      return;
    }
    setDebouncing(true);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      setDebouncing(false);
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId, requestLanguages, roots ?? undefined);
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
    if (!isMount) dropPrefixFilter();
    if (query.trim()) runSearch(query, true, isMount ? within ?? null : mode === "modifier" ? MODIFIER_ROOTS : null);
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

  const isUsable = (c: SearchCandidate): boolean =>
    canAssign && c.obsolete !== true && !(assignMode === "change" && isModifierHit(c));
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
    : state.candidates.findIndex(isUsable);
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
    if (!isUsable(candidate)) return;
    if (onPickModifier && isModifierHit(candidate)) onPickModifier(candidate, state.searchId ?? undefined);
    else onSelectCandidate(candidate, state.searchId ?? undefined);
  };

  // Enter pressed while the search for this query was pending: add the active hit once its answer arrives.
  const queuedEnter = useRef<string | null>(null);
  useEffect(() => {
    if (queuedEnter.current === null || searching) return;
    const query = queuedEnter.current;
    queuedEnter.current = null;
    if (resultsCurrent && query === queryInput && shownActive >= 0) addCandidate(candidates[shownActive]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, resultsCurrent, queryInput]);

  const handleQueryChange = (val: string) => {
    userTyped.current = true;
    const start = val.trimStart();
    if (offerModifierFilter && start.slice(0, MODIFIER_PREFIX.length).toLowerCase() === MODIFIER_PREFIX) {
      const rest = start.slice(MODIFIER_PREFIX.length).trimStart();
      if (!modifiersOnly) modifiersFromPrefix.current = true;
      setModifiersOnly(true);
      setQueryInput(rest);
      runSearch(rest, false, MODIFIER_ROOTS);
      return;
    }
    if (!val.trim() && modifiersFromPrefix.current) dropPrefixFilter();
    setQueryInput(val);
    runSearch(val);
  };

  const dropPrefixFilter = () => {
    modifiersFromPrefix.current = false;
    setModifiersOnly(false);
  };

  const toggleModifiersOnly = (on: boolean) => {
    modifiersFromPrefix.current = false;
    setModifiersOnly(on);
    if (queryInput.trim()) runSearch(queryInput, true, on ? MODIFIER_ROOTS : null);
    inputRef.current?.focus({ preventScroll: true });
  };

  const handleClear = () => {
    userTyped.current = true;
    if (modifiersFromPrefix.current) dropPrefixFilter();
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
        // A pending or stale search runs now; its active hit is added when it answers.
        if (hasQuery) queuedEnter.current = queryInput;
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

  // The count names the listed hits; the keys line only when one of them can be added.
  const noun = within ? "modifier" : "term";
  const hitCount = `${candidates.length} ${noun}${candidates.length === 1 ? "" : "s"}`;
  const anyUsable = candidates.some(isUsable);

  return (
    <div className="search-panel">
      <div className="form-group">
        <label htmlFor={inputId} className="form-label">
          {mode === "modifier" ? "Search modifier" : "Search term"}
        </label>
        <div className="search-field-row">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            className="form-control"
            placeholder={mode === "modifier" ? "Severity, onset, pattern…" : "Name or code"}
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
        {offerModifierFilter && <div className="search-filter-row">
          {modifiersOnly
            ? <FilterChip label="Modifiers only" onRemove={() => toggleModifiersOnly(false)} />
            : <Button size="sm" aria-pressed="false" onClick={() => toggleModifiersOnly(true)}>Modifiers only</Button>}
        </div>}
        <div id={hintId} className="search-hint">
          {hasQuery && languageHint && !noHits && <span className="search-hint-language">{languageHint}</span>}
          {!hasQuery ? (
            <>{languageHint ?? DEFAULT_EMPTY_HINT}{offerModifierFilter && !modifiersOnly && `${languageHint ? " " : ". "}${MODIFIER_PREFIX_HINT}`}</>
          ) : searching ? (
            <span role="status">Searching…</span>
          ) : failed ? null : noHits ? (
            `${languageHint ? `${languageHint} ` : ""}No terms match “${queryInput.trim()}”. Change the words, try a code (HP:0001250) or switch search languages.`
          ) : expanded ? (
            anyUsable ? (
              <>
                {hitCount}, <Kbd>↓</Kbd><Kbd>↑</Kbd> choose, <Kbd>Enter</Kbd> add, <Kbd>Esc</Kbd> cancel
              </>
            ) : (
              hitCount
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

      {/* The active hit (the first usable one by default); with none usable, the first hit for reference (spec F4.2). */}
      {expanded && <SearchDetail hit={candidates[shownActive >= 0 ? shownActive : 0]} />}

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
                  <strong className="candidate-label" title={cand.label}>{cand.label}</strong>
                  <span className="candidate-id">{cand.term_id}</span>
                  {isModifierHit(cand) && <span className="candidate-role">{cand.role === "cohort" ? COHORT_TAG : "Modifier"}</span>}
                  {canAssign && (
                    // Reserved in every row and shown only on the active one, so activity never changes the layout.
                    <span className="candidate-enter" aria-hidden="true"><Kbd><span className="candidate-enter-word">Enter</span><span className="candidate-enter-symbol">⏎</span></Kbd></span>
                  )}
                </div>
                {match && <div className="candidate-match" title={cand.match_kind}>{match}</div>}
                {cand.definition && (
                  // Clamped visually; the full definition stays in the option for screen readers.
                  <div className="candidate-def">{cand.definition}</div>
                )}
                {assignMode === "change" && isModifierHit(cand) && <span className="candidate-reason">{MODIFIER_IN_CHANGE}</span>}
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

/** Fixed-height area above the hits with the active hit in full; a visual duplicate of the active option.
 * Label and code are drawn from data attributes (CSS generated content), so the option stays the only
 * element with that text: text queries and find-in-page land on the hit, not on its duplicate. */
const SearchDetail: React.FC<{ hit: SearchCandidate }> = ({ hit }) => (
  <div className="search-detail" data-search-detail aria-hidden="true">
    <p className="search-detail__head">
      <span className="search-detail__label" data-text={hit.label} />{" "}
      <span className="search-detail__code" data-text={hit.term_id} />
    </p>
    <p>{hit.definition || "No definition."}</p>
    {matchLine(hit) && hit.matched_term && <p className="search-detail__match">Matched: {hit.matched_term}</p>}
    {hit.obsolete && <p className="warning-badge">Obsolete term (assignment not allowed)</p>}
  </div>
);
