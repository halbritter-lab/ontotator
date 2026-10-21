import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FinalPanelView, type RowSubmissions } from "../api/client";

export interface FinalPanelData {
  /** The panel's view (`GET …/final-panel`). */
  panel: FinalPanelView;
  /** The row's submissions with rounds and open translation reviews (cause and waiting lines). */
  submissions: RowSubmissions;
}

export interface FinalPanelState {
  /** Kept while a reload runs; null after an error or a row change. */
  data: FinalPanelData | null;
  error: unknown | null;
  loading: boolean;
  /** Guideline version in force ("Guidelines v2 (current: v3)"); null when unknown. */
  guidelineCurrent: number | null;
  reload: () => void;
}

interface Snapshot { identity: string; data: FinalPanelData | null; error: unknown | null; loading: boolean }

/**
 * Data of the final-result panel for one row: the panel view and the row's submissions, loaded
 * together. `refresh` is the current rows page: each new page (a refetch) reloads the data in place.
 * Responses older than the latest request are discarded.
 */
export function useFinalPanel(projectKey: string, caseId: string, language: string, refresh?: unknown): FinalPanelState {
  const identity = JSON.stringify([projectKey, caseId, language]);
  const generation = useRef(0);
  const [state, setState] = useState<Snapshot>({ identity, data: null, error: null, loading: true });
  const [guidelineCurrent, setGuidelineCurrent] = useState<number | null>(null);

  const load = useCallback(() => {
    const current = ++generation.current;
    setState(previous => (previous.identity === identity ? { ...previous, loading: true } : { identity, data: null, error: null, loading: true }));
    Promise.all([api.finalPanel(projectKey, caseId, language), api.getRowSubmissions(projectKey, caseId, language)]).then(
      ([panel, submissions]) => { if (current === generation.current) setState({ identity, data: { panel, submissions }, error: null, loading: false }); },
      error => { if (current === generation.current) setState({ identity, data: null, error, loading: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // A row change loads at once; a new rows page reloads in place.
  useEffect(() => { load(); }, [load, refresh]);
  useEffect(() => () => { generation.current += 1; }, []);

  // Version in force, once per project; a failed read only drops the comparison.
  useEffect(() => {
    let active = true;
    void api.listGuidelines(projectKey).then(listing => listing.current?.version ?? null, () => null).then(version => { if (active) setGuidelineCurrent(version); });
    return () => { active = false; };
  }, [projectKey]);

  const own = state.identity === identity ? state : { data: null, error: null, loading: true };
  return { data: own.data, error: own.error, loading: own.loading, guidelineCurrent, reload: load };
}
