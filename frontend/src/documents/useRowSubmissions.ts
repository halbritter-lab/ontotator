import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RowSubmissions } from "../api/client";

export interface RowSubmissionsState {
  /** Submissions of the row; kept while `reload` runs, null after an error or a row change. */
  data: RowSubmissions | null;
  error: unknown | null;
  /** True while a request for this row is in flight (actions stay unavailable). */
  loading: boolean;
  reload: () => void;
  retry: () => void;
}

interface Snapshot { data: RowSubmissions | null; error: unknown | null; loading: boolean }

/**
 * Submissions of one expanded row, loaded only while `enabled`. Responses older than the
 * latest request for the same data are discarded; `reload()` refetches after an own action.
 * Background refresh (focus, 60 s) belongs to the rows hook; the page calls `reload` with it.
 */
export function useRowSubmissions(projectKey: string, caseId: string, language: string, enabled: boolean): RowSubmissionsState {
  const generation = useRef(0);
  const [state, setState] = useState<Snapshot>({ data: null, error: null, loading: enabled });
  const identity = JSON.stringify([projectKey, caseId, language, enabled]);

  const load = useCallback(() => {
    const current = ++generation.current;
    if (!enabled) { setState({ data: null, error: null, loading: false }); return; }
    setState(previous => ({ ...previous, loading: true }));
    api.getRowSubmissions(projectKey, caseId, language).then(
      data => { if (current === generation.current) setState({ data, error: null, loading: false }); },
      error => { if (current === generation.current) setState({ data: null, error, loading: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    setState({ data: null, error: null, loading: enabled });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => () => { generation.current += 1; }, []);

  return { ...state, reload: load, retry: load };
}
