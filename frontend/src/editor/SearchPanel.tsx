import React, { useEffect, useRef, useState } from "react";
import type { SearchCandidate } from "../api/client";
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";

export interface SearchPanelProps {
  searchManager: SearchManager;
  annotationId: string;
  workspaceKey: WorkspaceKey;
  layerId?: string;
  currentTermId?: string | null;
  onSelectCandidate: (candidate: SearchCandidate, searchId?: string) => void;
  /** Delay before a typed query is sent; avoids one request (and one logged search event) per keystroke. */
  debounceMs?: number;
}

export const SEARCH_DEBOUNCE_MS = 250;

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchManager,
  annotationId,
  workspaceKey,
  layerId,
  currentTermId,
  onSelectCandidate,
  debounceMs = SEARCH_DEBOUNCE_MS,
}) => {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDebounce = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
  };
  useEffect(() => cancelDebounce, []);
  const runSearch = (val: string, immediate = false) => {
    cancelDebounce();
    if (immediate || debounceMs <= 0 || !val.trim()) {
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId);
    }, debounceMs);
  };
  const [state, setState] = useState<SearchState>(searchManager.getState());
  const [queryInput, setQueryInput] = useState<string>("");

  useEffect(() => {
    return searchManager.subscribe((nextState) => {
      setState(nextState);
    });
  }, [searchManager]);

  useEffect(() => {
    cancelDebounce();
    searchManager.clear();
    setQueryInput("");
  }, [annotationId, workspaceKey, layerId, searchManager]);

  const handleQueryChange = (val: string) => {
    setQueryInput(val);
    runSearch(val);
  };

  const handleClear = () => {
    cancelDebounce();
    setQueryInput("");
    searchManager.clear();
  };

  const isObsolete = (c: SearchCandidate): boolean => c.obsolete === true;

  // What matched, and in which language when it was not an English name.
  const matchDetail = (c: SearchCandidate): string =>
    c.match_language && c.match_language !== "en"
      ? `${c.match_kind}, ${c.match_language}`
      : `${c.match_kind}`;

  return (
    <div className="search-panel">
      <div className="form-group">
        <label htmlFor="search-input" className="form-label">
          Search ontology term
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            id="search-input"
            type="text"
            className="form-control"
            placeholder="Name or code"
            value={queryInput}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch(queryInput, true);
              }
            }}
            autoComplete="off"
          />
          {queryInput && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleClear}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
          Search by name or code (e.g. HP:0001250)
        </div>
      </div>

      {state.isLoading && (
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", padding: "8px 0" }}>
          Searching...
        </div>
      )}

      {state.error && (
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--danger)",
            background: "var(--danger-light)",
            padding: "8px 12px",
            borderRadius: "var(--radius)",
            marginBottom: 8,
          }}
        >
          Error: {state.error}
        </div>
      )}

      {state.candidates.length > 0 && (
        <ul className="candidate-list">
          {state.candidates.map((cand) => {
            const obsolete = isObsolete(cand);
            const candidateTermId = cand.term_id;
            const targetTermId = currentTermId;
            const isSelected = candidateTermId === targetTermId;

            return (
              <li
                key={`${candidateTermId}-${cand.rank}`}
                role="button"
                tabIndex={obsolete ? -1 : 0}
                aria-disabled={obsolete}
                onKeyDown={(event) => {
                  if (!obsolete && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onSelectCandidate(cand, state.searchId ?? undefined);
                  }
                }}
                className={`candidate-card ${obsolete ? "candidate-obsolete" : ""}`}
                style={
                  isSelected
                    ? { outline: "2px solid var(--primary)", background: "var(--primary-light)" }
                    : undefined
                }
                onClick={() => {
                  if (!obsolete) {
                    onSelectCandidate(cand, state.searchId ?? undefined);
                  }
                }}
              >
                <div className="candidate-header">
                  <span className="candidate-label">{cand.label}</span>
                  <span className="candidate-id">{candidateTermId}</span>
                </div>
                {cand.matched_term && cand.matched_term !== cand.label && (
                  <div style={{ fontSize: "0.8rem", color: "var(--primary)", marginBottom: 2 }}>
                    {`Match: »${cand.matched_term}« (${matchDetail(cand)})`}
                  </div>
                )}
                {cand.definition && <div className="candidate-def">{cand.definition}</div>}
                {obsolete && (
                  <span className="warning-badge">
                    Obsolete term (assignment not allowed)
                  </span>
                )}
                {isSelected && (
                  <span
                    style={{
                      display: "inline-block",
                      marginTop: 4,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "var(--primary)",
                    }}
                  >
                    ✓ Currently selected
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
