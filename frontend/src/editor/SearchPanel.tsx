import React, { useEffect, useState } from "react";
import type { SearchCandidate } from "../api/client";
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";

export interface SearchPanelProps {
  searchManager: SearchManager;
  annotationId: string;
  workspaceKey: WorkspaceKey;
  currentHpoId?: string | null;
  onSelectCandidate: (candidate: SearchCandidate) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchManager,
  annotationId,
  workspaceKey,
  currentHpoId,
  onSelectCandidate,
}) => {
  const [state, setState] = useState<SearchState>(searchManager.getState());
  const [route, setRoute] = useState<"lexical" | "exact" | "id" | "browse">("lexical");
  const [queryInput, setQueryInput] = useState<string>("");

  useEffect(() => {
    return searchManager.subscribe((nextState) => {
      setState(nextState);
    });
  }, [searchManager]);

  const handleQueryChange = (val: string) => {
    setQueryInput(val);
    searchManager.search(val, annotationId, workspaceKey, route);
  };

  const handleRouteChange = (newRoute: "lexical" | "exact" | "id" | "browse") => {
    setRoute(newRoute);
    if (queryInput) {
      searchManager.search(queryInput, annotationId, workspaceKey, newRoute);
    }
  };

  const isObsolete = (c: SearchCandidate): boolean => {
    return (
      c.match_kind === "obsolete" ||
      c.label.toLowerCase().includes("obsolete") ||
      c.definition.toLowerCase().includes("obsolete")
    );
  };

  return (
    <div className="search-panel">
      <div className="form-group">
        <label htmlFor="search-input" className="form-label">
          HPO-Term suchen
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            id="search-input"
            type="text"
            className="form-control"
            placeholder="Suchbegriff oder HP:000..."
            value={queryInput}
            onChange={(e) => handleQueryChange(e.target.value)}
            autoComplete="off"
          />
          {queryInput && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleQueryChange("")}
              title="Suche zurücksetzen"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="search-route-select" className="form-label">
          Suchweg
        </label>
        <select
          id="search-route-select"
          className="form-select"
          value={route}
          onChange={(e) =>
            handleRouteChange(e.target.value as "lexical" | "exact" | "id" | "browse")
          }
        >
          <option value="lexical">Lexikalische Ähnlichkeit</option>
          <option value="exact">Exakter Begriff</option>
          <option value="id">HPO-Kennung (HP:...)</option>
          <option value="browse">Hierarchie (Eltern/Kinder)</option>
        </select>
      </div>

      {state.isLoading && (
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", padding: "8px 0" }}>
          Suche läuft...
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
          Fehler: {state.error}
        </div>
      )}

      {state.candidates.length > 0 && (
        <ul className="candidate-list">
          {state.candidates.map((cand) => {
            const obsolete = isObsolete(cand);
            const isSelected = cand.hpo_id === currentHpoId;

            return (
              <li
                key={`${cand.hpo_id}-${cand.rank}`}
                className={`candidate-card ${obsolete ? "candidate-obsolete" : ""}`}
                style={
                  isSelected
                    ? { outline: "2px solid var(--primary)", background: "var(--primary-light)" }
                    : undefined
                }
                onClick={() => {
                  if (!obsolete) {
                    onSelectCandidate(cand);
                  }
                }}
              >
                <div className="candidate-header">
                  <span className="candidate-label">{cand.label}</span>
                  <span className="candidate-id">{cand.hpo_id}</span>
                </div>
                {cand.matched_term && cand.matched_term !== cand.label && (
                  <div style={{ fontSize: "0.8rem", color: "var(--primary)", marginBottom: 2 }}>
                    Treffer: »{cand.matched_term}« ({cand.match_kind})
                  </div>
                )}
                {cand.definition && <div className="candidate-def">{cand.definition}</div>}
                {obsolete && (
                  <span className="warning-badge">
                    Veralteter Begriff (obsolet - Zuweisung nicht zulässig)
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
                    ✓ Aktuell ausgewählt
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
