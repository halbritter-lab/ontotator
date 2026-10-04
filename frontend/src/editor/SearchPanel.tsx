import React, { useEffect, useState } from "react";
import type { SearchCandidate } from "../api/client";
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";

export interface SearchPanelProps {
  searchManager: SearchManager;
  annotationId: string;
  workspaceKey: WorkspaceKey;
  layerId?: string;
  currentTermId?: string | null;
  onSelectCandidate: (candidate: SearchCandidate, searchId?: string) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchManager,
  annotationId,
  workspaceKey,
  layerId,
  currentTermId,
  onSelectCandidate,
}) => {
  const [state, setState] = useState<SearchState>(searchManager.getState());
  const [route, setRoute] = useState<"lexical" | "exact" | "id" | "browse">("lexical");
  const [userSelectedRoute, setUserSelectedRoute] = useState<boolean>(false);
  const [queryInput, setQueryInput] = useState<string>("");

  useEffect(() => {
    return searchManager.subscribe((nextState) => {
      setState(nextState);
    });
  }, [searchManager]);

  useEffect(() => {
    searchManager.clear();
    setQueryInput("");
    setUserSelectedRoute(false);
    setRoute("lexical");
  }, [annotationId, workspaceKey, layerId, searchManager]);

  const isIdLike = (q: string): boolean => {
    const trimmed = q.trim();
    return /^\d+$/.test(trimmed) || /^[A-Za-z]+:\d+$/i.test(trimmed);
  };

  const handleQueryChange = (val: string) => {
    setQueryInput(val);
    let effectiveRoute = route;
    if (!userSelectedRoute) {
      if (isIdLike(val)) {
        effectiveRoute = "id";
        setRoute("id");
      } else if (route === "id" && !isIdLike(val)) {
        effectiveRoute = "lexical";
        setRoute("lexical");
      }
    }
    searchManager.search(val, annotationId, workspaceKey, effectiveRoute, 10, layerId);
  };

  const handleClear = () => {
    setQueryInput("");
    setUserSelectedRoute(false);
    setRoute("lexical");
    searchManager.clear();
  };

  const handleRouteChange = (newRoute: "lexical" | "exact" | "id" | "browse") => {
    setUserSelectedRoute(true);
    setRoute(newRoute);
    if (queryInput) {
      searchManager.search(queryInput, annotationId, workspaceKey, newRoute, 10, layerId);
    }
  };

  const isObsolete = (c: SearchCandidate): boolean => c.obsolete === true;

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
            placeholder="Search term or identifier (e.g. 1250, HP:0001250, MONDO:0001250)"
            value={queryInput}
            onChange={(e) => handleQueryChange(e.target.value)}
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
          Pure digits search the main ontology. For other prefixes, provide the full identifier (e.g. MONDO:0001250).
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="search-route-select" className="form-label">
          Search Strategy
        </label>
        <select
          id="search-route-select"
          className="form-select"
          value={route}
          onChange={(e) =>
            handleRouteChange(e.target.value as "lexical" | "exact" | "id" | "browse")
          }
        >
          <option value="lexical">Lexical similarity</option>
          <option value="exact">Exact term</option>
          <option value="id">Identifier (e.g. HP:..., MONDO:...)</option>
          <option value="browse">Hierarchy (Parents/Children)</option>
        </select>
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
                    Match: »{cand.matched_term}« ({cand.match_kind})
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
